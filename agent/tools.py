"""The investigator's tools. Code does every calculation; the model chooses
which check to run next and interprets the results.

Each tool returns a JSON-serialisable dict. Anything the model may cite
carries an evidence ID, and every ID handed out is recorded in
`registry`, so the validator can reject citations to evidence that was
never produced.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from core.checks import run_checks
from core.physics import PowerModel, coverage, power_vs_load, treatment_interval, water_balance, window
from store.cases import Bundle

SIGNAL_INFO = {
    "S1": ("Intake flow", "m3/h"),
    "S2": ("ETP inflow", "m3/h"),
    "S3": ("ETP power", "kW"),
    "S4a": ("Outfall flow", "m3/h"),
    "S4b": ("Outfall pH", "pH"),
    "S4c": ("Outfall conductivity", "uS/cm"),
    "T1": ("Equalization tank level", "fraction of volume"),
}
# how far a reading read off a meter may sit from the feed and still agree
READING_TOLERANCE = {"S1": (0.06, 2.0), "S2": (0.06, 2.0), "S3": (0.08, 2.0), "S4a": (0.06, 2.0),
                     "S4b": (0.0, 0.15), "S4c": (0.05, 50.0), "T1": (0.0, 0.03)}
MAX_POINTS = 36
TERMINAL = {"request_evidence", "submit_assessment"}
FREE = TERMINAL | {"update_hypotheses", "get_case_overview"}  # do not use up checks
STATUSES = ("supports", "contradicts", "insufficient", "review_required")


def _fmt(t: pd.Timestamp) -> str:
    return t.strftime("%Y-%m-%d %H:%M")


def _span_id(start: pd.Timestamp, end: pd.Timestamp) -> str:
    return f"{start:%m%d-%H%M}..{end:%m%d-%H%M}"


def _r(x, digits=1):
    if x is None or (isinstance(x, float) and math.isnan(x)):
        return None
    return round(float(x), digits)


class ToolError(Exception):
    pass


@dataclass
class CaseTools:
    bundle: Bundle
    power_model: PowerModel
    budget: int = 12
    registry: dict = field(default_factory=dict)
    calls: list = field(default_factory=list)
    final: dict | None = None
    ledger: list = field(default_factory=list)  # every update_hypotheses call, in order

    # ---- helpers

    @property
    def cfg(self):
        return self.bundle.cfg

    def _time(self, value: str) -> pd.Timestamp:
        try:
            t = pd.Timestamp(value)
        except (ValueError, TypeError) as exc:
            raise ToolError(f"could not read time {value!r}; use ISO 8601, e.g. 2026-10-13T14:00") from exc
        t = t.tz_localize(self.cfg.timezone) if t.tzinfo is None else t.tz_convert(self.cfg.timezone)
        return min(max(t, self.bundle.start), self.bundle.end)

    def _window(self, start: str, end: str) -> tuple[pd.Timestamp, pd.Timestamp]:
        s, e = self._time(start), self._time(end)
        if e <= s:
            raise ToolError("end must be after start")
        return s, e

    def _register(self, eid: str, kind: str, summary: dict) -> str:
        self.registry[eid] = {"kind": kind, **summary}
        return eid

    def _gaps(self, signal: str, start, end) -> list[list[str]]:
        w = window(self.bundle.signals, start, end)[signal]
        if signal == "T1":
            w = w[w.index.minute % self.cfg.sensors.tank_level_resolution_minutes == 0]
        missing = w.isna()
        out, run_start = [], None
        step = w.index[1] - w.index[0] if len(w) > 1 else pd.Timedelta(minutes=5)
        for t, m in missing.items():
            if m and run_start is None:
                run_start = t
            if not m and run_start is not None:
                if t - run_start >= pd.Timedelta(minutes=30):
                    out.append([_fmt(run_start), _fmt(t)])
                run_start = None
        if run_start is not None and w.index[-1] + step - run_start >= pd.Timedelta(minutes=30):
            out.append([_fmt(run_start), _fmt(w.index[-1] + step)])
        return out

    # ---- dispatch

    def call(self, name: str, args: dict) -> dict:
        """Run a tool by name. Errors come back as results so the model can recover."""
        if self.final is not None and name != "submit_assessment":
            return {"error": "the investigation has already finished"}
        args = dict(args or {})
        why = args.pop("why", None)
        used = self.checks_used
        if name not in FREE and used >= self.budget:
            return {"error": f"tool budget of {self.budget} checks is spent; submit an assessment or an evidence request now"}
        fn = getattr(self, f"tool_{name}", None)
        if fn is None:
            return {"error": f"unknown tool {name!r}"}
        try:
            result = fn(**args)
        except ToolError as exc:
            result = {"error": str(exc)}
        except TypeError as exc:
            result = {"error": f"bad arguments: {exc}"}
        self.calls.append({"name": name, "args": args, "why": why, "result": result})
        return result

    @property
    def checks_used(self) -> int:
        return sum(1 for c in self.calls if c["name"] not in FREE)

    # ---- tools

    def tool_get_case_overview(self) -> dict:
        b = self.bundle
        batch = b.target_batch
        bs, be = pd.Timestamp(batch["start"]), pd.Timestamp(batch["end"])
        ts, te = treatment_interval(bs, be, self.cfg)
        alerts = [a for a in run_checks(b.signals, self.cfg, self.power_model) if a.start < te and a.end > ts]
        for a in alerts:
            self._register(f"alert:{a.id}", "alert", {"check": a.check, "start": _fmt(a.start), "end": _fmt(a.end)})
        signals = {}
        for sig, (name, unit) in SIGNAL_INFO.items():
            signals[sig] = {"name": name, "unit": unit, "coverage_of_treatment_interval": _r(coverage(b.signals, sig, ts, te), 3),
                            "gaps": self._gaps(sig, ts, te)}
        lim = self.cfg.discharge_limits
        return {
            "case_id": b.case_id,
            "claim": "The factory states this batch's wastewater was treated in its ETP before discharge.",
            "batch": {"id": batch["id"], "production_start": _fmt(bs), "production_end": _fmt(be), "shade": batch["shade"],
                      "planned_wastewater_m3": batch["planned_wastewater_m3"]},
            "treatment_interval": {"start": _fmt(ts), "end": _fmt(te),
                                   "basis": f"production window shifted by {self.cfg.etp.residence_min_h:g} to {self.cfg.etp.residence_max_h:g} h residence"},
            "case_data_range": {"start": _fmt(b.start), "end": _fmt(b.end)},
            "plant": {"equalization_tank_m3": self.cfg.etp.equalization.volume_m3, "reuse_fraction": self.cfg.water.reuse_fraction,
                      "discharge_limits": {"bod_mg_l": lim.bod_mg_l, "ph": [lim.ph_min, lim.ph_max]}},
            "signals": signals,
            "documents": [{"id": d["id"], "type": d["type"], "covers": d["covers"], "received_at": d["received_at"],
                           "author": d["author"], "factory_claim": d["is_claim"]} for d in b.documents],
            "alerts": [{"id": f"alert:{a.id}", "check": a.check, "start": _fmt(a.start), "end": _fmt(a.end),
                        "summary": a.summary, "metrics": a.metrics} for a in alerts],
            "budget": {"checks_allowed": self.budget},
        }

    def tool_get_signal_window(self, signal: str, start: str, end: str) -> dict:
        if signal not in SIGNAL_INFO:
            raise ToolError(f"unknown signal {signal!r}; choose from {', '.join(SIGNAL_INFO)}")
        s, e = self._window(start, end)
        w = window(self.bundle.signals, s, e)[signal].dropna()
        cov = coverage(self.bundle.signals, signal, s, e)
        eid = f"sig:{signal}@{_span_id(s, e)}"
        out = {"evidence_id": eid, "signal": signal, "name": SIGNAL_INFO[signal][0], "unit": SIGNAL_INFO[signal][1],
               "start": _fmt(s), "end": _fmt(e), "coverage": _r(cov, 3), "gaps": self._gaps(signal, s, e)}
        if w.empty:
            out["note"] = "no readings in this window"
            self._register(eid, "signal", {"signal": signal, "start": _fmt(s), "end": _fmt(e), "coverage": 0})
            return out
        digits = 2 if signal in ("S4b", "T1") else 1
        hours = (e - s) / pd.Timedelta(hours=1)
        step_min = max(5, int(math.ceil(hours * 60 / MAX_POINTS / 5) * 5))
        series = w.resample(f"{step_min}min").mean().dropna()
        flags = []
        if len(w) >= 12 and float(w.std()) < 1e-6:
            flags.append("readings do not change at all (flat)")
        # a spike stands out from its own neighbours, not just from the window
        local = w.rolling(7, center=True, min_periods=3).median()
        jitter = float((w - local).abs().median()) or 1e-9
        spikes = int(((w - local).abs() > 10 * jitter).sum()) if jitter > 1e-6 else 0
        if spikes >= 3 and spikes < 0.2 * len(w):
            flags.append(f"{spikes} isolated spikes far from the window's typical value")
        out.update({"mean": _r(w.mean(), digits), "min": _r(w.min(), digits), "max": _r(w.max(), digits),
                    "std": _r(w.std(), digits), "resolution_minutes": step_min,
                    "series": [[t.strftime("%m-%d %H:%M"), _r(v, digits)] for t, v in series.items()], "flags": flags})
        self._register(eid, "signal", {"signal": signal, "start": _fmt(s), "end": _fmt(e), "mean": out["mean"], "min": out["min"], "max": out["max"]})
        return out

    def tool_compute_water_balance(self, start: str, end: str) -> dict:
        s, e = self._window(start, end)
        wb = water_balance(self.bundle.signals, s, e, self.cfg)
        eid = f"calc:water_balance@{_span_id(s, e)}"
        out = {"evidence_id": eid, **wb,
               "note": "ETP balance: treated flow reaching the outfall vs outfall flow (same time). "
                       "Boundary balance: intake vs outfall + losses + sludge water + tank storage change (reuse cancels). "
                       "Tank balance: wastewater arriving vs ETP inflow + storage change; unaccounted water left the tank another way. "
                       "null means a required signal is under 80% coverage."}
        self._register(eid, "calculation", {"etp": wb["etp"], "boundary": wb["boundary"]})
        return out

    def tool_check_power_vs_load(self, start: str, end: str) -> dict:
        s, e = self._window(start, end)
        r = power_vs_load(self.bundle.signals, s, e, self.power_model, self.cfg)
        eid = f"calc:power_vs_load@{_span_id(s, e)}"
        if r is None:
            out = {"evidence_id": eid, "result": None, "note": "ETP inflow or power under 80% coverage in this window"}
        else:
            ratio = r["observed_mean_kw"] / r["expected_mean_kw"] if r["expected_mean_kw"] else None
            out = {"evidence_id": eid, **r, "observed_as_share_of_expected": _r(ratio, 2),
                   "note": "Expected band fitted on the factory's normal-operation baseline from ETP inflow; "
                           "with the ETP off, expected is standby power."}
        self._register(eid, "calculation", {k: v for k, v in out.items() if k not in ("note",)})
        return out

    def tool_compare_similar_windows(self, signal: str, start: str, end: str) -> dict:
        if signal not in SIGNAL_INFO:
            raise ToolError(f"unknown signal {signal!r}")
        s, e = self._window(start, end)
        target = window(self.bundle.signals, s, e)[signal]
        comparisons = []
        for days in (-2, -1, 1, 2):
            offset = pd.Timedelta(days=days)
            if s + offset < self.bundle.start or e + offset > self.bundle.end + pd.Timedelta(minutes=5):
                continue
            other = window(self.bundle.signals, s + offset, e + offset)[signal]
            a, b = target.to_numpy(), other.to_numpy()[: len(target)]
            ok = ~(np.isnan(a) | np.isnan(b[: len(a)]))
            if ok.sum() < 6:
                continue
            a, b = a[ok], b[: len(ok)][ok]
            diff = np.abs(a - b)
            corr = float(np.corrcoef(a, b)[0, 1]) if a.std() > 1e-9 and b.std() > 1e-9 else None
            # longest stretch where the two days match reading for reading
            times = target.index[ok]
            best, run_start, best_span = 0, None, None
            for i, same in enumerate(diff < 1e-6):
                if same and run_start is None:
                    run_start = i
                if (not same or i == len(diff) - 1) and run_start is not None:
                    end_i = i if same else i - 1
                    if end_i - run_start + 1 > best:
                        best, best_span = end_i - run_start + 1, (times[run_start], times[end_i])
                    run_start = None
            identical_min = best * self.cfg.timestep_minutes
            comparisons.append({"window": f"{_fmt(s + offset)} to {_fmt(e + offset)}", "days_offset": days,
                                "mean_here": _r(a.mean()), "mean_there": _r(b.mean()), "mean_abs_difference": _r(diff.mean(), 3),
                                "correlation": _r(corr, 3), "longest_identical_stretch_minutes": identical_min,
                                "identical_stretch": [_fmt(best_span[0]), _fmt(best_span[1] + pd.Timedelta(minutes=self.cfg.timestep_minutes))]
                                if best_span and identical_min >= 30 else None,
                                "identical_reading_for_reading": bool(identical_min >= 60)})
        eid = f"calc:compare:{signal}@{_span_id(s, e)}"
        out = {"evidence_id": eid, "signal": signal, "comparisons": comparisons,
               "note": "Live meters never repeat noise exactly; identical readings for hours point to a replayed or copied feed."}
        self._register(eid, "calculation", {"signal": signal, "comparisons": comparisons})
        return out

    def tool_read_document(self, doc_id: str) -> dict:
        d = self.bundle.document(doc_id)
        if d is None:
            raise ToolError(f"no document {doc_id!r}; see the overview for document IDs")
        out = {"evidence_id": d["id"], "type": d["type"], "author": d["author"], "factory_claim": d["is_claim"],
               "covers": d["covers"], "received_at": d["received_at"]}
        if d.get("content"):
            out["content"] = d["content"]
        if d.get("image"):
            out["image"] = d["image"]  # the loop attaches the image itself
            out["note"] = "The image follows. Read it yourself; no transcription is provided."
        self._register(d["id"], "document", {"type": d["type"], "factory_claim": d["is_claim"]})
        return out

    def tool_check_reading_against_feed(self, signal: str, timestamp: str, value: float) -> dict:
        if signal not in SIGNAL_INFO:
            raise ToolError(f"unknown signal {signal!r}")
        t = self._time(timestamp)
        w = window(self.bundle.signals, t - pd.Timedelta(minutes=10), t + pd.Timedelta(minutes=10))[signal].dropna()
        eid = f"calc:reading_vs_feed:{signal}@{t:%m%d-%H%M}"
        if w.empty:
            out = {"evidence_id": eid, "result": None, "note": "the feed has no readings within 10 minutes of that time"}
        else:
            nearest = float(w.iloc[w.index.get_indexer([t], method="nearest")[0]])
            rel, floor = READING_TOLERANCE[signal]
            tol = max(rel * abs(nearest), floor)
            lo, hi = float(w.min()) - tol, float(w.max()) + tol
            out = {"evidence_id": eid, "signal": signal, "time": _fmt(t), "reading_given": _r(value, 2),
                   "feed_nearest": _r(nearest, 2), "feed_range_within_10_min": [_r(w.min(), 2), _r(w.max(), 2)],
                   "difference": _r(value - nearest, 2), "tolerance": _r(tol, 2), "consistent": bool(lo <= value <= hi),
                   "note": "Compared within 10 minutes either side, allowing for meter clocks that are a few minutes off."}
            if signal == "S3":
                out.update(self._expected_power_at(t, value))
        self._register(eid, "calculation", {k: v for k, v in out.items() if k != "note"})
        return out

    def _expected_power_at(self, t: pd.Timestamp, value: float) -> dict:
        """What ETP inflow at time t says power should be, independent of the power feed."""
        warm = window(self.bundle.signals, t - pd.Timedelta(hours=4 * self.power_model.response_h), t + pd.Timedelta(minutes=5))
        if warm["S2"].notna().mean() < 0.8:
            return {"expected_from_inflow": None}
        expected = float(self.power_model.expected(warm["S2"].interpolate(), self.cfg.dt_h).iloc[-1])
        band = self.power_model.band_sd * self.power_model.residual_sd_kw
        position = "below" if value < expected - band else "above" if value > expected + band else "within"
        return {"expected_kw_from_inflow": _r(expected), "expected_band_half_width_kw": _r(band),
                "reading_vs_expected_band": position,
                "reading_as_share_of_expected": _r(value / expected, 2) if expected else None}

    def tool_get_lab_results(self) -> dict:
        labs = [d for d in self.bundle.documents if d["type"] == "lab_report"]
        for d in labs:
            self._register(d["id"], "document", {"type": "lab_report"})
        return {"lab_results": [{"evidence_id": d["id"], **d["content"]} for d in labs],
                "note": "Grab samples from an accredited lab. None means no sample falls in this case's period."
                if labs else "No lab samples in this case's period."}

    def tool_get_production(self, start: str, end: str) -> dict:
        s, e = self._window(start, end)
        rows = [b for b in self.bundle.batches if pd.Timestamp(b["start"]) < e and pd.Timestamp(b["end"]) > s]
        eid = f"plan:production@{_span_id(s, e)}"
        self._register(eid, "factory_plan", {"batches": len(rows)})
        return {"evidence_id": eid, "note": "The factory's production plan (a factory record, not a measurement).",
                "batches": rows}

    def tool_update_hypotheses(self, explanations: list[dict]) -> dict:
        if len(explanations) < 2:
            raise ToolError("keep at least two competing explanations open until the evidence rules one out")
        self.ledger.append(explanations)
        cited = {i for e in explanations for i in e.get("supporting", []) + e.get("contradicting", [])}
        unknown = sorted(c for c in cited if c not in self.registry)
        out = {"recorded": True, "checks_used": self.checks_used, "checks_left": self.budget - self.checks_used}
        if unknown:
            out["warning"] = f"these IDs were not returned by any tool: {', '.join(unknown)}"
        return out

    def tool_request_evidence(self, items: list[str], interval_start: str, interval_end: str, reason: str,
                              fallback: str | None = None) -> dict:
        s, e = self._window(interval_start, interval_end)
        self.final = {"kind": "evidence_request", "items": items, "interval": [_fmt(s), _fmt(e)], "reason": reason,
                      "fallback": fallback}
        return {"recorded": True}

    def tool_submit_assessment(self, status: str, summary: str, explanations: list[dict], key_evidence: list[dict],
                               scope_line: str, limitations: list[str], unresolved: list[str] | None = None,
                               evidence_request: dict | None = None) -> dict:
        if status not in STATUSES:
            raise ToolError(f"status must be one of {', '.join(STATUSES)}")
        self.final = {"kind": "assessment", "status": status, "summary": summary, "explanations": explanations,
                      "key_evidence": key_evidence, "scope_line": scope_line, "limitations": limitations,
                      "unresolved": unresolved or [], "evidence_request": evidence_request}
        return {"recorded": True}


_WHY = {"type": "string", "description": "One sentence: how this check separates the explanations still open"}


def _fn(name: str, description: str, properties: dict, required: list[str], why: bool = True) -> dict:
    if why:
        properties, required = {**properties, "why": _WHY}, [*required, "why"]
    return {"type": "function", "function": {"name": name, "description": description,
            "parameters": {"type": "object", "properties": properties, "required": required}}}


_T = {"type": "string", "description": "ISO 8601 time, factory local (Asia/Dhaka), e.g. 2026-10-13T14:00"}
_SIG = {"type": "string", "enum": list(SIGNAL_INFO)}
_EXPLANATION = {
    "type": "object",
    "properties": {
        "id": {"type": "string"}, "label": {"type": "string"},
        "supporting": {"type": "array", "items": {"type": "string"}},
        "contradicting": {"type": "array", "items": {"type": "string"}},
        "missing": {"type": "array", "items": {"type": "string"}},
        "status": {"type": "string", "enum": ["open", "supported", "contradicted"]},
    },
    "required": ["id", "label", "supporting", "contradicting", "missing", "status"],
}

TOOL_SPECS = [
    _fn("get_case_overview", "Batch, treatment interval, plant facts, signal coverage and gaps, documents and alerts. Call first.", {}, []),
    _fn("get_signal_window", "Summary statistics and a downsampled series for one signal over a window, with gap and quality flags.",
        {"signal": _SIG, "start": _T, "end": _T}, ["signal", "start", "end"]),
    _fn("compute_water_balance", "ETP and factory boundary water balances over a window, computed in code with tolerances.",
        {"start": _T, "end": _T}, ["start", "end"]),
    _fn("check_power_vs_load", "Observed ETP power against the band expected for its inflow, over a window.",
        {"start": _T, "end": _T}, ["start", "end"]),
    _fn("compare_similar_windows", "Compare one signal's window with the same clock hours on other days; detects copied or replayed feeds.",
        {"signal": _SIG, "start": _T, "end": _T}, ["signal", "start", "end"]),
    _fn("read_document", "Open a document. Images are attached for you to read; factory documents are claims, not facts.",
        {"doc_id": {"type": "string"}}, ["doc_id"]),
    _fn("check_reading_against_feed", "Compare a value you read off a meter photo or document with the digital feed at that time.",
        {"signal": _SIG, "timestamp": _T, "value": {"type": "number"}}, ["signal", "timestamp", "value"]),
    _fn("get_lab_results", "Accredited lab results for effluent grab samples in this case's period.", {}, []),
    _fn("get_production", "The factory's production plan (batches, shades, planned volumes) over a window.",
        {"start": _T, "end": _T}, ["start", "end"]),
    _fn("update_hypotheses", "Record the current competing explanations and the evidence for and against each. Does not use up a check.",
        {"explanations": {"type": "array", "items": _EXPLANATION}}, ["explanations"], why=False),
    _fn("request_evidence", "Finish with a specific evidence request when the available evidence cannot settle the case.",
        {"items": {"type": "array", "items": {"type": "string"}}, "interval_start": _T, "interval_end": _T,
         "reason": {"type": "string", "description": "How this evidence would separate the remaining explanations"},
         "fallback": {"type": "string", "description": "What to do if it does not exist, e.g. a surprise sampling visit"}},
        ["items", "interval_start", "interval_end", "reason"], why=False),
    _fn("submit_assessment", "Finish with a structured assessment.",
        {"status": {"type": "string", "enum": list(STATUSES)},
         "summary": {"type": "string", "description": "2 to 4 plain sentences; numbers only as they appear in tool results"},
         "explanations": {"type": "array", "items": _EXPLANATION},
         "key_evidence": {"type": "array", "items": {"type": "object", "properties": {"id": {"type": "string"}, "why": {"type": "string"}},
                                                      "required": ["id", "why"]}},
         "scope_line": {"type": "string"},
         "limitations": {"type": "array", "items": {"type": "string"}},
         "unresolved": {"type": "array", "items": {"type": "string"}},
         "evidence_request": {"type": "object", "properties": {"items": {"type": "array", "items": {"type": "string"}},
                                                               "interval": {"type": "string"}, "reason": {"type": "string"}}}},
        ["status", "summary", "explanations", "key_evidence", "scope_line", "limitations"], why=False),
]
