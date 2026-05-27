"""Tabla curada de campos relevantes por tipo, con severidad.

PRINCIPIO: cero falsos positivos. Solo se compara lo que está aquí.
Cualquier diferencia en campos NO listados se ignora (ruido).
"""

from cenote.core.models import DriftSeverity

H = DriftSeverity.HIGH
M = DriftSeverity.MEDIUM
L = DriftSeverity.LOW

DRIFT_FIELDS: dict[str, dict[str, DriftSeverity]] = {
    "aws_vpc": {
        "cidr_block": H,
        "enable_dns_support": M,
        "enable_dns_hostnames": M,
        "tags": L,
    },
    "aws_subnet": {
        "cidr_block": H,
        "availability_zone": H,
        "map_public_ip_on_launch": M,
        "tags": L,
    },
    "aws_security_group": {
        "ingress": H,
        "egress": H,
        "description": L,
        "tags": L,
    },
    "aws_route_table": {
        "routes": H,
        "tags": L,
    },
    "aws_internet_gateway": {
        "vpc_id": H,
        "tags": L,
    },
    "aws_nat_gateway": {
        "subnet_id": H,
        "allocation_id": H,
        "connectivity_type": M,
        "tags": L,
    },
    "aws_instance": {
        "instance_type": H,
        "ami": H,
        "key_name": M,
        "vpc_security_group_ids": H,
        "subnet_id": H,
        "iam_instance_profile": H,
        "user_data": M,
        "tags": L,
    },
    "aws_ebs_volume": {
        "size": H,
        "type": H,
        "iops": M,
        "encrypted": H,
        "kms_key_id": H,
        "tags": L,
    },
    "aws_lb": {
        "load_balancer_type": H,
        "internal": H,
        "subnets": H,
        "security_groups": H,
        "tags": L,
    },
    "aws_lb_target_group": {
        "port": H,
        "protocol": H,
        "target_type": H,
        "vpc_id": H,
        "health_check": M,
        "tags": L,
    },
    "aws_db_instance": {
        "instance_class": H,
        "engine": H,
        "engine_version": M,
        "allocated_storage": H,
        "storage_type": M,
        "multi_az": H,
        "publicly_accessible": H,
        "vpc_security_group_ids": H,
        "db_subnet_group_name": H,
        "backup_retention_period": M,
        "tags": L,
    },
    "aws_s3_bucket": {
        "region": H,
        "tags": L,
        # versioning, encryption, etc. quedan para v0.2
        # (requieren get_bucket_* calls extras, no en el primer scan)
    },
    "aws_lambda_function": {
        "runtime": H,
        "handler": H,
        "memory_size": M,
        "timeout": M,
        "role": H,
        "environment": M,
        "vpc_config": H,
        "tags": L,
    },
}
