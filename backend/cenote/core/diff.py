"""Diff entre dos snapshots — for the PR-style viewer."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

from cenote.catalogs.drift_fields import DRIFT_FIELDS
from cenote.core.models import Graph, Resource


class FieldChange(BaseModel):
    field: str
    before: object | None
    after: object | None


class ResourceChange(BaseModel):
    arn: str
    type: str
    name: str
    change: Literal["added", "removed", "modified", "unchanged"]
    fields: list[FieldChange] = []


class GraphDiff(BaseModel):
    base_snapshot: str
    head_snapshot: str
    added: list[ResourceChange]
    removed: list[ResourceChange]
    modified: list[ResourceChange]
    unchanged_count: int


def _attrs(r: Resource) -> dict:
    """Pick the most authoritative attrs for comparison."""
    if r.tf_state:
        return r.tf_state.attributes
    if r.aws_state:
        return r.aws_state.attributes
    return {}


def diff_graphs(base: Graph, head: Graph) -> GraphDiff:
    base_by_arn = {r.id: r for r in base.nodes}
    head_by_arn = {r.id: r for r in head.nodes}

    added_arns = set(head_by_arn) - set(base_by_arn)
    removed_arns = set(base_by_arn) - set(head_by_arn)
    common_arns = set(base_by_arn) & set(head_by_arn)

    added: list[ResourceChange] = []
    for arn in sorted(added_arns):
        r = head_by_arn[arn]
        added.append(ResourceChange(arn=arn, type=r.type, name=r.name, change="added"))

    removed: list[ResourceChange] = []
    for arn in sorted(removed_arns):
        r = base_by_arn[arn]
        removed.append(ResourceChange(arn=arn, type=r.type, name=r.name, change="removed"))

    modified: list[ResourceChange] = []
    unchanged = 0
    for arn in sorted(common_arns):
        b = base_by_arn[arn]
        h = head_by_arn[arn]
        fields_table = DRIFT_FIELDS.get(h.type) or {}
        if not fields_table:
            unchanged += 1
            continue
        b_attrs = _attrs(b)
        h_attrs = _attrs(h)
        changes: list[FieldChange] = []
        for field in fields_table:
            bv = b_attrs.get(field)
            hv = h_attrs.get(field)
            if bv != hv:
                changes.append(FieldChange(field=field, before=bv, after=hv))
        if changes:
            modified.append(ResourceChange(
                arn=arn, type=h.type, name=h.name, change="modified", fields=changes,
            ))
        else:
            unchanged += 1

    return GraphDiff(
        base_snapshot=base.snapshot_id,
        head_snapshot=head.snapshot_id,
        added=added,
        removed=removed,
        modified=modified,
        unchanged_count=unchanged,
    )
