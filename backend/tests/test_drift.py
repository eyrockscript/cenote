"""Drift engine tests — must have zero false positives on noise fields."""

from cenote.core.drift import compute_drift


def test_no_drift_when_attrs_equal():
    tf = {"instance_type": "t3.medium", "subnet_id": "subnet-1", "tags": {"env": "prod"}}
    aws = {"instance_type": "t3.medium", "subnet_id": "subnet-1", "tags": {"env": "prod"}}
    assert compute_drift("aws_instance", tf, aws) == []


def test_detects_instance_type_drift():
    tf = {"instance_type": "t3.medium"}
    aws = {"instance_type": "t3.large"}
    drift = compute_drift("aws_instance", tf, aws)
    assert len(drift) == 1
    assert drift[0].field == "instance_type"
    assert drift[0].severity == "high"


def test_ignores_noise_fields_not_in_table():
    # `availability_zone` is not in DRIFT_FIELDS for aws_instance → must be ignored
    tf = {"instance_type": "t3.medium"}
    aws = {"instance_type": "t3.medium", "availability_zone": "us-east-1a"}
    assert compute_drift("aws_instance", tf, aws) == []


def test_sg_set_field_order_independent():
    tf = {"vpc_security_group_ids": ["sg-1", "sg-2"]}
    aws = {"vpc_security_group_ids": ["sg-2", "sg-1"]}
    assert compute_drift("aws_instance", tf, aws) == []


def test_empty_vs_none_equivalent():
    tf = {"key_name": None}
    aws = {"key_name": ""}
    assert compute_drift("aws_instance", tf, aws) == []


def test_returns_empty_for_unknown_type():
    assert compute_drift("aws_unknown_type", {"a": 1}, {"a": 2}) == []
