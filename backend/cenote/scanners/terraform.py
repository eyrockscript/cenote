"""Terraform parser — tfstate + plan JSON.

Supports:
- `terraform.tfstate` (v4 JSON format)
- `terraform show -json plan.bin > plan.json` (plan JSON)

Each parsed resource carries: tf_type, address (with module path and instance key),
and the resolved attributes. Module roots, count, and for_each are flattened to
one entry per instance.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import structlog

from cenote.catalogs.resource_types import is_supported
from cenote.core.arn import tf_to_arn
from cenote.core.models import TFState

log = structlog.get_logger()


class ParsedTFResource:
    """A single TF resource instance (one per count/for_each expansion)."""

    __slots__ = ("tf_type", "address", "module", "attributes", "name", "instance_key")

    def __init__(
        self,
        tf_type: str,
        address: str,
        module: str | None,
        name: str,
        attributes: dict[str, Any],
        instance_key: Any = None,
    ) -> None:
        self.tf_type = tf_type
        self.address = address
        self.module = module
        self.name = name
        self.attributes = attributes
        self.instance_key = instance_key

    def to_tf_state(self) -> TFState:
        return TFState(address=self.address, module=self.module, attributes=self.attributes)


def parse_tfstate(path: Path) -> list[ParsedTFResource]:
    """Parse a terraform.tfstate v4 file."""
    raw = json.loads(path.read_text())
    return _parse_state_json(raw)


def parse_plan_json(path: Path) -> list[ParsedTFResource]:
    """Parse a `terraform show -json plan.bin` output."""
    raw = json.loads(path.read_text())
    # plan JSON has `planned_values.root_module` (post-apply state)
    pv = raw.get("planned_values") or {}
    return _walk_plan_module(pv.get("root_module") or {}, module_path=None)


def _parse_state_json(state: dict[str, Any]) -> list[ParsedTFResource]:
    out: list[ParsedTFResource] = []
    for res in state.get("resources", []):
        if res.get("mode") != "managed":
            continue
        tf_type = res.get("type")
        if not tf_type or not is_supported(tf_type):
            continue
        name = res.get("name") or tf_type
        module = res.get("module")  # e.g. "module.api" or None
        for inst in res.get("instances", []):
            attrs = inst.get("attributes") or {}
            instance_key = inst.get("index_key")
            address = _build_address(module, tf_type, name, instance_key)
            out.append(ParsedTFResource(
                tf_type=tf_type,
                address=address,
                module=module,
                name=name,
                attributes=attrs,
                instance_key=instance_key,
            ))
    return out


def _walk_plan_module(module: dict[str, Any], module_path: str | None) -> list[ParsedTFResource]:
    out: list[ParsedTFResource] = []
    for res in module.get("resources", []):
        if res.get("mode") != "managed":
            continue
        tf_type = res.get("type")
        if not tf_type or not is_supported(tf_type):
            continue
        out.append(ParsedTFResource(
            tf_type=tf_type,
            address=res.get("address") or f"{tf_type}.{res.get('name')}",
            module=module_path,
            name=res.get("name") or tf_type,
            attributes=res.get("values") or {},
            instance_key=res.get("index"),
        ))
    for child in module.get("child_modules", []):
        out.extend(_walk_plan_module(child, child.get("address")))
    return out


def _build_address(module: str | None, tf_type: str, name: str, key: Any) -> str:
    base = f"{tf_type}.{name}"
    if module:
        base = f"{module}.{base}"
    if key is None:
        return base
    if isinstance(key, int):
        return f"{base}[{key}]"
    return f'{base}["{key}"]'


def resolve_arn(parsed: ParsedTFResource, account_id: str, region: str) -> str | None:
    """Map a parsed TF resource to its canonical AWS ARN."""
    return tf_to_arn(parsed.tf_type, parsed.attributes, account_id, region)
