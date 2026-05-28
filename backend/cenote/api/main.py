from pathlib import Path

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
    tfstate_path: str | None = None
    tfplan_path: str | None = None
    include_authorship: bool = True


@app.post("/api/scan", response_model=Snapshot, status_code=202)
async def post_scan(body: ScanBody, bg: BackgroundTasks) -> Snapshot:
    """Run a full scan (sync for simplicity in v0.1)."""
    req = ScanRequest(
        region=body.region or settings.aws_region,
        profile=settings.aws_profile,
        tfstate_path=Path(body.tfstate_path) if body.tfstate_path else None,
        tfplan_path=Path(body.tfplan_path) if body.tfplan_path else None,
        include_authorship=body.include_authorship,
    )
    try:
        return run_scan(req, _store())
    except Exception as exc:
        log.exception("scan.fail")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/snapshots", response_model=list[Snapshot])
async def list_snapshots() -> list[Snapshot]:
    return _store().list_snapshots()


@app.get("/api/snapshots/{snap_id}/graph", response_model=Graph)
async def get_graph(snap_id: str) -> Graph:
    try:
        return _store().get_graph(snap_id)
    except Exception as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/api/snapshots/{base_id}/diff/{head_id}", response_model=GraphDiff)
async def get_diff(base_id: str, head_id: str) -> GraphDiff:
    store = _store()
    try:
        base = store.get_graph(base_id)
        head = store.get_graph(head_id)
    except Exception as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return diff_graphs(base, head)


@app.post("/api/upload/tfstate")
async def upload_tfstate(file: UploadFile) -> dict[str, str]:
    """Stash an uploaded tfstate file for use in /api/scan."""
    uploads_dir = settings.db_path.parent / "uploads"
    uploads_dir.mkdir(parents=True, exist_ok=True)
    dest = uploads_dir / f"{file.filename}"
    dest.write_bytes(await file.read())
    return {"path": str(dest)}
