import { memo } from "react";
import { type NodeProps } from "reactflow";
import { cn } from "@/lib/cn";
import { BoundingBox, Square, Globe } from "@phosphor-icons/react";

interface ContainerData {
  kind: "vpc" | "subnet" | "global";
  title: string;
  subtitle?: string;
  badge?: string;
}

const STYLES = {
  vpc: {
    wrapper: "border-2 border-sky-200/70 bg-sky-50/30",
    title: "text-sky-900",
    subtitle: "text-sky-700/70",
    iconBg: "bg-sky-100 text-sky-700",
    Icon: BoundingBox,
  },
  subnet: {
    wrapper: "border border-dashed border-slate-300 bg-white/50",
    title: "text-neutral-800",
    subtitle: "text-neutral-500",
    iconBg: "bg-neutral-100 text-neutral-600",
    Icon: Square,
  },
  global: {
    wrapper: "border-2 border-neutral-200 bg-neutral-50/50 border-dashed",
    title: "text-neutral-800",
    subtitle: "text-neutral-500",
    iconBg: "bg-neutral-100 text-neutral-600",
    Icon: Globe,
  },
} as const;

function _ContainerNode({ data }: NodeProps<ContainerData>) {
  const s = STYLES[data.kind];
  const Icon = s.Icon;
  return (
    <div
      className={cn(
        "w-full h-full rounded-[2rem] relative overflow-hidden",
        s.wrapper,
      )}
    >
      <div className="absolute top-3 left-4 right-4 flex items-center justify-between pointer-events-none">
        <div className="flex items-center gap-2">
          <span className={cn("inline-flex items-center justify-center w-6 h-6 rounded-lg", s.iconBg)}>
            <Icon size={13} weight="duotone" />
          </span>
          <div>
            <div className={cn("text-[12px] font-semibold tracking-tight", s.title)}>
              {data.title}
            </div>
            {data.subtitle && (
              <div className={cn("text-[10px] font-mono", s.subtitle)}>{data.subtitle}</div>
            )}
          </div>
        </div>
        {data.badge && (
          <span className="text-[10px] font-mono text-neutral-500 bg-white/70 backdrop-blur-sm rounded-md px-1.5 py-0.5">
            {data.badge}
          </span>
        )}
      </div>
    </div>
  );
}

export const ContainerNode = memo(_ContainerNode);
