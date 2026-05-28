import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ArrowRight, Plus, Minus, PencilSimple } from "@phosphor-icons/react";
import { api } from "@/lib/api";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/cn";
import { EmptyState } from "@/components/EmptyState";
import type { GraphDiff, ResourceChange, FieldChange } from "@/types/graph";

export function DiffView() {
  const snapshots = useStore((s) => s.snapshots);
  const diffPair = useStore((s) => s.diffPair);
  const setDiffPair = useStore((s) => s.setDiffPair);
  const [diff, setDiff] = useState<GraphDiff | null>(null);

  useEffect(() => {
    if (snapshots.length >= 2 && !diffPair.base && !diffPair.head) {
      setDiffPair({ base: snapshots[1].id, head: snapshots[0].id });
    }
  }, [snapshots, diffPair, setDiffPair]);

  useEffect(() => {
    if (!diffPair.base || !diffPair.head) return;
    api.getDiff(diffPair.base, diffPair.head).then(setDiff).catch(() => setDiff(null));
  }, [diffPair]);

  if (snapshots.length < 2) {
    return (
      <EmptyState
        title="Need two snapshots"
        desc="Run at least two scans to compare. Or import a terraform plan to compare against the current state."
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <h1 className="text-4xl tracking-tighter leading-none font-semibold">Diff</h1>
          <p className="mt-3 text-[13px] text-neutral-500 leading-relaxed max-w-xl">
            Compare any two snapshots. Review pre-apply changes the same way you review a pull
            request.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <SnapshotSelect
            label="Base"
            value={diffPair.base}
            onChange={(v) => setDiffPair({ base: v })}
          />
          <ArrowRight size={14} className="text-neutral-400" />
          <SnapshotSelect
            label="Head"
            value={diffPair.head}
            onChange={(v) => setDiffPair({ head: v })}
          />
        </div>
      </div>

      {diff ? <DiffBody diff={diff} /> : <DiffSkeleton />}
    </div>
  );
}

function SnapshotSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | null;
  onChange: (v: string) => void;
}) {
  const snapshots = useStore((s) => s.snapshots);
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-[0.14em] text-neutral-500 font-medium">
        {label}
      </span>
      <select
        className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[12px] font-mono"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
      >
        {snapshots.map((s) => (
          <option key={s.id} value={s.id}>
            {s.id.slice(0, 14)} · {new Date(s.created_at).toLocaleString()}
          </option>
        ))}
      </select>
    </label>
  );
}

function DiffBody({ diff }: { diff: GraphDiff }) {
  const stats = useMemo(
    () => [
      { label: "Added", count: diff.added.length, tone: "ok" },
      { label: "Removed", count: diff.removed.length, tone: "danger" },
      { label: "Modified", count: diff.modified.length, tone: "warn" },
      { label: "Unchanged", count: diff.unchanged_count, tone: "neutral" },
    ],
    [diff],
  );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {stats.map((s) => (
          <Stat key={s.label} {...s} />
        ))}
      </div>

      <Section title="Modified" Icon={PencilSimple} accent="amber">
        {diff.modified.length === 0 ? (
          <EmptyRow label="No modified resources" />
        ) : (
          <div className="divide-y divide-slate-200/60">
            {diff.modified.map((m) => <ChangeRow key={m.arn} change={m} />)}
          </div>
        )}
      </Section>

      <Section title="Added" Icon={Plus} accent="emerald">
        {diff.added.length === 0 ? (
          <EmptyRow label="No added resources" />
        ) : (
          <div className="divide-y divide-slate-200/60">
            {diff.added.map((m) => <ChangeRow key={m.arn} change={m} />)}
          </div>
        )}
      </Section>

      <Section title="Removed" Icon={Minus} accent="red">
        {diff.removed.length === 0 ? (
          <EmptyRow label="No removed resources" />
        ) : (
          <div className="divide-y divide-slate-200/60">
            {diff.removed.map((m) => <ChangeRow key={m.arn} change={m} />)}
          </div>
        )}
      </Section>
    </div>
  );
}

function Stat({ label, count, tone }: { label: string; count: number; tone: string }) {
  const dotClass: Record<string, string> = {
    ok: "bg-emerald-500",
    danger: "bg-red-500",
    warn: "bg-amber-500",
    neutral: "bg-neutral-300",
  };
  return (
    <motion.div
      layout
      transition={{ type: "spring", stiffness: 100, damping: 20 }}
      className="rounded-2xl bg-white border border-slate-200/60 p-5"
    >
      <div className="flex items-center gap-2 mb-2">
        <span className={cn("inline-block w-1.5 h-1.5 rounded-full", dotClass[tone])} />
        <span className="text-[10px] uppercase tracking-[0.14em] text-neutral-500 font-medium">
          {label}
        </span>
      </div>
      <div className="font-mono text-3xl tracking-tighter">{count}</div>
    </motion.div>
  );
}

function Section({
  title,
  Icon,
  accent,
  children,
}: {
  title: string;
  Icon: React.ComponentType<{ size: number; weight?: "regular" | "duotone" }>;
  accent: "emerald" | "red" | "amber";
  children: React.ReactNode;
}) {
  const bg: Record<string, string> = {
    emerald: "bg-emerald-50 text-emerald-700",
    red: "bg-red-50 text-red-700",
    amber: "bg-amber-50 text-amber-700",
  };
  return (
    <div className="rounded-3xl border border-slate-200/60 bg-white overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-200/60 flex items-center gap-2">
        <span className={cn("inline-flex items-center justify-center w-5 h-5 rounded", bg[accent])}>
          <Icon size={11} weight="regular" />
        </span>
        <h3 className="font-medium tracking-tight text-[14px]">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function EmptyRow({ label }: { label: string }) {
  return <div className="px-5 py-4 text-[12px] text-neutral-400 italic">{label}</div>;
}

function ChangeRow({ change }: { change: ResourceChange }) {
  return (
    <motion.div
      layout
      transition={{ type: "spring", stiffness: 100, damping: 20 }}
      className="px-5 py-3"
    >
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <div className="min-w-0">
          <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-500 mr-2">
            {change.type}
          </span>
          <span className="font-medium text-[13px]">{change.name}</span>
        </div>
        <span className="text-[10px] font-mono text-neutral-400 truncate max-w-[280px]">
          {change.arn}
        </span>
      </div>
      {change.fields.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5 mt-2">
          {change.fields.map((f) => (
            <FieldDiff key={f.field} field={f} />
          ))}
        </div>
      )}
    </motion.div>
  );
}

function FieldDiff({ field }: { field: FieldChange }) {
  return (
    <div className="rounded-lg bg-neutral-50 border border-slate-200/60 px-2.5 py-1.5 text-[11px] font-mono">
      <div className="text-neutral-500 mb-1">{field.field}</div>
      <div className="grid grid-cols-2 gap-1.5">
        <span className="bg-red-50 text-red-700 rounded px-1.5 py-0.5 truncate">
          {valueStr(field.before)}
        </span>
        <span className="bg-emerald-50 text-emerald-700 rounded px-1.5 py-0.5 truncate">
          {valueStr(field.after)}
        </span>
      </div>
    </div>
  );
}

function valueStr(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v || '""';
  return JSON.stringify(v);
}

function DiffSkeleton() {
  return (
    <div className="space-y-4">
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className="rounded-2xl bg-white border border-slate-200/60 h-16 animate-pulse"
        />
      ))}
    </div>
  );
}
