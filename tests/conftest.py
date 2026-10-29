import pytest

from passport import record


@pytest.fixture(autouse=True)
def signing_key(tmp_path, monkeypatch):
    # every test signs with its own throwaway key, never the demo's
    monkeypatch.delenv("PASSPORT_SIGNING_KEY", raising=False)
    monkeypatch.setattr(record, "KEY_FILE", tmp_path / "passport.key")
