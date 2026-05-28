import { memo } from "react";
import { Handle, Position, type NodeProps } from "reactflow";
import { AwsServiceIcon, TYPE_TO_LABEL } from "@/components/AwsServiceIcon";
import type { Resource } from "@/types/graph";
import { cn } from "@/lib/cn";

/**
 * Card used in the TF Diagram view. Mirrors `ResourceNode`'s outer shape so
 * the hierarchical layout's width/height constants stay valid, but swaps the
 * Phosphor glyph for the official-style AWS service tile and drops drift /
 * authorship affordances (which don't exist for planned resources).
 */

interface NodeData {
  resource: Resource;
  dimmed?: boolean;
  highlighted?: boolean;
}

function _AwsResourceNode({ data, selected }: NodeProps<NodeData>) {
  const { resource, dimmed, highlighted } = data;
  const label = TYPE_TO_LABEL[resource.type] ?? resource.type;

  return (
    <div
      className={cn(
        "relative rounded-2xl border bg-white border-slate-200 transition-all px-3 py-2 w-[170px]",
        selected || highlighted
          ? "shadow-[0_10px_24px_-8px_rgba(0,0,0,0.22)] -translate-y-[1px] border-slate-300"
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
        <div className="min-w-0">
          <div className="text-[10px] font-mono uppercase tracking-wider text-neutral-500 truncate leading-none">
            {label}
          </div>
          <div className="text-[12px] font-medium truncate leading-tight text-neutral-900 mt-1">
            {resource.name}
          </div>
        </div>
      </div>

      {Object.keys(resource.tags || {}).length > 0 && (
        <div className="mt-1 flex items-center gap-1 flex-wrap">
          {Object.entries(resource.tags)
            .slice(0, 1)
            .map(([k, v]) => (
              <span
                key={k}
                className="text-[10px] font-mono text-neutral-500 truncate max-w-full"
              >
                {k}={v}
              </span>
            ))}
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
