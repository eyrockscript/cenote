"""AWS scanner — boto3 describe_* for the 13 supported types.

Principle: $0 in AWS. Only free control-plane APIs.
- describe_*, list_* (free)
- tag:GetResources (free)

No AWS Config, no Cost Explorer, no Athena in v0.1.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import boto3
import structlog
from botocore.config import Config as BotoConfig

from cenote.core.models import AWSState, Containers, Edge, Resource

log = structlog.get_logger()

_BOTO_CFG = BotoConfig(
    retries={"max_attempts": 4, "mode": "adaptive"},
    max_pool_connections=20,
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _tag_dict(taglist: list[dict[str, str]] | None) -> dict[str, str]:
    if not taglist:
        return {}
    return {t.get("Key", ""): t.get("Value", "") for t in taglist if t.get("Key")}


def _name(tags: dict[str, str], default: str) -> str:
    return tags.get("Name") or default


class AWSScanner:
    """Scans a single account / region and returns (resources, edges)."""

    def __init__(self, region: str, profile: str | None = None) -> None:
        self.region = region
        self.session = boto3.Session(profile_name=profile) if profile else boto3.Session()
        self._sts = self.session.client("sts", config=_BOTO_CFG)
        self._account_id: str | None = None

    @property
    def account_id(self) -> str:
        if self._account_id is None:
            self._account_id = self._sts.get_caller_identity()["Account"]
        return self._account_id

    def _client(self, service: str) -> Any:
        return self.session.client(service, region_name=self.region, config=_BOTO_CFG)

    # ---- public api ----

    def scan(self) -> tuple[list[Resource], list[Edge]]:
        """Run all scanners and return the merged inventory."""
        resources: list[Resource] = []
        edges: list[Edge] = []

        scanners = [
            self._scan_vpcs,
            self._scan_subnets,
            self._scan_security_groups,
            self._scan_route_tables,
            self._scan_internet_gateways,
            self._scan_nat_gateways,
            self._scan_instances,
            self._scan_ebs_volumes,
            self._scan_lbs,
            self._scan_target_groups,
            self._scan_db_instances,
            self._scan_s3_buckets,
            self._scan_lambda_functions,
        ]

        for fn in scanners:
            try:
                r, e = fn()
                resources.extend(r)
                edges.extend(e)
                log.info("aws.scan.ok", scanner=fn.__name__, count=len(r))
            except Exception as exc:
                log.warning("aws.scan.fail", scanner=fn.__name__, error=str(exc))

        return resources, edges

    # ---- per-type scanners ----

    def _scan_vpcs(self) -> tuple[list[Resource], list[Edge]]:
        ec2 = self._client("ec2")
        out, edges = [], []
        for page in ec2.get_paginator("describe_vpcs").paginate():
            for vpc in page.get("Vpcs", []):
                tags = _tag_dict(vpc.get("Tags"))
                vid = vpc["VpcId"]
                arn = f"arn:aws:ec2:{self.region}:{self.account_id}:vpc/{vid}"
                attrs = {
                    "id": vid,
                    "cidr_block": vpc.get("CidrBlock"),
                    "enable_dns_support": True,
                    "enable_dns_hostnames": True,
                    "is_default": vpc.get("IsDefault", False),
                    "state": vpc.get("State"),
                    "tags": tags,
                }
                out.append(Resource(
                    id=arn,
                    type="aws_vpc",
                    name=_name(tags, vid),
                    region=self.region,
                    account_id=self.account_id,
                    aws_state=AWSState(attributes=attrs, last_seen=_now()),
                    tags=tags,
                    containers=Containers(vpc_id=vid),
                ))
        return out, edges

    def _scan_subnets(self) -> tuple[list[Resource], list[Edge]]:
        ec2 = self._client("ec2")
        out, edges = [], []
        for page in ec2.get_paginator("describe_subnets").paginate():
            for sn in page.get("Subnets", []):
                tags = _tag_dict(sn.get("Tags"))
                sid = sn["SubnetId"]
                arn = f"arn:aws:ec2:{self.region}:{self.account_id}:subnet/{sid}"
                attrs = {
                    "id": sid,
                    "vpc_id": sn.get("VpcId"),
                    "cidr_block": sn.get("CidrBlock"),
                    "availability_zone": sn.get("AvailabilityZone"),
                    "map_public_ip_on_launch": sn.get("MapPublicIpOnLaunch", False),
                    "tags": tags,
                }
                out.append(Resource(
                    id=arn,
                    type="aws_subnet",
                    name=_name(tags, sid),
                    region=self.region,
                    account_id=self.account_id,
                    aws_state=AWSState(attributes=attrs, last_seen=_now()),
                    tags=tags,
                    containers=Containers(
                        vpc_id=sn.get("VpcId"),
                        subnet_id=sid,
                        az=sn.get("AvailabilityZone"),
                    ),
                ))
                if sn.get("VpcId"):
                    vpc_arn = f"arn:aws:ec2:{self.region}:{self.account_id}:vpc/{sn['VpcId']}"
                    edges.append(Edge(source=arn, target=vpc_arn, type="in_vpc"))
        return out, edges

    def _scan_security_groups(self) -> tuple[list[Resource], list[Edge]]:
        ec2 = self._client("ec2")
        out, edges = [], []
        for page in ec2.get_paginator("describe_security_groups").paginate():
            for sg in page.get("SecurityGroups", []):
                tags = _tag_dict(sg.get("Tags"))
                sgid = sg["GroupId"]
                arn = f"arn:aws:ec2:{self.region}:{self.account_id}:security-group/{sgid}"
                attrs = {
                    "id": sgid,
                    "name": sg.get("GroupName"),
                    "description": sg.get("Description"),
                    "vpc_id": sg.get("VpcId"),
                    "ingress": sg.get("IpPermissions", []),
                    "egress": sg.get("IpPermissionsEgress", []),
                    "tags": tags,
                }
                out.append(Resource(
                    id=arn,
                    type="aws_security_group",
                    name=_name(tags, sg.get("GroupName") or sgid),
                    region=self.region,
                    account_id=self.account_id,
                    aws_state=AWSState(attributes=attrs, last_seen=_now()),
                    tags=tags,
                    containers=Containers(vpc_id=sg.get("VpcId")),
                ))
                if sg.get("VpcId"):
                    vpc_arn = f"arn:aws:ec2:{self.region}:{self.account_id}:vpc/{sg['VpcId']}"
                    edges.append(Edge(source=arn, target=vpc_arn, type="in_vpc"))
                # SG-to-SG references
                for perm in sg.get("IpPermissions", []):
                    for pair in perm.get("UserIdGroupPairs", []):
                        ref_sg = pair.get("GroupId")
                        if ref_sg and ref_sg != sgid:
                            ref_arn = f"arn:aws:ec2:{self.region}:{self.account_id}:security-group/{ref_sg}"
                            edges.append(Edge(
                                source=arn, target=ref_arn,
                                type="references_sg",
                                metadata={"direction": "ingress"},
                            ))
        return out, edges

    def _scan_route_tables(self) -> tuple[list[Resource], list[Edge]]:
        ec2 = self._client("ec2")
        out, edges = [], []
        for page in ec2.get_paginator("describe_route_tables").paginate():
            for rt in page.get("RouteTables", []):
                tags = _tag_dict(rt.get("Tags"))
                rid = rt["RouteTableId"]
                arn = f"arn:aws:ec2:{self.region}:{self.account_id}:route-table/{rid}"
                routes = [
                    {
                        "destination": r.get("DestinationCidrBlock") or r.get("DestinationIpv6CidrBlock"),
                        "target": r.get("GatewayId") or r.get("NatGatewayId") or r.get("InstanceId") or r.get("NetworkInterfaceId"),
                        "state": r.get("State"),
                    }
                    for r in rt.get("Routes", [])
                ]
                attrs = {
                    "id": rid,
                    "vpc_id": rt.get("VpcId"),
                    "routes": routes,
                    "tags": tags,
                }
                out.append(Resource(
                    id=arn,
                    type="aws_route_table",
                    name=_name(tags, rid),
                    region=self.region,
                    account_id=self.account_id,
                    aws_state=AWSState(attributes=attrs, last_seen=_now()),
                    tags=tags,
                    containers=Containers(vpc_id=rt.get("VpcId")),
                ))
                for assoc in rt.get("Associations", []):
                    if assoc.get("SubnetId"):
                        sn_arn = f"arn:aws:ec2:{self.region}:{self.account_id}:subnet/{assoc['SubnetId']}"
                        edges.append(Edge(source=sn_arn, target=arn, type="routes_via"))
                for route in routes:
                    target = route.get("target")
                    if not target:
                        continue
                    if target.startswith("igw-"):
                        edges.append(Edge(
                            source=arn,
                            target=f"arn:aws:ec2:{self.region}:{self.account_id}:internet-gateway/{target}",
                            type="routes_to",
                            metadata={"destination": route.get("destination")},
                        ))
                    elif target.startswith("nat-"):
                        edges.append(Edge(
                            source=arn,
                            target=f"arn:aws:ec2:{self.region}:{self.account_id}:natgateway/{target}",
                            type="routes_to",
                            metadata={"destination": route.get("destination")},
                        ))
        return out, edges

    def _scan_internet_gateways(self) -> tuple[list[Resource], list[Edge]]:
        ec2 = self._client("ec2")
        out, edges = [], []
        for page in ec2.get_paginator("describe_internet_gateways").paginate():
            for igw in page.get("InternetGateways", []):
                tags = _tag_dict(igw.get("Tags"))
                iid = igw["InternetGatewayId"]
                arn = f"arn:aws:ec2:{self.region}:{self.account_id}:internet-gateway/{iid}"
                attachments = igw.get("Attachments", [])
                vpc_id = attachments[0].get("VpcId") if attachments else None
                attrs = {
                    "id": iid,
                    "vpc_id": vpc_id,
                    "attachments": attachments,
                    "tags": tags,
                }
                out.append(Resource(
                    id=arn,
                    type="aws_internet_gateway",
                    name=_name(tags, iid),
                    region=self.region,
                    account_id=self.account_id,
                    aws_state=AWSState(attributes=attrs, last_seen=_now()),
                    tags=tags,
                    containers=Containers(vpc_id=vpc_id),
                ))
                if vpc_id:
                    vpc_arn = f"arn:aws:ec2:{self.region}:{self.account_id}:vpc/{vpc_id}"
                    edges.append(Edge(source=arn, target=vpc_arn, type="attached_to"))
        return out, edges

    def _scan_nat_gateways(self) -> tuple[list[Resource], list[Edge]]:
        ec2 = self._client("ec2")
        out, edges = [], []
        for page in ec2.get_paginator("describe_nat_gateways").paginate():
            for nat in page.get("NatGateways", []):
                tags = _tag_dict(nat.get("Tags"))
                nid = nat["NatGatewayId"]
                arn = f"arn:aws:ec2:{self.region}:{self.account_id}:natgateway/{nid}"
                attrs = {
                    "id": nid,
                    "subnet_id": nat.get("SubnetId"),
                    "vpc_id": nat.get("VpcId"),
                    "state": nat.get("State"),
                    "connectivity_type": nat.get("ConnectivityType", "public"),
                    "allocation_id": (nat.get("NatGatewayAddresses") or [{}])[0].get("AllocationId"),
                    "tags": tags,
                }
                out.append(Resource(
                    id=arn,
                    type="aws_nat_gateway",
                    name=_name(tags, nid),
                    region=self.region,
                    account_id=self.account_id,
                    aws_state=AWSState(attributes=attrs, last_seen=_now()),
                    tags=tags,
                    containers=Containers(vpc_id=nat.get("VpcId"), subnet_id=nat.get("SubnetId")),
                ))
                if nat.get("SubnetId"):
                    sn_arn = f"arn:aws:ec2:{self.region}:{self.account_id}:subnet/{nat['SubnetId']}"
                    edges.append(Edge(source=arn, target=sn_arn, type="in_subnet"))
        return out, edges

    def _scan_instances(self) -> tuple[list[Resource], list[Edge]]:
        ec2 = self._client("ec2")
        out, edges = [], []
        for page in ec2.get_paginator("describe_instances").paginate():
            for res in page.get("Reservations", []):
                for inst in res.get("Instances", []):
                    if inst.get("State", {}).get("Name") == "terminated":
                        continue
                    tags = _tag_dict(inst.get("Tags"))
                    iid = inst["InstanceId"]
                    arn = f"arn:aws:ec2:{self.region}:{self.account_id}:instance/{iid}"
                    sg_ids = sorted([sg["GroupId"] for sg in inst.get("SecurityGroups", [])])
                    attrs = {
                        "id": iid,
                        "instance_type": inst.get("InstanceType"),
                        "ami": inst.get("ImageId"),
                        "key_name": inst.get("KeyName"),
                        "subnet_id": inst.get("SubnetId"),
                        "vpc_id": inst.get("VpcId"),
                        "vpc_security_group_ids": sg_ids,
                        "iam_instance_profile": (inst.get("IamInstanceProfile") or {}).get("Arn"),
                        "state": inst.get("State", {}).get("Name"),
                        "private_ip": inst.get("PrivateIpAddress"),
                        "public_ip": inst.get("PublicIpAddress"),
                        "tags": tags,
                    }
                    out.append(Resource(
                        id=arn,
                        type="aws_instance",
                        name=_name(tags, iid),
                        region=self.region,
                        account_id=self.account_id,
                        aws_state=AWSState(attributes=attrs, last_seen=_now()),
                        tags=tags,
                        containers=Containers(
                            vpc_id=inst.get("VpcId"),
                            subnet_id=inst.get("SubnetId"),
                            az=(inst.get("Placement") or {}).get("AvailabilityZone"),
                        ),
                    ))
                    if inst.get("SubnetId"):
                        sn_arn = f"arn:aws:ec2:{self.region}:{self.account_id}:subnet/{inst['SubnetId']}"
                        edges.append(Edge(source=arn, target=sn_arn, type="in_subnet"))
                    for sg_id in sg_ids:
                        sg_arn = f"arn:aws:ec2:{self.region}:{self.account_id}:security-group/{sg_id}"
                        edges.append(Edge(source=arn, target=sg_arn, type="uses_sg"))
                    for bdm in inst.get("BlockDeviceMappings", []):
                        vol_id = (bdm.get("Ebs") or {}).get("VolumeId")
                        if vol_id:
                            vol_arn = f"arn:aws:ec2:{self.region}:{self.account_id}:volume/{vol_id}"
                            edges.append(Edge(source=arn, target=vol_arn, type="mounts"))
        return out, edges

    def _scan_ebs_volumes(self) -> tuple[list[Resource], list[Edge]]:
        ec2 = self._client("ec2")
        out, edges = [], []
        for page in ec2.get_paginator("describe_volumes").paginate():
            for vol in page.get("Volumes", []):
                tags = _tag_dict(vol.get("Tags"))
                vid = vol["VolumeId"]
                arn = f"arn:aws:ec2:{self.region}:{self.account_id}:volume/{vid}"
                attrs = {
                    "id": vid,
                    "size": vol.get("Size"),
                    "type": vol.get("VolumeType"),
                    "iops": vol.get("Iops"),
                    "encrypted": vol.get("Encrypted", False),
                    "kms_key_id": vol.get("KmsKeyId"),
                    "availability_zone": vol.get("AvailabilityZone"),
                    "state": vol.get("State"),
                    "tags": tags,
                }
                out.append(Resource(
                    id=arn,
                    type="aws_ebs_volume",
                    name=_name(tags, vid),
                    region=self.region,
                    account_id=self.account_id,
                    aws_state=AWSState(attributes=attrs, last_seen=_now()),
                    tags=tags,
                    containers=Containers(az=vol.get("AvailabilityZone")),
                ))
        return out, edges

    def _scan_lbs(self) -> tuple[list[Resource], list[Edge]]:
        elbv2 = self._client("elbv2")
        out, edges = [], []
        for page in elbv2.get_paginator("describe_load_balancers").paginate():
            for lb in page.get("LoadBalancers", []):
                arn = lb["LoadBalancerArn"]
                try:
                    tag_resp = elbv2.describe_tags(ResourceArns=[arn])
                    tags = _tag_dict(tag_resp["TagDescriptions"][0].get("Tags"))
                except Exception:
                    tags = {}
                az_subnets = sorted([az["SubnetId"] for az in lb.get("AvailabilityZones", []) if az.get("SubnetId")])
                attrs = {
                    "id": arn,
                    "arn": arn,
                    "name": lb.get("LoadBalancerName"),
                    "load_balancer_type": lb.get("Type"),
                    "internal": lb.get("Scheme") == "internal",
                    "subnets": az_subnets,
                    "security_groups": sorted(lb.get("SecurityGroups", [])),
                    "vpc_id": lb.get("VpcId"),
                    "dns_name": lb.get("DNSName"),
                    "state": (lb.get("State") or {}).get("Code"),
                    "tags": tags,
                }
                out.append(Resource(
                    id=arn,
                    type="aws_lb",
                    name=lb.get("LoadBalancerName") or arn,
                    region=self.region,
                    account_id=self.account_id,
                    aws_state=AWSState(attributes=attrs, last_seen=_now()),
                    tags=tags,
                    containers=Containers(vpc_id=lb.get("VpcId")),
                ))
                for sg_id in lb.get("SecurityGroups", []) or []:
                    sg_arn = f"arn:aws:ec2:{self.region}:{self.account_id}:security-group/{sg_id}"
                    edges.append(Edge(source=arn, target=sg_arn, type="uses_sg"))
                for sn_id in az_subnets:
                    sn_arn = f"arn:aws:ec2:{self.region}:{self.account_id}:subnet/{sn_id}"
                    edges.append(Edge(source=arn, target=sn_arn, type="in_subnet"))
        return out, edges

    def _scan_target_groups(self) -> tuple[list[Resource], list[Edge]]:
        elbv2 = self._client("elbv2")
        out, edges = [], []
        for page in elbv2.get_paginator("describe_target_groups").paginate():
            for tg in page.get("TargetGroups", []):
                arn = tg["TargetGroupArn"]
                try:
                    tag_resp = elbv2.describe_tags(ResourceArns=[arn])
                    tags = _tag_dict(tag_resp["TagDescriptions"][0].get("Tags"))
                except Exception:
                    tags = {}
                attrs = {
                    "id": arn,
                    "arn": arn,
                    "name": tg.get("TargetGroupName"),
                    "port": tg.get("Port"),
                    "protocol": tg.get("Protocol"),
                    "target_type": tg.get("TargetType"),
                    "vpc_id": tg.get("VpcId"),
                    "health_check": {
                        "protocol": tg.get("HealthCheckProtocol"),
                        "port": tg.get("HealthCheckPort"),
                        "path": tg.get("HealthCheckPath"),
                        "interval": tg.get("HealthCheckIntervalSeconds"),
                    },
                    "tags": tags,
                }
                out.append(Resource(
                    id=arn,
                    type="aws_lb_target_group",
                    name=tg.get("TargetGroupName") or arn,
                    region=self.region,
                    account_id=self.account_id,
                    aws_state=AWSState(attributes=attrs, last_seen=_now()),
                    tags=tags,
                    containers=Containers(vpc_id=tg.get("VpcId")),
                ))
                # Target health → edges to targets
                try:
                    th = elbv2.describe_target_health(TargetGroupArn=arn)
                    for desc in th.get("TargetHealthDescriptions", []):
                        target_id = (desc.get("Target") or {}).get("Id")
                        if not target_id:
                            continue
                        if tg.get("TargetType") == "instance":
                            tgt_arn = f"arn:aws:ec2:{self.region}:{self.account_id}:instance/{target_id}"
                            edges.append(Edge(source=arn, target=tgt_arn, type="targets"))
                        elif tg.get("TargetType") == "lambda":
                            edges.append(Edge(source=arn, target=target_id, type="targets"))
                except Exception:
                    pass
        return out, edges

    def _scan_db_instances(self) -> tuple[list[Resource], list[Edge]]:
        rds = self._client("rds")
        out, edges = [], []
        for page in rds.get_paginator("describe_db_instances").paginate():
            for db in page.get("DBInstances", []):
                arn = db["DBInstanceArn"]
                tags = _tag_dict(db.get("TagList"))
                sg_ids = sorted([s["VpcSecurityGroupId"] for s in db.get("VpcSecurityGroups", [])])
                subnet_group = (db.get("DBSubnetGroup") or {})
                attrs = {
                    "id": db.get("DBInstanceIdentifier"),
                    "identifier": db.get("DBInstanceIdentifier"),
                    "arn": arn,
                    "instance_class": db.get("DBInstanceClass"),
                    "engine": db.get("Engine"),
                    "engine_version": db.get("EngineVersion"),
                    "allocated_storage": db.get("AllocatedStorage"),
                    "storage_type": db.get("StorageType"),
                    "multi_az": db.get("MultiAZ", False),
                    "publicly_accessible": db.get("PubliclyAccessible", False),
                    "vpc_security_group_ids": sg_ids,
                    "db_subnet_group_name": subnet_group.get("DBSubnetGroupName"),
                    "backup_retention_period": db.get("BackupRetentionPeriod"),
                    "endpoint": (db.get("Endpoint") or {}).get("Address"),
                    "tags": tags,
                }
                out.append(Resource(
                    id=arn,
                    type="aws_db_instance",
                    name=db.get("DBInstanceIdentifier") or arn,
                    region=self.region,
                    account_id=self.account_id,
                    aws_state=AWSState(attributes=attrs, last_seen=_now()),
                    tags=tags,
                    containers=Containers(vpc_id=subnet_group.get("VpcId")),
                ))
                for sg_id in sg_ids:
                    sg_arn = f"arn:aws:ec2:{self.region}:{self.account_id}:security-group/{sg_id}"
                    edges.append(Edge(source=arn, target=sg_arn, type="uses_sg"))
                for sn in subnet_group.get("Subnets", []) or []:
                    sn_id = sn.get("SubnetIdentifier")
                    if sn_id:
                        sn_arn = f"arn:aws:ec2:{self.region}:{self.account_id}:subnet/{sn_id}"
                        edges.append(Edge(source=arn, target=sn_arn, type="in_subnet"))
        return out, edges

    def _scan_s3_buckets(self) -> tuple[list[Resource], list[Edge]]:
        s3 = self._client("s3")
        out: list[Resource] = []
        try:
            resp = s3.list_buckets()
        except Exception:
            return out, []
        for b in resp.get("Buckets", []):
            name = b["Name"]
            arn = f"arn:aws:s3:::{name}"
            tags: dict[str, str] = {}
            bregion = self.region
            try:
                loc = s3.get_bucket_location(Bucket=name).get("LocationConstraint")
                bregion = loc or "us-east-1"
            except Exception:
                pass
            if bregion != self.region:
                # bucket lives in another region — skip in this scan
                continue
            try:
                tag_resp = s3.get_bucket_tagging(Bucket=name)
                tags = _tag_dict(tag_resp.get("TagSet"))
            except Exception:
                pass
            attrs = {
                "id": name,
                "bucket": name,
                "region": bregion,
                "creation_date": b.get("CreationDate").isoformat() if b.get("CreationDate") else None,
                "tags": tags,
            }
            out.append(Resource(
                id=arn,
                type="aws_s3_bucket",
                name=name,
                region=bregion,
                account_id=self.account_id,
                aws_state=AWSState(attributes=attrs, last_seen=_now()),
                tags=tags,
            ))
        return out, []

    def _scan_lambda_functions(self) -> tuple[list[Resource], list[Edge]]:
        lam = self._client("lambda")
        out, edges = [], []
        for page in lam.get_paginator("list_functions").paginate():
            for fn in page.get("Functions", []):
                arn = fn["FunctionArn"]
                vpc_cfg = fn.get("VpcConfig") or {}
                attrs = {
                    "id": fn.get("FunctionName"),
                    "arn": arn,
                    "function_name": fn.get("FunctionName"),
                    "runtime": fn.get("Runtime"),
                    "handler": fn.get("Handler"),
                    "memory_size": fn.get("MemorySize"),
                    "timeout": fn.get("Timeout"),
                    "role": fn.get("Role"),
                    "environment": (fn.get("Environment") or {}).get("Variables", {}),
                    "vpc_config": {
                        "subnet_ids": sorted(vpc_cfg.get("SubnetIds", []) or []),
                        "security_group_ids": sorted(vpc_cfg.get("SecurityGroupIds", []) or []),
                        "vpc_id": vpc_cfg.get("VpcId"),
                    },
                }
                try:
                    tag_resp = lam.list_tags(Resource=arn)
                    tags = dict(tag_resp.get("Tags") or {})
                except Exception:
                    tags = {}
                attrs["tags"] = tags
                out.append(Resource(
                    id=arn,
                    type="aws_lambda_function",
                    name=fn.get("FunctionName") or arn,
                    region=self.region,
                    account_id=self.account_id,
                    aws_state=AWSState(attributes=attrs, last_seen=_now()),
                    tags=tags,
                    containers=Containers(vpc_id=vpc_cfg.get("VpcId")),
                ))
                for sn_id in vpc_cfg.get("SubnetIds", []) or []:
                    sn_arn = f"arn:aws:ec2:{self.region}:{self.account_id}:subnet/{sn_id}"
                    edges.append(Edge(source=arn, target=sn_arn, type="in_subnet"))
                for sg_id in vpc_cfg.get("SecurityGroupIds", []) or []:
                    sg_arn = f"arn:aws:ec2:{self.region}:{self.account_id}:security-group/{sg_id}"
                    edges.append(Edge(source=arn, target=sg_arn, type="uses_sg"))
        return out, edges
