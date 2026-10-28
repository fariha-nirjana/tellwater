import json

import pytest
from fastapi.testclient import TestClient

from api import app as api


@pytest.fixture
def client(tmp_path, monkeypatch):
    # reviews and submissions go to a scratch file, never the demo's own state
    monkeypatch.setattr(api, "STATE", tmp_path / "state.json")
    return TestClient(api.app)


def test_cases_and_documents(client):
    keys = {c["key"]: c["status"] for c in client.get("/api/cases").json()}
    assert keys == {"A": "supports", "B": "contradicts", "C": "insufficient"}
    docs = {d["id"]: d for d in client.get("/api/cases/B").json()["documents"]}
    assert docs["doc:logbook-1013"]["lines"] and docs["doc:photo-S3-1013-1530"]["image"]
    assert client.get(docs["doc:photo-S3-1013-1530"]["image"]).headers["content-type"] == "image/jpeg"


def test_signals_resample_and_keep_gaps(client):
    s = client.get("/api/cases/C/signals", params={"start": "2026-10-13T11:00", "end": "2026-10-13T21:00", "step": 30}).json()
    assert len(s["times"]) == 21
    assert all(v is None for v in s["series"]["T1"])  # the tank log is missing in case C


def test_submission_fills_the_record_and_adds_a_factory_document(client):
    r = client.post("/api/cases/C/evidence", data={"signal": "T1", "sample": "true"}).json()
    assert r["recorded"] and r["readings"] > 0
    c = client.get("/api/cases/C").json()
    assert c["overview"]["signals"]["T1"]["coverage_of_treatment_interval"] == 1.0
    sub = next(d for d in c["documents"] if d["type"] == "factory_submission")
    assert sub["is_claim"]  # a factory-supplied record is still the factory's word
    client.delete("/api/cases/C/evidence")
    assert client.get("/api/cases/C").json()["overview"]["signals"]["T1"]["coverage_of_treatment_interval"] == 0.0


def test_review_updates_the_passport(client):
    assert client.post("/api/cases/A/review", json={"action": "approve", "reason": ""}).status_code == 400
    client.post("/api/cases/A/review", json={"action": "change", "status": "review_required", "reason": "Want the tank log signed."})
    p = client.get("/api/passport/A").json()
    assert p["status"] == "review_required" and p["assessed_status"] == "supports"
    assert "not a certificate" in p["disclosure"]


def test_after_upload_trace_is_saved_for_case_c(client):
    t = client.get("/api/cases/C/trace", params={"which": "after"}).json()
    assert t["status"] == "supports" and t["valid"]
    assert json.dumps(t).count("doc:submission-T1") >= 1
