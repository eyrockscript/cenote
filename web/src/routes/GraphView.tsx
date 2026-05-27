import { useCallback, useEffect, useMemo, useState } from "react";
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

import { api } from "@/lib/api";
import { useStore } from "@/lib/store";
import { dagreLayout } from "@/lib/layout";
import { resourceState, type Resource } from "@/types/graph";
import { ResourceNode } from "@/components/ResourceNode";
import { Filters } from "@/components/Filters";
import { ResourceDetail } from "@/components/ResourceDetail";
import { EmptyState } from "@/components/EmptyState";

const NODE_TYPES = { resource: ResourceNode };

export function GraphView() {
  const snapshotId = useStore((s) => s.selectedSnapshotId);
  const graph = useStore((s) => s.graph);
  const setGraph = useStore((s) => s.setGraph);
  const filter = useStore((s) => s.filter);
  const selectedArn = useStore((s) => s.selectedArn);
  const setSelectedArn = useStore((s) => s.setSelectedArn);

  const [nodes, setNodes] = useState<Node[]>([]);

  useEffect(() => {
    if (!snapshotId) return;
    api.getGraph(snapshotId).then(setGraph).catch(() => setGraph(null));
  }, [snapshotId, setGraph]);

  const filtered = useMemo(() => {
    if (!graph) return null;
    let n = graph.nodes;
    if (filter.showDriftOnly) n = n.filter((r) => r.drift.length > 0);
    if (filter.showOrphansOnly) n = n.filter((r) => resourceState(r) === "aws_only");
    if (filter.type) n = n.filter((r) => r.type === filter.type);
    const ids = new Set(n.map((r) => r.id));
    const e = graph.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target));
    return { nodes: n, edges: e };
  }, [graph, filter]);

  useEffect(() => {
    if (!filtered) {
      setNodes([]);
      return;
    }
    const rfNodes: Node[] = filtered.nodes.map((r) => ({
      id: r.id,
      type: "resource",
      position: { x: 0, y: 0 },
      data: { resource: r, state: resourceState(r) },
    }));
    const rfEdges: RFEdge[] = filtered.edges.map((e, i) => ({
      id: `${e.source}-${e.target}-${i}`,
      source: e.source,
      target: e.target,
      type: "smoothstep",
      animated: false,
      style: { stroke: "#cbd5e1", strokeWidth: 1.2 },
    }));
    const laid = dagreLayout(rfNodes, rfEdges, "TB");
    setNodes(laid.nodes);
  }, [filtered]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes((nds) => applyNodeChanges(changes, nds)),
    [],
  );

  const onNodeClick = useCallback(
    (_: unknown, node: Node) => setSelectedArn(node.id),
    [setSelectedArn],
  );

  const types = useMemo(() => {
    if (!graph) return [];
    return Array.from(new Set(graph.nodes.map((r) => r.type))).sort();
  }, [graph]);

  const selectedResource: Resource | null = useMemo(() => {
    if (!graph || !selectedArn) return null;
    return graph.nodes.find((r) => r.id === selectedArn) ?? null;
  }, [graph, selectedArn]);

  if (!snapshotId) {
    return (
      <EmptyState
        title="Select a snapshot"
        desc="Go to the Dashboard and pick or create a snapshot to render the graph."
      />
    );
  }

  if (!graph || graph.nodes.length === 0) {
    return (
      <EmptyState
        title="Empty snapshot"
        desc="This snapshot has no resources. Re-run the scan or check IAM permissions."
      />
    );
  }

  const rfEdges: RFEdge[] = filtered
    ? filtered.edges.map((e, i) => ({
        id: `${e.source}-${e.target}-${i}`,
        source: e.source,
        target: e.target,
        type: "smoothstep",
        style: { stroke: "#cbd5e1", strokeWidth: 1.2 },
      }))
    : [];

  return (
    <div className="space-y-4">
      <Filters types={types} />
      <div className="relative h-[calc(100dvh-220px)] rounded-3xl border border-slate-200/60 bg-white overflow-hidden">
        <ReactFlow
          nodes={nodes}
          edges={rfEdges}
          nodeTypes={NODE_TYPES}
          onNodesChange={onNodesChange}
          onNodeClick={onNodeClick}
          onPaneClick={() => setSelectedArn(null)}
          fitView
          minZoom={0.2}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#e2e8f0" />
          <Controls className="!shadow-none !border !border-slate-200/60 !rounded-xl" />
          <MiniMap
            pannable
            zoomable
            className="!bg-white !border !border-slate-200/60 !rounded-xl"
            maskColor="rgba(241, 245, 249, 0.7)"
            nodeColor={(n) => {
              const state = (n.data as { state?: string })?.state;
              if (state === "drift") return "#ef4444";
              if (state === "aws_only") return "#f59e0b";
              if (state === "tf_only") return "#94a3b8";
              return "#10b981";
            }}
          />
        </ReactFlow>
        <ResourceDetail resource={selectedResource} />
      </div>
    </div>
  );
}
