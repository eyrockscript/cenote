"""moto-based tests for the AWS scanner.

These run against in-process AWS mocks; no real cloud calls.
"""

from datetime import datetime, timezone

import boto3
import pytest
from moto import mock_aws

from cenote.scanners.aws import AWSScanner


@mock_aws
def test_scan_vpc_and_subnet_with_edges():
    ec2 = boto3.client("ec2", region_name="us-east-1")
    vpc = ec2.create_vpc(CidrBlock="10.0.0.0/16")["Vpc"]
    sn = ec2.create_subnet(VpcId=vpc["VpcId"], CidrBlock="10.0.1.0/24")["Subnet"]

    scanner = AWSScanner(region="us-east-1")
    resources, edges = scanner.scan()

    types = {r.type for r in resources}
    assert "aws_vpc" in types
    assert "aws_subnet" in types

    # Subnet → VPC edge
    sn_arn = next(r.id for r in resources if r.type == "aws_subnet" and r.aws_state.attributes["id"] == sn["SubnetId"])
    vpc_arn = next(r.id for r in resources if r.type == "aws_vpc" and r.aws_state.attributes["id"] == vpc["VpcId"])
    edge_pairs = {(e.source, e.target, e.type) for e in edges}
    assert (sn_arn, vpc_arn, "in_vpc") in edge_pairs


@mock_aws
def test_scan_security_group_with_self_reference():
    ec2 = boto3.client("ec2", region_name="us-east-1")
    vpc = ec2.create_vpc(CidrBlock="10.0.0.0/16")["Vpc"]
    sg_a = ec2.create_security_group(GroupName="a", Description="a", VpcId=vpc["VpcId"])
    sg_b = ec2.create_security_group(GroupName="b", Description="b", VpcId=vpc["VpcId"])
    ec2.authorize_security_group_ingress(
        GroupId=sg_a["GroupId"],
        IpPermissions=[{
            "IpProtocol": "tcp",
            "FromPort": 80,
            "ToPort": 80,
            "UserIdGroupPairs": [{"GroupId": sg_b["GroupId"]}],
        }],
    )

    scanner = AWSScanner(region="us-east-1")
    resources, edges = scanner.scan()
    sg_resources = [r for r in resources if r.type == "aws_security_group"]
    assert len(sg_resources) >= 2  # plus default
    refs = [e for e in edges if e.type == "references_sg"]
    assert any(e.target.endswith(sg_b["GroupId"]) for e in refs)


@mock_aws
def test_scan_instance_with_sg_and_subnet_edges():
    ec2 = boto3.client("ec2", region_name="us-east-1")
    vpc = ec2.create_vpc(CidrBlock="10.0.0.0/16")["Vpc"]
    sn = ec2.create_subnet(VpcId=vpc["VpcId"], CidrBlock="10.0.1.0/24")["Subnet"]
    sg = ec2.create_security_group(GroupName="web", Description="web", VpcId=vpc["VpcId"])
    inst = ec2.run_instances(
        ImageId="ami-12345678",
        MinCount=1,
        MaxCount=1,
        InstanceType="t3.medium",
        SubnetId=sn["SubnetId"],
        SecurityGroupIds=[sg["GroupId"]],
    )["Instances"][0]

    scanner = AWSScanner(region="us-east-1")
    resources, edges = scanner.scan()
    instance_arn = next(
        r.id for r in resources
        if r.type == "aws_instance" and r.aws_state.attributes["id"] == inst["InstanceId"]
    )
    edge_types = {(e.source, e.type) for e in edges if e.source == instance_arn}
    assert (instance_arn, "in_subnet") in edge_types
    assert (instance_arn, "uses_sg") in edge_types
