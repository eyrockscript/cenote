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


def test_settings_endpoint_persists_profile_tf_vars(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("CENOTE_DB_PATH", str(tmp_path / "cenote.duckdb"))
    monkeypatch.setenv("CENOTE_SECRET_KEY", "k")
    from cenote.config import Settings
    import cenote.api.main as main_mod
    main_mod.settings = Settings()  # type: ignore[attr-defined]

    c = TestClient(app)
    # First save: token + a profile with two tf_vars.
    r = c.put("/api/settings/credentials", json={
        "gitlab_token": "glpat-xxx",
        "gitlab_profile": {
            "label": "develop",
            "project": "grp/svc",
            "tf_vars": {"name": "svc", "region": "us-east-1"},
        },
    })
    assert r.status_code == 200
    body = r.json()
    assert body["gitlab"]["token_configured"] is True
    assert body["gitlab"]["active"] == "develop"
    profile = body["gitlab"]["projects"][0]
    assert profile["label"] == "develop"
    assert profile["project"] == "grp/svc"
    assert sorted(profile["tf_vars"]["names"]) == ["name", "region"]

    # Additive merge: add `tag` keeps the original two.
    r2 = c.put("/api/settings/credentials", json={
        "gitlab_profile": {"label": "develop", "tf_vars": {"tag": "abc123"}},
    })
    assert sorted(r2.json()["gitlab"]["projects"][0]["tf_vars"]["names"]) == ["name", "region", "tag"]

    # Replace wipes others within the same profile.
    r3 = c.put("/api/settings/credentials", json={
        "gitlab_profile": {"label": "develop", "tf_vars": {"only": "1"}, "tf_vars_replace": True},
    })
    assert r3.json()["gitlab"]["projects"][0]["tf_vars"]["names"] == ["only"]

    # Add a second profile — both coexist under the shared token.
    r4 = c.put("/api/settings/credentials", json={
        "gitlab_profile": {"label": "production", "project": "grp/svc-prod"},
    })
    labels = sorted(p["label"] for p in r4.json()["gitlab"]["projects"])
    assert labels == ["develop", "production"]

    # Switch active.
    r5 = c.put("/api/settings/credentials", json={"gitlab_active": "production"})
    assert r5.json()["gitlab"]["active"] == "production"

    # Delete a profile.
    r6 = c.put("/api/settings/credentials", json={"gitlab_delete_profile": "develop"})
    body6 = r6.json()
    assert [p["label"] for p in body6["gitlab"]["projects"]] == ["production"]
    assert body6["gitlab"]["active"] == "production"


def test_migrates_v1_single_project_blob(tmp_path: Path, monkeypatch):
    """An existing user with the old single-project shape should see it auto-
    migrate to a single profile labelled after the project's last path segment."""
    monkeypatch.setenv("CENOTE_DB_PATH", str(tmp_path / "cenote.duckdb"))
    monkeypatch.setenv("CENOTE_SECRET_KEY", "k")
    from cenote.config import Settings
    import cenote.api.main as main_mod
    main_mod.settings = Settings()  # type: ignore[attr-defined]

    # Seed the store with the v1 shape directly.
    SecretStore(tmp_path, env_key="k").save({
        "gitlab": {"token": "glpat-old", "project": "grp/myproject", "environment": "develop"},
        "tf_vars": {"name": "svc"},
    })

    body = TestClient(app).get("/api/settings/credentials").json()
    assert body["gitlab"]["token_configured"] is True
    assert body["gitlab"]["active"] == "myproject"
    p = body["gitlab"]["projects"][0]
    assert p["label"] == "myproject"
    assert p["project"] == "grp/myproject"
    assert p["environment"] == "develop"
    # Old root-level tf_vars folded into this profile.
    assert p["tf_vars"]["names"] == ["name"]
