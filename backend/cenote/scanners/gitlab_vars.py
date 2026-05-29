"""Fetch GitLab CI/CD variables to resolve a Terraform diagram.

Many stacks keep their `var.*` values in GitLab CI/CD variables (the
`TF_VAR_<name>` convention terraform reads from the environment). Pulling the
NON-SENSITIVE ones (GitLab's own `masked` flag) lets the plan resolve real
values — concrete ports, sizes, names, tags — instead of `${var.x}`, and lets
us flag required variables that aren't configured in GitLab yet.

Security:
- The access token is used only for the in-flight request; it is never written
  to disk, never logged. Callers must keep it out of persisted state.
- Only `masked == false` variables are returned with their values. Masked
  variable KEYS are reported (so a required-but-masked var counts as
  configured) but their values are never fetched into the diagram.
"""

from __future__ import annotations

import fnmatch
from dataclasses import dataclass, field
from urllib.parse import quote

import httpx
import structlog

log = structlog.get_logger()

_DEFAULT_BASE = "https://gitlab.com"
_TF_VAR_PREFIX = "TF_VAR_"
_TIMEOUT = httpx.Timeout(15.0)
_MAX_PAGES = 10  # 100/page → up to 1000 vars


class GitlabError(RuntimeError):
    """Raised when GitLab returns an error we can't recover from (auth, 404)."""


@dataclass
class GitlabFetch:
    """Result of resolving TF_VAR_* from GitLab.

    `tf_vars` maps full `TF_VAR_<name>` env keys → value (non-masked only), ready
    to merge into the terraform plan environment. `masked_keys` are the
    `TF_VAR_<name>` keys that exist but were skipped because they're masked.
    `all_var_names` is every `<name>` seen (masked or not), for the report.
    """

    tf_vars: dict[str, str] = field(default_factory=dict)
    masked_keys: set[str] = field(default_factory=set)  # full TF_VAR_ keys
    all_var_names: set[str] = field(default_factory=set)  # bare names
    source_counts: dict[str, int] = field(default_factory=dict)  # project/group → count


def _scope_score(environment: str | None, scope: str) -> int:
    """Rank a variable's environment_scope for `environment`. Higher wins.
    Exact match > glob match > wildcard `*`. Returns -1 for no match."""
    if scope == "*":
        return 0
    if environment is None:
        return -1  # only wildcard applies when no environment is given
    if scope == environment:
        return 2
    if fnmatch.fnmatch(environment, scope):
        return 1
    return -1


def _select_by_scope(
    raw_vars: list[dict], environment: str | None
) -> dict[str, dict]:
    """Collapse multiple environment_scope rows of the same key into the single
    best-matching one for `environment`."""
    best: dict[str, dict] = {}
    best_score: dict[str, int] = {}
    for v in raw_vars:
        key = v.get("key")
        if not key:
            continue
        score = _scope_score(environment, v.get("environment_scope", "*"))
        if score < 0:
            continue
        if key not in best_score or score > best_score[key]:
            best[key] = v
            best_score[key] = score
    return best


def _get_paginated(client: httpx.Client, url: str) -> list[dict]:
    out: list[dict] = []
    for page in range(1, _MAX_PAGES + 1):
        resp = client.get(url, params={"per_page": 100, "page": page})
        if resp.status_code == 401:
            raise GitlabError("GitLab rejected the token (401). Needs a token with `api` scope.")
        if resp.status_code == 403:
            raise GitlabError("GitLab forbade the request (403). The token needs Maintainer+ to read CI/CD variables.")
        if resp.status_code == 404:
            raise GitlabError("GitLab project/group not found (404). Check the path/ID.")
        if resp.status_code >= 400:
            raise GitlabError(f"GitLab error {resp.status_code}.")
        batch = resp.json()
        if not isinstance(batch, list) or not batch:
            break
        out.extend(batch)
        if len(batch) < 100:
            break
    return out


def _ingest(
    fetch: GitlabFetch,
    raw_vars: list[dict],
    environment: str | None,
    source: str,
) -> None:
    selected = _select_by_scope(raw_vars, environment)
    count = 0
    for key, v in selected.items():
        if v.get("variable_type") not in (None, "env_var"):
            continue  # skip file-type variables
        if not key.startswith(_TF_VAR_PREFIX):
            continue
        name = key[len(_TF_VAR_PREFIX):]
        fetch.all_var_names.add(name)
        if v.get("masked"):
            fetch.masked_keys.add(key)
            continue
        # Project overrides group: only set if not already set by a
        # higher-priority source (project ingested after group).
        fetch.tf_vars[key] = str(v.get("value", ""))
        count += 1
    fetch.source_counts[source] = count


def fetch_tf_vars(
    *,
    token: str,
    project: str | None = None,
    group: str | None = None,
    environment: str | None = None,
    base_url: str = _DEFAULT_BASE,
) -> GitlabFetch:
    """Resolve `TF_VAR_*` from a GitLab project and/or group.

    `project` / `group` accept a numeric ID or a URL path
    (`my-group/my-project`). When both are given, group is fetched first and
    project values override it. Only non-masked `env_var` variables are
    returned with values.
    """
    if not token:
        raise GitlabError("a GitLab access token is required")
    if not project and not group:
        raise GitlabError("provide a project and/or group")

    api = base_url.rstrip("/") + "/api/v4"
    fetch = GitlabFetch()
    headers = {"PRIVATE-TOKEN": token}

    with httpx.Client(timeout=_TIMEOUT, headers=headers) as client:
        # Group first so project entries win on key collisions.
        if group:
            gid = quote(group, safe="")
            raw = _get_paginated(client, f"{api}/groups/{gid}/variables")
            _ingest(fetch, raw, environment, "group")
        if project:
            pid = quote(project, safe="")
            raw = _get_paginated(client, f"{api}/projects/{pid}/variables")
            _ingest(fetch, raw, environment, "project")

    log.info(
        "gitlab.vars.fetched",
        resolved=len(fetch.tf_vars),
        masked_skipped=len(fetch.masked_keys),
        sources=fetch.source_counts,
        environment=environment,
    )  # never logs values or token
    return fetch


def fetch_project_meta(
    *, token: str, project: str, base_url: str = _DEFAULT_BASE
) -> dict[str, str]:
    """Return GitLab's predefined CI variables for a project (`CI_PROJECT_TITLE`,
    `CI_PROJECT_NAME`, `CI_PROJECT_PATH`, `CI_PROJECT_ID`, `CI_DEFAULT_BRANCH`).
    These are the references most CI YAML files chain into via aliases."""
    api = base_url.rstrip("/") + "/api/v4"
    pid = quote(project, safe="")
    headers = {"PRIVATE-TOKEN": token}
    with httpx.Client(timeout=_TIMEOUT, headers=headers) as client:
        resp = client.get(f"{api}/projects/{pid}")
    if resp.status_code == 401:
        raise GitlabError("GitLab rejected the token (401).")
    if resp.status_code == 404:
        raise GitlabError(f"GitLab project not found (404): {project}")
    if resp.status_code >= 400:
        raise GitlabError(f"GitLab project metadata error {resp.status_code}.")
    data = resp.json()
    return {
        "CI_PROJECT_TITLE": str(data.get("name_with_namespace") or data.get("name") or ""),
        "CI_PROJECT_NAME": str(data.get("path") or data.get("name") or ""),
        "CI_PROJECT_PATH": str(data.get("path_with_namespace") or ""),
        "CI_PROJECT_ID": str(data.get("id") or ""),
        "CI_DEFAULT_BRANCH": str(data.get("default_branch") or "main"),
        # Aliases the user's pipeline commonly references via `$PROJECT_TITLE`.
        # These mirror what GitLab Runner would expand at job time.
        "CI_PROJECT_DIR": "/builds",
    }


def fetch_ci_yaml(
    *,
    token: str,
    project: str,
    ref: str = "HEAD",
    base_url: str = _DEFAULT_BASE,
) -> str | None:
    """Fetch `.gitlab-ci.yml` raw content from a project at `ref`. Returns
    None if the file doesn't exist; raises GitlabError on auth failure."""
    api = base_url.rstrip("/") + "/api/v4"
    pid = quote(project, safe="")
    headers = {"PRIVATE-TOKEN": token}
    url = f"{api}/projects/{pid}/repository/files/.gitlab-ci.yml/raw"
    with httpx.Client(timeout=_TIMEOUT, headers=headers) as client:
        resp = client.get(url, params={"ref": ref})
    if resp.status_code == 401:
        raise GitlabError("GitLab rejected the token (401).")
    if resp.status_code == 403:
        raise GitlabError("GitLab forbade access to .gitlab-ci.yml (403). Token needs read_repository.")
    if resp.status_code == 404:
        return None
    if resp.status_code >= 400:
        raise GitlabError(f"GitLab .gitlab-ci.yml fetch failed: {resp.status_code}")
    return resp.text
