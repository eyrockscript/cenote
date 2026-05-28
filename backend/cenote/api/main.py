from pathlib import Path
from typing import Literal

import structlog
from fastapi import BackgroundTasks, FastAPI, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from cenote import __version__
from cenote.config import settings
from cenote.core.diff import GraphDiff, diff_graphs
from cenote.core.models import Graph, Snapshot
from cenote.core.scan import ScanRequest, run_scan
from cenote.store.duckdb_store import DuckDBStore

log = structlog.get_logger()

app = FastAPI(
    title="Cenote API",
    version=__version__,
    description="AWS + Terraform drift detection, diff viewer, and authorship attribution.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:4173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _store() -> DuckDBStore:
    return DuckDBStore(settings.db_path)


@app.on_event("startup")
async def startup() -> None:
    _store().init_schema()
    log.info("cenote.startup", db=str(settings.db_path), region=settings.aws_region)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "version": __version__}


_STATIC_REGIONS: list[str] = [
    "us-east-1", "us-east-2", "us-west-1", "us-west-2",
    "af-south-1",
    "ap-east-1",
    "ap-south-1", "ap-south-2",
    "ap-northeast-1", "ap-northeast-2", "ap-northeast-3",
    "ap-southeast-1", "ap-southeast-2", "ap-southeast-3", "ap-southeast-4",
    "ca-central-1", "ca-west-1",
    "eu-central-1", "eu-central-2",
    "eu-north-1",
    "eu-south-1", "eu-south-2",
    "eu-west-1", "eu-west-2", "eu-west-3",
    "il-central-1",
    "me-central-1", "me-south-1",
    "sa-east-1",
]


@app.get("/api/aws/regions")
async def list_aws_regions() -> dict[str, object]:
    """Return AWS regions enabled for the configured account, plus a fallback.

    Falls back to a static, complete list if the call fails (e.g. missing
    permissions or no credentials). The `source` field tells the caller
    which one was used so the UI can flag it.
    """
    import boto3
    from botocore.exceptions import BotoCoreError, ClientError, NoCredentialsError

    try:
        session = boto3.Session(profile_name=settings.aws_profile)
        ec2 = session.client("ec2", region_name=settings.aws_region)
        resp = ec2.describe_regions(AllRegions=False)
        regions = sorted({r["RegionName"] for r in resp.get("Regions", [])})
        if not regions:
            regions = _STATIC_REGIONS
            return {"current": settings.aws_region, "regions": regions, "source": "static"}
        return {"current": settings.aws_region, "regions": regions, "source": "account"}
    except (NoCredentialsError, ClientError, BotoCoreError, Exception):
        return {
            "current": settings.aws_region,
            "regions": _STATIC_REGIONS,
            "source": "static",
        }


@app.get("/api/health/aws")
async def health_aws() -> dict[str, object]:
    """Validate AWS credentials and minimum permissions before the first scan.

    Returns:
      - ok: True if credentials resolve AND we can call sts:GetCallerIdentity
      - account_id, region: discovered values
      - profile: profile name being used
      - error: human-readable message if anything is wrong
    """
    import boto3
    from botocore.exceptions import BotoCoreError, ClientError, NoCredentialsError

    try:
        session = boto3.Session(profile_name=settings.aws_profile)
        sts = session.client("sts", region_name=settings.aws_region)
        ident = sts.get_caller_identity()
        return {
            "ok": True,
            "account_id": ident["Account"],
            "principal_arn": ident["Arn"],
            "region": settings.aws_region,
            "profile": settings.aws_profile,
        }
    except NoCredentialsError:
        return {
            "ok": False,
            "error": f"No AWS credentials for profile '{settings.aws_profile}'. "
                     f"Check ~/.aws/credentials and AWS_PROFILE in your .env.",
            "profile": settings.aws_profile,
        }
    except ClientError as exc:
        return {
            "ok": False,
            "error": f"AWS rejected the call: {exc.response.get('Error', {}).get('Message', str(exc))}",
            "profile": settings.aws_profile,
        }
    except (BotoCoreError, Exception) as exc:
        return {"ok": False, "error": str(exc), "profile": settings.aws_profile}


@app.get("/")
async def root() -> dict[str, str]:
    return {"name": "cenote", "version": __version__, "docs": "/docs"}


class ScanBody(BaseModel):
    region: str | None = None
    # Choose at most one of these. If multiple are set, the first non-None wins
    # in this order: tfstate_path > tfstate_s3 > tfplan_path > terraform_dir.
    tfstate_path: str | None = None     # local file path inside the api container
    tfstate_s3: str | None = None       # s3://bucket/key
    tfplan_path: str | None = None      # local plan.json
    terraform_dir: str | None = None    # directory of .tf files (must be reachable inside the container)
    include_authorship: bool = True


@app.post("/api/scan", response_model=Snapshot, status_code=202)
async def post_scan(body: ScanBody, bg: BackgroundTasks) -> Snapshot:
    """Run a full scan (sync for simplicity in v0.1)."""
    req = ScanRequest(
        region=body.region or settings.aws_region,
        profile=settings.aws_profile,
        tfstate_path=Path(body.tfstate_path) if body.tfstate_path else None,
        tfstate_s3=body.tfstate_s3 or None,
        tfplan_path=Path(body.tfplan_path) if body.tfplan_path else None,
        terraform_dir=Path(body.terraform_dir) if body.terraform_dir else None,
        include_authorship=body.include_authorship,
    )
    try:
        return run_scan(req, _store())
    except Exception as exc:
        log.exception("scan.fail")
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/snapshots", response_model=list[Snapshot])
async def list_snapshots() -> list[Snapshot]:
    return _store().list_snapshots()


@app.get("/api/snapshots/{snap_id}/graph", response_model=Graph)
async def get_graph(snap_id: str) -> Graph:
    try:
        return _store().get_graph(snap_id)
    except Exception as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.delete("/api/snapshots/{snap_id}", status_code=204)
async def delete_snapshot(snap_id: str) -> None:
    deleted = _store().delete_snapshot(snap_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"snapshot {snap_id} not found")


@app.delete("/api/snapshots", status_code=200)
async def delete_all_snapshots() -> dict[str, int]:
    count = _store().delete_all_snapshots()
    return {"deleted": count}


@app.get("/api/snapshots/{base_id}/diff/{head_id}", response_model=GraphDiff)
async def get_diff(base_id: str, head_id: str) -> GraphDiff:
    store = _store()
    try:
        base = store.get_graph(base_id)
        head = store.get_graph(head_id)
    except Exception as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return diff_graphs(base, head)


@app.post("/api/upload")
async def upload_artifact(
    file: UploadFile,
    kind: Literal["tfstate", "plan"] = "tfstate",
) -> dict[str, str]:
    """Stash an uploaded file. Use `kind=tfstate` (default) or `kind=plan` for plan.json."""
    uploads_dir = settings.db_path.parent / "uploads"
    uploads_dir.mkdir(parents=True, exist_ok=True)
    suffix = ".tfstate" if kind == "tfstate" else ".plan.json"
    safe_name = (file.filename or kind).replace("/", "_")
    dest = uploads_dir / f"{safe_name}{'' if safe_name.endswith(suffix) else suffix}"
    dest.write_bytes(await file.read())
    return {"path": str(dest), "kind": kind}


# Backwards-compatible alias
@app.post("/api/upload/tfstate")
async def upload_tfstate(file: UploadFile) -> dict[str, str]:
    return await upload_artifact(file, kind="tfstate")  # type: ignore[arg-type]
