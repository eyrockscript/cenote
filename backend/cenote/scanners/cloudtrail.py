"""CloudTrail miner — atribuye autoría a cada ARN.

Estrategia eficiente:
- Una pasada por TIPO DE EVENTO (no por recurso).
- Cada evento se mapea a un ARN computado a partir del id en responseElements.
- Cache local en SQLite (por cuenta+región) para no repetir el mining.
- Cubre los últimos 90 días vía cloudtrail:LookupEvents (gratis).

Inferencia de `via`:
- userIdentity.invokedBy == "cloudformation.amazonaws.com" → CloudFormation
- sessionIssuer.userName matches /terraform|atlantis|spacelift/i → Terraform
- userAgent empieza con "aws-cli/" → CLI
- userAgent empieza con "aws-sdk-" → SDK
- userAgent contiene "console" o "Mozilla" → Console
- default → Unknown
"""

from __future__ import annotations

import json
import re
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import boto3
import structlog

from cenote.catalogs.create_events import CREATE_EVENTS, event_names
from cenote.core.models import Author, AuthorVia

log = structlog.get_logger()

_TERRAFORM_AGENT_RE = re.compile(r"terraform|atlantis|spacelift|tflint", re.IGNORECASE)


def _classify_via(event: dict[str, Any]) -> AuthorVia:
    user_identity = event.get("userIdentity", {}) or {}
    invoked_by = user_identity.get("invokedBy") or ""
    if invoked_by == "cloudformation.amazonaws.com":
        return AuthorVia.CLOUDFORMATION

    session_issuer = (user_identity.get("sessionContext") or {}).get("sessionIssuer") or {}
    issuer_name = session_issuer.get("userName") or ""
    if _TERRAFORM_AGENT_RE.search(issuer_name):
        return AuthorVia.TERRAFORM

    user_agent = event.get("userAgent") or ""
    if _TERRAFORM_AGENT_RE.search(user_agent):
        return AuthorVia.TERRAFORM
    if user_agent.startswith("aws-cli/"):
        return AuthorVia.CLI
    if user_agent.startswith("aws-sdk-") or "Boto3" in user_agent:
        return AuthorVia.SDK
    if "console" in user_agent.lower() or user_agent.startswith("Mozilla"):
        return AuthorVia.CONSOLE
    return AuthorVia.UNKNOWN


def _extract_principal(event: dict[str, Any]) -> tuple[str | None, str | None]:
    user_identity = event.get("userIdentity", {}) or {}
    arn = user_identity.get("arn")
    name = user_identity.get("userName")
    if not name:
        session = (user_identity.get("sessionContext") or {}).get("sessionIssuer") or {}
        name = session.get("userName")
    return arn, name


def _resolve_path(obj: Any, path: str) -> Any:
    """Tiny jmespath-lite: supports a.b[0].c and a.b[].c (first match)."""
    cur = obj
    for part in path.split("."):
        if cur is None:
            return None
        if "[" in part:
            base, idx_s = part.split("[", 1)
            idx_s = idx_s.rstrip("]")
            if base:
                cur = cur.get(base) if isinstance(cur, dict) else None
            if cur is None or not isinstance(cur, list):
                return None
            if idx_s == "":
                cur = cur[0] if cur else None
            else:
                try:
                    cur = cur[int(idx_s)]
                except (IndexError, ValueError):
                    return None
        else:
            cur = cur.get(part) if isinstance(cur, dict) else None
    return cur


def _build_arn(tf_type: str, identifier: str, account_id: str, region: str) -> str | None:
    """Build canonical ARN from a resource id extracted from CloudTrail."""
    builders: dict[str, callable] = {
        "aws_vpc": lambda i: f"arn:aws:ec2:{region}:{account_id}:vpc/{i}",
        "aws_subnet": lambda i: f"arn:aws:ec2:{region}:{account_id}:subnet/{i}",
        "aws_security_group": lambda i: f"arn:aws:ec2:{region}:{account_id}:security-group/{i}",
        "aws_route_table": lambda i: f"arn:aws:ec2:{region}:{account_id}:route-table/{i}",
        "aws_internet_gateway": lambda i: f"arn:aws:ec2:{region}:{account_id}:internet-gateway/{i}",
        "aws_nat_gateway": lambda i: f"arn:aws:ec2:{region}:{account_id}:natgateway/{i}",
        "aws_instance": lambda i: f"arn:aws:ec2:{region}:{account_id}:instance/{i}",
        "aws_ebs_volume": lambda i: f"arn:aws:ec2:{region}:{account_id}:volume/{i}",
        "aws_lb": lambda i: i if str(i).startswith("arn:") else None,
        "aws_lb_target_group": lambda i: i if str(i).startswith("arn:") else None,
        "aws_db_instance": lambda i: i if str(i).startswith("arn:") else f"arn:aws:rds:{region}:{account_id}:db:{i}",
        "aws_s3_bucket": lambda i: f"arn:aws:s3:::{i}",
        "aws_lambda_function": lambda i: i if str(i).startswith("arn:") else None,
    }
    builder = builders.get(tf_type)
    return builder(identifier) if builder else None


class CloudTrailMiner:
    """Mines CloudTrail Lookup events to attribute authorship to resources."""

    def __init__(
        self,
        region: str,
        account_id: str,
        profile: str | None = None,
        cache_path: Path | None = None,
        lookback_days: int = 90,
    ) -> None:
        self.region = region
        self.account_id = account_id
        self.lookback_days = lookback_days
        self.session = boto3.Session(profile_name=profile) if profile else boto3.Session()
        self._ct = self.session.client("cloudtrail", region_name=region)
        self.cache_path = cache_path or Path("/data/cloudtrail_cache.sqlite")
        self.cache_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_cache()

    def _init_cache(self) -> None:
        with sqlite3.connect(self.cache_path) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS author_cache (
                    arn TEXT PRIMARY KEY,
                    account_id TEXT NOT NULL,
                    region TEXT NOT NULL,
                    via TEXT NOT NULL,
                    principal_arn TEXT,
                    principal_name TEXT,
                    event_id TEXT,
                    event_time TEXT,
                    confidence REAL,
                    cached_at TEXT NOT NULL
                );
            """)

    def _load_cache(self) -> dict[str, Author]:
        out: dict[str, Author] = {}
        with sqlite3.connect(self.cache_path) as conn:
            rows = conn.execute(
                "SELECT arn, via, principal_arn, principal_name, event_id, event_time, confidence "
                "FROM author_cache WHERE account_id = ? AND region = ?",
                [self.account_id, self.region],
            ).fetchall()
        for r in rows:
            out[r[0]] = Author(
                via=AuthorVia(r[1]),
                principal_arn=r[2],
                principal_name=r[3],
                event_id=r[4],
                event_time=datetime.fromisoformat(r[5]) if r[5] else None,
                confidence=r[6] or 1.0,
            )
        return out

    def _save_cache(self, authors: dict[str, Author]) -> None:
        now = datetime.now(timezone.utc).isoformat()
        with sqlite3.connect(self.cache_path) as conn:
            for arn, a in authors.items():
                conn.execute(
                    """
                    INSERT OR REPLACE INTO author_cache
                      (arn, account_id, region, via, principal_arn, principal_name,
                       event_id, event_time, confidence, cached_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    [
                        arn,
                        self.account_id,
                        self.region,
                        a.via if isinstance(a.via, str) else a.via.value,
                        a.principal_arn,
                        a.principal_name,
                        a.event_id,
                        a.event_time.isoformat() if a.event_time else None,
                        a.confidence,
                        now,
                    ],
                )

    def mine(self, target_arns: set[str]) -> dict[str, Author]:
        """Return author info for each ARN in target_arns.

        Uses cache aggressively. Only fetches uncovered ARNs from CloudTrail.
        """
        cached = self._load_cache()
        needed = target_arns - set(cached.keys())
        log.info(
            "cloudtrail.mine.start",
            cached_hits=len(cached),
            need_to_fetch=len(needed),
        )

        if not needed:
            return {arn: cached[arn] for arn in target_arns if arn in cached}

        # Build reverse map: event_name -> [(tf_type, path)]
        events_to_fetch: dict[str, list[tuple[str, str]]] = {}
        for tf_type, events in CREATE_EVENTS.items():
            for event_name, path in events:
                events_to_fetch.setdefault(event_name, []).append((tf_type, path))

        start = datetime.now(timezone.utc) - timedelta(days=self.lookback_days)
        end = datetime.now(timezone.utc)
        fresh: dict[str, Author] = {}

        for event_name in event_names():
            try:
                paginator = self._ct.get_paginator("lookup_events")
                for page in paginator.paginate(
                    LookupAttributes=[{"AttributeKey": "EventName", "AttributeValue": event_name}],
                    StartTime=start,
                    EndTime=end,
                ):
                    for event in page.get("Events", []):
                        ce = event.get("CloudTrailEvent")
                        if not ce:
                            continue
                        try:
                            parsed = json.loads(ce)
                        except json.JSONDecodeError:
                            continue
                        arn = self._extract_arn_for_event(event_name, parsed, events_to_fetch)
                        if not arn or arn not in needed:
                            continue
                        principal_arn, principal_name = _extract_principal(parsed)
                        author = Author(
                            via=_classify_via(parsed),
                            principal_arn=principal_arn,
                            principal_name=principal_name,
                            event_id=parsed.get("eventID"),
                            event_time=datetime.fromisoformat(
                                parsed["eventTime"].replace("Z", "+00:00")
                            ) if parsed.get("eventTime") else None,
                            confidence=0.95,
                        )
                        fresh[arn] = author
            except Exception as exc:
                log.warning("cloudtrail.mine.event_fail", event=event_name, error=str(exc))

        self._save_cache(fresh)
        cached.update(fresh)
        return {arn: cached[arn] for arn in target_arns if arn in cached}

    def _extract_arn_for_event(
        self,
        event_name: str,
        parsed: dict[str, Any],
        events_to_fetch: dict[str, list[tuple[str, str]]],
    ) -> str | None:
        candidates = events_to_fetch.get(event_name) or []
        for tf_type, path in candidates:
            ident = _resolve_path(parsed, path)
            if not ident:
                continue
            arn = _build_arn(tf_type, str(ident), self.account_id, self.region)
            if arn:
                return arn
        return None
