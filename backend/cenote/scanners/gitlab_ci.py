"""Extract `TF_VAR_*` values from a `.gitlab-ci.yml`.

Many teams keep their non-sensitive Terraform inputs (project name, region,
image tag…) wired up in the GitLab CI YAML itself, not as `TF_VAR_*`-prefixed
CI/CD variables. Parsing the YAML lets the diagram resolve those values the
same way the deploy job would, so the rendered plan matches what actually
gets applied.

What we read:
- The top-level `variables:` block.
- Every job's `variables:` block (anywhere in the file).
- Every job's `script:` and `before_script:` lines, looking for
  `terraform … -var "name=value"` (or `-var name=value`).

What we resolve:
- `$VAR` / `${VAR}` references via the caller-supplied dicts (GitLab CI/CD
  variables and a small set of predefined CI variables).
- Anything still containing a `$VAR` we couldn't resolve, or a `$(...)` shell
  substitution, is reported under `unresolved` so the UI can ask the user to
  fill it in via the manual textarea instead of silently sending garbage to
  terraform.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

import structlog
import yaml

log = structlog.get_logger()

_TF_VAR_PREFIX = "TF_VAR_"
# `-var "key=val"` or `-var 'key=val'` or `-var key=val`. Captures key and the
# (possibly quoted) value up to the matching quote / whitespace.
_VAR_FLAG_RE = re.compile(
    r"""-var\s+(?:"([^"=]+)=([^"]*)"|'([^'=]+)=([^']*)'|([^=\s'"]+)=(\S+))""",
)
# `$VAR` or `${VAR}` — simple env-style references only; we don't try to
# emulate bash parameter expansion (defaults, slicing, etc.).
_REF_RE = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)")
# A `$(...)` shell substitution — we can't evaluate these statically.
_CMD_SUB_RE = re.compile(r"\$\([^)]*\)")


@dataclass
class CIExtraction:
    """Result of parsing a `.gitlab-ci.yml`.

    `tf_vars` is a bare-name → value map ready to merge with the rest of the
    plan's variable sources. `unresolved` captures expressions that referenced
    unknown variables or shell substitutions so the UI can surface them.
    """

    tf_vars: dict[str, str] = field(default_factory=dict)
    unresolved: list[str] = field(default_factory=list)  # `name: $expr`
    jobs_seen: list[str] = field(default_factory=list)


def extract_tf_vars_from_ci(
    yaml_text: str,
    gitlab_vars: dict[str, str] | None = None,
    predefined: dict[str, str] | None = None,
) -> CIExtraction:
    """Parse `yaml_text` and resolve every `TF_VAR_*` mapping it can.

    `gitlab_vars` is a bare-name → value map of non-masked GitLab CI/CD
    variables (typically what `fetch_tf_vars` returns minus the `TF_VAR_`
    prefix); `predefined` covers GitLab's built-ins (e.g. `CI_PROJECT_TITLE`).
    """
    try:
        doc = yaml.safe_load(yaml_text)
    except yaml.YAMLError as exc:
        log.warning("gitlab_ci.parse_fail", error=str(exc))
        return CIExtraction()
    if not isinstance(doc, dict):
        return CIExtraction()

    sources = {**(gitlab_vars or {}), **(predefined or {})}
    result = CIExtraction()

    # Pass 1: collect every variable mapping from the YAML — both alias keys
    # (non-TF_VAR — these chain into TF_VAR refs, e.g.
    # `PROJECT_TITLE: $CI_PROJECT_TITLE` then `TF_VAR_name: $PROJECT_TITLE`)
    # and the TF_VAR_* keys themselves.
    raw_aliases: dict[str, str] = {}      # NAME → raw value (may contain $REF)
    raw_tf: dict[str, str] = {}           # bare TF_VAR_x → raw value

    def _collect(vars_dict: Any) -> None:
        if not isinstance(vars_dict, dict):
            return
        for k, v in vars_dict.items():
            if not isinstance(k, str):
                continue
            sv = _coerce(v)
            if k.startswith(_TF_VAR_PREFIX):
                raw_tf[k[len(_TF_VAR_PREFIX):]] = sv
            else:
                raw_aliases[k] = sv

    _collect(doc.get("variables"))

    reserved = {
        "default", "include", "stages", "variables", "workflow", "image",
        "services", "before_script", "after_script", "cache", "pages",
    }
    for name, body in doc.items():
        if name in reserved or not isinstance(body, dict):
            continue
        result.jobs_seen.append(name)
        _collect(body.get("variables"))
        for script_key in ("script", "before_script", "after_script"):
            script = body.get(script_key)
            if not script:
                continue
            for line in _flatten_lines(script):
                for k, v in _scan_var_flags(line):
                    raw_tf[k] = v

    # Pass 2: resolve aliases iteratively. Each pass substitutes any reference
    # we can; if every alias still depends on something unknown, we stop.
    enriched: dict[str, str] = dict(sources)
    for _ in range(8):  # cap iterations to avoid pathological loops
        changed = False
        for k, raw in raw_aliases.items():
            resolved, ok = _substitute(raw, enriched)
            if ok and enriched.get(k) != resolved:
                enriched[k] = resolved
                changed = True
        if not changed:
            break

    # Pass 3: resolve every TF_VAR_* against the enriched source map.
    for key, value in raw_tf.items():
        resolved, ok = _substitute(value, enriched)
        if ok:
            result.tf_vars[key] = resolved
        else:
            result.unresolved.append(f"{key}={value}")

    log.info(
        "gitlab_ci.extracted",
        jobs=len(result.jobs_seen),
        resolved=len(result.tf_vars),
        unresolved=len(result.unresolved),
    )
    return result


# ─── internals ──────────────────────────────────────────────────────────────


def _coerce(value: Any) -> str:
    """YAML can yield ints/bools/None for un-quoted scalars; coerce to string."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def _flatten_lines(script: Any) -> list[str]:
    """`script:` is a list (sometimes nested via YAML anchors). Flatten it to a
    flat list of strings."""
    out: list[str] = []
    if isinstance(script, str):
        out.append(script)
    elif isinstance(script, list):
        for item in script:
            out.extend(_flatten_lines(item))
    return out


def _scan_var_flags(line: str) -> list[tuple[str, str]]:
    """Return every `key=value` captured from `-var` flags in a script line."""
    out: list[tuple[str, str]] = []
    for m in _VAR_FLAG_RE.finditer(line):
        # The regex has 3 alternatives, each contributing two groups; pick the
        # one that matched.
        k = m.group(1) or m.group(3) or m.group(5)
        v = m.group(2) if m.group(1) else (m.group(4) if m.group(3) else m.group(6))
        if k and v is not None:
            out.append((k.strip(), v))
    return out


def _substitute(value: str, sources: dict[str, str]) -> tuple[str, bool]:
    """Replace `$VAR`/`${VAR}` references; return (resolved, fully_resolved).

    A value is considered fully resolved when every reference was found in
    `sources` and no shell substitution `$(...)` remains. Unknown references
    are left in place so the caller can show the user what's missing."""
    fully_resolved = True

    def repl(match: re.Match[str]) -> str:
        nonlocal fully_resolved
        name = match.group(1) or match.group(2)
        if name in sources:
            return sources[name]
        fully_resolved = False
        return match.group(0)  # leave as-is so the user sees what's unresolved

    out = _REF_RE.sub(repl, value)
    if _CMD_SUB_RE.search(out):
        fully_resolved = False
    return out, fully_resolved
