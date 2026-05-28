import { useEffect } from "react";
import { motion } from "framer-motion";
import { Graph, ListBullets, GitDiff, FileArchive, type Icon as PhosphorIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import { useStore, type View } from "@/lib/store";
import { api } from "@/lib/api";
import { RegionPicker } from "@/components/RegionPicker";

const NAV: { id: View; label: string; Icon: PhosphorIcon }[] = [
  { id: "dashboard", label: "Dashboard", Icon: ListBullets },
  { id: "graph", label: "Graph", Icon: Graph },
  { id: "diff", label: "Diff", Icon: GitDiff },
  { id: "tf", label: "TF Diagram", Icon: FileArchive },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const setSnapshots = useStore((s) => s.setSnapshots);
  const region = useStore((s) => s.region);
  const setRegion = useStore((s) => s.setRegion);
  const setAvailableRegions = useStore((s) => s.setAvailableRegions);

  // Boot: load snapshots and AWS regions in parallel.
  useEffect(() => {
    api.listSnapshots().then(setSnapshots).catch(() => undefined);
    api
      .listRegions()
      .then((r) => {
        setAvailableRegions(r.regions);
        if (!region) setRegion(r.current);
      })
      .catch(() => {
        // Backend reachable but regions endpoint failed; still set a default.
        if (!region) setRegion("us-east-1");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-[100dvh] bg-[#f9fafb] text-neutral-900">
      <header className="sticky top-0 z-40 backdrop-blur-md bg-white/70 border-b border-slate-200/60">
        <div className="max-w-[1400px] mx-auto px-6 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 shrink-0">
            <img src="/brand/mark.svg" alt="Cenote" className="w-7 h-7 rounded-md" />
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-semibold tracking-tight">Cenote</span>
              <span className="text-[11px] font-mono text-neutral-500">v0.1</span>
            </div>
          </div>

          <nav className="flex items-center gap-1 bg-neutral-100/80 rounded-full p-1">
            {NAV.map(({ id, label, Icon }) => {
              const active = id === view;
              return (
                <button
                  key={id}
                  onClick={() => setView(id)}
                  className={cn(
                    "relative flex items-center gap-2 px-3 py-1.5 rounded-full text-[13px] transition-colors",
                    active ? "text-neutral-900" : "text-neutral-500 hover:text-neutral-800",
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId="nav-pill"
                      className="absolute inset-0 bg-white rounded-full shadow-[0_1px_2px_rgba(0,0,0,0.06)]"
                      transition={{ type: "spring", stiffness: 400, damping: 30 }}
                    />
                  )}
                  <Icon size={14} weight="regular" />
                  <span className="relative font-medium">{label}</span>
                </button>
              );
            })}
          </nav>

          <div className="flex items-center gap-3 shrink-0">
            <RegionPicker />
            <div className="text-[10px] font-mono text-neutral-400">#{__COMMIT_HASH__}</div>
          </div>
        </div>
      </header>
      <main className="max-w-[1400px] mx-auto px-6 py-8">{children}</main>
    </div>
  );
}
