"""Orchestrator — runs scanner + parser + reconciler and persists a snapshot."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import structlog

from cenote.core.models import Graph, Snapshot, SnapshotSource
from cenote.core.reconciler import compute_blast_radius, reconcile
from cenote.scanners.aws import AWSScanner
from cenote.scanners.cloudtrail import CloudTrailMiner
from cenote.scanners.terraform import (
    fetch_tfstate,
    parse_plan_json,
    parse_tfstate,
    run_terraform_plan,
)
from cenote.store.duckdb_store import DuckDBStore

log = structlog.get_logger()


@dataclass
class ScanRequest:
    region: str
    profile: str | None = None

    # Mutually exclusive Terraform sources (first non-None wins):
    tfstate_path: Path | None = None      # local .tfstate file
    tfstate_s3: str | None = None         # s3://bucket/key URI
    tfplan_path: Path | None = None       # local plan.json (from `terraform show -json`)
    terraform_dir: Path | None = None     # directory of .tf files (planned in-container)

    include_authorship: bool = True


def run_scan(req: ScanRequest, store: DuckDBStore) -> Snapshot:
    """End-to-end scan that produces and persists a snapshot."""
    scanner = AWSScanner(region=req.region, profile=req.profile)
    aws_resources, edges = scanner.scan()
    account_id = scanner.account_id
    log.info("scan.aws.ok", count=len(aws_resources), edges=len(edges))

    tf_resources: list = []
    source = SnapshotSource.LIVE
    tmp_to_clean: Path | None = None

    if req.tfstate_path and req.tfstate_path.exists():
        tf_resources = parse_tfstate(req.tfstate_path)
        source = SnapshotSource.TFSTATE
        log.info("scan.tf.tfstate", count=len(tf_resources))

    elif req.tfstate_s3:
        local = fetch_tfstate(req.tfstate_s3, profile=req.profile)
        tmp_to_clean = local
        tf_resources = parse_tfstate(local)
        source = SnapshotSource.TFSTATE
        log.info("scan.tf.s3_tfstate", count=len(tf_resources), uri=req.tfstate_s3)

    elif req.tfplan_path and req.tfplan_path.exists():
        tf_resources = parse_plan_json(req.tfplan_path)
        source = SnapshotSource.PLAN
        log.info("scan.tf.plan_json", count=len(tf_resources))

    elif req.terraform_dir:
        plan_json = run_terraform_plan(req.terraform_dir)
        tf_resources = parse_plan_json(plan_json)
        source = SnapshotSource.PLAN
        log.info("scan.tf.dir_plan", count=len(tf_resources), dir=str(req.terraform_dir))

    authors: dict = {}
    if req.include_authorship:
        try:
            target_arns = {r.id for r in aws_resources}
            miner = CloudTrailMiner(region=req.region, account_id=account_id, profile=req.profile)
            authors = miner.mine(target_arns)
            log.info("scan.ct.ok", count=len(authors))
        except Exception as exc:
            log.warning("scan.ct.fail", error=str(exc))

    reconciled = reconcile(aws_resources, tf_resources, authors, account_id, req.region)
    compute_blast_radius(reconciled, edges)

    drift_count = sum(1 for r in reconciled if r.drift)
    orphan_count = sum(1 for r in reconciled if r.state == "aws_only")
    declared_only = sum(1 for r in reconciled if r.state == "tf_only")

    snap_id = f"snap-{uuid.uuid4().hex[:12]}"
    snapshot = Snapshot(
        id=snap_id,
        account_id=account_id,
        region=req.region,
        created_at=datetime.now(timezone.utc),
        source=source,
        resource_count=len(reconciled),
        drift_count=drift_count,
        orphan_count=orphan_count,
        declared_only_count=declared_only,
    )
    graph = Graph(snapshot_id=snap_id, nodes=reconciled, edges=edges)
    store.save_snapshot(snapshot, graph)
    log.info(
        "scan.persisted",
        snapshot_id=snap_id,
        resources=len(reconciled),
        drift=drift_count,
        orphans=orphan_count,
        source=source.value,
    )

    if tmp_to_clean and tmp_to_clean.exists():
        try:
            tmp_to_clean.unlink()
        except OSError:
            pass

    return snapshot
