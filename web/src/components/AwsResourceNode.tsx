import { memo } from "react";
import { Handle, Position, type NodeProps } from "reactflow";
import { AwsServiceIcon, prettyTypeLabel } from "@/components/AwsServiceIcon";
import type { PlannedAction, Resource } from "@/types/graph";
import { cn } from "@/lib/cn";

/**
 * Card used in the TF Diagram view. Designed so a non-author can read the
 * diagram at a glance:
 *   - A prominent verb badge says exactly what terraform will do (Create /
 *     Update / Delete) — or "Existing" for data sources that already live in
 *     AWS and are only being referenced.
 *   - "Existing" cards are drawn as muted, dashed "ghosts" so new resources
 *     visually pop and you can see where the stack plugs into current infra.
 *   - A key attribute (CIDR, instance type, bucket, …) makes each card
 *     self-explanatory without opening the detail panel.
 */

interface NodeData {
  resource: Resource;
  dimmed?: boolean;
  highlighted?: boolean;
}

interface ActionMeta {
  verb: string;
  badge: string; // pill bg+text
  border: string;
  ghost: boolean; // dashed/muted = already exists
}

const ACTION_META: Record<PlannedAction, ActionMeta> = {
  create: { verb: "Create", badge: "bg-emerald-100 text-emerald-800", border: "border-emerald-300 ring-1 ring-emerald-200/60", ghost: false },
  update: { verb: "Update", badge: "bg-amber-100 text-amber-800", border: "border-amber-300 ring-1 ring-amber-200/60", ghost: false },
  delete: { verb: "Delete", badge: "bg-red-100 text-red-800", border: "border-red-300 ring-1 ring-red-200/60", ghost: false },
  read: { verb: "Existing", badge: "bg-slate-200 text-slate-700", border: "border-slate-300 border-dashed", ghost: true },
  "no-op": { verb: "No change", badge: "bg-slate-100 text-slate-600", border: "border-slate-200", ghost: false },
};

// HCL fallback (no plan run) — we can't say what terraform would do.
const NEUTRAL_META: ActionMeta = {
  verb: "Planned",
  badge: "bg-slate-100 text-slate-600",
  border: "border-slate-200",
  ghost: false,
};

function _AwsResourceNode({ data, selected }: NodeProps<NodeData>) {
  const { resource, dimmed, highlighted } = data;
  const meta = resource.planned_action ? ACTION_META[resource.planned_action] : NEUTRAL_META;
  const label = prettyTypeLabel(resource.type);
  const detail = keyAttr(resource);

  return (
    <div
      className={cn(
        "relative rounded-2xl border px-3 py-2.5 w-[210px] transition-all",
        meta.border,
        meta.ghost ? "bg-slate-50" : "bg-white",
        selected || highlighted
          ? "shadow-[0_10px_24px_-8px_rgba(0,0,0,0.22)] -translate-y-[1px]"
          : "shadow-[0_2px_6px_-2px_rgba(0,0,0,0.06)]",
        dimmed && "opacity-30",
      )}
    >
      <Handle type="target" position={Position.Top} className="!w-1 !h-1 !bg-neutral-300 !border-0" />

      <div className="flex items-start gap-2">
        <AwsServiceIcon type={resource.type} size={26} className={cn(meta.ghost && "opacity-60")} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-1">
            <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-500 truncate" title={label}>
              {label}
            </span>
            <span
              className={cn(
                "shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide",
                meta.badge,
              )}
            >
              {meta.verb}
            </span>
          </div>
          <div
            className={cn(
              "text-[13px] font-semibold truncate leading-tight mt-0.5",
              meta.ghost ? "text-neutral-600" : "text-neutral-900",
            )}
            title={resource.name}
          >
            {resource.name}
          </div>
          {detail && (
            <div className="text-[10px] font-mono text-neutral-400 truncate mt-0.5" title={detail}>
              {detail}
            </div>
          )}
        </div>
      </div>

      <Handle type="source" position={Position.Bottom} className="!w-1 !h-1 !bg-neutral-300 !border-0" />
    </div>
  );
}

/** A single representative attribute per resource type, so the card explains
 *  itself. For data sources (existing infra) the resolved id is shown. */
function keyAttr(r: Resource): string | null {
  const a = r.tf_state?.attributes ?? {};
  const pick = (...keys: string[]): string | null => {
    for (const k of keys) {
      const v = a[k];
      if (typeof v === "string" && v.trim()) return v.length > 32 ? `${v.slice(0, 31)}…` : v;
      if (typeof v === "number") return String(v);
    }
    return null;
  };
  switch (r.type) {
    case "aws_vpc":
    case "aws_subnet":
      return pick("cidr_block", "id");
    case "aws_instance":
      return pick("instance_type");
    case "aws_db_instance":
      return pick("engine", "instance_class");
    case "aws_lambda_function":
      return pick("runtime", "handler");
    case "aws_s3_bucket":
      return pick("bucket", "id");
    case "aws_lb":
      return pick("load_balancer_type", "name");
    case "aws_ebs_volume": {
      const size = pick("size");
      return size ? `${size} GiB` : null;
    }
    default:
      return pick("name", "id", "identifier", "function_name", "bucket", "arn");
  }
}

export const AwsResourceNode = memo(_AwsResourceNode);
