<div align="center">

<img src="web/public/brand/mark.svg" width="84" height="84" alt="Cenote" />

# Cenote

**Unified AWS + Terraform graph** — drift detection, a pre-apply diff viewer, authorship attribution, and an architecture diagram straight from your `.tf`. Self-hosted, read-only, **$0 in AWS** by default.

![Status](https://img.shields.io/badge/status-v0.1%20dev-0a0a0a)
![Python](https://img.shields.io/badge/python-3.11-3776AB)
![React](https://img.shields.io/badge/react-18-149ECA)
![Runtime](https://img.shields.io/badge/runtime-Docker%20%7C%20Podman-0a0a0a)
![AWS cost](https://img.shields.io/badge/AWS%20cost-%240%2Fmo-10b981)

</div>

A cenote is a natural sinkhole that reveals the groundwater hiding below the surface — the same way this tool reveals the AWS resources hiding behind what Terraform declares. The logo's two offset rings are that gap: the declared view and the real one, with a red marker where they disagree (drift).

> **Status:** v0.1, in active development. Scope is intentionally narrow — see [SPEC.md](./SPEC.md).

---

## What it does

Cenote has two surfaces that share one resource graph.

### 1. Reconciliation — AWS ↔ Terraform

1. **Shadow infra** — what lives in AWS but is **not** declared in Terraform.
2. **Drift** — what differs between Terraform and AWS, field by field.
3. **Authorship** — **who** created a resource and how (Console / Terraform / CLI / SDK), mined from CloudTrail.

Browse it as a **Dashboard**, an interactive **Graph**, or a snapshot-to-snapshot **Diff**.

### 2. Terraform architecture diagram — from a `.tf` zip

Drop a zip of `.tf` files and get a rendered architecture diagram. No state file, no AWS account required for the baseline view.

- **Plan mode** runs `terraform init + plan + show` inside the container, so modules, `count`, `for_each`, and variables are fully expanded and every node is labelled with its planned action (**create** vs **existing**).
- **HCL fallback** parses the raw `.tf` directly when a plan can't run (no credentials, providers unavailable) — every managed resource plus the `data` sources the stack plugs into still render.
- **Distinct service icons** per AWS service and a **click-to-inspect panel** showing each resource's key configuration (ports, CPU/memory, health checks, scaling bounds, alarm thresholds…) and its relationships.
- **GitLab variable resolution** — point Cenote at a GitLab project/group and it pulls the **non-masked** `TF_VAR_*` CI/CD variables to resolve `var.*` to real values, then reports which required variables GitLab does and doesn't cover (a pre-deploy gap check). See [Terraform diagram](#terraform-diagram-detail).

---

## Stack

- **Backend** — Python 3.11 · FastAPI · DuckDB · boto3 · python-hcl2 · Terraform CLI (bundled in the image)
- **Frontend** — React 18 · Vite · TypeScript · React Flow · Tailwind · Framer Motion · Phosphor Icons · Zustand
- **Deploy** — Docker Compose **or** Podman (auto-detected by `scripts/up.sh`)

## Quick start

```bash
git clone https://github.com/eyrockscript/cenote.git
cd cenote
cp .env.example .env          # set AWS_PROFILE / AWS_REGION (and optionally CENOTE_SECRET_KEY)
scripts/up.sh up --build      # auto-detects docker / podman / podman-compose
```

Or pick the runtime explicitly:

```bash
docker compose up --build     # Docker Engine v2 plugin
podman compose up --build     # Podman v4+
podman-compose up --build     # Python podman-compose
```

Then open:

- API → http://localhost:8000/docs
- Web → http://localhost:5173

### Podman notes

- **Rootless Podman** works out of the box on macOS and Linux.
- On **SELinux** systems (Fedora/RHEL) volume mounts may need a `:z`/`:Z` label; rootless Podman ignores them safely.
- `~/.aws` is mounted **read-only**.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `AWS_PROFILE` | `default` | Profile used by the scanner (mounted read-only from `~/.aws`). |
| `AWS_REGION` | `us-east-1` | Default region for scans. |
| `CENOTE_DB_PATH` | `/data/cenote.duckdb` | DuckDB path on the persistent volume. |
| `CENOTE_LOG_LEVEL` | `INFO` | Log verbosity. |
| `CENOTE_SECRET_KEY` | _(auto-generated)_ | Master key for the encrypted credential store. If unset, a key is generated and persisted on the `/data` volume. Set it to keep the key off the volume. |
| `TF_DIR` | `./tf` | Host directory of `.tf` files mounted into the container for planning. |

### Saved credentials (encrypted, server-side)

Instead of pasting AWS keys and a GitLab token on every diagram run, configure them once from the **TF Diagram** screen. They are **Fernet-encrypted at rest** on the `/data` volume — never stored in the browser — and the plan endpoint falls back to them when a request omits credentials. Only a non-sensitive status (configured? region? project? masked key tail) is ever returned to the client. Encryption works identically under Docker and rootless Podman.

## Terraform diagram (detail)

| Path | AWS creds | Output |
|---|---|---|
| **Plan** | optional | Full resolution: modules, `count`, `for_each`, and variables expanded; per-node `create` / `existing` action. Credentials let `data` sources resolve against live AWS. |
| **HCL fallback** | none | Every managed resource + catalogued `data` sources, with inferred edges. No variable resolution. |

**GitLab variables.** Provide a project and/or group path plus a token with the `api` scope (Maintainer+ to read CI/CD variables). Cenote reads only `masked: false` variables (the platform's own non-sensitive flag), maps `TF_VAR_<name>` → `var.<name>` (project overrides group, `environment_scope` honored), feeds them into the plan, and returns a coverage report flagging any required `TF_VAR_*` that GitLab does not define.

## Supported resource types

Reconciliation (scanner + TF parser + drift table + CloudTrail event) covers 13 types end-to-end:

| Network | Compute | Storage | Data |
|---|---|---|---|
| VPC, Subnet, Security Group | EC2 Instance, Lambda | EBS Volume, S3 Bucket | RDS Instance |
| Route Table, Internet Gateway, NAT Gateway | | | |
| Load Balancer, Target Group | | | |

The **Terraform diagram renders every resource type** (managed resources and catalogued `data` sources), not just these 13 — uncatalogued types get a generic icon and label so a real stack of ECS, IAM, CloudWatch, autoscaling, etc. shows up in full.

## Cost in AWS

**$0 USD/month** with the default configuration — only free APIs are used, and a plan never mutates infrastructure.

| API | Cost | Used by |
|---|---|---|
| `ec2:Describe*`, `rds:Describe*`, … | Free | scanner |
| `tag:GetResources` | Free | scanner accelerator |
| `cloudtrail:LookupEvents` | Free (90-day window) | authorship miner |
| `sts:GetCallerIdentity` | Free | credential check |

No AWS Config, no Cost Explorer, no Athena in v0.1. See `scripts/iam-policy.json` for the minimal read-only IAM policy.

## Repository layout

```
cenote/
├── SPEC.md                     # focused scope document
├── docker-compose.yml          # works with docker compose & podman compose
├── .env.example
├── backend/                    # FastAPI + DuckDB + boto3
│   ├── cenote/
│   │   ├── api/                # FastAPI endpoints
│   │   ├── core/               # models, arn, drift, reconciler, diff, scan,
│   │   │                       #   tf_diagram, plan_diagram
│   │   ├── scanners/           # aws, terraform, tf_hcl, cloudtrail, gitlab_vars
│   │   ├── security/           # encrypted credential store
│   │   ├── store/              # duckdb persistence
│   │   └── catalogs/           # supported types, drift fields, create events
│   └── tests/                  # pytest + moto fixtures
├── web/                        # React + Vite
│   ├── src/
│   │   ├── routes/             # Dashboard, GraphView, DiffView, TFDiagram
│   │   ├── components/         # Shell, AwsResourceNode, ResourceDetailPanel,
│   │   │                       #   AwsServiceIcon, ContainerNode, …
│   │   ├── lib/                # api, store (zustand), layout (dagre), cn
│   │   └── types/              # Graph types
│   └── public/brand/           # logo, mark, mark-light, favicon
├── brand/                      # brand guidelines
└── scripts/
    ├── up.sh                   # runtime-detecting compose wrapper
    ├── iam-policy.json         # minimal read-only AWS IAM
    └── generate-favicons.js    # favicon family from mark.svg
```

## Why Cenote

| | Cenote | Firefly | Cloudcraft / Hava |
|---|---|---|---|
| Self-hosted, simple | yes | partial | yes |
| Open source | yes (license TBD) | no | no |
| TF + AWS + CloudTrail unified | yes | yes | no |
| Pre-apply diff viewer | yes | partial | no |
| Diagram from `.tf` (no state) | yes | partial | partial |
| $0 in AWS by default | yes | requires agent | yes |
| Multi-cloud | no (by focus) | yes | partial |

## Roadmap

See [SPEC.md §5](./SPEC.md) for the roadmap. After the drift-detection phase there is a **mandatory validation gate** with three real users before investing further.

## License

To be decided before public release (BSL or Apache 2.0).
