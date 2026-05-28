from pathlib import Path

from cenote.scanners.terraform import (
    _placeholder_literal,
    _required_var_placeholders,
    _scalar_placeholder,
    parse_tfstate,
    resolve_arn,
)

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


def test_scalar_placeholder_uses_name_heuristics():
    # AWS fields that fail provider validation if fed a nonsense string must
    # get a format-valid value derived from the variable name.
    assert _scalar_placeholder("vpc_cidr_block") == "10.0.0.0/16"
    assert _scalar_placeholder("primary_region") == "us-east-1"
    assert _scalar_placeholder("ami_id").startswith("ami-")
    assert _scalar_placeholder("az").__class__ is str  # falls through to default
    assert _scalar_placeholder("project_name") == "cenote-auto"


def test_placeholder_literal_respects_declared_type():
    assert _placeholder_literal("tags", "map(string)") == "{}"
    assert _placeholder_literal("settings", "object({a=string})") == "{}"
    assert _placeholder_literal("replicas", "number") == "1"
    assert _placeholder_literal("enabled", "bool") == "false"
    # Collections seed one element so element()/index lookups don't fail.
    assert _placeholder_literal("subnet_cidrs", "list(string)") == '["10.0.0.0/16"]'
    # Quote-wrapped type expression from python-hcl2 v6+ still parses.
    assert _placeholder_literal("name", '"string"') == "cenote-auto"


def test_required_var_placeholders_only_vars_without_default(tmp_path):
    (tmp_path / "main.tf").write_text(
        'variable "vpc_cidr" {\n  type = string\n}\n'
        'variable "region" {\n  type    = string\n  default = "us-west-2"\n}\n'
        'variable "azs" {\n  type = list(string)\n}\n'
    )
    out = _required_var_placeholders(tmp_path)
    assert out["TF_VAR_vpc_cidr"] == "10.0.0.0/16"
    assert out["TF_VAR_azs"] == '["cenote-auto"]'
    assert "TF_VAR_region" not in out  # has a default → terraform supplies it


def test_required_var_placeholders_survives_validation_blocks(tmp_path):
    # python-hcl2 throws on validation blocks / optional() in object types; the
    # old scanner then dropped EVERY var in the file and plan aborted on the
    # first required one. The regex scanner must still find them.
    (tmp_path / "variables.tf").write_text(
        'variable "subnet_id" {\n'
        "  type = string\n"
        "  validation {\n"
        '    condition     = can(regex("^subnet-", var.subnet_id))\n'
        '    error_message = "must start with subnet-."\n'
        "  }\n"
        "}\n"
        'variable "settings" {\n'
        "  type = object({\n"
        "    name    = string\n"
        "    enabled = optional(bool, true)\n"
        "  })\n"
        "}\n"
    )
    out = _required_var_placeholders(tmp_path)
    assert out["TF_VAR_subnet_id"].startswith("subnet-")
    assert out["TF_VAR_settings"] == "{}"


def test_aws_id_name_heuristics():
    assert _scalar_placeholder("subnet_id").startswith("subnet-")
    assert _scalar_placeholder("my_vpc_id").startswith("vpc-")
    assert _scalar_placeholder("security_group_id").startswith("sg-")
    # cidr wins over vpc when both substrings are present (more specific first)
    assert _scalar_placeholder("vpc_cidr_block") == "10.0.0.0/16"


def test_validation_enum_satisfied(tmp_path):
    # A generic placeholder fails `contains([...])` / `== || ==` validations;
    # we must mine an allowed literal so plan doesn't abort with
    # "Invalid value for variable".
    (tmp_path / "variables.tf").write_text(
        'variable "environment" {\n'
        "  type = string\n"
        "  validation {\n"
        '    condition     = contains(["dev", "prod"], var.environment)\n'
        '    error_message = "environment must be dev or prod."\n'
        "  }\n"
        "}\n"
        'variable "stage" {\n'
        "  type = string\n"
        "  validation {\n"
        '    condition     = var.stage == "staging" || var.stage == "production"\n'
        '    error_message = "bad"\n'
        "  }\n"
        "}\n"
        'variable "name" {\n'
        "  type = string\n"
        "  validation {\n"
        "    condition     = length(var.name) > 0\n"
        '    error_message = "empty"\n'
        "  }\n"
        "}\n"
    )
    out = _required_var_placeholders(tmp_path)
    assert out["TF_VAR_environment"] == "dev"
    assert out["TF_VAR_stage"] == "staging"
    # length() check has no allow-list literal → falls back to the placeholder.
    assert out["TF_VAR_name"] == "cenote-auto"
