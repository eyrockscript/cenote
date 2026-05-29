"""Stripping configured backend blocks so `terraform plan -backend=false`
doesn't abort with "Backend initialization required" on a diagram run."""

from pathlib import Path

from cenote.scanners.terraform import (
    _neutralize_backends,
    _neutralize_provider_profile,
    _strip_backend_blocks,
    _strip_provider_profile,
)


def test_strips_empty_http_backend():
    text = (
        'terraform {\n'
        '  required_providers {\n'
        '    aws = { source = "hashicorp/aws" }\n'
        '  }\n'
        '  backend "http" {}\n'
        '}\n'
    )
    out = _strip_backend_blocks(text)
    assert "backend" not in out
    assert "required_providers" in out  # rest of terraform block survives
    assert 'source = "hashicorp/aws"' in out


def test_strips_nonempty_s3_backend():
    text = (
        'terraform {\n'
        '  backend "s3" {\n'
        '    bucket = "tfstate"\n'
        '    key    = "env/terraform.tfstate"\n'
        '    region = "us-east-1"\n'
        '  }\n'
        '}\n'
    )
    out = _strip_backend_blocks(text)
    assert "backend" not in out
    assert "bucket" not in out


def test_no_backend_is_noop():
    text = 'resource "aws_vpc" "main" {\n  cidr_block = "10.0.0.0/16"\n}\n'
    assert _strip_backend_blocks(text) == text


def test_neutralize_backends_writes_files_and_skips_cenote(tmp_path: Path):
    (tmp_path / "provider.tf").write_text('terraform {\n  backend "http" {}\n}\n')
    (tmp_path / "_cenote_override.tf").write_text('terraform {\n  backend "http" {}\n}\n')
    (tmp_path / "main.tf").write_text('resource "aws_vpc" "v" {}\n')

    changed = _neutralize_backends(tmp_path)

    assert changed == 1  # only provider.tf; main.tf has none, _cenote_ is skipped
    assert "backend" not in (tmp_path / "provider.tf").read_text()
    # _cenote_ files are auto-generated and must not be touched
    assert "backend" in (tmp_path / "_cenote_override.tf").read_text()


def test_strips_profile_only_inside_aws_provider():
    text = (
        'provider "aws" {\n'
        '  region  = var.region\n'
        '  profile = "oidc"\n'
        '}\n'
        'resource "aws_iam_instance_profile" "p" {\n'
        '  name = "profile"\n'
        '}\n'
    )
    out, removed = _strip_provider_profile(text)
    assert removed == 1
    assert 'profile = "oidc"' not in out
    assert "region  = var.region" in out
    # The resource named with "profile" and its attribute survive untouched
    assert 'resource "aws_iam_instance_profile" "p"' in out
    assert 'name = "profile"' in out


def test_profile_strip_noop_without_profile():
    text = 'provider "aws" {\n  region = "us-east-1"\n}\n'
    out, removed = _strip_provider_profile(text)
    assert removed == 0
    assert out == text


def test_neutralize_provider_profile_writes_file(tmp_path: Path):
    (tmp_path / "provider.tf").write_text(
        'provider "aws" {\n  region = var.region\n  profile = "oidc"\n}\n'
    )
    changed = _neutralize_provider_profile(tmp_path)
    assert changed == 1
    assert "oidc" not in (tmp_path / "provider.tf").read_text()
