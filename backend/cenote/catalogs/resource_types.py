"""Catalog of supported resource types for v0.1.

13 types, each one must be covered 100% across:
- AWS scanner (describe → normalize)
- TF parser (tf_to_arn)
- Drift fields table
- CloudTrail create event
- Edge inference
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class ResourceTypeDef:
    tf_type: str
    aws_service: str
    display: str
    category: str  # network | compute | storage | data | identity


SUPPORTED_TYPES: list[ResourceTypeDef] = [
    # Network
    ResourceTypeDef("aws_vpc", "ec2", "VPC", "network"),
    ResourceTypeDef("aws_subnet", "ec2", "Subnet", "network"),
    ResourceTypeDef("aws_security_group", "ec2", "Security Group", "network"),
    ResourceTypeDef("aws_route_table", "ec2", "Route Table", "network"),
    ResourceTypeDef("aws_internet_gateway", "ec2", "Internet Gateway", "network"),
    ResourceTypeDef("aws_nat_gateway", "ec2", "NAT Gateway", "network"),
    ResourceTypeDef("aws_lb", "elbv2", "Load Balancer", "network"),
    ResourceTypeDef("aws_lb_target_group", "elbv2", "Target Group", "network"),
    # Compute
    ResourceTypeDef("aws_instance", "ec2", "EC2 Instance", "compute"),
    ResourceTypeDef("aws_lambda_function", "lambda", "Lambda Function", "compute"),
    # Storage
    ResourceTypeDef("aws_ebs_volume", "ec2", "EBS Volume", "storage"),
    ResourceTypeDef("aws_s3_bucket", "s3", "S3 Bucket", "storage"),
    # Data
    ResourceTypeDef("aws_db_instance", "rds", "RDS Instance", "data"),
]

BY_TF_TYPE: dict[str, ResourceTypeDef] = {t.tf_type: t for t in SUPPORTED_TYPES}

# Extra `data` source types worth showing in the diagram as EXISTING infra,
# beyond the reconciliation catalog. These are intentionally NOT in
# SUPPORTED_TYPES — they don't need scanner/drift/ARN coverage, they only need
# to render as context a stack plugs into (e.g. existing IAM roles, certs,
# clusters). Kept separate so the reconciliation path stays untouched.
DIAGRAM_DATA_TYPES: frozenset[str] = frozenset({
    "aws_iam_role",
    "aws_iam_policy",
    "aws_acm_certificate",
    "aws_kms_key",
    "aws_ecs_cluster",
    "aws_ecr_repository",
    "aws_route53_zone",
})


def is_supported(tf_type: str) -> bool:
    return tf_type in BY_TF_TYPE


def is_diagram_data_type(tf_type: str) -> bool:
    """True for data-source types worth rendering as existing infrastructure:
    the reconciliation catalog (VPC/subnet/SG/LB/…) plus a few common
    referenced-but-not-managed types (IAM roles, certs, clusters). Filters out
    noise lookups like aws_caller_identity / aws_region / aws_availability_zones.
    """
    return tf_type in BY_TF_TYPE or tf_type in DIAGRAM_DATA_TYPES


def all_tf_types() -> list[str]:
    return [t.tf_type for t in SUPPORTED_TYPES]
