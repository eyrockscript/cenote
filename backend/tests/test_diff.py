from datetime import datetime, timezone

from cenote.core.diff import diff_graphs
from cenote.core.models import AWSState, Graph, Resource


def _r(arn: str, instance_type: str = "t3.medium"):
    return Resource(
        id=arn,
        type="aws_instance",
        name=arn.split("/")[-1],
        region="us-east-1",
        account_id="1",
        aws_state=AWSState(
            attributes={"id": arn.split("/")[-1], "instance_type": instance_type},
            last_seen=datetime.now(timezone.utc),
        ),
    )


def test_detects_added_removed_modified():
    base = Graph(
        snapshot_id="A",
        nodes=[_r("arn:i/keep", "t3.medium"), _r("arn:i/gone")],
        edges=[],
    )
    head = Graph(
        snapshot_id="B",
        nodes=[_r("arn:i/keep", "t3.large"), _r("arn:i/new")],
        edges=[],
    )
    d = diff_graphs(base, head)
    assert {c.arn for c in d.added} == {"arn:i/new"}
    assert {c.arn for c in d.removed} == {"arn:i/gone"}
    mod = {c.arn: c for c in d.modified}
    assert "arn:i/keep" in mod
    fields = {f.field for f in mod["arn:i/keep"].fields}
    assert "instance_type" in fields
