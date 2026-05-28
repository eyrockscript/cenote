import { memo } from "react";
import { Handle, Position, type NodeProps } from "reactflow";
import type { Resource, ResourceState } from "@/types/graph";
import { cn } from "@/lib/cn";
import { ResourceIcon, typeCategoryClass, typeShortLabel } from "@/components/ResourceIcon";
import { AuthorBadge } from "@/components/AuthorBadge";

const STATE_BORDER: Record<ResourceState, string> = {
  matched: "border-emerald-200 bg-white",
  drift: "border-red-300 bg-red-50/60 ring-2 ring-red-300/40",
  tf_only: "border-slate-200 bg-slate-50/60 [&_*]:opacity-90 border-dashed",
  aws_only: "border-amber-200 bg-amber-50/40",
};

const STATE_DOT: Record<ResourceState, string> = {
  matched: "bg-emerald-500",
  drift: "bg-red-500",
  tf_only: "bg-slate-400",
  aws_only: "bg-amber-500",
};

interface NodeData {
  resource: Resource;
  state: ResourceState;
  dimmed?: boolean;
  highlighted?: boolean;
}

function _ResourceNode({ data, selected }: NodeProps<NodeData>) {
  const { resource, state, dimmed, highlighted } = data;
  return (
    <div
      className={cn(
        "relative rounded-2xl border transition-all px-3 py-2 w-[170px]",
        STATE_BORDER[state],
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
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className={cn(
          "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5",
          typeCategoryClass(resource.type),
        )}>
          <ResourceIcon type={resource.type} size={11} className="opacity-90" />
          <span className="text-[10px] font-mono uppercase tracking-wider leading-none">
            {typeShortLabel(resource.type)}
          </span>
        </div>
        <span
          className={cn("inline-block w-1.5 h-1.5 rounded-full shrink-0", STATE_DOT[state])}
          title={state.replace("_", " ")}
        />
      </div>

      <div className="text-[12px] font-medium truncate leading-tight text-neutral-900">
        {resource.name}
      </div>

      <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
        {resource.drift.length > 0 && (
          <span className="text-[10px] font-mono font-medium text-red-600">
            {resource.drift.length} drift{resource.drift.length > 1 ? "s" : ""}
          </span>
        )}
        {resource.author && <AuthorBadge via={resource.author.via} size="xs" />}
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        className="!w-1 !h-1 !bg-neutral-300 !border-0"
      />
    </div>
  );
}

export const ResourceNode = memo(_ResourceNode);
