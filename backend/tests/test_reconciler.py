from datetime import datetime, timezone
from pathlib import Path

from cenote.core.models import AWSState, Resource
from cenote.core.reconciler import reconcile
from cenote.scanners.terraform import parse_tfstate

FIXTURE = Path(__file__).parent / "fixtures" / "example.tfstate.json"


def _now():
    return datetime.now(timezone.utc)


def test_matched_no_drift():
    aws = [
        Resource(
            id="arn:aws:ec2:us-east-1:1:instance/i-0abc",
            type="aws_instance",
            name="api-server",
            region="us-east-1",
            account_id="1",
            aws_state=AWSState(attributes={"id": "i-0abc", "instance_type": "t3.medium"}, last_seen=_now()),
        ),
    ]
    tf = parse_tfstate(FIXTURE)
    instances_tf = [t for t in tf if t.tf_type == "aws_instance"]
    out = reconcile(aws, instances_tf, {}, "1", "us-east-1")
    matched = [r for r in out if r.tf_state and r.aws_state]
    assert len(matched) == 1
    assert matched[0].drift == []


def test_detects_drift_when_instance_type_differs():
    aws = [
        Resource(
            id="arn:aws:ec2:us-east-1:1:instance/i-0abc",
            type="aws_instance",
            name="api-server",
            region="us-east-1",
            account_id="1",
            aws_state=AWSState(attributes={"id": "i-0abc", "instance_type": "t3.large"}, last_seen=_now()),
        ),
    ]
    tf = parse_tfstate(FIXTURE)
    instances_tf = [t for t in tf if t.tf_type == "aws_instance"]
    out = reconcile(aws, instances_tf, {}, "1", "us-east-1")
    assert len(out[0].drift) >= 1
    assert any(d.field == "instance_type" for d in out[0].drift)


def test_orphan_marks_aws_only_when_no_tf():
    aws = [
        Resource(
            id="arn:aws:ec2:us-east-1:1:instance/i-orphan",
            type="aws_instance",
            name="manual",
            region="us-east-1",
            account_id="1",
            aws_state=AWSState(attributes={"id": "i-orphan", "instance_type": "t3.micro"}, last_seen=_now()),
        ),
    ]
    out = reconcile(aws, [], {}, "1", "us-east-1")
    assert out[0].state == "aws_only"


def test_tf_only_when_no_aws():
    tf = parse_tfstate(FIXTURE)
    instances_tf = [t for t in tf if t.tf_type == "aws_instance"]
    out = reconcile([], instances_tf, {}, "1", "us-east-1")
    assert all(r.state == "tf_only" for r in out)
