import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { GitBranch, ShieldWarning, UserCircle, Cloud, WarningCircle } from "@phosphor-icons/react";
import { useStore } from "@/lib/store";
import { api, type AwsHealth } from "@/lib/api";
import { MetricCard } from "@/components/MetricCard";
import { Button } from "@/components/Button";
import { Spinner } from "@/components/Spinner";
import { EmptyState } from "@/components/EmptyState";
import { SnapshotPicker } from "@/components/SnapshotPicker";
import { SourceLoader } from "@/components/SourceLoader";

async function runScanFlow(region: string | null): Promise<{ snapshot_id: string } | { error: string }> {
  // Preflight: verify credentials before bothering the user with a long scan.
  let aws: AwsHealth;
  try {
    aws = await api.healthAws();
  } catch (e) {
    return { error: `Backend unreachable: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!aws.ok) return { error: aws.error || "Unknown AWS error" };

  try {
    const snap = await api.scan({
      region: region ?? undefined,
      include_authorship: true,
    });
    return { snapshot_id: snap.id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export function Dashboard() {
  const snapshots = useStore((s) => s.snapshots);
  const selectedId = useStore((s) => s.selectedSnapshotId);
  const setSelectedId = useStore((s) => s.setSelectedSnapshotId);
  const setSnapshots = useStore((s) => s.setSnapshots);
  const setView = useStore((s) => s.setView);

  const region = useStore((s) => s.region);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedId && snapshots.length > 0) setSelectedId(snapshots[0].id);
  }, [snapshots, selectedId, setSelectedId]);

  const handleScan = async () => {
    setScanning(true);
    setScanError(null);
    const result = await runScanFlow(region);
    setScanning(false);
    if ("error" in result) {
      setScanError(result.error);
      return;
    }
    const list = await api.listSnapshots();
    setSnapshots(list);
    setSelectedId(result.snapshot_id);
  };

  const current = snapshots.find((s) => s.id === selectedId) ?? snapshots[0] ?? null;

  if (!current) {
    return (
      <div className="space-y-8">
        <Header onScan={handleScan} scanning={scanning} />
        {scanError && <ErrorBanner message={scanError} onDismiss={() => setScanError(null)} />}
        <EmptyState
          title="No snapshots yet"
          desc="Run your first scan to inventory AWS resources and reconcile against Terraform. Read-only, $0 in AWS."
          action={
            <Button onClick={handleScan} disabled={scanning}>
              {scanning ? <><Spinner size={14} className="border-white/40 border-t-white" />Scanning AWS…</> : "Run first scan"}
            </Button>
          }
        />
      </div>
    );
  }

  // Without a tfstate, "orphan" is meaningless — every AWS resource looks orphaned.
  // We surface this clearly so the user knows what to do next.
  const isLiveOnly = current.source === "live";

  const handleSourceScanComplete = async (snapshotId: string) => {
    const list = await api.listSnapshots();
    setSnapshots(list);
    setSelectedId(snapshotId);
  };

  return (
    <div className="space-y-8">
      <Header onScan={handleScan} scanning={scanning} />
      {scanError && <ErrorBanner message={scanError} onDismiss={() => setScanError(null)} />}
      <SnapshotPicker />

      <SourceLoader onScanComplete={handleSourceScanComplete} liveOnly={isLiveOnly} />

      {/* Bento 2.0 — asymmetric metrics */}
      <div className="grid grid-cols-1 md:grid-cols-6 gap-5">
        <div className="md:col-span-2">
          <MetricCard
            label={isLiveOnly ? "AWS resources" : "Resources"}
            value={current.resource_count}
            hint={`Region ${current.region} · account ${current.account_id.slice(0, 4)}…${current.account_id.slice(-4)}`}
          />
        </div>
        <div className="md:col-span-2">
          <MetricCard
            label="Drift"
            value={isLiveOnly ? "—" : current.drift_count}
            tone={isLiveOnly ? "neutral" : current.drift_count > 0 ? "danger" : "ok"}
            hint={
              isLiveOnly
                ? "Upload a tfstate to detect drift"
                : current.drift_count > 0
                  ? "TF and AWS disagree on field values"
                  : "No drift detected"
            }
          />
        </div>
        <div className="md:col-span-2">
          <MetricCard
            label={isLiveOnly ? "Inventoried" : "Orphans"}
            value={current.orphan_count}
            tone={isLiveOnly ? "neutral" : current.orphan_count > 0 ? "warn" : "ok"}
            hint={
              isLiveOnly
                ? "Every AWS resource (no TF baseline yet)"
                : current.orphan_count > 0
                  ? "Exist in AWS, not declared in Terraform"
                  : "Everything is declared"
            }
          />
        </div>

        <div className="md:col-span-3">
          <FeaturePromo
            title="Drift detection"
            desc="Field-by-field comparison with curated severities. Zero false positives across 13 supported types."
            Icon={ShieldWarning}
            onClick={() => setView("graph")}
            cta={current.drift_count > 0 ? `Inspect ${current.drift_count} drifted resources` : "View graph"}
          />
        </div>
        <div className="md:col-span-3">
          <FeaturePromo
            title="Diff viewer"
            desc="Pick a base and a head snapshot — or import a terraform plan — and review changes PR-style before apply."
            Icon={GitBranch}
            onClick={() => setView("diff")}
            cta="Open diff"
          />
        </div>

        <div className="md:col-span-6">
          <AuthorshipBanner />
        </div>
      </div>
    </div>
  );
}

function Header({ onScan, scanning }: { onScan: () => void; scanning: boolean }) {
  const region = useStore((s) => s.region);
  return (
    <div className="flex items-end justify-between gap-6">
      <div>
        <h1 className="text-4xl md:text-5xl tracking-tighter leading-none font-semibold">
          Reconciliation
        </h1>
        <p className="mt-3 text-[13px] text-neutral-500 max-w-xl leading-relaxed">
          Three views of every resource: what Terraform declares, what AWS actually has, and the
          delta between them.
        </p>
      </div>
      <Button onClick={onScan} disabled={scanning}>
        {scanning ? (
          <>
            <Spinner size={14} className="border-white/40 border-t-white" />
            Scanning AWS…
          </>
        ) : (
          <>
            Run scan
            {region && (
              <span className="ml-1.5 inline-flex items-center gap-1 text-[10px] font-mono opacity-70">
                <span className="inline-block w-1 h-1 rounded-full bg-emerald-400" />
                {region}
              </span>
            )}
          </>
        )}
      </Button>
    </div>
  );
}

function ErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 240, damping: 24 }}
      className="rounded-2xl border border-red-200 bg-red-50/70 p-4 flex items-start gap-3"
    >
      <WarningCircle size={18} weight="duotone" className="text-red-600 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-[12px] font-semibold text-red-900 mb-0.5">Scan blocked</div>
        <p className="text-[12px] text-red-700 font-mono break-words leading-relaxed">{message}</p>
        <p className="text-[11px] text-red-600/70 mt-1.5 leading-relaxed">
          Check <code className="font-mono">AWS_PROFILE</code> /{" "}
          <code className="font-mono">AWS_REGION</code> in <code className="font-mono">.env</code>,{" "}
          and that the profile has the permissions in{" "}
          <code className="font-mono">scripts/iam-policy.json</code>.
        </p>
      </div>
      <button onClick={onDismiss} className="text-red-400 hover:text-red-900 text-xs">
        dismiss
      </button>
    </motion.div>
  );
}

function FeaturePromo({
  title,
  desc,
  Icon,
  onClick,
  cta,
}: {
  title: string;
  desc: string;
  Icon: React.ComponentType<{ size: number; weight?: "regular" | "duotone" }>;
  onClick: () => void;
  cta: string;
}) {
  return (
    <motion.button
      onClick={onClick}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.99 }}
      transition={{ type: "spring", stiffness: 100, damping: 20 }}
      className="relative w-full text-left rounded-[2.5rem] bg-white border border-slate-200/60 p-8 shadow-[0_20px_40px_-15px_rgba(0,0,0,0.05)] overflow-hidden"
    >
      <div className="inline-flex items-center justify-center w-10 h-10 rounded-2xl bg-neutral-100 mb-5">
        <Icon size={18} weight="duotone" />
      </div>
      <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
      <p className="mt-2 text-[13px] text-neutral-500 leading-relaxed max-w-md">{desc}</p>
      <div className="mt-6 inline-flex items-center gap-1 text-[12px] font-medium text-neutral-900">
        {cta} <span aria-hidden>→</span>
      </div>
    </motion.button>
  );
}

function AuthorshipBanner() {
  return (
    <div className="rounded-[2.5rem] bg-neutral-900 text-neutral-100 p-8 md:p-10 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.25)] relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none opacity-[0.06]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.5) 1px, transparent 0)",
          backgroundSize: "16px 16px",
        }}
      />
      <div className="relative flex flex-col md:flex-row md:items-center md:justify-between gap-6">
        <div>
          <div className="inline-flex items-center gap-2 mb-3 text-[11px] uppercase tracking-[0.14em] text-neutral-400">
            <UserCircle size={14} weight="duotone" />
            Authorship
          </div>
          <h3 className="text-2xl tracking-tight font-semibold leading-tight max-w-xl">
            Every resource carries a trace: who created it, from where, and when.
          </h3>
          <p className="mt-3 text-[13px] text-neutral-400 max-w-xl leading-relaxed">
            CloudTrail Lookup powers the last 90 days for free. No extra AWS bill.
          </p>
        </div>
        <div className="font-mono text-[11px] text-neutral-500 space-y-1 min-w-[200px]">
          <Row label="via" value="Console / Terraform / CLI / SDK" />
          <Row label="window" value="90d via Lookup (free)" />
          <Row label="cache" value="SQLite, per account / region" />
        </div>
      </div>
      <Cloud
        size={180}
        weight="duotone"
        className="absolute -right-8 -bottom-8 text-white/[0.04] pointer-events-none"
      />
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-neutral-500">{label}</span>
      <span className="text-neutral-300">{value}</span>
    </div>
  );
}
