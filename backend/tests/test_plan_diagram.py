"""Tests for building a Graph from terraform plan JSON, focused on the two
hard parts: rendering every managed resource (not just the catalog) and
resolving cross-module edges that travel through module outputs.
"""

import json
from pathlib import Path

from cenote.core.plan_diagram import build_graph_from_plan


def _write(tmp_path: Path, plan: dict) -> Path:
    p = tmp_path / "plan.json"
    p.write_text(json.dumps(plan))
    return p


def test_renders_uncatalogued_managed_types_skips_noise_data(tmp_path: Path):
    plan = {
        "planned_values": {"root_module": {"resources": [
            {"address": "aws_iam_role.exec", "mode": "managed", "type": "aws_iam_role",
             "name": "exec", "values": {"name": "exec"}},
            {"address": "aws_vpc.main", "mode": "managed", "type": "aws_vpc",
             "name": "main", "values": {"cidr_block": "10.0.0.0/16"}},
            {"address": "data.aws_caller_identity.cur", "mode": "data",
             "type": "aws_caller_identity", "name": "cur", "values": {}},
        ]}},
        "resource_changes": [],
        "configuration": {"root_module": {}},
    }
    g = build_graph_from_plan(_write(tmp_path, plan), "t")
    types = {n.type for n in g.nodes}
    assert "aws_iam_role" in types          # uncatalogued managed type rendered
    assert "aws_vpc" in types
    assert "aws_caller_identity" not in types  # non-infra data lookup dropped


def test_cross_module_edge_through_output(tmp_path: Path):
    # module.network exposes subnet_id (→ aws_subnet.app); module.compute
    # consumes it as var.subnet_id on aws_instance.api. The edge must connect
    # the instance to the subnet, and the subnet to the vpc (within-module).
    plan = {
        "planned_values": {"root_module": {"child_modules": [
            {"address": "module.network", "resources": [
                {"address": "module.network.aws_vpc.main", "mode": "managed",
                 "type": "aws_vpc", "name": "main", "values": {}},
                {"address": "module.network.aws_subnet.app", "mode": "managed",
                 "type": "aws_subnet", "name": "app", "values": {}},
            ]},
            {"address": "module.compute", "resources": [
                {"address": "module.compute.aws_instance.api", "mode": "managed",
                 "type": "aws_instance", "name": "api", "values": {}},
            ]},
        ]}},
        "resource_changes": [],
        "configuration": {"root_module": {
            "module_calls": {
                "network": {"module": {
                    "resources": [
                        {"address": "aws_vpc.main", "expressions": {}},
                        {"address": "aws_subnet.app",
                         "expressions": {"vpc_id": {"references": ["aws_vpc.main.id", "aws_vpc.main"]}}},
                    ],
                    "outputs": {"subnet_id": {"expression": {"references": ["aws_subnet.app.id", "aws_subnet.app"]}}},
                }},
                "compute": {
                    "expressions": {"subnet_id": {"references": ["module.network.subnet_id"]}},
                    "module": {"resources": [
                        {"address": "aws_instance.api",
                         "expressions": {"subnet_id": {"references": ["var.subnet_id"]}}},
                    ]},
                },
            },
        }},
    }
    g = build_graph_from_plan(_write(tmp_path, plan), "t")
    edges = {(e.source, e.target, e.type) for e in g.edges}
    assert ("tf://module.network.aws_subnet.app", "tf://module.network.aws_vpc.main", "in_vpc") in edges
    assert ("tf://module.compute.aws_instance.api", "tf://module.network.aws_subnet.app", "in_subnet") in edges
