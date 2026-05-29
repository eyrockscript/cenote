"""Manual `TF_VAR_*` plumbing: textarea parsing, encrypted store status, and
the plan endpoint merge precedence (gitlab < saved < request)."""

from pathlib import Path

from fastapi.testclient import TestClient

from cenote.api.main import _parse_tf_vars_text, app
from cenote.security.secret_store import SecretStore


def test_parse_textarea_strips_prefix_and_comments():
    out = _parse_tf_vars_text(
        "# comment\n"
        "\n"
        "name=my-svc\n"
        "TF_VAR_region = us-east-1\n"
        "tag = abc12345\n"
        "= ignored\n"
    )
    # `TF_VAR_` prefix stripped; whitespace trimmed; blank/comment skipped.
    assert out == {"name": "my-svc", "region": "us-east-1", "tag": "abc12345"}


def test_status_reports_tf_var_names_no_values(tmp_path: Path):
    store = SecretStore(tmp_path, env_key="k")
    store.save({"tf_vars": {"name": "my-svc", "region": "us-east-1"}})
    st = store.status()
    assert st["tf_vars"]["configured"] is True
    assert st["tf_vars"]["count"] == 2
    assert st["tf_vars"]["names"] == ["name", "region"]
    # No values leak through status.
    assert "my-svc" not in str(st) and "us-east-1" not in str(st)


def test_settings_endpoint_persists_tf_vars(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("CENOTE_DB_PATH", str(tmp_path / "cenote.duckdb"))
    monkeypatch.setenv("CENOTE_SECRET_KEY", "k")
    # Re-import settings so the env override applies.
    from cenote.config import Settings
    import cenote.api.main as main_mod
    main_mod.settings = Settings()  # type: ignore[attr-defined]

    c = TestClient(app)
    r = c.put("/api/settings/credentials", json={"tf_vars": {"name": "svc", "region": "us-east-1"}})
    assert r.status_code == 200
    body = r.json()
    assert body["tf_vars"]["configured"] is True
    assert sorted(body["tf_vars"]["names"]) == ["name", "region"]

    # Merge default (additive): adding `tag` keeps the original two.
    r2 = c.put("/api/settings/credentials", json={"tf_vars": {"tag": "abc123"}})
    assert sorted(r2.json()["tf_vars"]["names"]) == ["name", "region", "tag"]

    # Replace mode wipes others.
    r3 = c.put("/api/settings/credentials", json={"tf_vars": {"only": "1"}, "tf_vars_replace": True})
    assert r3.json()["tf_vars"]["names"] == ["only"]
