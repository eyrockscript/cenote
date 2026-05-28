import { memo } from "react";
import { Handle, Position, type NodeProps } from "reactflow";
import { AwsServiceIcon, TYPE_TO_LABEL } from "@/components/AwsServiceIcon";
import type { PlannedAction, Resource } from "@/types/graph";
import { cn } from "@/lib/cn";

/**
 * Card used in the TF Diagram view. Border + badge color encode the planned
 * action (create/update/delete/read/no-op) so a reader of the technical doc
 * can tell at a glance what terraform would do — green = create, yellow =
 * update, red = destroy, blue = data source (exists already), grey = no-op.
 */

interface NodeData {
  resource: Resource;
  dimmed?: boolean;
  highlighted?: boolean;
}

const ACTION_STYLE: Record<PlannedAction, { border: string; badge: string; label: string }> = {
  create:   { border: "border-emerald-300 ring-1 ring-emerald-200/60",
              badge: "bg-emerald-500", label: "create" },
  update:   { border: "border-amber-300 ring-1 ring-amber-200/60",
              badge: "bg-amber-500", label: "update" },
  delete:   { border: "border-red-300 ring-1 ring-red-200/60",
              badge: "bg-red-500", label: "delete" },
  read:     { border: "border-sky-300 ring-1 ring-sky-200/60",
              badge: "bg-sky-500", label: "data" },
  "no-op":  { border: "border-slate-200",
              badge: "bg-slate-400", label: "no-op" },
};

// Used when the graph was produced by the raw-HCL fallback (no plan run),
// so we can't say what terraform would do.
const NEUTRAL_STYLE = { border: "border-slate-200", badge: "bg-slate-300", label: "planned" };

function _AwsResourceNode({ data, selected }: NodeProps<NodeData>) {
  const { resource, dimmed, highlighted } = data;
  const label = TYPE_TO_LABEL[resource.type] ?? resource.type;
  const style = resource.planned_action ? ACTION_STYLE[resource.planned_action] : NEUTRAL_STYLE;

  return (
    <div
      className={cn(
        "relative rounded-2xl border bg-white transition-all px-3 py-2 w-[170px]",
        style.border,
        selected || highlighted
          ? "shadow-[0_10px_24px_-8px_rgba(0,0,0,0.22)] -translate-y-[1px]"
          : "shadow-[0_2px_6px_-2px_rgba(0,0,0,0.06)]",
        dimmed && "opacity-30",
      )}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!w-1 !h-1 !bg-neutral-300 !border-0"
      />

      <div className="flex items-center gap-2 mb-1.5">
        <AwsServiceIcon type={resource.type} size={26} />
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-mono uppercase tracking-wider text-neutral-500 truncate leading-none">
            {label}
          </div>
          <div className="text-[12px] font-medium truncate leading-tight text-neutral-900 mt-1">
            {resource.name}
          </div>
        </div>
        <span
          className={cn(
            "inline-block w-1.5 h-1.5 rounded-full shrink-0",
            style.badge,
          )}
          title={style.label}
        />
      </div>

      {resource.planned_action && (
        <div className="mt-1 text-[10px] font-mono uppercase tracking-wider text-neutral-500">
          {style.label}
        </div>
      )}

      <Handle
        type="source"
        position={Position.Bottom}
        className="!w-1 !h-1 !bg-neutral-300 !border-0"
      />
    </div>
  );
}

export const AwsResourceNode = memo(_AwsResourceNode);
