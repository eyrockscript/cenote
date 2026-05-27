from pathlib import Path

from cenote.scanners.terraform import parse_tfstate, resolve_arn

FIXTURE = Path(__file__).parent / "fixtures" / "example.tfstate.json"


def test_parses_vpc_subnet_instance_with_module():
    parsed = parse_tfstate(FIXTURE)
    types = {p.tf_type for p in parsed}
    assert "aws_vpc" in types
    assert "aws_subnet" in types
    assert "aws_instance" in types


def test_expands_count_instances():
    parsed = parse_tfstate(FIXTURE)
    subnets = [p for p in parsed if p.tf_type == "aws_subnet"]
    assert len(subnets) == 2
    addresses = sorted(s.address for s in subnets)
    assert addresses == ["aws_subnet.private[0]", "aws_subnet.private[1]"]


def test_module_address_prefix():
    parsed = parse_tfstate(FIXTURE)
    inst = next(p for p in parsed if p.tf_type == "aws_instance")
    assert inst.address.startswith("module.api.aws_instance.web")
    assert inst.module == "module.api"


def test_resolve_arn_for_vpc():
    parsed = parse_tfstate(FIXTURE)
    vpc = next(p for p in parsed if p.tf_type == "aws_vpc")
    arn = resolve_arn(vpc, "123456789012", "us-east-1")
    assert arn == "arn:aws:ec2:us-east-1:123456789012:vpc/vpc-abc"
