"""Raw .tf parser: walks a directory of HCL2 source files and extracts
the declared resources plus their cross-references.

No `terraform` binary required, no AWS credentials, no state file. The output
is intentionally lossy: it describes what WOULD be built ("planned graph"),
not a reconciliation against live AWS.

Used by the `/api/tf/diagram` endpoint to render an architecture diagram from
a user-supplied folder/zip of `.tf` files.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import hcl2  # type: ignore[import-untyped]
import structlog

from cenote.catalogs.resource_types import is_supported

log = structlog.get_logger()


# ---------- data ----------

@dataclass(frozen=True)
class HCLResource:
    """A single resource block from a .tf file. count/for_each are NOT
    expanded — one entry per declared block (vs. one per planned instance)."""

    tf_type: str          # e.g. "aws_vpc"
    name: str             # e.g. "main"  (the second label in `resource "aws_vpc" "main" {…}`)
    address: str          # e.g. "aws_vpc.main"
    attributes: dict[str, Any]
    source_file: str      # relative path inside the parsed directory


@dataclass(frozen=True)
class HCLReference:
    """A reference from one resource to another, discovered by scanning
    string values for `aws_x.name[.attr]` patterns."""

    source: str           # address of the referrer
    target: str           # address of the referee
    via: str              # attribute name where the reference was found


@dataclass
class HCLGraph:
    resources: list[HCLResource] = field(default_factory=list)
    references: list[HCLReference] = field(default_factory=list)


# ---------- public api ----------

# Matches `aws_<type>.<name>[.<attr>...]` even inside interpolations like
# "${aws_vpc.main.id}" or modern HCL2 references `aws_vpc.main.id`.
_REF_RE = re.compile(r"\b(aws_[a-z0-9_]+)\.([A-Za-z_][A-Za-z0-9_-]*)(?:\.[A-Za-z0-9_\[\]\.\"-]+)?")


class HCLParseError(RuntimeError):
    pass


def parse_directory(root: Path) -> HCLGraph:
    """Walk `root` for `.tf` files and return the declared resources + edges.

    Silently skips files that fail to parse (logged at WARN) so a single
    bad file doesn't kill the whole diagram.
    """
    if not root.exists() or not root.is_dir():
        raise HCLParseError(f"not a directory: {root}")

    tf_files = sorted(root.rglob("*.tf"))
    if not tf_files:
        raise HCLParseError(f"no .tf files under {root}")

    graph = HCLGraph()
    by_address: dict[str, HCLResource] = {}

    for fp in tf_files:
        rel = str(fp.relative_to(root))
        try:
            with fp.open("r", encoding="utf-8") as f:
                parsed = hcl2.load(f)
        except Exception as exc:  # noqa: BLE001
            log.warning("tf_hcl.parse_fail", file=rel, error=str(exc))
            continue

        for res in _iter_resource_blocks(parsed):
            tf_type, name, attrs = res
            if not is_supported(tf_type):
                # Not in v0.1's 13-type catalog — skipped to keep the diagram
                # focused on what we can actually render with icons + edges.
                continue
            address = f"{tf_type}.{name}"
            r = HCLResource(
                tf_type=tf_type,
                name=name,
                address=address,
                attributes=attrs,
                source_file=rel,
            )
            graph.resources.append(r)
            by_address[address] = r

    # Reference pass — must run after all resources are collected so we can
    # filter out references to undeclared addresses (e.g. data sources, modules).
    for r in graph.resources:
        for via, target in _extract_references(r.attributes):
            if target == r.address:
                continue  # self-ref, ignore
            if target in by_address:
                graph.references.append(
                    HCLReference(source=r.address, target=target, via=via)
                )

    log.info(
        "tf_hcl.parsed",
        files=len(tf_files),
        resources=len(graph.resources),
        edges=len(graph.references),
    )
    return graph


# ---------- internals ----------

def _iter_resource_blocks(parsed: dict[str, Any]):
    """python-hcl2 represents top-level blocks as lists of single-key dicts.

    A `resource "aws_vpc" "main" { cidr_block = "10.0.0.0/16" }` block becomes
    (in hcl2 v6+):
        {"resource": [{'"aws_vpc"': {'"main"': {"cidr_block": '"10.0.0.0/16"',
                                                  "__is_block__": True}}}]}

    The labels arrive double-quote-wrapped and bodies carry a synthetic
    `__is_block__` marker — both stripped here so the rest of the pipeline
    sees plain Python data.
    """
    for block in parsed.get("resource", []) or []:
        if not isinstance(block, dict):
            continue
        for raw_type, named in block.items():
            tf_type = _strip_quotes(raw_type)
            if not isinstance(named, dict):
                continue
            for raw_name, attrs in named.items():
                name = _strip_quotes(raw_name)
                body = attrs[0] if isinstance(attrs, list) and attrs else attrs
                if isinstance(body, dict):
                    yield tf_type, name, _clean_attrs(body)


def _strip_quotes(s: Any) -> str:
    if not isinstance(s, str):
        return str(s)
    if len(s) >= 2 and s[0] == s[-1] == '"':
        return s[1:-1]
    return s


def _clean_attrs(node: Any) -> Any:
    """Strip the `__is_block__` marker and unwrap quoted string literals
    recursively so values look like plain Python (e.g. '10.0.0.0/16' not
    '"10.0.0.0/16"'). Reference strings like '${aws_vpc.main.id}' are
    preserved verbatim."""
    if isinstance(node, dict):
        return {
            k: _clean_attrs(v)
            for k, v in node.items()
            if k != "__is_block__"
        }
    if isinstance(node, list):
        return [_clean_attrs(v) for v in node]
    if isinstance(node, str):
        return _strip_quotes(node)
    return node


def _extract_references(node: Any, _path: str = "") -> list[tuple[str, str]]:
    """Walk a parsed attribute tree, yielding (attribute_path, target_address) pairs."""
    out: list[tuple[str, str]] = []
    if isinstance(node, str):
        for m in _REF_RE.finditer(node):
            tf_type, name = m.group(1), m.group(2)
            out.append((_path or "_", f"{tf_type}.{name}"))
    elif isinstance(node, dict):
        for k, v in node.items():
            out.extend(_extract_references(v, k if not _path else f"{_path}.{k}"))
    elif isinstance(node, list):
        for i, v in enumerate(node):
            out.extend(_extract_references(v, _path or f"[{i}]"))
    return out
