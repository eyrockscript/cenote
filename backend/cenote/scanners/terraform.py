"""Terraform parser — tfstate + plan JSON, with sourcing helpers.

Supports:
- `terraform.tfstate` (v4 JSON format) — local path or s3:// URI
- `terraform show -json plan.bin` (plan JSON) — local path
- Directory of `.tf` files — runs terraform init+plan+show internally

Each parsed resource carries: tf_type, address (with module path and instance key),
and the resolved attributes. Module roots, count, and for_each are flattened to
one entry per instance.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import boto3
import structlog

from cenote.catalogs.resource_types import is_supported
from cenote.core.arn import tf_to_arn
from cenote.core.models import TFState

log = structlog.get_logger()


class TerraformError(RuntimeError):
    """Raised when terraform sourcing fails (download, init, plan)."""


def fetch_tfstate(uri: str, profile: str | None = None) -> Path:
    """Resolve a tfstate source to a local file path.

    Accepts:
      - local path (already a file)
      - `s3://bucket/key` URI (downloaded with the same AWS session as the scanner)

    The caller is responsible for cleaning up if it was downloaded.
    """
    parsed = urlparse(uri)
    if parsed.scheme in ("", "file"):
        p = Path(parsed.path or uri)
        if not p.exists():
            raise TerraformError(f"tfstate not found at {p}")
        return p
    if parsed.scheme == "s3":
        if not parsed.netloc or not parsed.path:
            raise TerraformError(f"invalid s3 URI: {uri}")
        session = boto3.Session(profile_name=profile) if profile else boto3.Session()
        s3 = session.client("s3")
        bucket = parsed.netloc
        key = parsed.path.lstrip("/")
        fd, dest_str = tempfile.mkstemp(suffix=".tfstate")
        os.close(fd)
        dest = Path(dest_str)
        try:
            s3.download_file(bucket, key, str(dest))
        except Exception as exc:
            dest.unlink(missing_ok=True)
            raise TerraformError(f"failed to download {uri}: {exc}") from exc
        log.info("tfstate.s3.downloaded", uri=uri, dest=str(dest))
        return dest
    raise TerraformError(f"unsupported tfstate URI scheme: {parsed.scheme}")


def run_terraform_plan(directory: Path, extra_env: dict[str, str] | None = None) -> Path:
    """Run `terraform init` + `plan` + `show -json` in `directory`. Returns plan-JSON path.

    Honors existing `*.tfvars` / `*.auto.tfvars` in the dir and `TF_VAR_*` env vars.
    The plan binary and JSON are written under `<dir>/.terraform/`.
    """
    if not shutil.which("terraform"):
        raise TerraformError(
            "terraform binary not found in PATH. Rebuild the api container "
            "(it ships terraform by default)."
        )
    if not directory.exists() or not directory.is_dir():
        raise TerraformError(f"directory does not exist: {directory}")
    if not any(directory.glob("*.tf")):
        raise TerraformError(f"no .tf files in {directory}")

    proc_env = {**os.environ, **(extra_env or {})}

    def _run(args: list[str], step: str) -> subprocess.CompletedProcess[str]:
        log.info("terraform.run", step=step, args=args)
        return subprocess.run(
            ["terraform", *args],
            cwd=str(directory),
            capture_output=True,
            text=True,
            env=proc_env,
            check=False,
        )

    init = _run(["init", "-input=false", "-no-color"], "init")
    if init.returncode != 0:
        tail = (init.stderr or init.stdout or "").splitlines()[-15:]
        raise TerraformError("terraform init failed:\n" + "\n".join(tail))

    plan_bin = directory / ".terraform" / "cenote.tfplan"
    plan_bin.parent.mkdir(parents=True, exist_ok=True)
    plan = _run(
        ["plan", "-input=false", "-no-color", "-out", str(plan_bin)],
        "plan",
    )
    if plan.returncode != 0:
        tail = (plan.stderr or plan.stdout or "").splitlines()[-15:]
        raise TerraformError("terraform plan failed:\n" + "\n".join(tail))

    show = _run(["show", "-json", str(plan_bin)], "show")
    if show.returncode != 0:
        raise TerraformError(f"terraform show -json failed: {show.stderr[:500]}")

    plan_json = directory / ".terraform" / "cenote.plan.json"
    plan_json.write_text(show.stdout)
    log.info("terraform.plan.ok", json_path=str(plan_json))
    return plan_json


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
