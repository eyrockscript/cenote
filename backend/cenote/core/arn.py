"""Deterministic mapping from Terraform resource to canonical AWS ARN.

Each entry knows how to extract the identifier from the TF resource's attributes
and build the ARN. The ARN format matches what AWS returns from describe_* calls,
so the reconciler can match by string equality.

If a TF resource cannot be mapped to an ARN (e.g. data sources, modules without
attributes), tf_to_arn returns None and the caller logs it as 'unresolved'.
"""

from typing import Any, Callable

Attrs = dict[str, Any]
ArnBuilder = Callable[[Attrs, str, str], str | None]


def _ec2(suffix: str) -> ArnBuilder:
    def builder(a: Attrs, account: str, region: str) -> str | None:
        ident = a.get("id")
        if not ident:
            return None
        return f"arn:aws:ec2:{region}:{account}:{suffix}/{ident}"
    return builder


def _instance(a: Attrs, account: str, region: str) -> str | None:
    ident = a.get("id")
    if not ident:
        return None
    return f"arn:aws:ec2:{region}:{account}:instance/{ident}"


def _ebs(a: Attrs, account: str, region: str) -> str | None:
    ident = a.get("id")
    if not ident:
        return None
    return f"arn:aws:ec2:{region}:{account}:volume/{ident}"


def _s3_bucket(a: Attrs, account: str, region: str) -> str | None:
    name = a.get("bucket") or a.get("id")
    if not name:
        return None
    return f"arn:aws:s3:::{name}"


def _lambda(a: Attrs, account: str, region: str) -> str | None:
    arn = a.get("arn")
    if arn:
        return arn
    name = a.get("function_name") or a.get("id")
    if not name:
        return None
    return f"arn:aws:lambda:{region}:{account}:function:{name}"


def _lb(a: Attrs, account: str, region: str) -> str | None:
    return a.get("arn")


def _lb_tg(a: Attrs, account: str, region: str) -> str | None:
    return a.get("arn")


def _rds(a: Attrs, account: str, region: str) -> str | None:
    arn = a.get("arn")
    if arn:
        return arn
    ident = a.get("identifier") or a.get("id")
    if not ident:
        return None
    return f"arn:aws:rds:{region}:{account}:db:{ident}"


ARN_BUILDERS: dict[str, ArnBuilder] = {
    "aws_vpc": _ec2("vpc"),
    "aws_subnet": _ec2("subnet"),
    "aws_security_group": _ec2("security-group"),
    "aws_route_table": _ec2("route-table"),
    "aws_internet_gateway": _ec2("internet-gateway"),
    "aws_nat_gateway": _ec2("natgateway"),
    "aws_instance": _instance,
    "aws_ebs_volume": _ebs,
    "aws_lb": _lb,
    "aws_lb_target_group": _lb_tg,
    "aws_db_instance": _rds,
    "aws_s3_bucket": _s3_bucket,
    "aws_lambda_function": _lambda,
}


def tf_to_arn(tf_type: str, attrs: Attrs, account_id: str, region: str) -> str | None:
    builder = ARN_BUILDERS.get(tf_type)
    if not builder:
        return None
    return builder(attrs, account_id, region)
