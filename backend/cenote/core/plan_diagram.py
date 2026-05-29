"""Build a `Graph` from `terraform show -json` plan output.

The plan JSON gives us everything raw HCL can't:
- Modules, count, and for_each are fully expanded into one entry per instance.
- All `var.x` / `local.x` / interpolations are resolved into concrete values.
- Each resource carries a `change.actions` list (create/update/delete/no-op/read)
  that lets us color the diagram by what terraform will actually do.
- The `configuration` section holds a precise dependency graph
  (`expressions.<attr>.references`) — far more reliable than scanning string
  values with a regex.

Every managed resource is rendered (the diagram answers "what will terraform
build?"); types outside `cenote.catalogs.resource_types.SUPPORTED_TYPES` get a
generic icon on the frontend. `data` sources are only kept when they're in the
catalog, to avoid cluttering the diagram with non-infra lookups.

Two non-trivial translations happen here:
1. `configuration` references use the resource-block address WITHOUT the
   count/for_each instance key (e.g. `aws_subnet.public`), while
   `planned_values` instances carry the full address with the key
   (`aws_subnet.public[0]`). We build an instance index so a single config
   reference fans out to all matching instances.
2. References inside a child module body look like `var.subnet_id`. To turn
   those into real cross-module edges, we read the caller's
   `module_calls.<name>.expressions.subnet_id.references` and substitute.
"""

from __future__ import annotations

import json
import re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import structlog

from cenote.catalogs.resource_types import is_diagram_data_type
from cenote.core.models import Edge, Graph, PlannedAction, Resource, TFState

log = structlog.get_logger()

_VIRTUAL_ACCOUNT = "000000000000"
_VIRTUAL_REGION = "tf-planned"
# Matches a TF address inside a configuration.references entry. The leading
# group accepts any number of `module.<name>.` segments AND a trailing
# instance key (`[0]`, `["foo"]`) so we don't strip count/for_each specificity.
_ADDR_HEAD_RE = re.compile(
    r"^((?:module\.[^.\[\]]+\.)*"
    r"(?:aws_[a-z0-9_]+|data\.aws_[a-z0-9_]+)\."
    r"[A-Za-z_][\w-]*"
    r'(?:\[(?:\d+|"[^"]*")\])?'
    r")"
)
# Strips a trailing instance key like `[0]` or `["foo"]` from an address.
_INSTANCE_KEY_RE = re.compile(r"\[[^\]]+\]$")


def build_graph_from_plan(plan_json_path: Path, snapshot_id: str) -> Graph:
    raw: dict[str, Any] = json.loads(plan_json_path.read_text())

    instances = _walk_planned_values(raw.get("planned_values", {}).get("root_module", {}))

    actions_by_addr: dict[str, PlannedAction] = {}
    for rc in raw.get("resource_changes", []) or []:
        addr = rc.get("address")
        if not addr:
            continue
        actions = (rc.get("change") or {}).get("actions") or []
        actions_by_addr[addr] = _normalize_action(actions)

    refs_by_addr = _collect_references(raw.get("configuration", {}).get("root_module", {}))

    # Resource nodes — keyed by FULL instance address (includes count/for_each key).
    #
    # The plan diagram shows EVERY managed resource terraform will create/change,
    # not just the 13-type catalog — a real stack is mostly IAM, ECS, CloudWatch,
    # SNS, etc., and hiding them made the diagram show "1 resource". Unknown
    # types still render (generic icon + the tf_type as label) on the frontend.
    #
    # `data` sources are lookups, not built infrastructure, so we only keep the
    # ones in the catalog (existing VPC/subnet referenced as containers) and drop
    # the noise (aws_caller_identity, aws_iam_policy_document, aws_region, …).
    nodes: list[Resource] = []
    by_addr: dict[str, Resource] = {}
    for inst in instances:
        if inst.get("mode") == "data" and not is_diagram_data_type(inst["type"]):
            continue
        node = _to_resource(inst, actions_by_addr.get(inst["address"]))
        nodes.append(node)
        by_addr[inst["address"]] = node

    # Diagnostic: what did terraform actually plan? If a "basic" resource (the
    # VPC, say) is missing from the diagram, this shows whether it was missing
    # from the plan itself (wrong root module / unreferenced folder) vs dropped
    # here. Check the api logs for `plan_diagram.parsed`.
    by_type = Counter(i["type"] for i in instances)
    log.info(
        "plan_diagram.parsed",
        planned_instances=len(instances),
        managed=sum(1 for i in instances if i.get("mode") == "managed"),
        data=sum(1 for i in instances if i.get("mode") == "data"),
        rendered_nodes=len(nodes),
        top_types=dict(by_type.most_common(15)),
    )

    # Map BARE address (no [..]) → all matching instance addresses, so a single
    # configuration-level reference fans out to every count/for_each instance.
    instances_by_bare: dict[str, list[str]] = {}
    for full_addr in by_addr:
        instances_by_bare.setdefault(_strip_instance_key(full_addr), []).append(full_addr)

    edges: list[Edge] = []
    seen: set[tuple[str, str, str]] = set()
    for cfg_addr, ref_map in refs_by_addr.items():
        for src_addr in instances_by_bare.get(cfg_addr, []):
            src_node = by_addr.get(src_addr)
            if not src_node:
                continue
            for attr, ref_targets in ref_map.items():
                # Terraform emits both `aws_subnet.public[0]` AND
                # `aws_subnet.public` for the same dependency. Keep only the
                # most specific form so we don't fan out to every instance
                # when the user pointed at a single one.
                addrs = [_strip_attr_suffix(r) for r in ref_targets]
                addrs = [a for a in addrs if a and a != cfg_addr]
                indexed_bare = {
                    _strip_instance_key(a) for a in addrs if _INSTANCE_KEY_RE.search(a)
                }
                preferred = [
                    a for a in addrs
                    if _INSTANCE_KEY_RE.search(a) or _strip_instance_key(a) not in indexed_bare
                ]
                # Dedupe while preserving order.
                preferred = list(dict.fromkeys(preferred))
                for target_addr in preferred:
                    if _INSTANCE_KEY_RE.search(target_addr):
                        tgt_candidates = [target_addr] if target_addr in by_addr else []
                    else:
                        tgt_candidates = instances_by_bare.get(target_addr, [])
                    for tgt_addr in tgt_candidates:
                        tgt_node = by_addr.get(tgt_addr)
                        if not tgt_node:
                            continue
                        edge_type = _edge_type_for(attr, tgt_node.type)
                        key = (src_node.id, tgt_node.id, edge_type)
                        if key in seen:
                            continue
                        seen.add(key)
                        edges.append(
                            Edge(
                                source=src_node.id,
                                target=tgt_node.id,
                                type=edge_type,
                                metadata={"via": attr},
                                discovered_via="tf_state",
                            )
                        )
                        # Containers: VPC/Subnet groupings for the layout.
                        if edge_type == "in_vpc":
                            src_node.containers.vpc_id = tgt_node.id
                        elif edge_type == "in_subnet":
                            src_node.containers.subnet_id = tgt_node.id
                            if not src_node.containers.vpc_id and tgt_node.containers.vpc_id:
                                src_node.containers.vpc_id = tgt_node.containers.vpc_id

    # Propagate vpc_id from subnet up through resources that only declared
    # subnet_id (EC2, RDS, etc.).
    for node in nodes:
        if node.containers.vpc_id is None and node.containers.subnet_id:
            sub = next((n for n in nodes if n.id == node.containers.subnet_id), None)
            if sub and sub.containers.vpc_id:
                node.containers.vpc_id = sub.containers.vpc_id

    return Graph(snapshot_id=snapshot_id, nodes=nodes, edges=edges)


# ---------- planned_values walking ----------

def _walk_planned_values(module: dict[str, Any]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for res in module.get("resources", []) or []:
        if res.get("mode") not in ("managed", "data"):
            continue
        out.append(
            {
                "address": res.get("address") or f"{res.get('type')}.{res.get('name')}",
                "type": res.get("type") or "",
                "name": res.get("name") or "",
                "values": res.get("values") or {},
                "mode": res.get("mode"),
                "module_address": module.get("address"),  # None for root
                "index": res.get("index"),
            }
        )
    for child in module.get("child_modules", []) or []:
        out.extend(_walk_planned_values(child))
    return out


# ---------- configuration walking ----------

def _build_output_map(module: dict[str, Any], prefix: str = "") -> dict[str, list[str]]:
    """Map a fully-qualified module output (`module.network.subnet_id`) to the
    fully-qualified resource addresses it ultimately resolves to
    (`module.network.aws_subnet.app`).

    Real stacks wire modules together through outputs, so without this a
    `subnet_id = module.network.subnet_id` consumed by another module never
    connects to the subnet that produced it. Children are resolved first so an
    output that re-exports a child module's output chains correctly.
    """
    omap: dict[str, list[str]] = {}
    for name, call in (module.get("module_calls") or {}).items():
        omap.update(_build_output_map(call.get("module") or {}, f"{prefix}module.{name}."))
    for oname, odef in (module.get("outputs") or {}).items():
        expr = odef.get("expression", {}) if isinstance(odef, dict) else {}
        resolved: list[str] = []
        for ref in _extract_refs_from_expression(expr):
            resolved.extend(_resolve_config_ref(ref, prefix, omap))
        if resolved:
            omap[f"{prefix}{oname}"] = list(dict.fromkeys(resolved))
    return omap


def _resolve_config_ref(ref: str, prefix: str, omap: dict[str, list[str]]) -> list[str]:
    """Turn one configuration reference (in the namespace of the module at
    `prefix`) into zero or more fully-qualified, bare resource addresses.

      - bare resource (`aws_subnet.app.id`)      → `<prefix>aws_subnet.app`
      - child-module output (`module.net.x`)     → omap[`<prefix>module.net.x`]
      - var./local./each./count.                 → handled elsewhere / ignored
    """
    if ref.startswith(("var.", "local.", "each.", "count.", "path.", "terraform.")):
        return []
    if ref.startswith("module."):
        return list(omap.get(f"{prefix}{ref}", omap.get(ref, [])))
    bare = _strip_attr_suffix(ref)
    return [f"{prefix}{bare}"] if bare else []


def _collect_references(
    module: dict[str, Any],
    prefix: str = "",
    inherited_var_bindings: dict[str, list[str]] | None = None,
    output_map: dict[str, list[str]] | None = None,
) -> dict[str, dict[str, list[str]]]:
    """Walk the `configuration` tree and return:
        { fq_resource_address: { attribute_name: [fq_target_resource_addresses] } }

    Every target is resolved to a fully-qualified, bare resource address so the
    edge builder can fan it out to instances. Three reference shapes are
    resolved: bare sibling resources (prefixed with the module path), `var.X`
    (substituted with the caller's binding, itself pre-resolved to resources),
    and `module.child.output` (resolved via the output map to the producing
    resource).
    """
    omap = output_map if output_map is not None else _build_output_map(module, "")
    inherited = inherited_var_bindings or {}
    out: dict[str, dict[str, list[str]]] = {}

    def _resolve(ref: str) -> list[str]:
        if ref.startswith("var."):
            return list(inherited.get(ref, []))
        return _resolve_config_ref(ref, prefix, omap)

    for res in module.get("resources", []) or []:
        raw_addr = res.get("address") or f"{res.get('type')}.{res.get('name')}"
        addr = f"{prefix}{raw_addr}"
        ref_map: dict[str, list[str]] = {}
        for attr, expr in (res.get("expressions") or {}).items():
            targets: list[str] = []
            for ref in _extract_refs_from_expression(expr):
                targets.extend(_resolve(ref))
            targets = [t for t in dict.fromkeys(targets) if t and t != addr]
            if targets:
                ref_map[attr] = targets
        if ref_map:
            out[addr] = ref_map

    for name, call in (module.get("module_calls") or {}).items():
        # Resolve each argument the caller passes (`subnet_id = module.net.x`)
        # to fully-qualified resources, so `var.subnet_id` inside the child
        # connects straight to the producing resource.
        var_bindings: dict[str, list[str]] = {}
        for var_name, expr in (call.get("expressions") or {}).items():
            resolved: list[str] = []
            for r in _extract_refs_from_expression(expr):
                resolved.extend(_resolve(r))
            if resolved:
                var_bindings[f"var.{var_name}"] = list(dict.fromkeys(resolved))

        out.update(
            _collect_references(
                call.get("module") or {},
                prefix=f"{prefix}module.{name}.",
                inherited_var_bindings=var_bindings,
                output_map=omap,
            )
        )
    return out


def _extract_refs_from_expression(expr: Any) -> list[str]:
    """Pull every `references` array out of an expression node, regardless of
    nesting depth (list-of-objects, single-object, list-of-lists for lists).
    """
    out: list[str] = []
    if isinstance(expr, dict):
        refs = expr.get("references")
        if isinstance(refs, list):
            for r in refs:
                if isinstance(r, str):
                    out.append(r)
        for v in expr.values():
            if isinstance(v, (dict, list)):
                out.extend(_extract_refs_from_expression(v))
    elif isinstance(expr, list):
        for item in expr:
            out.extend(_extract_refs_from_expression(item))
    return out


def _strip_attr_suffix(ref: str) -> str | None:
    """`aws_vpc.main.id` → `aws_vpc.main`. `module.x.aws_vpc.y.id` →
    `module.x.aws_vpc.y`. Returns None if `ref` isn't a resource reference
    (e.g. `var.x`, `each.key`, `count.index`)."""
    m = _ADDR_HEAD_RE.match(ref)
    return m.group(0) if m else None


def _strip_instance_key(addr: str) -> str:
    """`aws_subnet.public[0]` → `aws_subnet.public`. Module path is preserved."""
    return _INSTANCE_KEY_RE.sub("", addr)


# ---------- helpers ----------

def _to_resource(inst: dict[str, Any], action: PlannedAction | None) -> Resource:
    values = inst["values"]
    address = inst["address"]
    if action is None and inst.get("mode") == "data":
        action = "read"
    return Resource(
        id=f"tf://{address}",
        type=inst["type"],
        # Display label: include the instance key for count/for_each so the
        # 3 `aws_subnet.public[*]` nodes don't render as identical text.
        name=_display_name(inst),
        region=_VIRTUAL_REGION,
        account_id=_VIRTUAL_ACCOUNT,
        tf_state=TFState(
            address=address,
            module=inst.get("module_address"),
            attributes=values,
        ),
        aws_state=None,
        drift=[],
        author=None,
        tags=_extract_tags(values),
        planned_action=action,
    )


def _display_name(inst: dict[str, Any]) -> str:
    name = inst["name"]
    idx = inst.get("index")
    if idx is None:
        return name
    if isinstance(idx, int):
        return f"{name}[{idx}]"
    return f'{name}["{idx}"]'


def _extract_tags(values: dict[str, Any]) -> dict[str, str]:
    raw = values.get("tags") or {}
    if not isinstance(raw, dict):
        return {}
    return {str(k): str(v) for k, v in raw.items() if isinstance(v, (str, int, float, bool))}


def _normalize_action(actions: list[str]) -> PlannedAction:
    """Collapse the `change.actions` list (terraform may emit
    ["delete","create"] for replace) into a single most-impactful action."""
    if not actions:
        return "no-op"
    if "delete" in actions and "create" in actions:
        return "create"  # replace — show as create for forward-looking diagrams
    for preferred in ("delete", "create", "update", "read", "no-op"):
        if preferred in actions:
            return preferred  # type: ignore[return-value]
    return "no-op"


def _edge_type_for(attr: str, target_type: str) -> str:
    a = attr.lower()
    if a == "vpc_id" and target_type == "aws_vpc":
        return "in_vpc"
    if ("subnet_id" in a or a == "subnets") and target_type == "aws_subnet":
        return "in_subnet"
    if "security_group" in a or a == "vpc_security_group_ids":
        return "references_sg"
    if "target_group" in a:
        return "attached_to"
    if "route_table" in a:
        return "routes_via"
    return "references"


def synth_plan_snapshot_id() -> str:
    return f"tf-plan-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S%f')}"
