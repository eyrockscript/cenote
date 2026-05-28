import { useMemo } from "react";
import { motion } from "framer-motion";
import { MagnifyingGlassIcon, XIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import { useStore } from "@/lib/store";
import { typeShortLabel } from "@/components/ResourceIcon";
import type { Resource } from "@/types/graph";

interface Props {
  resources: Resource[];
  search: string;
  onSearchChange: (v: string) => void;
}

export function Filters({ resources, search, onSearchChange }: Props) {
  const filter = useStore((s) => s.filter);
  const setFilter = useStore((s) => s.setFilter);

  const typeCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of resources) {
      map.set(r.type, (map.get(r.type) ?? 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [resources]);

  const driftCount = resources.filter((r) => r.drift.length > 0).length;
  const orphanCount = resources.filter((r) => !r.tf_state && r.aws_state).length;

  return (
    <div className="rounded-2xl border border-slate-200/70 bg-white p-3 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5 rounded-full bg-neutral-50 border border-slate-200/60 px-3 py-1.5 min-w-[260px] flex-1 max-w-md">
          <MagnifyingGlassIcon size={13} weight="regular" className="text-neutral-400 shrink-0" />
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search by name, ARN, tag…"
            className="flex-1 bg-transparent outline-none text-[12px] font-mono min-w-0"
          />
          {search && (
            <button
              onClick={() => onSearchChange("")}
              className="text-neutral-400 hover:text-neutral-700 shrink-0"
            >
              <XIcon size={11} />
            </button>
          )}
        </div>

        <Toggle
          active={filter.showDriftOnly}
          onClick={() => setFilter({ showDriftOnly: !filter.showDriftOnly })}
          label="Drift"
          count={driftCount}
          tone="danger"
        />
        <Toggle
          active={filter.showOrphansOnly}
          onClick={() => setFilter({ showOrphansOnly: !filter.showOrphansOnly })}
          label="Orphans"
          count={orphanCount}
          tone="warn"
        />
      </div>

      <div className="flex flex-wrap gap-1.5">
        <Toggle
          active={filter.type === null}
          onClick={() => setFilter({ type: null })}
          label="All types"
          count={resources.length}
        />
        {typeCounts.map(([t, c]) => (
          <Toggle
            key={t}
            active={filter.type === t}
            onClick={() => setFilter({ type: filter.type === t ? null : t })}
            label={typeShortLabel(t)}
            count={c}
          />
        ))}
      </div>
    </div>
  );
}

function Toggle({
  active,
  onClick,
  label,
  count,
  tone = "neutral",
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count?: number;
  tone?: "neutral" | "danger" | "warn";
}) {
  const TONE_ACTIVE: Record<string, string> = {
    neutral: "bg-neutral-900 text-white",
    danger: "bg-red-500 text-white",
    warn: "bg-amber-500 text-white",
  };
  return (
    <motion.button
      whileTap={{ scale: 0.95 }}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
        active ? TONE_ACTIVE[tone] : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200",
      )}
    >
      <span>{label}</span>
      {typeof count === "number" && (
        <span
          className={cn(
            "rounded-full text-[9px] font-mono px-1.5 leading-[1.4]",
            active ? "bg-white/20" : "bg-neutral-200/70 text-neutral-600",
          )}
        >
          {count}
        </span>
      )}
    </motion.button>
  );
}
