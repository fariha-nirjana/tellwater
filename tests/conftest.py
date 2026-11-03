import pytest

from api import limits
from passport import record


@pytest.fixture(autouse=True)
def signing_key(tmp_path, monkeypatch):
    # every test signs with its own throwaway key, never the demo's
    monkeypatch.delenv("PASSPORT_SIGNING_KEY", raising=False)
    monkeypatch.setattr(record, "KEY_FILE", tmp_path / "passport.key")


@pytest.fixture(autouse=True)
def usage(tmp_path, monkeypatch):
    # demo caps count into a scratch file, never the demo's own
    monkeypatch.setattr(limits, "USAGE", tmp_path / "usage.json")


@pytest.fixture(autouse=True)
def model_key(monkeypatch):
    # tests fake every model call, so a placeholder key is enough; it also means no test can ever
    # reach the real API with the key in .env
    monkeypatch.setenv("MODEL_API_KEY", "test-only")
