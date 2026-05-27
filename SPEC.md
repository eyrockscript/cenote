# Cenote v0.1 — Spec recortado (drift + diff + autoría)

> Versión enfocada del spec original. Elimina 3D, cost engine y SaaS multi-tenant del MVP.
> Objetivo: **una sola cosa hecha brutalmente bien** antes de expandir alcance.

---

## 0. Tesis

**Tres preguntas que hoy nadie responde bien para un equipo con AWS + Terraform:**

1. ¿Qué recursos vivos en AWS NO están en Terraform? (huérfanos / shadow infra)
2. ¿Qué recursos en Terraform NO coinciden con AWS? (drift)
3. ¿Quién creó este recurso y cómo? (consola vs IaC vs CLI)

Cenote v0.1 responde estas tres con una vista 2D navegable y un diff viewer estilo PR.
Nada más. Sin 3D. Sin cost overlay. Sin multi-cuenta. Sin SaaS.

---

## 1. Alcance v0.1

### IN
- AWS scanner read-only (boto3 + Tagging API). Una cuenta, una región.
- Terraform parser: `tfstate` + `plan -json`.
- CloudTrail miner (Lookup API, 90 días).
- Reconciliador TF↔AWS.
- Drift detection campo a campo con tabla de severidades.
- Vista 2D (React Flow) con agrupación VPC/Subnet.
- Diff viewer estilo PR review.
- Atribución de autoría (`via`: Console/Terraform/CLI/SDK/Unknown).
- 13 tipos de recurso cubiertos al **100%** (no parcialmente).
- `docker-compose up` arranca todo.

### OUT (explícito)
- ❌ Vista 3D (post-validación de mercado).
- ❌ Cost engine / Pricing API (post-validación).
- ❌ AWS Config Modo C (post-validación).
- ❌ Athena CloudTrail Modo B (post-validación).
- ❌ Multi-cuenta / multi-región (v0.2).
- ❌ SaaS multi-tenant (después del bootstrap).
- ❌ SSO, RBAC, audit log.

### Razón del recorte
- Cada feature fuera del trío drift/diff/autoría es trabajo que NO valida la tesis.
- El 3D es demo; el comprador empresarial no compra por demos.
- Cost engine sin Cost Explorer es estimado y miente; con Cost Explorer cuesta dinero al cliente.
- Validación primero, expansión después.

---

## 2. 13 Tipos de recurso (cobertura 100%)

Cada tipo requiere implementación completa de **5 piezas**:

1. **AWS scanner** — `describe_*` → normalización a `Resource.aws_state`.
2. **TF parser** — `tf_to_arn(resource)` determinístico.
3. **Drift fields** — tabla de campos relevantes + severidad.
4. **CloudTrail event** — evento de creación + path al ID en `responseElements`.
5. **Edges** — relaciones inferidas del `describe_*`.

| # | Tipo | Servicio | Edges típicos |
|---|---|---|---|
| 1 | `aws_vpc` | EC2 | contains: subnets, route_tables, igw |
| 2 | `aws_subnet` | EC2 | in: vpc; routes: route_table |
| 3 | `aws_security_group` | EC2 | references: sg; in: vpc |
| 4 | `aws_route_table` | EC2 | routes_to: igw/nat; associated: subnet |
| 5 | `aws_internet_gateway` | EC2 | attached: vpc |
| 6 | `aws_nat_gateway` | EC2 | in: subnet; uses: eip |
| 7 | `aws_instance` | EC2 | in: subnet; uses: sg; volumes: ebs |
| 8 | `aws_ebs_volume` | EC2 | attached: instance |
| 9 | `aws_lb` (ALB/NLB) | ELBv2 | in: subnet; uses: sg; targets: tg |
| 10 | `aws_lb_target_group` | ELBv2 | targets: instances/lambdas |
| 11 | `aws_db_instance` | RDS | in: subnet_group; uses: sg |
| 12 | `aws_s3_bucket` | S3 | (sin policies en v0.1) |
| 13 | `aws_lambda_function` | Lambda | in: vpc; role: iam |

**Definición de "100%":**
- Todos los campos relevantes del recurso aparecen en `aws_state`.
- El drift compara TODOS los campos de la tabla `DRIFT_FIELDS` para ese tipo.
- El parser TF maneja `count`, `for_each`, y módulos.
- El CloudTrail miner encuentra autoría para >95% de recursos creados en los últimos 90 días.
- Tests con fixtures reales (tfstate + boto3 mock) cubren cada tipo.

---

## 3. Arquitectura (sin cambios respecto al original)

```
┌───────────────┐  ┌───────────────┐  ┌───────────────┐
│ scanner-aws   │  │ scanner-tf    │  │ scanner-ct    │
└───────┬───────┘  └───────┬───────┘  └───────┬───────┘
        └────────────┬─────┴────────────┬─────┘
                     ▼                  ▼
              ┌────────────┐    ┌────────────┐
              │ reconciler │ →  │   drift    │
              └────────────┘    └────────────┘
                     │
                     ▼
              ┌────────────┐
              │  DuckDB    │ (snapshots)
              └────────────┘
                     │
                     ▼
              ┌────────────┐
              │  FastAPI   │
              └─────┬──────┘
                    │
              ┌─────▼──────┐
              │  React +   │
              │ React Flow │
              └────────────┘
```

Stack idéntico al spec original (FastAPI, DuckDB, React, React Flow, Vite, Tailwind, shadcn/ui, Zustand).

---

## 4. Modelo de datos (recortado)

```python
class Resource:
    id: str                        # ARN canónico
    type: str                      # aws_instance, etc.
    name: str
    region: str
    account_id: str

    tf_state: dict | None          # solo si está en TF
    aws_state: dict | None         # solo si vive en AWS
    drift: list[DriftField]        # vacío si no hay drift

    author: Author | None          # de CloudTrail
    tags: dict[str, str]
    containers: dict               # vpc_id, subnet_id, az
    blast_radius: int              # se mantiene, es trivial

    # eliminados respecto al spec original:
    # ❌ cost: ...
```

```python
class Edge:
    source: str
    target: str
    type: str
    metadata: dict
    discovered_via: str
```

---

## 5. Roadmap recortado (10 semanas, 10h/sem)

### Fase 0 — Foundation (sem 1)
- Repo, docker-compose, pyproject.toml, README.
- Pydantic models: Resource, Edge, Snapshot.
- DuckDB schema + migraciones.
- FastAPI con `/health`.
- Frontend scaffold (Vite + React + Tailwind + shadcn).
- CI básico.

**Deliverable:** `docker-compose up` boot completo, página vacía.

### Fase 1 — AWS scanner para 13 tipos (sem 2-4)
- 3 tipos por semana, cada uno con tests.
- Tagging API + boto3 paralelizado.
- Edge inference completa para cada tipo.
- Endpoint `POST /api/scan`.

**Deliverable:** apuntas a tu cuenta, ves los 13 tipos dibujados en 2D crudo.

### Fase 2 — Terraform parser + reconciliador (sem 5-6)
- Parser `tfstate` + `plan -json`.
- `tf_to_arn` para los 13 tipos.
- Manejo de `count`, `for_each`, módulos.
- Reconciliador con matching por ARN.
- Estados: solo-AWS / solo-TF / ambos / drift.

**Deliverable:** subes tu tfstate, ves huérfanos y matched.

### Fase 3 — Drift detection (sem 7)
- `DRIFT_FIELDS` para los 13 tipos con severidad.
- Color encoding en UI (rojo = drift, amarillo = solo-AWS, gris = solo-TF, verde = match).
- Filtro "solo con drift".
- Hover card con drift campo a campo.

**Deliverable:** filtras por drift, ves exactamente qué cambió y dónde.

### Fase 4 — CloudTrail autoría (sem 8)
- `cloudtrail:LookupEvents` con batching por evento.
- Tabla `CREATE_EVENTS` para los 13 tipos.
- Inferencia de `via` desde userAgent + sessionIssuer.
- Cache local en SQLite.
- UI: columna "creado por" + filtro por autor.

**Deliverable:** ves quién creó cada recurso y cómo (Console vs Terraform).

### Fase 5 — Diff viewer (sem 9)
- Endpoint `GET /api/snapshots/{a}/diff/{b}`.
- UI estilo PR: panel izq/der, colores verde/rojo/amarillo/gris.
- Importar `terraform plan -json` como snapshot virtual.
- Botón "ver en grafo" desde diff.

**Deliverable:** review visual de un plan pre-apply.

### Fase 6 — Polish + release (sem 10)
- Docs: instalación, política IAM, casos de uso.
- README con GIFs de las 3 features clave.
- Video demo 60s (drift en acción).
- Landing simple en Cloudflare Pages.
- Publicar: GitHub, r/Terraform, r/devops, HN, dev.to.

**Deliverable:** público.

---

## 6. Definición de "brutalmente bien" para v0.1

Lo que diferencia v0.1 de un fork-de-Cartography:

1. **Cero falsos positivos en drift.** Si la UI dice "drift", hay drift real. Tabla de campos curada a mano por tipo.
2. **Reconciliador robusto con módulos TF.** No falla con `module.x.aws_instance.y[0]`.
3. **CloudTrail mining eficiente.** Una pasada por evento, no por recurso. Cache persistente.
4. **Diff viewer que ahorra tiempo real.** Importas un plan, en 5 segundos ves qué va a cambiar.
5. **Setup en 5 minutos.** `docker-compose up` + AWS profile + URL. Sin más.
6. **Tests con cuentas reales.** Cada tipo tiene fixture de tfstate + dump boto3.

---

## 7. Validación a buscar antes de Fase 4

**Después de Fase 3, antes de invertir en CloudTrail mining**, validar con 3 usuarios reales:

- ¿El drift detection identifica algo que NO sabían?
- ¿Cuánto tiempo dicen que les ahorra al mes?
- ¿Pagarían $X por esto self-hosted? ¿Cuánto es X?

Si las respuestas son tibias → pivot o detener.
Si son entusiastas → seguir con Fase 4.

**Esta es la regla de oro:** no construir Fase 4+ hasta tener señal de que Fases 1-3 generan valor real.

---

## 8. Lo que SÍ vuelve (después de validación)

Cuando v0.1 tenga 3-5 usuarios pagando o 500+ GitHub stars con engagement:

- **Cost engine** — porque ya hay alguien que va a usarlo.
- **3D cost towers** — porque ya hay material para una demo viral.
- **Multi-cuenta** — porque ya alguien tiene 5 cuentas.
- **SaaS hosted** — porque ya validaste que pagan.

No antes.

---

## 9. Diferenciadores defensibles vs Firefly.ai

Firefly hace drift detection multi-cloud, IaC reconciliation, cobertura amplia. Es competidor real.

**Lo que v0.1 puede hacer mejor (porque es más enfocado):**

1. **Self-hosted simple.** Firefly es SaaS principalmente. Algunas empresas no pueden mandar metadata fuera.
2. **Open source con BSL.** Firefly es closed. Para equipos pequeños/medianos esto importa.
3. **Diff visual pre-apply.** Firefly se enfoca en detección, no en review. Hay hueco aquí.
4. **Cero costo en AWS.** Firefly requiere su agente. Cenote solo boto3.
5. **Focus en AWS + Terraform.** Firefly multi-cloud → "jack of all, master of none". Cenote profundo en una vertical.

Esto es lo que se vende. No "tenemos 3D".
