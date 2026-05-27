"""Reconciliador — funde tres flujos en el grafo unificado.

Entrada:
- aws_resources: lista normalizada del scanner AWS (cada uno con aws_state)
- tf_resources: lista parseada de Terraform (cada uno con tf_state)
- authors: dict ARN -> Author (de CloudTrail)

Salida: list[Resource] reconciliados con estado (matched | drift | tf_only | aws_only).
"""

from __future__ import annotations

import structlog

from cenote.core.drift import compute_drift
from cenote.core.models import Author, AWSState, Resource, TFState
from cenote.scanners.terraform import ParsedTFResource, resolve_arn

log = structlog.get_logger()


def reconcile(
    aws_resources: list[Resource],
    tf_resources: list[ParsedTFResource],
    authors: dict[str, Author],
    account_id: str,
    region: str,
) -> list[Resource]:
    by_arn: dict[str, Resource] = {r.id: r for r in aws_resources}
    unresolved: list[str] = []

    for tf in tf_resources:
        arn = resolve_arn(tf, account_id, region)
        if not arn:
            unresolved.append(tf.address)
            continue
        tf_state = tf.to_tf_state()
        if arn in by_arn:
            by_arn[arn].tf_state = tf_state
        else:
            # TF declares but AWS doesn't have it (yet, or any more)
            by_arn[arn] = Resource(
                id=arn,
                type=tf.tf_type,
                name=tf.name,
                region=region,
                account_id=account_id,
                tf_state=tf_state,
                aws_state=None,
            )

    # Inject authorship
    for arn, author in authors.items():
        if arn in by_arn:
            by_arn[arn].author = author

    # Compute drift on matched pairs
    for r in by_arn.values():
        if r.tf_state and r.aws_state:
            r.drift = compute_drift(
                r.type,
                r.tf_state.attributes,
                r.aws_state.attributes,
            )

    if unresolved:
        log.warning("reconciler.unresolved_tf", count=len(unresolved), sample=unresolved[:3])

    return list(by_arn.values())


def compute_blast_radius(resources: list[Resource], edges: list) -> None:
    """Annotates each resource with its blast_radius (count of downstream nodes)."""
    children: dict[str, set[str]] = {}
    for e in edges:
        children.setdefault(e.source, set()).add(e.target)

    def dfs(node: str, seen: set[str], depth: int) -> None:
        if depth >= 5:
            return
        for child in children.get(node, set()):
            if child in seen:
                continue
            seen.add(child)
            dfs(child, seen, depth + 1)

    for r in resources:
        seen: set[str] = set()
        dfs(r.id, seen, 0)
        r.blast_radius = len(seen)
