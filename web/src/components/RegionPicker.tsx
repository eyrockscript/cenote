import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CaretDownIcon, CheckIcon, MagnifyingGlassIcon } from "@phosphor-icons/react";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/cn";

const REGION_LABELS: Record<string, string> = {
  "us-east-1": "US East (N. Virginia)",
  "us-east-2": "US East (Ohio)",
  "us-west-1": "US West (N. California)",
  "us-west-2": "US West (Oregon)",
  "af-south-1": "Africa (Cape Town)",
  "ap-east-1": "Asia Pacific (Hong Kong)",
  "ap-south-1": "Asia Pacific (Mumbai)",
  "ap-south-2": "Asia Pacific (Hyderabad)",
  "ap-northeast-1": "Asia Pacific (Tokyo)",
  "ap-northeast-2": "Asia Pacific (Seoul)",
  "ap-northeast-3": "Asia Pacific (Osaka)",
  "ap-southeast-1": "Asia Pacific (Singapore)",
  "ap-southeast-2": "Asia Pacific (Sydney)",
  "ap-southeast-3": "Asia Pacific (Jakarta)",
  "ap-southeast-4": "Asia Pacific (Melbourne)",
  "ca-central-1": "Canada (Central)",
  "ca-west-1": "Canada (Calgary)",
  "eu-central-1": "Europe (Frankfurt)",
  "eu-central-2": "Europe (Zurich)",
  "eu-north-1": "Europe (Stockholm)",
  "eu-south-1": "Europe (Milan)",
  "eu-south-2": "Europe (Spain)",
  "eu-west-1": "Europe (Ireland)",
  "eu-west-2": "Europe (London)",
  "eu-west-3": "Europe (Paris)",
  "il-central-1": "Israel (Tel Aviv)",
  "me-central-1": "Middle East (UAE)",
  "me-south-1": "Middle East (Bahrain)",
  "sa-east-1": "South America (São Paulo)",
};

export function RegionPicker() {
  const region = useStore((s) => s.region);
  const setRegion = useStore((s) => s.setRegion);
  const regions = useStore((s) => s.availableRegions);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  // Focus search on open
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 60);
    else setQuery("");
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return regions;
    return regions.filter((r) => {
      const label = (REGION_LABELS[r] || r).toLowerCase();
      return r.toLowerCase().includes(q) || label.includes(q);
    });
  }, [query, regions]);

  if (!region || regions.length === 0) return null;

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex items-center gap-2 rounded-full pl-3 pr-2.5 py-1.5 text-[12px] font-medium transition-colors",
          open
            ? "bg-neutral-900 text-white"
            : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200",
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500" />
          <span className="font-mono">{region}</span>
        </span>
        <CaretDownIcon
          size={11}
          weight="bold"
          className={cn("transition-transform", open && "rotate-180")}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 400, damping: 28 }}
            className="absolute right-0 mt-2 w-[300px] rounded-2xl bg-white border border-slate-200/70 shadow-[0_20px_50px_-12px_rgba(0,0,0,0.18)] z-50 overflow-hidden"
            role="listbox"
          >
            <div className="border-b border-slate-200/60 px-3 py-2 flex items-center gap-2">
              <MagnifyingGlassIcon size={13} weight="regular" className="text-neutral-400" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search region…"
                className="flex-1 bg-transparent outline-none text-[12px] font-mono"
              />
            </div>

            <div className="max-h-[280px] overflow-y-auto py-1">
              {filtered.length === 0 ? (
                <div className="px-3 py-4 text-center text-[12px] text-neutral-400">
                  No match
                </div>
              ) : (
                filtered.map((r) => {
                  const isCurrent = r === region;
                  return (
                    <button
                      key={r}
                      onClick={() => {
                        setRegion(r);
                        setOpen(false);
                      }}
                      className={cn(
                        "w-full flex items-center justify-between gap-3 px-3 py-1.5 text-left transition-colors",
                        isCurrent
                          ? "bg-neutral-50"
                          : "hover:bg-neutral-50",
                      )}
                      role="option"
                      aria-selected={isCurrent}
                    >
                      <div className="min-w-0">
                        <div className="font-mono text-[12px] text-neutral-900">{r}</div>
                        <div className="text-[10px] text-neutral-500 truncate">
                          {REGION_LABELS[r] || ""}
                        </div>
                      </div>
                      {isCurrent && (
                        <CheckIcon size={13} weight="bold" className="text-emerald-600 shrink-0" />
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
