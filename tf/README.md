# `tf/` — mount point for Terraform directories

This folder is mounted into the Cenote api container at `/tf`. Two ways to use it:

## Option A — copy .tf files here

```bash
cp -r ~/my-tf-project/* tf/
```

Then in the UI choose "Terraform directory" and use the path `/tf`.

## Option B — point at your project directly

Set `TF_DIR` in `.env`:

```env
TF_DIR=/Users/you/code/my-tf-project
```

Then restart the stack. `/tf` inside the container will reflect your project.

## What happens inside the container

When you trigger a scan with `terraform_dir`, Cenote runs:

1. `terraform init -input=false`
2. `terraform plan -input=false -out=plan`
3. `terraform show -json plan > plan.json`

The plan JSON is parsed and reconciled against the AWS scan. Any `terraform.tfvars`,
`*.auto.tfvars`, or `TF_VAR_*` env vars in the api container are honored.

## Caveats

- **Remote backends:** if your project uses S3/Terraform Cloud backend, the
  container needs the same credentials your local terraform has. The mounted
  `~/.aws` already provides AWS credentials.
- **Modules from git:** require the container to reach github.com / your VCS.
- **Provider downloads:** `terraform init` will fetch providers on each plan
  (cache lives in `<dir>/.terraform/`, which persists in the mounted folder).
