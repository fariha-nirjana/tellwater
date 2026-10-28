"""Validate a final assessment against the tool outputs it rests on.

- Every cited evidence ID was produced by a tool in this run.
- Every number in the summary appears in a tool result (at the precision
  written), allowing percentages of shares and clock times.
- Required parts are present: a scope line for "supports", an evidence
  request for "insufficient", at least two separate pieces of key evidence
  for "contradicts".
- No banned wording.
"""

from __future__ import annotations

import json
import re

BANNED = [r"\bcertif", r"\bcompliant\b", r"\bguarantee", r"independent signal", r"\d+\s*%\s*confiden", r"\bconfidence of\b"]
NUMBER = re.compile(r"(?<![\w.:/-])(\d+(?:\.\d+)?)(\s*%)?(?![\w:/])")
TIME = re.compile(r"\b\d{1,2}:\d{2}\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}/\d{1,2}(?:/\d{2,4})?\b")


def _numbers_in(obj, out: set[float]) -> None:
    if isinstance(obj, bool):
        return
    if isinstance(obj, (int, float)):
        out.add(float(obj))
    elif isinstance(obj, str):
        for m in re.finditer(r"-?\d+(?:\.\d+)?", obj):
            out.add(float(m.group()))
    elif isinstance(obj, dict):
        for v in obj.values():
            _numbers_in(v, out)
    elif isinstance(obj, (list, tuple)):
        for v in obj:
            _numbers_in(v, out)


def _supported_number(token: str, percent: bool, known: set[float]) -> bool:
    value = float(token)
    decimals = len(token.split(".")[1]) if "." in token else 0
    for v in known:
        if round(v, decimals) == value or round(abs(v), decimals) == value:
            return True
        if percent and round(v * 100, decimals) == value:
            return True
    return False


def validate(final: dict | None, registry: dict, tool_results: list) -> list[str]:
    if final is None:
        return ["no final assessment or evidence request was submitted"]
    if final["kind"] == "evidence_request":
        issues = []
        if not final.get("items"):
            issues.append("the evidence request names no evidence")
        if not final.get("reason"):
            issues.append("the evidence request gives no reason")
        return issues

    issues: list[str] = []
    cited = [k["id"] for k in final.get("key_evidence", [])]
    for e in final.get("explanations", []):
        cited += e.get("supporting", []) + e.get("contradicting", [])
    unknown = sorted({c for c in cited if c not in registry})
    if unknown:
        issues.append(f"cited evidence IDs that no tool returned: {', '.join(unknown)}")

    known: set[float] = set()
    _numbers_in(tool_results, known)
    summary = final.get("summary", "")
    stripped = TIME.sub(" ", summary)
    bad = [m.group(1) + (m.group(2) or "") for m in NUMBER.finditer(stripped)
           if not _supported_number(m.group(1), bool(m.group(2)), known)]
    if bad:
        issues.append(f"numbers in the summary that no tool returned: {', '.join(bad)}")

    status = final.get("status")
    if status == "supports" and not final.get("scope_line", "").strip():
        issues.append("a 'supports' assessment needs a scope line")
    if status == "insufficient" and not final.get("evidence_request"):
        issues.append("an 'insufficient' assessment needs an evidence_request")
    if status == "contradicts" and len(set(k["id"] for k in final.get("key_evidence", []))) < 2:
        issues.append("a 'contradicts' assessment needs at least two separate pieces of key evidence")
    if not final.get("explanations"):
        issues.append("list the explanations you considered")
    still_open = [e.get("label") or e.get("id") for e in final.get("explanations", []) if e.get("status") == "open"]
    if status == "supports" and still_open:
        issues.append(f"'supports' needs every other explanation contradicted, but these are still open: {'; '.join(still_open)}. "
                      "Contradict them with evidence, or choose the status that fits what remains open")

    text = json.dumps({k: final.get(k) for k in ("summary", "scope_line", "limitations", "explanations")}).lower()
    for pattern in BANNED:
        if re.search(pattern, text):
            issues.append(f"banned wording matched: {pattern}")
    return issues
