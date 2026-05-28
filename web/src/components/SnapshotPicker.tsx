import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Trash } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import { useStore } from "@/lib/store";
import { api } from "@/lib/api";
import type { Snapshot } from "@/types/graph";

const SOURCE_LABEL: Record<Snapshot["source"], string> = {
  live: "aws only",
  tfstate: "tfstate",
  plan: "plan",
};

export function SnapshotPicker() {
  const snapshots = useStore((s) => s.snapshots);
  const selected = useStore((s) => s.selectedSnapshotId);
  const setSelected = useStore((s) => s.setSelectedSnapshotId);
  const setSnapshots = useStore((s) => s.setSnapshots);

  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  if (snapshots.length === 0) return null;

  const handleDelete = async (id: string) => {
    setDeleting(true);
    try {
      await api.deleteSnapshot(id);
      const next = await api.listSnapshots();
      setSnapshots(next);
      if (selected === id) {
        setSelected(next[0]?.id ?? null);
      }
    } catch (e) {
      console.error("delete failed", e);
    } finally {
      setDeleting(false);
      setConfirmId(null);
    }
  };

  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-2">
      {snapshots.map((s) => {
        const active = s.id === selected;
        const confirming = confirmId === s.id;
        return (
          <motion.div
            key={s.id}
            layout
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            className={cn(
              "relative rounded-2xl border transition-colors group min-w-[200px]",
              active
                ? "border-neutral-900 bg-neutral-900 text-white"
                : "border-slate-200 bg-white hover:border-neutral-300",
            )}
          >
            <button
              onClick={() => setSelected(s.id)}
              className="w-full text-left px-4 py-2.5"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono text-[11px] opacity-80">{s.id.slice(0, 12)}</span>
                {active && <Check size={12} />}
              </div>
              <div className="mt-1 text-[12px] tabular-nums">
                {s.resource_count} resources · {s.drift_count} drift
              </div>
              <div className="flex items-center justify-between mt-0.5 gap-2">
                <span className={cn("text-[10px]", active ? "text-white/60" : "text-neutral-500")}>
                  {new Date(s.created_at).toLocaleString()}
                </span>
                <div className="flex items-center gap-1 shrink-0">
                  <span
                    className={cn(
                      "text-[9px] font-mono rounded px-1.5 py-0.5",
                      active
                        ? "bg-white/15 text-white/70"
                        : "bg-neutral-100 text-neutral-600",
                    )}
                  >
                    {s.region}
                  </span>
                  <span
                    className={cn(
                      "text-[9px] uppercase tracking-wider font-mono rounded px-1.5 py-0.5",
                      active
                        ? "bg-white/15 text-white/70"
                        : "bg-neutral-100 text-neutral-500",
                    )}
                  >
                    {SOURCE_LABEL[s.source]}
                  </span>
                </div>
              </div>
            </button>

            {/* delete handle */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                setConfirmId(confirming ? null : s.id);
              }}
              className={cn(
                "absolute top-1.5 right-1.5 rounded-md p-1 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity",
                active
                  ? "text-white/70 hover:bg-white/15"
                  : "text-neutral-400 hover:bg-neutral-100",
              )}
              aria-label="Delete snapshot"
            >
              <Trash size={12} weight="regular" />
            </button>

            <AnimatePresence>
              {confirming && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ type: "spring", stiffness: 400, damping: 28 }}
                  className="absolute inset-0 rounded-2xl bg-white border border-red-200 flex flex-col items-stretch justify-center p-2.5 gap-1.5 z-10 shadow-[0_8px_20px_-8px_rgba(0,0,0,0.18)]"
                >
                  <p className="text-[11px] text-neutral-700 text-center leading-tight">
                    Delete this snapshot?
                  </p>
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => handleDelete(s.id)}
                      disabled={deleting}
                      className="flex-1 rounded-lg bg-red-600 text-white text-[11px] font-medium py-1.5 hover:bg-red-700 disabled:opacity-50 active:translate-y-[1px]"
                    >
                      {deleting ? "…" : "Delete"}
                    </button>
                    <button
                      onClick={() => setConfirmId(null)}
                      className="flex-1 rounded-lg bg-neutral-100 text-neutral-700 text-[11px] font-medium py-1.5 hover:bg-neutral-200 active:translate-y-[1px]"
                    >
                      Cancel
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        );
      })}
    </div>
  );
}
