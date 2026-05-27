import { motion } from "framer-motion";
import { CheckIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import { useStore } from "@/lib/store";

export function SnapshotPicker() {
  const snapshots = useStore((s) => s.snapshots);
  const selected = useStore((s) => s.selectedSnapshotId);
  const setSelected = useStore((s) => s.setSelectedSnapshotId);

  if (snapshots.length === 0) return null;

  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-2">
      {snapshots.map((s) => {
        const active = s.id === selected;
        return (
          <motion.button
            key={s.id}
            layout
            onClick={() => setSelected(s.id)}
            whileTap={{ scale: 0.97 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            className={cn(
              "relative rounded-2xl border px-4 py-2.5 text-left min-w-[180px] transition-colors",
              active
                ? "border-neutral-900 bg-neutral-900 text-white"
                : "border-slate-200 bg-white hover:border-neutral-300",
            )}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="font-mono text-[11px] opacity-80">{s.id.slice(0, 12)}</span>
              {active && <CheckIcon size={12} />}
            </div>
            <div className="mt-1 text-[12px] tabular-nums">
              {s.resource_count} resources · {s.drift_count} drift
            </div>
            <div className={cn("text-[10px] mt-0.5", active ? "text-white/60" : "text-neutral-500")}>
              {new Date(s.created_at).toLocaleString()}
            </div>
          </motion.button>
        );
      })}
    </div>
  );
}
