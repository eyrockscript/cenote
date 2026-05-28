import { motion } from "framer-motion";
import { GraphIcon, RowsIcon } from "@phosphor-icons/react";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/cn";

export function GraphModeToggle() {
  const mode = useStore((s) => s.graphMode);
  const setMode = useStore((s) => s.setGraphMode);
  const options: { id: "graph" | "list"; label: string; Icon: React.ComponentType<{ size: number; weight?: "regular" }> }[] = [
    { id: "graph", label: "Graph", Icon: GraphIcon },
    { id: "list", label: "List", Icon: RowsIcon },
  ];
  return (
    <div className="inline-flex items-center gap-1 bg-neutral-100 rounded-full p-1">
      {options.map(({ id, label, Icon }) => {
        const active = id === mode;
        return (
          <button
            key={id}
            onClick={() => setMode(id)}
            className={cn(
              "relative inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[12px] font-medium transition-colors",
              active ? "text-neutral-900" : "text-neutral-500 hover:text-neutral-800",
            )}
          >
            {active && (
              <motion.span
                layoutId="graph-mode-pill"
                className="absolute inset-0 bg-white rounded-full shadow-[0_1px_2px_rgba(0,0,0,0.06)]"
                transition={{ type: "spring", stiffness: 400, damping: 30 }}
              />
            )}
            <Icon size={13} weight="regular" />
            <span className="relative">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
