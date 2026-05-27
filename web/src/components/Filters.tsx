import { motion } from "framer-motion";
import { cn } from "@/lib/cn";
import { useStore } from "@/lib/store";

export function Filters({ types }: { types: string[] }) {
  const filter = useStore((s) => s.filter);
  const setFilter = useStore((s) => s.setFilter);

  return (
    <div className="rounded-2xl border border-slate-200/60 bg-white p-3 flex flex-wrap items-center gap-1.5">
      <Toggle
        active={filter.showDriftOnly}
        onClick={() => setFilter({ showDriftOnly: !filter.showDriftOnly })}
        label="Drift only"
        tone="danger"
      />
      <Toggle
        active={filter.showOrphansOnly}
        onClick={() => setFilter({ showOrphansOnly: !filter.showOrphansOnly })}
        label="Orphans only"
        tone="warn"
      />
      <div className="mx-2 h-5 w-px bg-slate-200" />
      <Toggle
        active={filter.type === null}
        onClick={() => setFilter({ type: null })}
        label="All"
      />
      {types.map((t) => (
        <Toggle
          key={t}
          active={filter.type === t}
          onClick={() => setFilter({ type: filter.type === t ? null : t })}
          label={t.replace("aws_", "")}
        />
      ))}
    </div>
  );
}

function Toggle({
  active,
  onClick,
  label,
  tone = "neutral",
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  tone?: "neutral" | "danger" | "warn";
}) {
  const toneActive: Record<string, string> = {
    neutral: "bg-neutral-900 text-white",
    danger: "bg-red-500 text-white",
    warn: "bg-amber-500 text-white",
  };
  return (
    <motion.button
      whileTap={{ scale: 0.95 }}
      onClick={onClick}
      className={cn(
        "rounded-full px-3 py-1 text-[11px] font-medium transition-colors",
        active ? toneActive[tone] : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200",
      )}
    >
      {label}
    </motion.button>
  );
}
