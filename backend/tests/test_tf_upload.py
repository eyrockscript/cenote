"""Tests for the zip-extraction and offline-provider injection used by
/api/tf/diagram/plan. These guard two regressions:

  1. Companion files (templatefile/file() targets, JSON policies, scripts) must
     be extracted alongside `.tf`, else terraform plan aborts with
     "Invalid function argument: no file exists".
  2. The baseline `provider "aws"` injection must not break when the upload has
     no provider block (it used str.format on HCL full of literal braces).
"""

import io
import zipfile
from pathlib import Path

import pytest
from fastapi import HTTPException

from cenote.api.main import _safe_extract
from cenote.scanners.terraform import _inject_offline_provider


def _zip(files: dict[str, str]) -> zipfile.ZipFile:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for name, content in files.items():
            z.writestr(name, content)
    buf.seek(0)
    return zipfile.ZipFile(buf)


def test_extracts_tf_and_companion_files(tmp_path: Path):
    zf = _zip({
        "main.tf": 'resource "aws_vpc" "v" { cidr_block = "10.0.0.0/16" }\n',
        "modules/sfn/state_machine.asl.json": '{"StartAt": "Done"}\n',
        "modules/sfn/user_data.sh.tpl": "#!/bin/bash\necho hi\n",
        "policy.json": "{}\n",
    })
    tf_count = _safe_extract(zf, tmp_path)
    assert tf_count == 1  # count is .tf only
    # Companion files preserve their relative path so path.module resolves.
    assert (tmp_path / "modules/sfn/state_machine.asl.json").exists()
    assert (tmp_path / "modules/sfn/user_data.sh.tpl").exists()
    assert (tmp_path / "policy.json").exists()


def test_skips_provider_binaries_and_vcs_dirs(tmp_path: Path):
    zf = _zip({
        "main.tf": 'resource "aws_vpc" "v" { cidr_block = "10.0.0.0/16" }\n',
        ".terraform/providers/aws/binary": "BINARY",
        ".git/config": "[core]\n",
        "node_modules/pkg/index.js": "module.exports = {}\n",
        "diagram.png": "PNGDATA",
    })
    _safe_extract(zf, tmp_path)
    assert not (tmp_path / ".terraform").exists()
    assert not (tmp_path / ".git").exists()
    assert not (tmp_path / "node_modules").exists()
    assert not (tmp_path / "diagram.png").exists()


def test_no_tf_files_raises(tmp_path: Path):
    zf = _zip({"policy.json": "{}\n", "README.md": "hi\n"})
    with pytest.raises(HTTPException) as exc:
        _safe_extract(zf, tmp_path)
    assert exc.value.status_code == 400
    assert "no .tf files" in str(exc.value.detail).lower()


def test_inject_baseline_provider_when_none_declared(tmp_path: Path):
    # No `provider "aws"` block → baseline file is written and is valid HCL
    # (the literal-braces bug produced an IndexError here).
    (tmp_path / "main.tf").write_text(
        'resource "aws_vpc" "v" { cidr_block = "10.0.0.0/16" }\n'
    )
    _inject_offline_provider(tmp_path, "eu-west-1")
    baseline = tmp_path / "_cenote_baseline_provider.tf"
    assert baseline.exists()
    body = baseline.read_text()
    assert 'region                      = "eu-west-1"' in body
    assert "{region}" not in body and "__REGION__" not in body


def test_no_baseline_when_provider_present(tmp_path: Path):
    (tmp_path / "main.tf").write_text('provider "aws" { region = "us-east-1" }\n')
    _inject_offline_provider(tmp_path, "us-east-1")
    assert not (tmp_path / "_cenote_baseline_provider.tf").exists()
    assert (tmp_path / "_cenote_override.tf").exists()  # override always written
