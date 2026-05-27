from datetime import datetime
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class DriftSeverity(str, Enum):
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class AuthorVia(str, Enum):
    TERRAFORM = "Terraform"
    CONSOLE = "Console"
    CLI = "CLI"
    SDK = "SDK"
    CLOUDFORMATION = "CloudFormation"
    UNKNOWN = "Unknown"


class DriftField(BaseModel):
    field: str
    tf_value: Any | None
    aws_value: Any | None
    severity: DriftSeverity


class Author(BaseModel):
    principal_arn: str | None = None
    principal_name: str | None = None
    via: AuthorVia = AuthorVia.UNKNOWN
    event_id: str | None = None
    event_time: datetime | None = None
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)


class TFState(BaseModel):
    address: str
    module: str | None = None
    attributes: dict[str, Any]


class AWSState(BaseModel):
    attributes: dict[str, Any]
    last_seen: datetime


class Containers(BaseModel):
    vpc_id: str | None = None
    subnet_id: str | None = None
    az: str | None = None


class Resource(BaseModel):
    model_config = ConfigDict(use_enum_values=True)

    id: str  # canonical ARN
    type: str  # aws_instance, aws_vpc, etc.
    name: str
    region: str
    account_id: str

    tf_state: TFState | None = None
    aws_state: AWSState | None = None
    drift: list[DriftField] = Field(default_factory=list)

    author: Author | None = None
    tags: dict[str, str] = Field(default_factory=dict)
    containers: Containers = Field(default_factory=Containers)
    blast_radius: int = 0

    @property
    def state(self) -> Literal["matched", "drift", "tf_only", "aws_only"]:
        if self.tf_state and self.aws_state:
            return "drift" if self.drift else "matched"
        if self.tf_state:
            return "tf_only"
        return "aws_only"


class Edge(BaseModel):
    source: str
    target: str
    type: str
    metadata: dict[str, Any] = Field(default_factory=dict)
    discovered_via: Literal["aws_describe", "tf_state", "inferred"] = "aws_describe"


class SnapshotSource(str, Enum):
    LIVE = "live"
    PLAN = "plan"
    TFSTATE = "tfstate"


class Snapshot(BaseModel):
    id: str
    account_id: str
    region: str
    created_at: datetime
    source: SnapshotSource
    resource_count: int = 0
    drift_count: int = 0
    orphan_count: int = 0  # aws_only
    declared_only_count: int = 0  # tf_only


class Graph(BaseModel):
    snapshot_id: str
    nodes: list[Resource]
    edges: list[Edge]
