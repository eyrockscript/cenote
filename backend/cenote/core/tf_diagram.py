"""Build a `Graph` from a parsed HCL directory.

This is the bridge between `cenote.scanners.tf_hcl` (raw .tf parser) and
the existing `Graph` / `Resource` / `Edge` Pydantic models that the frontend
already knows how to render.

Design notes:
- Resources have NO ARN here (no account_id, no region). We use synthetic
  `tf://aws_vpc.main` IDs so React Flow keys still work.
- Containers (vpc_id / subnet_id) are resolved by matching the value of
  those attributes against declared resources — direct string references
  like `aws_vpc.main.id` survive in the attribute tree as raw strings, and
  we lift the address back from those.
- Edges are classified into a small set the existing edge styler understands:
  containment (in_vpc/in_subnet), routes (attached_to / routes_to),
  and the catch-all `references` for everything else.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone

from cenote.core.models import Edge, Graph, Resource, TFState
from cenote.scanners.tf_hcl import HCLGraph, HCLReference, HCLResource

_VIRTUAL_ACCOUNT = "000000000000"   # placeholder; never used as a real ARN
_VIRTUAL_REGION = "tf-planned"
_REF_RE = re.compile(r"\b(aws_[a-z0-9_]+)\.([A-Za-z_][A-Za-z0-9_-]*)")


def build_graph(hcl: HCLGraph, snapshot_id: str) -> Graph:
    by_address = {r.address: r for r in hcl.resources}
    nodes = [_to_resource(r) for r in hcl.resources]
    by_id = {n.id: n for n in nodes}

    edges: list[Edge] = []
    seen: set[tuple[str, str, str]] = set()

    # 1. Containment edges (preferred over generic references when both apply).
    for r in hcl.resources:
        for kind, target_addr in _containment_targets(r, by_address):
            edge = Edge(
                source=_address_to_id(r.address),
                target=_address_to_id(target_addr),
                type=kind,
                metadata={"via": "hcl"},
                discovered_via="tf_state",
            )
            key = (edge.source, edge.target, edge.type)
            if key not in seen and edge.source in by_id and edge.target in by_id:
                seen.add(key)
                edges.append(edge)

    # 2. Generic references — anything reference_pass found that isn't already
    # represented as containment.
    for ref in hcl.references:
        edge_type = _classify_reference(ref, by_address.get(ref.source))
        edge = Edge(
            source=_address_to_id(ref.source),
            target=_address_to_id(ref.target),
            type=edge_type,
            metadata={"via": ref.via},
            discovered_via="tf_state",
        )
        key = (edge.source, edge.target, edge.type)
        # Skip if we already emitted a containment edge for the same pair.
        already_contained = any(
            k[0] == edge.source and k[1] == edge.target and k[2] in ("in_vpc", "in_subnet")
            for k in seen
        )
        if (
            key not in seen
            and not already_contained
            and edge.source in by_id
            and edge.target in by_id
        ):
            seen.add(key)
            edges.append(edge)

    # Populate `containers` on each Resource so the hierarchical layout groups
    # nodes inside their parent VPC/Subnet rectangles.
    for r in hcl.resources:
        node = by_id.get(_address_to_id(r.address))
        if not node:
            continue
        vpc_addr = _resolve_attr_ref(r.attributes.get("vpc_id"), by_address, "aws_vpc")
        subnet_addr = _resolve_attr_ref(r.attributes.get("subnet_id"), by_address, "aws_subnet")
        if not subnet_addr and isinstance(r.attributes.get("subnet_ids"), list):
            for v in r.attributes["subnet_ids"]:
                subnet_addr = _resolve_attr_ref(v, by_address, "aws_subnet")
                if subnet_addr:
                    break
        if vpc_addr:
            node.containers.vpc_id = _address_to_id(vpc_addr)
        if subnet_addr:
            node.containers.subnet_id = _address_to_id(subnet_addr)
            if not vpc_addr:
                # Infer vpc from subnet's own vpc_id attribute, if declared.
                sub = by_address[subnet_addr]
                sub_vpc = _resolve_attr_ref(
                    sub.attributes.get("vpc_id"), by_address, "aws_vpc"
                )
                if sub_vpc:
                    node.containers.vpc_id = _address_to_id(sub_vpc)

    return Graph(snapshot_id=snapshot_id, nodes=nodes, edges=edges)


# ---------- helpers ----------

def _to_resource(r: HCLResource) -> Resource:
    return Resource(
        id=_address_to_id(r.address),
        type=r.tf_type,
        name=r.name,
        region=_VIRTUAL_REGION,
        account_id=_VIRTUAL_ACCOUNT,
        tf_state=TFState(address=r.address, module=None, attributes=r.attributes),
        aws_state=None,
        drift=[],
        author=None,
        tags=_extract_tags(r.attributes),
    )


def _address_to_id(address: str) -> str:
    """Stable synthetic ID for a TF-only resource. The `tf://` prefix makes
    them distinguishable from real ARNs everywhere they appear."""
    return f"tf://{address}"


def _extract_tags(attributes: dict) -> dict[str, str]:
    raw = attributes.get("tags") or {}
    if not isinstance(raw, dict):
        return {}
    out: dict[str, str] = {}
    for k, v in raw.items():
        if isinstance(v, (str, int, float, bool)):
            out[str(k)] = str(v)
    return out


def _containment_targets(
    r: HCLResource, by_address: dict[str, HCLResource]
) -> list[tuple[str, str]]:
    """Returns (edge_type, target_address) for in_vpc / in_subnet relationships."""
    out: list[tuple[str, str]] = []
    vpc = _resolve_attr_ref(r.attributes.get("vpc_id"), by_address, "aws_vpc")
    if vpc:
        out.append(("in_vpc", vpc))
    subnet = _resolve_attr_ref(r.attributes.get("subnet_id"), by_address, "aws_subnet")
    if subnet:
        out.append(("in_subnet", subnet))
    return out


def _resolve_attr_ref(value, by_address: dict[str, HCLResource], expected_type: str) -> str | None:
    """If `value` is a string like '${aws_vpc.main.id}' or 'aws_vpc.main.id',
    return the declared address if it exists and matches `expected_type`."""
    if not isinstance(value, str):
        return None
    for m in _REF_RE.finditer(value):
        tf_type, name = m.group(1), m.group(2)
        if tf_type != expected_type:
            continue
        addr = f"{tf_type}.{name}"
        if addr in by_address:
            return addr
    return None


def _classify_reference(ref: HCLReference, source: HCLResource | None) -> str:
    """Map an HCL reference to one of the edge types the layout knows about."""
    via = ref.via.lower()
    if "security_group" in via or via.endswith("groups") or via == "security_groups":
        return "references_sg"
    if "target_group" in via:
        return "attached_to"
    if "route_table" in via or via.startswith("route"):
        return "routes_via"
    return "references"


def synth_snapshot_id() -> str:
    """A stable-ish virtual snapshot id for ephemeral TF diagrams."""
    return f"tf-diagram-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S%f')}"
