import io
import json
import wave
from email.parser import BytesParser
from email.policy import default

import httpx
import pytest
from fastapi.testclient import TestClient

from api import app as api
from api import limits, voice


def wav(seconds=0.1, rate=24000, channels=1, width=2):
    out = io.BytesIO()
    with wave.open(out, "wb") as audio:
        audio.setparams((channels, width, rate, 0, "NONE", "not compressed"))
        audio.writeframes(b"\0" * (int(seconds * rate) * channels * width))
    return out.getvalue()


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(api, "STATE", tmp_path / "state.json")
    monkeypatch.setenv("TW_LIVE", "1")
    return TestClient(api.app)


@pytest.fixture
def calls(monkeypatch):
    calls = []

    def transcribe(audio):
        calls.append(audio)
        return "ETP maintenance ended at 2:20."

    monkeypatch.setattr(voice, "transcribe", transcribe)
    return calls


def post(client, audio=None):
    return client.post("/api/voice/transcribe", files={"audio": ("reply.wav", wav() if audio is None else audio, "audio/wav")})


def test_voice_returns_editable_text_without_sending_or_changing_a_finding(client, calls):
    before = client.get("/api/cases/B").json()
    r = post(client)
    assert r.status_code == 200
    assert r.json() == {"transcript": "ETP maintenance ended at 2:20.", "model": voice.MODEL, "seconds": 0.1}
    assert len(calls) == 1 and calls[0] == wav()
    assert client.get("/api/cases/B").json() == before
    assert not api.STATE.exists()
    assert client.get("/api/limits").json()["voice"] == {"left": 9, "per_visitor": 10, "live": True}
    # The normal reply endpoint is still the only way to send the text, including edits.
    text = "ETP maintenance ended at 2:25, corrected after checking."
    assert client.post("/api/cases/B/reply", json={"note": text}).json()["note"] == text


@pytest.mark.parametrize("audio", [b"", b"not a recording", wav(0), wav(channels=2), wav(width=1), wav(rate=48000),
                                  wav(seconds=120.01, rate=16000), wav()[:-10], b"\0" * (voice.MAX_BYTES + 1)])
def test_bad_audio_is_rejected_before_spending_allowance(client, calls, audio):
    assert post(client, audio).status_code == 400
    assert not calls and limits.remaining("voice", "testclient")["left"] == 10


@pytest.mark.parametrize("rate", [16000, 24000])
def test_voice_accepts_the_two_supported_rates(client, calls, rate):
    assert post(client, wav(rate=rate)).status_code == 200
    assert len(calls) == 1


def test_voice_accepts_exactly_two_minutes(client, calls):
    r = post(client, wav(seconds=120))
    assert r.status_code == 200 and r.json()["seconds"] == 120


def test_voice_caps_each_visitor_and_the_whole_day(client, calls, monkeypatch):
    monkeypatch.setenv("TW_TRUST_PROXY", "1")
    monkeypatch.setenv("TW_VOICE_PER_VISITOR", "1")
    monkeypatch.setenv("TW_VOICE_PER_DAY", "2")
    upload = {"audio": ("reply.wav", wav(), "audio/wav")}
    assert client.post("/api/voice/transcribe", files=upload, headers={"x-forwarded-for": "a"}).status_code == 200
    r = client.post("/api/voice/transcribe", files=upload, headers={"x-forwarded-for": "a"})
    assert r.status_code == 429 and "your voice transcriptions" in r.json()["detail"]
    assert client.post("/api/voice/transcribe", files=upload, headers={"x-forwarded-for": "b"}).status_code == 200
    r = client.post("/api/voice/transcribe", files=upload, headers={"x-forwarded-for": "c"})
    assert r.status_code == 429 and "today's voice transcriptions" in r.json()["detail"]
    assert len(calls) == 2


def test_voice_off_switch_never_calls_transcription(client, calls, monkeypatch):
    monkeypatch.setenv("TW_LIVE", "0")
    r = post(client)
    assert r.status_code == 429 and "still type your reply" in r.json()["detail"]
    assert not calls


def test_existing_daily_counts_survive_adding_voice(client):
    limits.take("questions", "a")
    old = json.loads(limits.USAGE.read_text(encoding="utf-8"))
    del old["voice"]
    limits.USAGE.write_text(json.dumps(old), encoding="utf-8")
    assert client.get("/api/limits").json()["voice"]["left"] == 10
    assert limits.remaining("questions", "a")["left"] == 19
    assert limits.take("voice", "a") is None
    saved = json.loads(limits.USAGE.read_text(encoding="utf-8"))
    assert saved["salt"] == old["salt"] and saved["questions"] == old["questions"]
    assert saved["voice"]["total"] == 1


def test_voice_upstream_failure_keeps_the_reply_unsent(client, monkeypatch):
    def unavailable(_):
        raise voice.TranscriptionError("Voice transcription is unavailable. You can still type your reply.")

    monkeypatch.setattr(voice, "transcribe", unavailable)
    r = post(client)
    assert r.status_code == 502 and "still type" in r.json()["detail"]
    assert not api.STATE.exists()


def test_empty_transcript_invites_another_recording(client, monkeypatch):
    monkeypatch.setattr(voice, "transcribe", lambda _: "")
    r = post(client)
    assert r.status_code == 422 and "No speech" in r.json()["detail"]


def test_transcription_uses_the_measured_settings_and_wav_part(monkeypatch):
    # The transport and environment loader are replaced; this never reaches a model service.
    monkeypatch.setattr(voice, "load_env", lambda: None)
    monkeypatch.setenv("MODEL_API_KEY", "voice-test-only")
    sent = []

    def mocked_post(url, **kwargs):
        assert kwargs.pop("timeout") == 90
        request = httpx.Request("POST", url, **kwargs)
        request.read()
        sent.append(request)
        return httpx.Response(200, json={"transcript": " ETP and WO checked. "}, request=request)

    monkeypatch.setattr(voice.httpx, "post", mocked_post)
    assert voice.transcribe(wav()) == "ETP and WO checked."
    request = sent[0]
    assert str(request.url) == "https://api.meta.ai/v1/asr/transcribe"
    assert request.headers["authorization"] == "Bearer voice-test-only"
    body = BytesParser(policy=default).parsebytes(f"Content-Type: {request.headers['content-type']}\r\n\r\n".encode() + request.content)
    parts = {p.get_param("name", header="content-disposition"): p for p in body.iter_parts()}
    assert json.loads(parts["request"].get_payload(decode=True)) == {
        "model": "muse-voice-transcribe-1.0", "mode": "PUSH_TO_TALK", "audioEncoding": "WAV",
        "languageBias": ["Bengali", "English"], "keywords": ["ETP", "WO", "pH", "aerator"]}
    assert parts["audio"].get_payload(decode=True) == wav()


@pytest.mark.parametrize("failure", ["timeout", "http", "json", "missing"])
def test_transcription_errors_do_not_expose_service_responses(monkeypatch, failure):
    monkeypatch.setattr(voice, "load_env", lambda: None)
    monkeypatch.setenv("MODEL_API_KEY", "voice-test-only")

    def mocked_post(url, **_):
        request = httpx.Request("POST", url)
        if failure == "timeout":
            raise httpx.ReadTimeout("private service detail", request=request)
        if failure == "http":
            return httpx.Response(500, text="private service detail", request=request)
        if failure == "json":
            return httpx.Response(200, text="not json", request=request)
        return httpx.Response(200, json={}, request=request)

    monkeypatch.setattr(voice.httpx, "post", mocked_post)
    with pytest.raises(voice.TranscriptionError) as e:
        voice.transcribe(wav())
    assert "private" not in str(e.value) and "type your reply" in str(e.value)
