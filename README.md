# Cenote

> Unified AWS + Terraform graph. Drift detection, diff viewer, and authorship attribution. Self-hosted, read-only, **$0 in AWS** by default.

A cenote is a natural sinkhole that reveals groundwater hiding below the surface — the same way this tool reveals the AWS resources hiding behind what Terraform declares.

**Status:** v0.1 in development. Scope is intentionally narrow — see [SPEC.md](./SPEC.md).

## Three questions it answers

1. What resources live in AWS but are **not** declared in Terraform? (shadow infra)
2. What resources have **drift** between Terraform and AWS? (field by field)
3. **Who** created this resource and how? (Console / Terraform / CLI / SDK)

## Stack

- **Backend:** Python 3.11 · FastAPI · DuckDB · boto3 · python-hcl2
- **Frontend:** React 18 · Vite · TypeScript · React Flow · Tailwind · Framer Motion · Phosphor Icons · Zustand
- **Deploy:** Docker Compose **or** Podman (auto-detected via `scripts/up.sh`)

## Quick start

```bash
git clone https://github.com/eyrockscript/cenote.git
cd cenote
cp .env.example .env          # set your AWS_PROFILE / AWS_REGION
scripts/up.sh up --build      # auto-detects docker / podman / podman-compose
```

Or manually:

```bash
docker compose up --build     # Docker Engine v2 plugin
podman compose up --build     # Podman v4+
podman-compose up --build     # Python podman-compose
```

Then:
- API → http://localhost:8000/docs
- Web → http://localhost:5173

### Podman notes

- **Rootless Podman** works out of the box on macOS and Linux.
- On **SELinux** systems (Fedora/RHEL), volume mounts may need a `:z` or `:Z` label; rootless Podman ignores them safely.
- The `~/.aws` volume is mounted **read-only**.

## What's in v0.1

13 supported AWS resource types, each covered end-to-end (scanner + TF parser + drift table + CloudTrail event):

| Network | Compute | Storage | Data |
|---|---|---|---|
| VPC, Subnet, Security Group | EC2 Instance, Lambda | EBS Volume, S3 Bucket | RDS Instance |
| Route Table, Internet Gateway | | | |
| NAT Gateway, Load Balancer, Target Group | | | |

## Cost in AWS

**$0 USD/month** with the default configuration. Only free APIs are used:

| API | Cost | Used by |
|---|---|---|
| `ec2:Describe*`, `rds:Describe*`, etc. | Free | scanner |
| `tag:GetResources` | Free | scanner accelerator |
| `cloudtrail:LookupEvents` | Free (90-day window) | authorship miner |

No AWS Config, no Cost Explorer, no Athena in v0.1.

## IAM policy

See `scripts/iam-policy.json` for the minimal read-only policy.

## Repository layout

```
cenote/
├── SPEC.md                    # focused scope document
├── README.md
├── docker-compose.yml         # works with docker compose & podman compose
├── .env.example
├── backend/                   # FastAPI + DuckDB + boto3
│   ├── cenote/
│   │   ├── api/               # FastAPI endpoints
│   │   ├── core/              # models, arn, drift, reconciler, diff, scan
│   │   ├── scanners/          # aws, terraform, cloudtrail
│   │   ├── store/             # duckdb persistence
│   │   └── catalogs/          # supported types, drift fields, create events
│   └── tests/                 # pytest + moto fixtures
├── web/                       # React + Vite
│   ├── src/
│   │   ├── routes/            # Dashboard, GraphView, DiffView
│   │   ├── components/        # Shell, MetricCard, ResourceNode, ...
│   │   ├── lib/               # api, store (zustand), layout (dagre), cn
│   │   └── types/             # Graph types
│   └── public/
│       └── brand/             # logo, mark, mark-light, favicon, og-image
├── brand/                     # brand guidelines
└── scripts/
    ├── up.sh                  # runtime-detecting compose wrapper
    ├── iam-policy.json        # minimal read-only AWS IAM
    └── generate-favicons.js   # generate favicon family from mark.svg
```

## Roadmap

See [SPEC.md §5](./SPEC.md) for the 10-week roadmap.

After Phase 3 (drift detection) there is a **mandatory validation gate** with 3 real users before investing in Phase 4+.

## Why Cenote (vs Firefly, Cloudcraft, Hava)

| | Cenote | Firefly | Cloudcraft / Hava |
|---|---|---|---|
| Self-hosted simple | yes | partial | yes |
| Open source | yes (BSL planned) | no | no |
| TF + AWS + CloudTrail unified | yes | yes | no |
| Diff viewer pre-apply | yes | partial | no |
| $0 in AWS default | yes | requires agent | yes |
| Multi-cloud | no (focus) | yes | partial |

## License

To be decided before public release (BSL or Apache 2.0).
