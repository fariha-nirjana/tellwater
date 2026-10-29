import copy

import pytest
from fastapi.testclient import TestClient

from api import app as api
from passport import record as pr
from store.cases import ROOT

CASE_B = ROOT / "data" / "demo" / "B" / "case"


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(api, "STATE", tmp_path / "state.json")
    return TestClient(api.app)


def _record(trace=None, manifest=None):
    trace = trace or {"model": "muse-spark-1.3", "status": "contradicts", "final": {"summary": "s"}, "valid": True}
    return pr.issue(product={"gtin": pr.gtin14("0299000000002"), "lot": "x"}, batch={"id": "b"}, trace=trace,
                    review={"action": "approve", "reason": "r"}, status="contradicts",
                    manifest=manifest or pr.evidence_manifest(CASE_B))


def test_gtin_check_digit():
    assert pr.gtin14("0950600013435") == "09506000134352"  # GS1's published example
    assert pr.gtin14("0299000000001").startswith("02")  # restricted circulation, never a real product


def test_manifest_covers_what_the_investigator_saw_and_never_the_hidden_truth():
    ids = {i["id"] for i in pr.evidence_manifest(CASE_B)}
    assert "file:signals.csv.gz" in ids and "file:docs/photo-S3-1013-1530.jpg" in ids
    assert not any("hidden" in i for i in ids)


def test_untouched_record_verifies():
    trace = {"model": "m", "status": "supports", "final": {}, "valid": True}
    manifest = pr.evidence_manifest(CASE_B)
    v = pr.verify(_record(trace, manifest), manifest, trace)
    assert v["signature_valid"] and v["evidence_matches"] and v["investigation_matches"] and not v["changed"]


def test_changed_evidence_is_named():
    manifest = pr.evidence_manifest(CASE_B)
    rec = _record(manifest=manifest)
    now = copy.deepcopy(manifest)
    photo = next(i for i in now if i["id"] == "file:docs/photo-S3-1013-1530.jpg")
    photo["sha256"] = "0" * 64
    v = pr.verify(rec, now)
    assert v["signature_valid"] and not v["evidence_matches"] and v["changed"] == [photo["id"]]


def test_edited_record_or_other_key_fails_the_signature():
    rec = _record()
    edited = {**rec, "status": "supports"}
    assert not pr.verify(edited)["signature_valid"]
    other = {"alg": "Ed25519", "key_id": "x", "public_key": pr.public_key()["public_key"][::-1]}
    assert not pr.verify(rec, key=other)["signature_valid"]


def test_review_issues_a_signed_record_the_passport_checks(client):
    assert client.get("/api/passport/B").json()["record"] is None  # undecided: nothing signed
    client.post("/api/cases/B/review", json={"action": "approve", "reason": "Photo and lab agree with the feed."})
    p = client.get("/api/passport/B").json()
    assert p["record"]["status"] == "contradicts" and p["record"]["evidence"]["root"]
    assert p["batch"]["production_start"] and p["record"]["batch"]["production_start"] == p["batch"]["production_start"]
    assert p["verification"] == {**p["verification"], "signature_valid": True, "evidence_matches": True,
                                 "investigation_matches": True}
    assert client.get("/api/passport/B/record").json() == p["record"]
    client.post("/api/cases/B/review", json={"action": "return", "reason": "Check the lab chain of custody."})
    assert client.get("/api/passport/B").json()["record"] is None  # sent back: the record is withdrawn


def test_new_evidence_after_the_record_shows_as_a_change(client):
    client.post("/api/cases/C/review", json={"action": "approve", "reason": "Tank log is missing; agree."})
    client.post("/api/cases/C/evidence", data={"signal": "T1", "sample": "true"})
    v = client.get("/api/passport/C/verify").json()
    # the factory's log arrived and the after-upload investigation now stands, so the record is out of date
    assert v["signature_valid"] and not v["evidence_matches"] and v["added"] == ["submission:T1"]
    assert not v["investigation_matches"]


def test_digital_link_opens_the_passport(client):
    link = client.get("/api/passport/A").json()["product"]["link"]
    r = client.get(link, follow_redirects=False)
    assert r.status_code == 307 and r.headers["location"].endswith("#/passport/A")
    assert client.get("/01/09506000134352/10/nope", follow_redirects=False).status_code == 404
