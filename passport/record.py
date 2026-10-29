"""The signed passport record: what the QR code on a garment resolves to.

A record is issued when a reviewer decides a case. It fingerprints every
piece of evidence the investigation could see (SHA-256 per item, and one
root over all of them) and the investigation trace itself, states the
status with its scope and limits, and is signed with Ed25519.

Two separate checks follow from that:
- the signature shows the record was issued here and not altered since;
- re-hashing the evidence shows it is still the evidence the record describes.
A hash alone proves neither: whoever edits the evidence can recompute it.

The product is named the way digital product passports name it, a GS1
Digital Link (/01/<GTIN>/10/<lot>). Demo GTINs use the restricted-circulation
prefix 02, so they can never collide with a real product's number.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

from store.cases import ROOT

KEY_FILE = ROOT / "data" / "keys" / "passport-ed25519.key"  # gitignored; PASSPORT_SIGNING_KEY overrides it
RECORD_TYPE = "tellwater.treatment-claim-assessment"
CLAIM = "Wastewater from this batch's production was treated by the factory's effluent treatment plant."


# ---- hashing


def canonical(obj) -> bytes:
    """Sorted keys, no whitespace, UTF-8: the same record always gives the same bytes."""
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str).encode()


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def evidence_manifest(folder: Path, submission: dict | None = None) -> list[dict]:
    """One hash per item the investigator could see: case files, signals, each document, any factory submission.
    The hidden/ folder (ground truth, labels) is never part of the evidence."""
    items = []
    for path in sorted(p for p in folder.rglob("*") if p.is_file() and "hidden" not in p.relative_to(folder).parts):
        items.append({"id": f"file:{path.relative_to(folder).as_posix()}", "sha256": sha256(path.read_bytes())})
    if submission:
        items.append({"id": f"submission:{submission['signal']}", "sha256": sha256(canonical(submission))})
    return items


def evidence_root(manifest: list[dict]) -> str:
    return sha256(canonical(sorted(manifest, key=lambda i: i["id"])))


# ---- product identity (GS1)


def gtin14(base13: str) -> str:
    """GTIN-14 with its GS1 check digit, from 13 digits."""
    assert len(base13) == 13 and base13.isdigit()
    total = sum(int(d) * (3 if i % 2 == 0 else 1) for i, d in enumerate(reversed(base13)))
    return base13 + str((10 - total % 10) % 10)


def digital_link(gtin: str, lot: str, base: str = "") -> str:
    return f"{base}/01/{gtin}/10/{lot}"


# ---- signing key


def _private_key() -> Ed25519PrivateKey:
    raw = os.environ.get("PASSPORT_SIGNING_KEY")
    if raw:
        return Ed25519PrivateKey.from_private_bytes(base64.b64decode(raw))
    if not KEY_FILE.exists():
        KEY_FILE.parent.mkdir(parents=True, exist_ok=True)
        KEY_FILE.write_bytes(Ed25519PrivateKey.generate().private_bytes_raw())
        KEY_FILE.chmod(0o600)
    return Ed25519PrivateKey.from_private_bytes(KEY_FILE.read_bytes())


def public_key() -> dict:
    raw = _private_key().public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)
    return {"alg": "Ed25519", "key_id": sha256(raw)[:16], "public_key": base64.b64encode(raw).decode()}


# ---- issue and verify


def issue(*, product: dict, batch: dict, trace: dict, review: dict, status: str, manifest: list[dict],
          issuer: str = "Tellwater prototype") -> dict:
    final = trace.get("final") or {}
    record = {
        "type": RECORD_TYPE,
        "version": 1,
        "issuer": issuer,
        "issued_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "product": product,
        "batch": {k: batch.get(k) for k in ("id", "production_start", "production_end", "shade")},
        "claim": CLAIM,
        "status": status,
        "assessed_status": trace.get("status"),
        "review": {k: review.get(k) for k in ("action", "status", "reason", "reviewer", "at")},
        "summary": final.get("summary"),
        "scope": final.get("scope_line"),
        "limitations": final.get("limitations", []),
        "evidence": {"items": manifest, "root": evidence_root(manifest)},
        "investigation": {"sha256": sha256(canonical(trace)), "model": trace.get("model"),
                          "finished_at": trace.get("finished_at"), "checks": trace.get("checks_used"),
                          "citations_validated": trace.get("valid")},
        "disclosure": "Prototype on simulated records. A batch-level assessment of the evidence, not a certificate.",
    }
    key = public_key()
    signature = _private_key().sign(canonical(record))
    record["proof"] = {"alg": "Ed25519", "key_id": key["key_id"], "signature": base64.b64encode(signature).decode()}
    return record


def verify(record: dict, manifest_now: list[dict] | None = None, trace_now: dict | None = None,
           key: dict | None = None) -> dict:
    """Check the signature, and, when given, that today's evidence and trace still match the record."""
    key = key or public_key()
    body = {k: v for k, v in record.items() if k != "proof"}
    proof = record.get("proof") or {}
    try:
        Ed25519PublicKey.from_public_bytes(base64.b64decode(key["public_key"])).verify(
            base64.b64decode(proof.get("signature", "")), canonical(body))
        signature_valid = proof.get("key_id") == key["key_id"]
    except (InvalidSignature, ValueError):
        signature_valid = False
    out = {"signature_valid": signature_valid, "key_id": key["key_id"]}
    if manifest_now is not None:
        then = {i["id"]: i["sha256"] for i in record["evidence"]["items"]}
        now = {i["id"]: i["sha256"] for i in manifest_now}
        out["evidence_matches"] = evidence_root(manifest_now) == record["evidence"]["root"]
        out["changed"] = sorted(k for k in then if k in now and now[k] != then[k])
        out["missing"] = sorted(k for k in then if k not in now)
        out["added"] = sorted(k for k in now if k not in then)
        out["items"] = len(then)
    if trace_now is not None:
        out["investigation_matches"] = sha256(canonical(trace_now)) == record["investigation"]["sha256"]
    return out
