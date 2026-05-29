"""Parsing TF_VAR mappings out of a real .gitlab-ci.yml, including the
job-level `variables:` block and `-var "key=value"` flags in script lines,
with `$VAR`/`${VAR}` substitution from GitLab + predefined sources."""

import textwrap

from cenote.scanners.gitlab_ci import extract_tf_vars_from_ci


# Trimmed-but-faithful version of the user's real pipeline.
_REAL_CI = textwrap.dedent(
    """
    variables:
      TF_ROOT: ${CI_PROJECT_DIR}/terraform/develop

    stages:
      - tf-deploy

    terraform_deploy:
      image:
        name: hashicorp/terraform:latest
      stage: tf-deploy
      variables:
        TF_VAR_name: $PROJECT_TITLE
        TF_VAR_region: $AWS_DEFAULT_REGION
        TF_VAR_tag: $IMAGE_TAG
      script:
        - cd $TF_ROOT
        - terraform plan -var "name=${PROJECT_TITLE}" -var "region=${AWS_DEFAULT_REGION}" -var "tag=${IMAGE_TAG}"
    """
)


def test_extracts_tf_vars_from_real_pipeline():
    extr = extract_tf_vars_from_ci(
        _REAL_CI,
        gitlab_vars={"AWS_DEFAULT_REGION": "us-east-1"},
        predefined={"PROJECT_TITLE": "processor-simulator", "IMAGE_TAG": "abc12345"},
    )
    assert extr.tf_vars == {
        "name": "processor-simulator",
        "region": "us-east-1",
        "tag": "abc12345",
    }
    assert extr.jobs_seen == ["terraform_deploy"]
    assert extr.unresolved == []


def test_unresolved_references_are_reported():
    # PROJECT_TITLE isn't supplied → kept unresolved with the original `$REF`.
    extr = extract_tf_vars_from_ci(
        _REAL_CI,
        gitlab_vars={"AWS_DEFAULT_REGION": "us-east-1"},
        predefined={"IMAGE_TAG": "abc12345"},
    )
    assert "name" not in extr.tf_vars
    assert any("name=" in u and "PROJECT_TITLE" in u for u in extr.unresolved)
    # Resolved ones still come through.
    assert extr.tf_vars["region"] == "us-east-1"


def test_shell_substitution_marks_unresolved():
    # `$(...)` can't be evaluated statically — must end up in unresolved even
    # when every named reference inside is known.
    extr = extract_tf_vars_from_ci(
        textwrap.dedent(
            """
            terraform_deploy:
              variables:
                TF_VAR_tag: $(echo $CI_COMMIT_SHA | head -c 8)
            """
        ),
        predefined={"CI_COMMIT_SHA": "abcdef123456"},
    )
    assert "tag" not in extr.tf_vars
    assert any("tag=" in u for u in extr.unresolved)


def test_global_variables_block_picked_up():
    extr = extract_tf_vars_from_ci(
        textwrap.dedent(
            """
            variables:
              TF_VAR_env: develop
            terraform_deploy:
              script:
                - terraform plan
            """
        ),
    )
    assert extr.tf_vars == {"env": "develop"}


def test_invalid_yaml_returns_empty_not_crash():
    extr = extract_tf_vars_from_ci(":\n  not: [valid yaml")
    assert extr.tf_vars == {} and extr.unresolved == []


def test_alias_chain_through_top_level_variables():
    # Real GitLab pipelines often chain: a top-level alias re-exports a
    # predefined CI var, and the job's TF_VAR_* references the alias. The
    # parser must follow that chain.
    extr = extract_tf_vars_from_ci(
        textwrap.dedent(
            """
            variables:
              PROJECT_TITLE: $CI_PROJECT_TITLE
              IMAGE_TAG: latest
            terraform_deploy:
              variables:
                TF_VAR_name: $PROJECT_TITLE
                TF_VAR_tag: $IMAGE_TAG
            """
        ),
        predefined={"CI_PROJECT_TITLE": "processor-simulator"},
    )
    assert extr.tf_vars == {"name": "processor-simulator", "tag": "latest"}
