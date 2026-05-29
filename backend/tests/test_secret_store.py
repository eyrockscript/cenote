"""Encrypted credential store: round-trips, status hides secrets, key handling."""

from pathlib import Path

from cenote.security.secret_store import SecretStore

_CREDS = {
    "aws": {
        "access_key_id": "AKIAEXAMPLE1234567",
        "secret_access_key": "supersecretvalue",
        "region": "us-east-1",
    },
    "gitlab": {"token": "glpat-abcdef", "project": "g/p", "environment": "develop"},
}


def test_roundtrip_with_env_key(tmp_path: Path):
    store = SecretStore(tmp_path, env_key="master-key")
    store.save(_CREDS)
    assert store.load() == _CREDS


def test_persisted_on_disk_is_encrypted(tmp_path: Path):
    store = SecretStore(tmp_path, env_key="master-key")
    store.save(_CREDS)
    blob = (tmp_path / "credentials.enc").read_bytes()
    assert b"supersecretvalue" not in blob   # not plaintext
    assert b"glpat-abcdef" not in blob


def test_status_hides_secret_values(tmp_path: Path):
    store = SecretStore(tmp_path, env_key="k")
    store.save(_CREDS)
    st = store.status()
    assert st["aws"]["configured"] is True
    assert st["aws"]["region"] == "us-east-1"
    assert st["aws"]["access_key_tail"] == "…4567"
    # No secret material anywhere in the status payload.
    flat = str(st)
    assert "supersecretvalue" not in flat
    assert "glpat-abcdef" not in flat
    assert st["gitlab"]["configured"] is True
    assert st["gitlab"]["project"] == "g/p"


def test_auto_generated_key_persists(tmp_path: Path):
    s1 = SecretStore(tmp_path)  # no env key → generates one
    s1.save(_CREDS)
    assert (tmp_path / ".cenote_key").exists()
    # A fresh instance pointing at the same dir reuses the key and decrypts.
    s2 = SecretStore(tmp_path)
    assert s2.load() == _CREDS


def test_wrong_key_returns_empty_not_crash(tmp_path: Path):
    SecretStore(tmp_path, env_key="right").save(_CREDS)
    assert SecretStore(tmp_path, env_key="wrong").load() == {}


def test_clear(tmp_path: Path):
    store = SecretStore(tmp_path, env_key="k")
    store.save(_CREDS)
    assert store.clear() is True
    assert store.load() == {}
    assert store.clear() is False  # already gone


def test_load_absent_is_empty(tmp_path: Path):
    assert SecretStore(tmp_path, env_key="k").load() == {}
    assert SecretStore(tmp_path, env_key="k").status()["aws"]["configured"] is False
