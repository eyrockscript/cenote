import { Shell } from "@/components/Shell";
import { useStore } from "@/lib/store";
import { Dashboard } from "@/routes/Dashboard";
import { GraphView } from "@/routes/GraphView";
import { DiffView } from "@/routes/DiffView";
import { TFDiagram } from "@/routes/TFDiagram";

export default function App() {
  const view = useStore((s) => s.view);
  return (
    <Shell>
      {view === "dashboard" && <Dashboard />}
      {view === "graph" && <GraphView />}
      {view === "diff" && <DiffView />}
      {view === "tf" && <TFDiagram />}
    </Shell>
  );
}
