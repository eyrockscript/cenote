import { useMemo } from "react";
import { X, ArrowRight, ArrowLeft } from "@phosphor-icons/react";
import { AwsServiceIcon, prettyTypeLabel } from "@/components/AwsServiceIcon";
import type { Edge, Graph, PlannedAction, Resource } from "@/types/graph";
import { cn } from "@/lib/cn";

/**
 * Slide-in inspector for a single resource. Built so an architect reviewing a
 * stack can answer "is this configured correctly?" without reading the .tf:
 *   - the action (Create / Existing / …) up top,
 *   - a curated set of the architecturally-relevant fields per type
 *     (ports, cpu/mem, health checks, scaling bounds, retention, …),
 *   - the relationships in/out of this node, resolved to readable names,
 *   - and the full raw attribute set for anything not surfaced above.
 */

interface Props {
  resource: Resource | null;
  graph: Graph;
  onClose: () => void;
}

const ACTION_BADGE: Record<PlannedAction, { label: string; cls: string }> = {
  create: { label: "Will be created", cls: "bg-emerald-100 text-emerald-800" },
  update: { label: "Will be updated", cls: "bg-amber-100 text-amber-800" },
  delete: { label: "Will be destroyed", cls: "bg-red-100 text-red-800" },
  read: { label: "Already exists", cls: "bg-slate-200 text-slate-700" },
  "no-op": { label: "No change", cls: "bg-slate-100 text-slate-600" },
};

export function ResourceDetailPanel({ resource, graph, onClose }: Props) {
  const nodesById = useMemo(
    () => new Map(graph.nodes.map((n) => [n.id, n])),
    [graph.nodes],
  );

  const rels = useMemo(() => {
    if (!resource) return { out: [], in: [] as RelItem[] };
    const out: RelItem[] = [];
    const incoming: RelItem[] = [];
    for (const e of graph.edges) {
      if (e.source === resource.id) {
        const other = nodesById.get(e.target);
        if (other) out.push({ node: other, edge: e });
      } else if (e.target === resource.id) {
        const other = nodesById.get(e.source);
        if (other) incoming.push({ node: other, edge: e });
      }
    }
    return { out, in: incoming };
  }, [resource, graph.edges, nodesById]);

  if (!resource) return null;

  const attrs = resource.tf_state?.attributes ?? {};
  const facts = keyFacts(resource.type, attrs);
  const factKeys = new Set(facts.map((f) => f.raw));
  const rest = Object.entries(attrs)
    .filter(([k, v]) => !factKeys.has(k) && isPrintable(v))
    .sort(([a], [b]) => a.localeCompare(b));
  const action = resource.planned_action ? ACTION_BADGE[resource.planned_action] : null;
  const tags = Object.entries(resource.tags ?? {});

  return (
    <aside className="absolute top-0 right-0 h-full w-[340px] bg-white border-l border-slate-200 shadow-[-12px_0_28px_-18px_rgba(0,0,0,0.25)] flex flex-col z-10">
      <header className="flex items-start gap-3 px-4 py-3.5 border-b border-slate-100">
        <AwsServiceIcon type={resource.type} size={32} />
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-mono uppercase tracking-wider text-neutral-500">
            {prettyTypeLabel(resource.type)}
          </div>
          <div className="text-[15px] font-semibold text-neutral-900 truncate leading-tight">
            {resource.name}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-lg p-1.5 text-neutral-400 hover:text-neutral-700 hover:bg-slate-100"
          aria-label="Close"
        >
          <X size={16} />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4 text-[12px]">
        {action && (
          <span className={cn("inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide", action.cls)}>
            {action.label}
          </span>
        )}

        <Section title="Address">
          <code className="block break-all rounded-lg bg-slate-50 border border-slate-200/70 px-2 py-1.5 text-[11px] font-mono text-neutral-700">
            {resource.tf_state?.address ?? resource.id.replace("tf://", "")}
          </code>
          {resource.tf_state?.module && (
            <div className="mt-1 text-[11px] text-neutral-500">
              module: <span className="font-mono">{resource.tf_state.module}</span>
            </div>
          )}
        </Section>

        {facts.length > 0 && (
          <Section title="Configuration">
            <dl className="space-y-1.5">
              {facts.map((f) => (
                <div key={f.raw} className="flex gap-2 justify-between">
                  <dt className="text-neutral-500 shrink-0">{f.label}</dt>
                  <dd className="text-neutral-900 font-medium text-right break-words min-w-0">{f.value}</dd>
                </div>
              ))}
            </dl>
          </Section>
        )}

        {(rels.out.length > 0 || rels.in.length > 0) && (
          <Section title="Relationships">
            <div className="space-y-1">
              {rels.out.map((r, i) => (
                <RelRow key={`o${i}`} item={r} direction="out" />
              ))}
              {rels.in.map((r, i) => (
                <RelRow key={`i${i}`} item={r} direction="in" />
              ))}
            </div>
          </Section>
        )}

        {tags.length > 0 && (
          <Section title="Tags">
            <div className="flex flex-wrap gap-1">
              {tags.map(([k, v]) => (
                <span key={k} className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-mono text-neutral-600">
                  {k}={v}
                </span>
              ))}
            </div>
          </Section>
        )}

        {rest.length > 0 && (
          <details className="group">
            <summary className="cursor-pointer text-[10px] font-mono uppercase tracking-wider text-neutral-500 hover:text-neutral-700 select-none">
              All attributes ({rest.length})
            </summary>
            <dl className="mt-2 space-y-1.5">
              {rest.map(([k, v]) => (
                <div key={k} className="flex gap-2 justify-between">
                  <dt className="text-neutral-500 shrink-0 font-mono text-[11px]">{k}</dt>
                  <dd className="text-neutral-700 text-right break-words min-w-0 font-mono text-[11px]">
                    {formatValue(v)}
                  </dd>
                </div>
              ))}
            </dl>
          </details>
        )}
      </div>
    </aside>
  );
}

interface RelItem {
  node: Resource;
  edge: Edge;
}

function RelRow({ item, direction }: { item: RelItem; direction: "in" | "out" }) {
  const Icon = direction === "out" ? ArrowRight : ArrowLeft;
  return (
    <div className="flex items-center gap-2 rounded-lg border border-slate-200/70 px-2 py-1.5">
      <Icon size={12} className="shrink-0 text-neutral-400" />
      <AwsServiceIcon type={item.node.type} size={18} />
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-medium text-neutral-800 truncate">{item.node.name}</div>
        <div className="text-[9px] font-mono uppercase tracking-wide text-neutral-400 truncate">
          {humanEdge(item.edge.type)}
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-[10px] font-mono uppercase tracking-wider text-neutral-500 mb-1.5">{title}</h3>
      {children}
    </section>
  );
}

// ─── per-type curated fields ────────────────────────────────────────────────

interface Fact {
  raw: string; // the source attribute key (so it's excluded from "all attributes")
  label: string;
  value: string;
}

/** Surface the architecturally-relevant fields for each type. Missing/unresolved
 *  values are skipped so the panel stays clean in HCL mode where some values are
 *  still `${var.x}`. */
function keyFacts(type: string, a: Record<string, unknown>): Fact[] {
  const out: Fact[] = [];
  const add = (raw: string, label: string, v?: unknown) => {
    const val = v === undefined ? a[raw] : v;
    const s = formatValue(val);
    if (s) out.push({ raw, label, value: s });
  };
  switch (type) {
    case "aws_vpc":
    case "aws_subnet":
      add("cidr_block", "CIDR");
      add("availability_zone", "AZ");
      break;
    case "aws_lb":
      add("load_balancer_type", "Type");
      add("internal", "Scheme", boolWord(a.internal, "internal", "internet-facing"));
      break;
    case "aws_lb_listener":
      add("port", "Port");
      add("protocol", "Protocol");
      add("ssl_policy", "SSL policy");
      add("certificate_arn", "Certificate");
      break;
    case "aws_lb_target_group":
      add("port", "Port");
      add("protocol", "Protocol");
      add("target_type", "Target type");
      if (a.health_check) add("health_check", "Health check", summarizeHealthCheck(a.health_check));
      break;
    case "aws_ecs_service":
      add("desired_count", "Desired count");
      add("launch_type", "Launch type");
      break;
    case "aws_ecs_task_definition":
      add("cpu", "CPU");
      add("memory", "Memory");
      add("network_mode", "Network mode");
      add("requires_compatibilities", "Compatibility");
      break;
    case "aws_appautoscaling_target":
      add("min_capacity", "Min capacity");
      add("max_capacity", "Max capacity");
      add("scalable_dimension", "Dimension");
      break;
    case "aws_appautoscaling_policy":
      add("policy_type", "Policy type");
      break;
    case "aws_cloudwatch_metric_alarm":
      add("metric_name", "Metric");
      add("comparison_operator", "Operator");
      add("threshold", "Threshold");
      add("evaluation_periods", "Eval periods");
      add("period", "Period (s)");
      break;
    case "aws_cloudwatch_log_group":
      add("retention_in_days", "Retention (days)");
      break;
    case "aws_instance":
      add("instance_type", "Instance type");
      add("ami", "AMI");
      break;
    case "aws_db_instance":
      add("engine", "Engine");
      add("instance_class", "Class");
      add("allocated_storage", "Storage (GiB)");
      add("multi_az", "Multi-AZ", boolWord(a.multi_az, "yes", "no"));
      break;
    case "aws_lambda_function":
      add("runtime", "Runtime");
      add("handler", "Handler");
      add("memory_size", "Memory (MB)");
      add("timeout", "Timeout (s)");
      break;
    case "aws_s3_bucket":
      add("bucket", "Bucket");
      break;
    case "aws_iam_role":
      add("name", "Role name");
      break;
    default:
      add("name", "Name");
      add("id", "ID");
  }
  return out;
}

function summarizeHealthCheck(hc: unknown): string {
  const h = unwrapBlock(hc);
  if (!h || typeof h !== "object") return "";
  const o = h as Record<string, unknown>;
  const parts: string[] = [];
  if (o.protocol) parts.push(cleanInterp(String(o.protocol)));
  if (o.port) parts.push(`:${cleanInterp(String(o.port))}`);
  if (o.path) parts.push(cleanInterp(String(o.path)));
  if (o.matcher) parts.push(`→${o.matcher}`);
  if (o.interval) parts.push(`every ${cleanInterp(String(o.interval))}s`);
  if (o.healthy_threshold && o.unhealthy_threshold) {
    parts.push(`${o.healthy_threshold}↑/${o.unhealthy_threshold}↓`);
  }
  return parts.join(" ");
}

/** A value that is exactly one `${…}` interpolation is shown as the bare
 *  expression (`${var.task_cpu}` → `var.task_cpu`) — cleaner than the braces,
 *  and still honest that it's parameterized (unresolved without a plan). */
function cleanInterp(s: string): string {
  const m = s.trim().match(/^\$\{([^}]+)\}$/);
  return m ? m[1] : s;
}

// ─── value formatting ───────────────────────────────────────────────────────

function isPrintable(v: unknown): boolean {
  return formatValue(v).length > 0;
}

function boolWord(v: unknown, t: string, f: string): string | undefined {
  if (typeof v === "boolean") return v ? t : f;
  return undefined;
}

/** hcl2 wraps single nested blocks in a one-element list; unwrap for display. */
function unwrapBlock(v: unknown): unknown {
  return Array.isArray(v) && v.length === 1 ? v[0] : v;
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") {
    const s = cleanInterp(v);
    return s.length > 60 ? `${s.slice(0, 59)}…` : s;
  }
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (Array.isArray(v)) {
    if (v.length === 0) return "";
    const flat = v.filter((x) => typeof x === "string" || typeof x === "number");
    if (flat.length === v.length) {
      const joined = flat.join(", ");
      return joined.length > 60 ? `${joined.slice(0, 59)}…` : joined;
    }
    return `${v.length} item${v.length === 1 ? "" : "s"}`;
  }
  if (typeof v === "object") {
    const keys = Object.keys(v as object);
    return keys.length ? `{ ${keys.length} field${keys.length === 1 ? "" : "s"} }` : "";
  }
  return String(v);
}

function humanEdge(t: string): string {
  const map: Record<string, string> = {
    in_vpc: "in VPC",
    in_subnet: "in subnet",
    references_sg: "uses security group",
    attached_to: "attached to",
    routes_via: "routes via",
    references: "references",
  };
  return map[t] ?? t.replace(/_/g, " ");
}
