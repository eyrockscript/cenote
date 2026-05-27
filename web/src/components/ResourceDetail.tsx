import { AnimatePresence, motion } from "framer-motion";
import { XIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import { useStore } from "@/lib/store";
import { resourceState } from "@/types/graph";
import type { DriftField, Resource } from "@/types/graph";

const STATE_COPY = {
  matched: "Terraform and AWS agree",
  drift: "Fields disagree between Terraform and AWS",
  tf_only: "Declared in Terraform, not present in AWS",
  aws_only: "Exists in AWS, not declared in Terraform",
};

export function ResourceDetail({ resource }: { resource: Resource | null }) {
  const setSelectedArn = useStore((s) => s.setSelectedArn);

  return (
    <AnimatePresence>
      {resource && (
        <motion.aside
          initial={{ x: 360, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 360, opacity: 0 }}
          transition={{ type: "spring", stiffness: 240, damping: 28 }}
          className="absolute top-3 right-3 bottom-3 w-[360px] z-10 rounded-3xl bg-white border border-slate-200/60 shadow-[0_30px_60px_-20px_rgba(0,0,0,0.12)] overflow-hidden flex flex-col"
        >
          <div className="px-5 py-4 border-b border-slate-200/60 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[10px] font-mono uppercase tracking-[0.14em] text-neutral-500">
                {resource.type}
              </div>
              <h3 className="text-base font-semibold tracking-tight truncate mt-0.5">
                {resource.name}
              </h3>
              <p className="text-[11px] text-neutral-500 mt-0.5 font-mono truncate">
                {resource.id}
              </p>
            </div>
            <button
              onClick={() => setSelectedArn(null)}
              className="text-neutral-400 hover:text-neutral-900 transition-colors"
            >
              <XIcon size={16} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            <Section label="State">
              <StateBadge resource={resource} />
              <p className="mt-2 text-[12px] text-neutral-600 leading-relaxed">
                {STATE_COPY[resourceState(resource)]}
              </p>
            </Section>

            {resource.drift.length > 0 && (
              <Section label="Drift">
                <div className="space-y-2">
                  {resource.drift.map((d) => (
                    <DriftRow key={d.field} drift={d} />
                  ))}
                </div>
              </Section>
            )}

            {resource.author && (
              <Section label="Author">
                <div className="grid grid-cols-2 gap-y-2 gap-x-3 text-[12px]">
                  <KV label="via" value={resource.author.via} />
                  <KV label="principal" value={resource.author.principal_name ?? "—"} />
                  {resource.author.event_time && (
                    <KV
                      label="when"
                      value={new Date(resource.author.event_time).toLocaleString()}
                    />
                  )}
                  <KV
                    label="confidence"
                    value={`${Math.round(resource.author.confidence * 100)}%`}
                  />
                </div>
              </Section>
            )}

            {Object.keys(resource.tags).length > 0 && (
              <Section label="Tags">
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(resource.tags).map(([k, v]) => (
                    <span
                      key={k}
                      className="text-[11px] font-mono rounded-md bg-neutral-100 px-2 py-0.5 text-neutral-700"
                    >
                      {k}={v}
                    </span>
                  ))}
                </div>
              </Section>
            )}

            <Section label="Blast radius">
              <span className="font-mono text-2xl tabular-nums">{resource.blast_radius}</span>
              <span className="ml-1.5 text-[12px] text-neutral-500">
                downstream resource{resource.blast_radius === 1 ? "" : "s"}
              </span>
            </Section>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="px-5 py-4 border-b border-slate-200/60 last:border-b-0">
      <div className="text-[10px] uppercase tracking-[0.14em] text-neutral-400 font-medium mb-2.5">
        {label}
      </div>
      {children}
    </div>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div className="contents">
      <span className="text-neutral-500">{label}</span>
      <span className="text-neutral-900 font-mono text-[11px] truncate">{value}</span>
    </div>
  );
}

function StateBadge({ resource }: { resource: Resource }) {
  const state = resourceState(resource);
  const styles: Record<typeof state, string> = {
    matched: "bg-emerald-100 text-emerald-700",
    drift: "bg-red-100 text-red-700",
    tf_only: "bg-slate-100 text-slate-700",
    aws_only: "bg-amber-100 text-amber-700",
  };
  return (
    <span
      className={cn(
        "inline-block rounded-full px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wider",
        styles[state],
      )}
    >
      {state.replace("_", " ")}
    </span>
  );
}

function DriftRow({ drift }: { drift: DriftField }) {
  const tone =
    drift.severity === "high"
      ? "border-red-200 bg-red-50/50"
      : drift.severity === "medium"
        ? "border-amber-200 bg-amber-50/50"
        : "border-slate-200 bg-slate-50/50";
  return (
    <div className={cn("rounded-xl border p-2.5", tone)}>
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="text-[12px] font-mono">{drift.field}</span>
        <span className="text-[9px] uppercase tracking-wider text-neutral-500">
          {drift.severity}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
        <div className="rounded bg-white border border-slate-200 px-2 py-1 truncate">
          <span className="text-neutral-400 mr-1">tf:</span>
          {valueStr(drift.tf_value)}
        </div>
        <div className="rounded bg-white border border-slate-200 px-2 py-1 truncate">
          <span className="text-neutral-400 mr-1">aws:</span>
          {valueStr(drift.aws_value)}
        </div>
      </div>
    </div>
  );
}

function valueStr(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v || '""';
  return JSON.stringify(v);
}
