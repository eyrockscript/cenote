"""Orchestrator — runs scanner + parser + reconciler and persists a snapshot."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from pathlib import Path

import structlog

from cenote.core.models import Graph, Resource, Snapshot, SnapshotSource
from cenote.core.reconciler import compute_blast_radius, reconcile
from cenote.scanners.aws import AWSScanner
from cenote.scanners.cloudtrail import CloudTrailMiner
from cenote.scanners.terraform import parse_plan_json, parse_tfstate
from cenote.store.duckdb_store import DuckDBStore

log = structlog.get_logger()


class ScanRequest:
    def __init__(
        self,
        region: str,
        profile: str | None = None,
        tfstate_path: Path | None = None,
        tfplan_path: Path | None = None,
        include_authorship: bool = True,
    ) -> None:
        self.region = region
        self.profile = profile
        self.tfstate_path = tfstate_path
        self.tfplan_path = tfplan_path
        self.include_authorship = include_authorship


def run_scan(req: ScanRequest, store: DuckDBStore) -> Snapshot:
    """End-to-end scan that produces and persists a snapshot."""
    scanner = AWSScanner(region=req.region, profile=req.profile)
    aws_resources, edges = scanner.scan()
    account_id = scanner.account_id
    log.info("scan.aws.ok", count=len(aws_resources), edges=len(edges))

    tf_resources = []
    if req.tfstate_path and req.tfstate_path.exists():
        tf_resources = parse_tfstate(req.tfstate_path)
        log.info("scan.tf.tfstate", count=len(tf_resources))
    if req.tfplan_path and req.tfplan_path.exists():
        plan_parsed = parse_plan_json(req.tfplan_path)
        tf_resources.extend(plan_parsed)
        log.info("scan.tf.plan", count=len(plan_parsed))

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
    source = (
        SnapshotSource.PLAN if req.tfplan_path else
        (SnapshotSource.TFSTATE if req.tfstate_path else SnapshotSource.LIVE)
    )
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
    )
    return snapshot
