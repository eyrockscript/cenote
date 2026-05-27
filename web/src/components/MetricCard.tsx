import { motion } from "framer-motion";
import { cn } from "@/lib/cn";

interface Props {
  label: string;
  value: number | string;
  hint?: string;
  tone?: "neutral" | "warn" | "danger" | "ok";
  delta?: { value: number; label: string };
}

const TONE = {
  neutral: { dot: "bg-neutral-300", text: "text-neutral-900" },
  ok: { dot: "bg-emerald-500", text: "text-neutral-900" },
  warn: { dot: "bg-amber-500", text: "text-neutral-900" },
  danger: { dot: "bg-red-500", text: "text-neutral-900" },
};

export function MetricCard({ label, value, hint, tone = "neutral" }: Props) {
  const t = TONE[tone];
  return (
    <motion.div
      layout
      transition={{ type: "spring", stiffness: 100, damping: 20 }}
      className="rounded-[2.5rem] bg-white border border-slate-200/60 p-8 shadow-[0_20px_40px_-15px_rgba(0,0,0,0.05)]"
    >
      <div className="flex items-center gap-2 mb-3">
        <span className={cn("inline-block w-1.5 h-1.5 rounded-full", t.dot)} />
        <span className="text-[11px] uppercase tracking-[0.14em] text-neutral-500 font-medium">
          {label}
        </span>
      </div>
      <div className={cn("font-mono text-4xl tracking-tighter leading-none", t.text)}>
        {value}
      </div>
      {hint && (
        <div className="mt-3 text-[12px] text-neutral-500 leading-relaxed">{hint}</div>
      )}
    </motion.div>
  );
}
