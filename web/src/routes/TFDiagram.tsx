import { useCallback, useMemo, useRef, useState } from "react";
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  type Node,
  type Edge as RFEdge,
  type NodeChange,
  applyNodeChanges,
} from "reactflow";
import "reactflow/dist/style.css";
import { motion } from "framer-motion";
import { FileArchive, DownloadSimple, ArrowsClockwise } from "@phosphor-icons/react";

import { api } from "@/lib/api";
import {
  buildHierarchicalLayout,
  classifyEdge,
  edgeStyleFor,
} from "@/lib/layout";
import { ContainerNode } from "@/components/ContainerNode";
import { AwsResourceNode } from "@/components/AwsResourceNode";
import { cn } from "@/lib/cn";
import type { Graph } from "@/types/graph";

const NODE_TYPES = { resource: AwsResourceNode, container: ContainerNode };

interface UIState {
  status: "idle" | "uploading" | "ready" | "error";
  graph: Graph | null;
  error: string | null;
  filename: string | null;
}

/**
 * "Give me a folder of .tf files, draw the diagram of what will be built."
 *
 * Standalone view — no AWS scan, no snapshot persistence, no diff. The graph
 * is requested ephemerally from `/api/tf/diagram` and held only in this
 * component's state so reloading the page resets the experience.
 */
export function TFDiagram() {
  const [ui, setUI] = useState<UIState>({
    status: "idle",
    graph: null,
    error: null,
    filename: null,
  });
  const [nodes, setNodes] = useState<Node[]>([]);
  const canvasRef = useRef<HTMLDivElement | null>(null);

  const onUpload = useCallback(async (file: File) => {
    setUI({ status: "uploading", graph: null, error: null, filename: file.name });
    try {
      const graph = await api.tfDiagramFromZip(file);
      const { nodes: laid } = buildHierarchicalLayout(graph.nodes);
      setNodes(laid);
      setUI({ status: "ready", graph, error: null, filename: file.name });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "upload failed";
      setUI({ status: "error", graph: null, error: message, filename: file.name });
    }
  }, []);

  const reset = useCallback(() => {
    setUI({ status: "idle", graph: null, error: null, filename: null });
    setNodes([]);
  }, []);

  const rfEdges: RFEdge[] = useMemo(() => {
    if (!ui.graph) return [];
    return ui.graph.edges
      // Containment is already shown as a parent/child rectangle.
      .filter((e) => e.type !== "in_vpc" && e.type !== "in_subnet")
      .map((e, i) => {
        const semantic = classifyEdge(e.type);
        return {
          id: `${e.source}|${e.target}|${i}`,
          source: e.source,
          target: e.target,
          type: "smoothstep",
          style: edgeStyleFor(semantic, false),
          data: { semantic },
        };
      });
  }, [ui.graph]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes((nds) => applyNodeChanges(changes, nds)),
    [],
  );

  if (ui.status !== "ready" || !ui.graph) {
    return (
      <DropZone
        status={ui.status}
        error={ui.error}
        filename={ui.filename}
        onPick={onUpload}
      />
    );
  }

  const counts = countByCategory(ui.graph);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="text-sm font-medium text-neutral-900">{ui.filename}</div>
          <div className="text-[11px] font-mono text-neutral-500">
            {ui.graph.nodes.length} resources · {ui.graph.edges.length} relationships
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ExportButton canvasRef={canvasRef} graph={ui.graph} />
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-1.5 text-[12px] text-neutral-600 hover:text-neutral-900 px-2.5 py-1.5 rounded-lg border border-slate-200/70 hover:bg-white"
          >
            <ArrowsClockwise size={14} />
            Upload another
          </button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2 text-[11px]">
        {counts.map((c) => (
          <div
            key={c.label}
            className="rounded-xl border border-slate-200/60 bg-white px-3 py-2"
          >
            <div className="text-neutral-500 font-mono uppercase tracking-wider text-[10px]">
              {c.label}
            </div>
            <div className="text-neutral-900 font-semibold text-base mt-0.5">
              {c.count}
            </div>
          </div>
        ))}
      </div>

      <div
        ref={canvasRef}
        className="relative h-[calc(100dvh-300px)] rounded-3xl border border-slate-200/60 bg-white overflow-hidden"
      >
        <ReactFlow
          nodes={nodes}
          edges={rfEdges}
          nodeTypes={NODE_TYPES}
          onNodesChange={onNodesChange}
          fitView
          minZoom={0.15}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#e2e8f0" />
          <Controls
            className="!shadow-none !border !border-slate-200/60 !rounded-xl !bg-white"
            showInteractive={false}
          />
          <MiniMap
            pannable
            zoomable
            className="!bg-white/90 !border !border-slate-200/60 !rounded-xl"
            maskColor="rgba(241, 245, 249, 0.65)"
            nodeColor={(n) => {
              if (n.type === "container") {
                const kind = (n.data as { kind?: string })?.kind;
                if (kind === "vpc") return "#bae6fd";
                if (kind === "subnet") return "#f1f5f9";
                return "#f5f5f4";
              }
              return "#94a3b8";
            }}
            nodeStrokeWidth={3}
          />
        </ReactFlow>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Drop zone

interface DropZoneProps {
  status: UIState["status"];
  error: string | null;
  filename: string | null;
  onPick: (f: File) => void;
}

function DropZone({ status, error, filename, onPick }: DropZoneProps) {
  const [dragging, setDragging] = useState(false);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      const file = files?.[0];
      if (!file) return;
      if (!file.name.toLowerCase().endsWith(".zip")) {
        // The endpoint enforces this too, but warn early to avoid the round-trip.
        alert("Please upload a .zip file containing your .tf files");
        return;
      }
      onPick(file);
    },
    [onPick],
  );

  return (
    <div className="grid place-items-center min-h-[calc(100dvh-220px)]">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 200, damping: 24 }}
        className={cn(
          "w-full max-w-xl rounded-[2rem] border-2 border-dashed bg-white p-10 text-center transition-colors",
          dragging
            ? "border-slate-400 bg-slate-50"
            : "border-slate-200 hover:border-slate-300",
        )}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          handleFiles(e.dataTransfer.files);
        }}
      >
        <div className="inline-flex w-14 h-14 rounded-2xl items-center justify-center bg-slate-100 text-slate-700 mb-4">
          <FileArchive size={28} weight="duotone" />
        </div>
        <h2 className="text-xl font-semibold tracking-tight text-neutral-900">
          Architecture diagram from a .tf folder
        </h2>
        <p className="text-[13px] text-neutral-500 mt-2 max-w-md mx-auto leading-relaxed">
          Zip your <code className="font-mono text-[12px] text-neutral-700">.tf</code>{" "}
          files and drop the archive here. Cenote parses the HCL directly — no{" "}
          <code className="font-mono text-[12px] text-neutral-700">terraform</code>{" "}
          binary, no AWS credentials, no state file required.
        </p>

        <label className="mt-6 inline-flex items-center gap-2 cursor-pointer rounded-xl bg-neutral-900 text-white px-4 py-2.5 text-[13px] font-medium hover:bg-neutral-800 transition-colors">
          <input
            type="file"
            accept=".zip,application/zip"
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
          Choose .zip file
        </label>

        {status === "uploading" && (
          <div className="mt-4 text-[12px] text-neutral-500">
            Parsing <span className="font-mono">{filename}</span>…
          </div>
        )}
        {status === "error" && (
          <div className="mt-4 text-[12px] text-red-600 max-w-md mx-auto whitespace-pre-wrap">
            {error}
          </div>
        )}

        <div className="mt-8 pt-6 border-t border-slate-100 text-[11px] text-neutral-400 font-mono">
          Supported: VPC · Subnet · SG · RT · IGW · NAT · ALB · TG · EC2 · Lambda · EBS · S3 · RDS
        </div>
      </motion.div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Export

function ExportButton({
  canvasRef,
  graph,
}: {
  canvasRef: React.RefObject<HTMLDivElement>;
  graph: Graph;
}) {
  const [busy, setBusy] = useState(false);

  const exportPng = useCallback(async () => {
    if (!canvasRef.current) return;
    setBusy(true);
    try {
      const { toPng } = await import("html-to-image");
      // Target the React Flow viewport so we capture the whole canvas regardless
      // of zoom/pan, not just what's on screen.
      const viewport = canvasRef.current.querySelector<HTMLElement>(
        ".react-flow__viewport",
      );
      const target = viewport ?? canvasRef.current;
      const dataUrl = await toPng(target, {
        backgroundColor: "#ffffff",
        cacheBust: true,
        pixelRatio: 2,
        // Skip the React Flow controls/minimap from the export.
        filter: (n) => {
          if (!(n instanceof HTMLElement)) return true;
          return !n.classList?.contains("react-flow__controls")
            && !n.classList?.contains("react-flow__minimap")
            && !n.classList?.contains("react-flow__attribution");
        },
      });
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `${slugFromGraph(graph)}.png`;
      a.click();
    } catch (e) {
      // Surface the error visibly; export failures used to fail silently.
      const msg = e instanceof Error ? e.message : "export failed";
      alert(`Export failed: ${msg}`);
    } finally {
      setBusy(false);
    }
  }, [canvasRef, graph]);

  return (
    <button
      type="button"
      onClick={exportPng}
      disabled={busy}
      className="inline-flex items-center gap-1.5 text-[12px] text-white bg-neutral-900 hover:bg-neutral-800 disabled:opacity-50 px-3 py-1.5 rounded-lg"
    >
      <DownloadSimple size={14} weight="bold" />
      {busy ? "Exporting…" : "Export PNG"}
    </button>
  );
}

function slugFromGraph(graph: Graph): string {
  return `cenote-tf-diagram-${graph.snapshot_id.slice(-12)}`;
}

// ────────────────────────────────────────────────────────────────────────────
// Counts

function countByCategory(graph: Graph): { label: string; count: number }[] {
  const cats: Record<string, number> = { Network: 0, Compute: 0, Storage: 0, Data: 0 };
  for (const r of graph.nodes) {
    if (
      r.type.startsWith("aws_vpc")
      || r.type.startsWith("aws_subnet")
      || r.type === "aws_security_group"
      || r.type === "aws_route_table"
      || r.type === "aws_internet_gateway"
      || r.type === "aws_nat_gateway"
      || r.type === "aws_lb"
      || r.type === "aws_lb_target_group"
    ) cats.Network += 1;
    else if (r.type === "aws_instance" || r.type === "aws_lambda_function") cats.Compute += 1;
    else if (r.type === "aws_ebs_volume" || r.type === "aws_s3_bucket") cats.Storage += 1;
    else if (r.type === "aws_db_instance") cats.Data += 1;
  }
  return Object.entries(cats).map(([label, count]) => ({ label, count }));
}
