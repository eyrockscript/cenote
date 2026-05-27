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


def is_supported(tf_type: str) -> bool:
    return tf_type in BY_TF_TYPE


def all_tf_types() -> list[str]:
    return [t.tf_type for t in SUPPORTED_TYPES]
