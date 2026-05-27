"""Tabla de eventos de creación en CloudTrail por tipo de recurso.

Cada entrada: (event_name, jmespath_to_resource_id)
Si un tipo tiene varios eventos posibles, lista todos.

Usado por scanner-cloudtrail para hacer una pasada por evento (no por recurso),
indexando el resultado por ARN computado a partir del id extraído.
"""

CREATE_EVENTS: dict[str, list[tuple[str, str]]] = {
    "aws_vpc": [("CreateVpc", "responseElements.vpc.vpcId")],
    "aws_subnet": [("CreateSubnet", "responseElements.subnet.subnetId")],
    "aws_security_group": [("CreateSecurityGroup", "responseElements.groupId")],
    "aws_route_table": [("CreateRouteTable", "responseElements.routeTable.routeTableId")],
    "aws_internet_gateway": [
        ("CreateInternetGateway", "responseElements.internetGateway.internetGatewayId")
    ],
    "aws_nat_gateway": [("CreateNatGateway", "responseElements.natGateway.natGatewayId")],
    "aws_instance": [("RunInstances", "responseElements.instancesSet.items[0].instanceId")],
    "aws_ebs_volume": [("CreateVolume", "responseElements.volumeId")],
    "aws_lb": [
        ("CreateLoadBalancer", "responseElements.loadBalancers[0].loadBalancerArn"),
    ],
    "aws_lb_target_group": [
        ("CreateTargetGroup", "responseElements.targetGroups[0].targetGroupArn"),
    ],
    "aws_db_instance": [
        ("CreateDBInstance", "responseElements.dBInstanceArn"),
    ],
    "aws_s3_bucket": [("CreateBucket", "requestParameters.bucketName")],
    "aws_lambda_function": [
        ("CreateFunction20150331", "responseElements.functionArn"),
    ],
}


def event_names() -> list[str]:
    """Returns the deduplicated list of event names to query in CloudTrail."""
    names: set[str] = set()
    for events in CREATE_EVENTS.values():
        for name, _ in events:
            names.add(name)
    return sorted(names)
