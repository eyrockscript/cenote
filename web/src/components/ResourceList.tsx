import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { CaretUpIcon, CaretDownIcon } from "@phosphor-icons/react";
import type { Resource } from "@/types/graph";
import { resourceState } from "@/types/graph";
import { cn } from "@/lib/cn";
import { useStore } from "@/lib/store";
import { ResourceIcon, typeCategoryClass, typeShortLabel } from "@/components/ResourceIcon";
import { AuthorBadge } from "@/components/AuthorBadge";

type SortKey = "name" | "type" | "state" | "author" | "drift" | "vpc";
type SortDir = "asc" | "desc";

const STATE_RANK = { matched: 3, drift: 0, aws_only: 1, tf_only: 2 } as const;
const STATE_COPY: Record<string, { text: string; className: string }> = {
  matched: { text: "matched", className: "text-emerald-700 bg-emerald-100" },
  drift: { text: "drift", className: "text-red-700 bg-red-100" },
  aws_only: { text: "aws only", className: "text-amber-700 bg-amber-100" },
  tf_only: { text: "tf only", className: "text-slate-700 bg-slate-100" },
};

interface Props {
  resources: Resource[];
}

export function ResourceList({ resources }: Props) {
  const selectedArn = useStore((s) => s.selectedArn);
  const setSelectedArn = useStore((s) => s.setSelectedArn);

  const [sortKey, setSortKey] = useState<SortKey>("state");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const sorted = useMemo(() => {
    const arr = [...resources];
    arr.sort((a, b) => {
      const cmp = compareResources(a, b, sortKey);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [resources, sortKey, sortDir]);

  const setSort = (key: SortKey) => {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  if (resources.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-200/70 bg-white px-6 py-12 text-center">
        <p className="text-[13px] text-neutral-500">No resources match the current filters.</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200/70 bg-white overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-left bg-neutral-50/70 border-b border-slate-200/60">
              <Th width="2%" sortable={false}>&nbsp;</Th>
              <Th onClick={() => setSort("name")} active={sortKey === "name"} dir={sortDir}>
                Name
              </Th>
              <Th onClick={() => setSort("type")} active={sortKey === "type"} dir={sortDir}>
                Type
              </Th>
              <Th onClick={() => setSort("state")} active={sortKey === "state"} dir={sortDir}>
                State
              </Th>
              <Th onClick={() => setSort("drift")} active={sortKey === "drift"} dir={sortDir}>
                Drift
              </Th>
              <Th onClick={() => setSort("author")} active={sortKey === "author"} dir={sortDir}>
                Created via
              </Th>
              <Th onClick={() => setSort("vpc")} active={sortKey === "vpc"} dir={sortDir}>
                VPC / Subnet
              </Th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const st = resourceState(r);
              const isSelected = selectedArn === r.id;
              const stateStyle = STATE_COPY[st];
              return (
                <motion.tr
                  key={r.id}
                  layout
                  transition={{ type: "spring", stiffness: 400, damping: 30 }}
                  onClick={() => setSelectedArn(r.id)}
                  className={cn(
                    "border-b border-slate-100 last:border-b-0 cursor-pointer hover:bg-neutral-50 transition-colors",
                    isSelected && "bg-neutral-100/70",
                  )}
                >
                  <td className="py-2.5 pl-3">
                    <span className={cn(
                      "inline-flex items-center justify-center w-6 h-6 rounded-md",
                      typeCategoryClass(r.type),
                    )}>
                      <ResourceIcon type={r.type} size={12} />
                    </span>
                  </td>
                  <td className="py-2.5 pr-4">
                    <div className="font-medium text-neutral-900 truncate max-w-[280px]">
                      {r.name}
                    </div>
                    <div className="text-[10px] font-mono text-neutral-400 truncate max-w-[320px]">
                      {r.id}
                    </div>
                  </td>
                  <td className="py-2.5 pr-4">
                    <span className="text-[11px] font-mono uppercase tracking-wider text-neutral-600">
                      {typeShortLabel(r.type)}
                    </span>
                  </td>
                  <td className="py-2.5 pr-4">
                    <span
                      className={cn(
                        "inline-block text-[10px] font-medium uppercase tracking-wider rounded px-1.5 py-0.5",
                        stateStyle.className,
                      )}
                    >
                      {stateStyle.text}
                    </span>
                  </td>
                  <td className="py-2.5 pr-4">
                    {r.drift.length > 0 ? (
                      <span className="font-mono text-[11px] text-red-600 font-medium">
                        {r.drift.length} field{r.drift.length === 1 ? "" : "s"}
                      </span>
                    ) : (
                      <span className="text-[11px] text-neutral-300">—</span>
                    )}
                  </td>
                  <td className="py-2.5 pr-4">
                    {r.author ? (
                      <div className="flex items-center gap-2 min-w-0">
                        <AuthorBadge via={r.author.via} size="sm" />
                        {r.author.principal_name && (
                          <span className="text-[10px] font-mono text-neutral-500 truncate max-w-[100px]">
                            {r.author.principal_name}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-[11px] text-neutral-300 italic">no data</span>
                    )}
                  </td>
                  <td className="py-2.5 pr-3">
                    <div className="text-[11px] font-mono text-neutral-600 truncate max-w-[200px]">
                      {r.containers?.vpc_id || "—"}
                    </div>
                    {r.containers?.subnet_id && (
                      <div className="text-[10px] font-mono text-neutral-400 truncate max-w-[200px]">
                        {r.containers.subnet_id}
                      </div>
                    )}
                  </td>
                </motion.tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="border-t border-slate-200/60 bg-neutral-50/60 px-3 py-2 text-[11px] text-neutral-500 font-mono">
        {resources.length} resource{resources.length === 1 ? "" : "s"}
      </div>
    </div>
  );
}

function Th({
  children,
  width,
  onClick,
  active,
  dir,
  sortable = true,
}: {
  children: React.ReactNode;
  width?: string;
  onClick?: () => void;
  active?: boolean;
  dir?: SortDir;
  sortable?: boolean;
}) {
  return (
    <th
      style={{ width }}
      className={cn(
        "py-2 px-3 text-[10px] uppercase tracking-[0.14em] font-semibold text-neutral-500 select-none",
        sortable && "cursor-pointer hover:text-neutral-900 transition-colors",
      )}
      onClick={onClick}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        {active && sortable && (
          dir === "asc" ? <CaretUpIcon size={9} weight="bold" /> : <CaretDownIcon size={9} weight="bold" />
        )}
      </span>
    </th>
  );
}

function compareResources(a: Resource, b: Resource, key: SortKey): number {
  switch (key) {
    case "name":
      return a.name.localeCompare(b.name);
    case "type":
      return a.type.localeCompare(b.type);
    case "state": {
      const sa = STATE_RANK[resourceState(a)];
      const sb = STATE_RANK[resourceState(b)];
      return sa - sb;
    }
    case "drift":
      return b.drift.length - a.drift.length;
    case "author": {
      const va = a.author?.via || "Unknown";
      const vb = b.author?.via || "Unknown";
      return va.localeCompare(vb);
    }
    case "vpc": {
      const va = a.containers?.vpc_id || "";
      const vb = b.containers?.vpc_id || "";
      const c = va.localeCompare(vb);
      if (c !== 0) return c;
      return (a.containers?.subnet_id || "").localeCompare(b.containers?.subnet_id || "");
    }
  }
}
