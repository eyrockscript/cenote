"""GitLab CI/CD variable resolution: non-masked filtering, TF_VAR_ mapping,
project-over-group precedence, and environment_scope selection."""

import httpx
import pytest

from cenote.scanners import gitlab_vars
from cenote.scanners.gitlab_vars import GitlabError, fetch_tf_vars


def _patch_transport(monkeypatch, routes: dict[str, list[dict]]):
    """Route GitLab API GETs to canned variable lists keyed by URL substring."""
    def handler(request: httpx.Request) -> httpx.Response:
        for needle, payload in routes.items():
            if needle in str(request.url):
                return httpx.Response(200, json=payload)
        return httpx.Response(200, json=[])

    real_client = httpx.Client

    def fake_client(*args, **kwargs):
        kwargs["transport"] = httpx.MockTransport(handler)
        return real_client(*args, **kwargs)

    monkeypatch.setattr(gitlab_vars.httpx, "Client", fake_client)


def test_filters_masked_and_maps_tf_var(monkeypatch):
    _patch_transport(monkeypatch, {
        "/projects/": [
            {"key": "TF_VAR_region", "value": "us-east-1", "masked": False, "environment_scope": "*"},
            {"key": "TF_VAR_db_password", "value": "secret", "masked": True, "environment_scope": "*"},
            {"key": "AWS_SECRET", "value": "nope", "masked": False, "environment_scope": "*"},
        ],
    })
    fetch = fetch_tf_vars(token="t", project="g/p")
    assert fetch.tf_vars == {"TF_VAR_region": "us-east-1"}   # masked + non-TF_VAR dropped
    assert fetch.masked_keys == {"TF_VAR_db_password"}
    assert "region" in fetch.all_var_names and "db_password" in fetch.all_var_names


def test_project_overrides_group(monkeypatch):
    _patch_transport(monkeypatch, {
        "/groups/": [
            {"key": "TF_VAR_region", "value": "eu-west-1", "masked": False, "environment_scope": "*"},
            {"key": "TF_VAR_name", "value": "from-group", "masked": False, "environment_scope": "*"},
        ],
        "/projects/": [
            {"key": "TF_VAR_region", "value": "us-east-1", "masked": False, "environment_scope": "*"},
        ],
    })
    fetch = fetch_tf_vars(token="t", project="g/p", group="g")
    assert fetch.tf_vars["TF_VAR_region"] == "us-east-1"   # project wins
    assert fetch.tf_vars["TF_VAR_name"] == "from-group"    # group-only survives


def test_environment_scope_specific_wins(monkeypatch):
    _patch_transport(monkeypatch, {
        "/projects/": [
            {"key": "TF_VAR_cpu", "value": "256", "masked": False, "environment_scope": "*"},
            {"key": "TF_VAR_cpu", "value": "512", "masked": False, "environment_scope": "develop"},
        ],
    })
    fetch = fetch_tf_vars(token="t", project="g/p", environment="develop")
    assert fetch.tf_vars["TF_VAR_cpu"] == "512"  # exact env beats wildcard


def test_environment_glob_match(monkeypatch):
    _patch_transport(monkeypatch, {
        "/projects/": [
            {"key": "TF_VAR_x", "value": "glob", "masked": False, "environment_scope": "review/*"},
        ],
    })
    fetch = fetch_tf_vars(token="t", project="g/p", environment="review/feature-1")
    assert fetch.tf_vars["TF_VAR_x"] == "glob"


def test_auth_error_raises(monkeypatch):
    def handler(_req):
        return httpx.Response(401, json={"message": "401 Unauthorized"})
    real = httpx.Client
    monkeypatch.setattr(
        gitlab_vars.httpx, "Client",
        lambda *a, **k: real(*a, **{**k, "transport": httpx.MockTransport(handler)}),
    )
    with pytest.raises(GitlabError, match="401"):
        fetch_tf_vars(token="bad", project="g/p")


def test_requires_token_and_target():
    with pytest.raises(GitlabError):
        fetch_tf_vars(token="", project="g/p")
    with pytest.raises(GitlabError):
        fetch_tf_vars(token="t")
