import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CaretDownIcon, InfoIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import { EDGE_LEGEND, edgeLegendColor } from "@/lib/layout";

const STATE_LEGEND: { state: string; label: string; dot: string; ring: string }[] = [
  { state: "matched", label: "Matched", dot: "bg-emerald-500", ring: "ring-emerald-200" },
  { state: "drift", label: "Drift", dot: "bg-red-500", ring: "ring-red-300" },
  { state: "aws_only", label: "AWS only (orphan)", dot: "bg-amber-500", ring: "ring-amber-200" },
  { state: "tf_only", label: "TF only", dot: "bg-slate-400", ring: "ring-slate-300" },
];

export function GraphLegend() {
  const [open, setOpen] = useState(false);
  return (
    <div className="absolute bottom-3 left-3 z-10">
      <motion.button
        layout
        onClick={() => setOpen((v) => !v)}
        whileTap={{ scale: 0.97 }}
        transition={{ type: "spring", stiffness: 400, damping: 28 }}
        className={cn(
          "rounded-2xl border bg-white/90 backdrop-blur-md text-[12px] flex items-center gap-2 px-3 py-1.5",
          open ? "border-neutral-300" : "border-slate-200/70",
        )}
      >
        <InfoIcon size={13} weight="duotone" className="text-neutral-500" />
        <span className="font-medium text-neutral-700">Legend</span>
        <CaretDownIcon
          size={10}
          weight="bold"
          className={cn("text-neutral-400 transition-transform", open && "rotate-180")}
        />
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ type: "spring", stiffness: 320, damping: 28 }}
            className="absolute bottom-full mb-2 left-0 w-[260px] rounded-2xl bg-white border border-slate-200/70 shadow-[0_20px_50px_-15px_rgba(0,0,0,0.15)] p-4 space-y-4"
          >
            <Section title="Node states">
              {STATE_LEGEND.map((s) => (
                <div key={s.state} className="flex items-center gap-2 text-[11px] text-neutral-700">
                  <span className={cn("inline-block w-2 h-2 rounded-full", s.dot)} />
                  <span>{s.label}</span>
                </div>
              ))}
            </Section>

            <Section title="Edges">
              {EDGE_LEGEND.map((e) => (
                <div key={e.semantic} className="flex items-center gap-2 text-[11px] text-neutral-700">
                  <span
                    className="inline-block w-5 h-[2px] rounded"
                    style={{ background: edgeLegendColor(e.semantic) }}
                  />
                  <span>{e.label}</span>
                </div>
              ))}
            </Section>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.14em] text-neutral-400 font-semibold mb-1.5">
        {title}
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}
