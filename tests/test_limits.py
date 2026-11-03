import json

import pytest
from fastapi.testclient import TestClient

from api import app as api
from api import limits


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(api, "STATE", tmp_path / "state.json")
    return TestClient(api.app)


def test_each_visitor_has_an_allowance(monkeypatch):
    monkeypatch.setenv("TW_QUESTIONS_PER_VISITOR", "2")
    assert limits.take("questions", "1.1.1.1") is None and limits.take("questions", "1.1.1.1") is None
    assert "your guide questions" in limits.take("questions", "1.1.1.1")
    assert limits.take("questions", "2.2.2.2") is None  # someone else still has theirs
    assert limits.remaining("questions", "2.2.2.2")["left"] == 1


def test_the_day_has_a_total(monkeypatch):
    monkeypatch.setenv("TW_RUNS_PER_DAY", "2")
    assert limits.take("runs", "a") is None and limits.take("runs", "b") is None
    assert "today's live investigations" in limits.take("runs", "c")


def test_counts_reset_each_day_and_never_store_addresses(monkeypatch):
    monkeypatch.setenv("TW_RUNS_PER_VISITOR", "1")
    limits.take("runs", "9.9.9.9")
    stored = limits.USAGE.read_text(encoding="utf-8")
    assert "9.9.9.9" not in stored
    u = json.loads(stored)
    u["day"] = "2000-01-01"
    limits.USAGE.write_text(json.dumps(u), encoding="utf-8")
    assert limits.take("runs", "9.9.9.9") is None


def test_switched_off(monkeypatch):
    monkeypatch.setenv("TW_LIVE", "0")
    assert "switched off" in limits.take("runs", "a")
    assert limits.remaining("questions", "a") == {"left": 0, "per_visitor": 20, "live": False}


def test_runs_in_flight_are_capped(monkeypatch):
    monkeypatch.setenv("TW_MAX_LIVE_RUNS", "1")
    assert limits.start_run() and not limits.start_run()
    limits.end_run()
    assert limits.start_run()
    limits.end_run()


def test_capped_live_run_never_calls_the_model(client, monkeypatch):
    monkeypatch.setenv("TW_RUNS_PER_VISITOR", "0")
    monkeypatch.setattr(api, "investigate", lambda *a, **k: pytest.fail("the model was called past the cap"))
    r = client.post("/api/cases/B/investigate")
    assert r.status_code == 429 and "saved investigation" in r.json()["detail"]
    assert limits.start_run()  # the refused run gave its slot back
    limits.end_run()


def test_guide_questions_count_down(client, monkeypatch):
    monkeypatch.setenv("TW_QUESTIONS_PER_VISITOR", "1")

    class Fake:
        def __init__(self, *_):
            pass

        def chat(self, messages, **_):
            return type("R", (), {"message": type("M", (), {"content": "Power stayed low."}), "usage": {}})()

    monkeypatch.setattr(api, "ModelClient", Fake)
    assert client.get("/api/limits").json()["questions"]["left"] == 1
    assert client.post("/api/cases/B/ask", json={"question": "Why?"}).status_code == 200
    r = client.post("/api/cases/B/ask", json={"question": "And?"})
    assert r.status_code == 429 and client.get("/api/limits").json()["questions"]["left"] == 0
