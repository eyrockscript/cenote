"""Ghost-node synthesis for `var.*`-referenced or literal-ID-referenced infra."""

from cenote.core.ghosts import synthesize_ghosts


def test_var_vpc_id_emits_ghost_vpc():
    managed = [
        ("tf://aws_ecs_service.svc", "aws_ecs_service", {"vpc_id": "${var.vpc_id}"}),
    ]
    ghosts, edges = synthesize_ghosts(managed, existing_ids=set())
    assert len(ghosts) == 1
    g = ghosts[0]
    assert g.type == "aws_vpc"
    assert g.name == "var.vpc_id"
    assert g.planned_action == "read"
    assert g.id.startswith("external://aws_vpc/")
    # Edge: ECS service → ghost VPC, typed in_vpc.
    e = edges[0]
    assert (e.source, e.target, e.type) == ("tf://aws_ecs_service.svc", g.id, "in_vpc")


def test_subnets_list_with_var_and_literal_both_emit_ghosts():
    managed = [
        (
            "tf://aws_ecs_service.svc",
            "aws_ecs_service",
            # plan-mode resolved value: list with one literal id + one var ref.
            {"subnet_ids": ["subnet-0abc1234def567890", "${var.private_subnet_id}"]},
        ),
    ]
    ghosts, edges = synthesize_ghosts(managed, existing_ids=set())
    names = sorted(g.name for g in ghosts)
    assert names == ["subnet-0abc1234def567890", "var.private_subnet_id"]
    assert all(g.type == "aws_subnet" for g in ghosts)
    assert all(e.type == "in_subnet" for e in edges)


def test_multiple_resources_sharing_a_var_dedupe_to_one_ghost():
    managed = [
        ("tf://aws_ecs_service.a", "aws_ecs_service", {"vpc_id": "${var.vpc_id}"}),
        ("tf://aws_lb.b", "aws_lb", {"vpc_id": "${var.vpc_id}"}),
    ]
    ghosts, edges = synthesize_ghosts(managed, existing_ids=set())
    assert len(ghosts) == 1
    assert {e.source for e in edges} == {"tf://aws_ecs_service.a", "tf://aws_lb.b"}
    assert all(e.target == ghosts[0].id for e in edges)


def test_security_group_ids_emits_ghost_sg():
    managed = [
        (
            "tf://aws_ecs_service.svc",
            "aws_ecs_service",
            {"vpc_security_group_ids": ["${var.ecs_sg_id}", "sg-deadbeef1234"]},
        ),
    ]
    ghosts, edges = synthesize_ghosts(managed, existing_ids=set())
    types = {g.type for g in ghosts}
    edge_types = {e.type for e in edges}
    assert types == {"aws_security_group"}
    assert edge_types == {"references_sg"}


def test_iam_role_arn_literal_extracts_role_name():
    managed = [
        (
            "tf://aws_ecs_task_definition.td",
            "aws_ecs_task_definition",
            {"execution_role_arn": "arn:aws:iam::123456789012:role/ecsExecRole"},
        ),
    ]
    ghosts, edges = synthesize_ghosts(managed, existing_ids=set())
    assert len(ghosts) == 1
    g = ghosts[0]
    assert g.type == "aws_iam_role"
    assert g.name == "ecsExecRole"
    assert edges[0].type == "references"


def test_skips_when_existing_id_collides():
    # Prevents double-adding when something else already produced this ghost.
    managed = [("tf://aws_ecs_service.svc", "aws_ecs_service", {"vpc_id": "${var.vpc_id}"})]
    existing = {"external://aws_vpc/var.vpc_id"}
    ghosts, edges = synthesize_ghosts(managed, existing_ids=existing)
    assert ghosts == []
    # Still emit the edge — the caller already has the node.
    assert len(edges) == 1
    assert edges[0].target == "external://aws_vpc/var.vpc_id"


def test_ignores_unknown_attribute_keys():
    # `name` isn't in any pattern set, so even though it has var.X, no ghost.
    managed = [("tf://aws_iam_role.r", "aws_iam_role", {"name": "${var.role_name}"})]
    ghosts, edges = synthesize_ghosts(managed, existing_ids=set())
    assert ghosts == [] and edges == []
