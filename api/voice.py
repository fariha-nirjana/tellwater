"""Short factory replies transcribed by Muse Voice Transcribe, never sent as replies here."""

from __future__ import annotations

import io
import json
import os
import wave

import httpx

from agent.models import load_env

MODEL = "muse-voice-transcribe-1.0"
ENDPOINT = "https://api.meta.ai/v1/asr/transcribe"
MAX_SECONDS = 120
MAX_BYTES = 6_000_000
SETTINGS = {"model": MODEL, "mode": "PUSH_TO_TALK", "audioEncoding": "WAV",
            "languageBias": ["Bengali", "English"], "keywords": ["ETP", "WO", "pH", "aerator"]}


class TranscriptionError(Exception):
    pass


def duration(audio: bytes) -> float:
    """Reject unsupported or truncated WAV files before using any allowance."""
    if not audio or len(audio) > MAX_BYTES:
        raise ValueError("Record a voice note of up to 2 minutes.")
    try:
        with wave.open(io.BytesIO(audio), "rb") as wav:
            if (wav.getnchannels() != 1 or wav.getsampwidth() != 2 or wav.getframerate() not in (16000, 24000)
                    or wav.getcomptype() != "NONE"):
                raise ValueError("Use a mono, 16-bit PCM WAV recording at 16 or 24 kHz.")
            frames = wav.getnframes()
            seconds = frames / wav.getframerate()
            if not 0 < seconds <= MAX_SECONDS:
                raise ValueError("Record a voice note of up to 2 minutes.")
            if len(wav.readframes(frames)) != frames * 2:
                raise ValueError("The recording is incomplete. Please record it again.")
            return seconds
    except (wave.Error, EOFError) as exc:
        raise ValueError("The recording could not be read. Please record it again.") from exc


def transcribe(audio: bytes) -> str:
    load_env()
    key = os.environ.get("MODEL_API_KEY")
    if not key:
        raise TranscriptionError("Voice transcription is not configured. You can still type your reply.")
    try:
        response = httpx.post(ENDPOINT, headers={"Authorization": f"Bearer {key}", "Accept": "application/json"},
                              files={"request": (None, json.dumps(SETTINGS), "application/json"),
                                     "audio": ("reply.wav", audio, "audio/wav")}, timeout=90)
        response.raise_for_status()
        result = response.json().get("transcript")
        if not isinstance(result, str):
            raise ValueError("missing transcript")
        return result.strip()
    except httpx.TimeoutException as exc:
        raise TranscriptionError("Transcription took too long. Try again or type your reply.") from exc
    except (httpx.HTTPError, ValueError, AttributeError) as exc:
        raise TranscriptionError("Voice transcription is unavailable. Try again or type your reply.") from exc
