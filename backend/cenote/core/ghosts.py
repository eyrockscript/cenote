"""Synthesize "ghost" nodes for existing AWS infrastructure a stack references
via `var.*` or a literal ID/ARN but never declares as a resource or data source.

A real stack often consumes a VPC, subnet, security group or IAM role through
`var.vpc_id` (filled by CI/CD) instead of `data "aws_vpc"`. Without anything in
the .tf to render, those existing pieces only show up in the resource detail
panel — the canvas just shows the new things floating disconnected from where
they actually plug in.

This module walks every managed resource's attributes, looks for well-known
attribute keys (`vpc_id`, `subnet_ids`, `vpc_security_group_ids`, role ARNs…)
that point at something external, and emits a placeholder Resource + Edge so
the diagram makes the connection visible. Placeholders are typed correctly
(aws_vpc, aws_subnet, …) so the existing icon and styling apply, and marked
`planned_action="read"` so they render as "Existing" (dashed) like data
sources do.
"""

from __future__ import annotations

import re
from typing import Any

from cenote.core.models import Edge, Resource, TFState

_VIRTUAL_ACCOUNT = "000000000000"
_VIRTUAL_REGION = "tf-existing"

# `var.<name>` references inside an HCL string or list value.
_VAR_RE = re.compile(r"\bvar\.([A-Za-z_][A-Za-z0-9_]*)")
# Literal AWS IDs the stack might hardcode or that plan-mode resolution turns
# `var.X` values into. Anchored at word boundaries to avoid matching inside
# unrelated identifiers.
_VPC_ID_RE = re.compile(r"\b(vpc-[0-9a-f]{8,})\b")
_SUBNET_ID_RE = re.compile(r"\b(subnet-[0-9a-f]{8,})\b")
_SG_ID_RE = re.compile(r"\b(sg-[0-9a-f]{8,})\b")
# ARNs — capture the last path segment (role/key name) for the display label.
_IAM_ROLE_ARN_RE = re.compile(r"arn:aws:iam::[^:\s\"']+:role/([A-Za-z0-9+=,.@_/\-]+)")
_KMS_KEY_ARN_RE = re.compile(r"arn:aws:kms:[^:\s\"']+:[^:\s\"']+:key/([A-Za-z0-9\-]+)")

# attribute names that suggest a particular external type and edge.
# (key_set, ghost_type, edge_type, literal_id_regex_or_None)
_PATTERNS: list[tuple[set[str], str, str, re.Pattern[str] | None]] = [
    ({"vpc_id"}, "aws_vpc", "in_vpc", _VPC_ID_RE),
    ({"subnet_id", "subnets", "subnet_ids"}, "aws_subnet", "in_subnet", _SUBNET_ID_RE),
    (
        {"security_group_id", "security_groups", "vpc_security_group_ids"},
        "aws_security_group",
        "references_sg",
        _SG_ID_RE,
    ),
    (
        {"role_arn", "execution_role_arn", "task_role_arn", "iam_role_arn"},
        "aws_iam_role",
        "references",
        _IAM_ROLE_ARN_RE,
    ),
    ({"kms_key_arn", "kms_key_id", "kms_master_key_id"}, "aws_kms_key", "references", _KMS_KEY_ARN_RE),
]


def synthesize_ghosts(
    managed: list[tuple[str, str, dict[str, Any]]],
    existing_ids: set[str],
) -> tuple[list[Resource], list[Edge]]:
    """Walk `managed` resources `(node_id, tf_type, attributes)` and emit ghost
    Resource + Edge pairs for var-referenced or literal-ID-referenced external
    infra. `existing_ids` is the set of node IDs already in the graph so the
    same ghost isn't created twice.
    """
    ghosts: dict[str, Resource] = {}
    edges: list[Edge] = []
    seen_edges: set[tuple[str, str, str]] = set()

    def add_ghost(node_id: str, ghost_type: str, label: str) -> None:
        if node_id in existing_ids or node_id in ghosts:
            return
        ghosts[node_id] = Resource(
            id=node_id,
            type=ghost_type,
            name=label,
            region=_VIRTUAL_REGION,
            account_id=_VIRTUAL_ACCOUNT,
            tf_state=TFState(address=label, module=None, attributes={}),
            aws_state=None,
            drift=[],
            author=None,
            tags={},
            planned_action="read",
        )

    def add_edge(src: str, dst: str, edge_type: str, via: str) -> None:
        key = (src, dst, edge_type)
        if key in seen_edges:
            return
        seen_edges.add(key)
        edges.append(
            Edge(
                source=src,
                target=dst,
                type=edge_type,
                metadata={"via": via, "ghost": True},
                discovered_via="inferred",
            )
        )

    for node_id, _tf_type, attrs in managed:
        if not isinstance(attrs, dict):
            continue
        for key_set, ghost_type, edge_type, id_re in _PATTERNS:
            for attr_key, attr_val in attrs.items():
                if attr_key not in key_set:
                    continue
                for s in _walk_strings(attr_val):
                    # 1) `var.<name>` references
                    for m in _VAR_RE.finditer(s):
                        label = f"var.{m.group(1)}"
                        ghost_id = _ghost_id(ghost_type, label)
                        add_ghost(ghost_id, ghost_type, label)
                        add_edge(node_id, ghost_id, edge_type, attr_key)
                    # 2) Literal AWS IDs or ARNs (when plan resolves vars).
                    if id_re is not None:
                        for m in id_re.finditer(s):
                            label = m.group(1) if m.lastindex else m.group(0)
                            ghost_id = _ghost_id(ghost_type, label)
                            add_ghost(ghost_id, ghost_type, label)
                            add_edge(node_id, ghost_id, edge_type, attr_key)

    return list(ghosts.values()), edges


# ─── helpers ────────────────────────────────────────────────────────────────


def _walk_strings(value: Any) -> list[str]:
    """Flatten a (possibly nested) HCL value into the string leaves so the
    extractors can search inside lists, blocks, and tag maps uniformly."""
    out: list[str] = []
    if isinstance(value, str):
        out.append(value)
    elif isinstance(value, list):
        for v in value:
            out.extend(_walk_strings(v))
    elif isinstance(value, dict):
        for v in value.values():
            out.extend(_walk_strings(v))
    return out


def _ghost_id(ghost_type: str, label: str) -> str:
    # `external://` keeps these distinct from `tf://` IDs so React Flow keys
    # stay unique and the frontend can style them differently if desired.
    return f"external://{ghost_type}/{label}"
