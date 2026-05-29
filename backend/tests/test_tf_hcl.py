"""Tests for the raw .tf parser used by /api/tf/diagram."""

from pathlib import Path

import pytest

from cenote.core.tf_diagram import build_graph
from cenote.scanners.tf_hcl import HCLParseError, parse_directory

FIXTURE = Path(__file__).parent / "fixtures" / "tf_sample"


def test_parses_all_supported_resources():
    graph = parse_directory(FIXTURE)
    addresses = {r.address for r in graph.resources}
    expected = {
        "aws_vpc.main",
        "aws_subnet.public_a",
        "aws_subnet.private_a",
        "aws_internet_gateway.igw",
        "aws_security_group.web",
        "aws_instance.api",
        "aws_lb.public",
        "aws_lb_target_group.api_tg",
        "aws_s3_bucket.assets",
    }
    assert expected.issubset(addresses), addresses - expected


def test_extracts_cross_references():
    graph = parse_directory(FIXTURE)
    refs = {(r.source, r.target) for r in graph.references}
    # Subnet → VPC, SG → VPC, IGW → VPC, EC2 → subnet + SG, ALB → subnet + SG
    assert ("aws_subnet.public_a", "aws_vpc.main") in refs
    assert ("aws_security_group.web", "aws_vpc.main") in refs
    assert ("aws_instance.api", "aws_subnet.private_a") in refs
    assert ("aws_instance.api", "aws_security_group.web") in refs
    assert ("aws_lb.public", "aws_subnet.public_a") in refs


def test_build_graph_assigns_containers():
    hcl = parse_directory(FIXTURE)
    graph = build_graph(hcl, snapshot_id="test-snap")

    ec2 = next(n for n in graph.nodes if n.type == "aws_instance")
    assert ec2.containers.vpc_id == "tf://aws_vpc.main"
    assert ec2.containers.subnet_id == "tf://aws_subnet.private_a"


def test_build_graph_edges_use_tf_prefix():
    hcl = parse_directory(FIXTURE)
    graph = build_graph(hcl, snapshot_id="test-snap")
    assert any(
        e.source == "tf://aws_security_group.web" and e.target == "tf://aws_vpc.main"
        for e in graph.edges
    )
    assert all(e.source.startswith("tf://") for e in graph.edges)
    assert all(e.target.startswith("tf://") for e in graph.edges)


def test_empty_directory_raises():
    with pytest.raises(HCLParseError):
        parse_directory(FIXTURE.parent / "does_not_exist")


def test_all_managed_types_render(tmp_path: Path):
    """Every managed resource renders, not just the catalog — a real stack is
    mostly ECS/IAM/CloudWatch and filtering to 13 types showed almost nothing."""
    (tmp_path / "x.tf").write_text(
        'resource "aws_vpc" "main" { cidr_block = "10.0.0.0/16" }\n'
        'resource "aws_kinesis_stream" "events" { name = "events" shard_count = 1 }\n'
    )
    graph = parse_directory(tmp_path)
    types = {r.tf_type for r in graph.resources}
    assert types == {"aws_vpc", "aws_kinesis_stream"}


def test_data_sources_render_as_existing(tmp_path: Path):
    """Catalogued data sources (existing infra the stack consumes) render with
    a `data.` address and mode='data'; noise lookups are dropped."""
    (tmp_path / "x.tf").write_text(
        'data "aws_lb" "alb" { name = "prod-alb" }\n'
        'data "aws_caller_identity" "current" {}\n'
        'resource "aws_lb_listener" "https" {\n'
        '  load_balancer_arn = data.aws_lb.alb.arn\n'
        '}\n'
    )
    graph = parse_directory(tmp_path)
    by_addr = {r.address: r for r in graph.resources}
    assert by_addr["data.aws_lb.alb"].mode == "data"          # existing infra kept
    assert "data.aws_caller_identity.current" not in by_addr  # noise dropped
    # The new listener references the EXISTING load balancer.
    assert ("aws_lb_listener.https", "data.aws_lb.alb") in {
        (r.source, r.target) for r in graph.references
    }


def test_build_graph_marks_created_vs_existing(tmp_path: Path):
    (tmp_path / "x.tf").write_text(
        'data "aws_subnet" "selected" { id = "subnet-123" }\n'
        'resource "aws_lb_target_group" "tg" { name = "tg" }\n'
    )
    graph = build_graph(parse_directory(tmp_path), "snap")
    actions = {n.type: n.planned_action for n in graph.nodes}
    assert actions["aws_subnet"] == "read"          # existing
    assert actions["aws_lb_target_group"] == "create"  # created by this stack
