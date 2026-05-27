import { memo } from "react";
import { Handle, Position, type NodeProps } from "reactflow";
import type { Resource, ResourceState } from "@/types/graph";
import { cn } from "@/lib/cn";

const STATE_RING: Record<ResourceState, string> = {
  matched: "ring-emerald-500/40 bg-white",
  drift: "ring-red-500/60 bg-red-50",
  tf_only: "ring-slate-400/40 bg-slate-50",
  aws_only: "ring-amber-500/50 bg-amber-50",
};

const STATE_DOT: Record<ResourceState, string> = {
  matched: "bg-emerald-500",
  drift: "bg-red-500",
  tf_only: "bg-slate-400",
  aws_only: "bg-amber-500",
};

const TYPE_LABEL: Record<string, string> = {
  aws_vpc: "VPC",
  aws_subnet: "Subnet",
  aws_security_group: "SG",
  aws_route_table: "RT",
  aws_internet_gateway: "IGW",
  aws_nat_gateway: "NAT",
  aws_instance: "EC2",
  aws_ebs_volume: "EBS",
  aws_lb: "LB",
  aws_lb_target_group: "TG",
  aws_db_instance: "RDS",
  aws_s3_bucket: "S3",
  aws_lambda_function: "λ",
};

interface NodeData {
  resource: Resource;
  state: ResourceState;
}

function _ResourceNode({ data, selected }: NodeProps<NodeData>) {
  const { resource, state } = data;
  return (
    <div
      className={cn(
        "relative rounded-2xl ring-1 transition-shadow px-3 py-2 min-w-[160px] max-w-[200px]",
        STATE_RING[state],
        selected
          ? "shadow-[0_8px_24px_-8px_rgba(0,0,0,0.18)]"
          : "shadow-[0_2px_6px_-2px_rgba(0,0,0,0.06)]",
      )}
    >
      <Handle type="target" position={Position.Top} className="!w-1.5 !h-1.5 !bg-neutral-400 !border-0" />
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-500">
          {TYPE_LABEL[resource.type] ?? resource.type}
        </span>
        <span className={cn("inline-block w-1.5 h-1.5 rounded-full", STATE_DOT[state])} />
      </div>
      <div className="text-[12px] font-medium truncate leading-tight">{resource.name}</div>
      {resource.drift.length > 0 && (
        <div className="mt-1 text-[10px] font-mono text-red-600">
          {resource.drift.length} drift{resource.drift.length > 1 ? "s" : ""}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} className="!w-1.5 !h-1.5 !bg-neutral-400 !border-0" />
    </div>
  );
}

export const ResourceNode = memo(_ResourceNode);
