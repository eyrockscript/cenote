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
import {
  buildHierarchicalLayout,
  classifyEdge,
  edgeStyleFor,
} from "@/lib/layout";
import { resourceState, type Resource } from "@/types/graph";
import { ResourceNode } from "@/components/ResourceNode";
import { ContainerNode } from "@/components/ContainerNode";
import { Filters } from "@/components/Filters";
import { ResourceDetail } from "@/components/ResourceDetail";
import { GraphLegend } from "@/components/GraphLegend";
import { EmptyState } from "@/components/EmptyState";
import { GraphModeToggle } from "@/components/GraphModeToggle";
import { ResourceList } from "@/components/ResourceList";

const NODE_TYPES = { resource: ResourceNode, container: ContainerNode };

export function GraphView() {
  const snapshotId = useStore((s) => s.selectedSnapshotId);
  const graph = useStore((s) => s.graph);
  const setGraph = useStore((s) => s.setGraph);
  const filter = useStore((s) => s.filter);
  const selectedArn = useStore((s) => s.selectedArn);
  const setSelectedArn = useStore((s) => s.setSelectedArn);
  const graphMode = useStore((s) => s.graphMode);

  const [nodes, setNodes] = useState<Node[]>([]);
  const [hoveredArn, setHoveredArn] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!snapshotId) return;
    api.getGraph(snapshotId).then(setGraph).catch(() => setGraph(null));
  }, [snapshotId, setGraph]);

  const filteredResources = useMemo(() => {
    if (!graph) return [];
    let n = graph.nodes;
    if (filter.showDriftOnly) n = n.filter((r) => r.drift.length > 0);
    if (filter.showOrphansOnly) n = n.filter((r) => resourceState(r) === "aws_only");
    if (filter.type) n = n.filter((r) => r.type === filter.type);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      n = n.filter((r) => {
        if (r.name.toLowerCase().includes(q)) return true;
        if (r.id.toLowerCase().includes(q)) return true;
        if (r.type.toLowerCase().includes(q)) return true;
        for (const [k, v] of Object.entries(r.tags || {})) {
          if (k.toLowerCase().includes(q) || v.toLowerCase().includes(q)) return true;
        }
        return false;
      });
    }
    return n;
  }, [graph, filter, search]);

  // Build nodes via hierarchical layout
  const { layoutedNodes, visibleResourceIds } = useMemo(() => {
    if (!graph) return { layoutedNodes: [], visibleResourceIds: new Set<string>() };
    // We still need VPC + Subnet anchors that are in graph.nodes (their .containers.vpc_id etc),
    // so include those structural resources too even if the filter would hide them.
    const allForLayout = filter.type || filter.showDriftOnly || filter.showOrphansOnly || search
      ? [
          ...graph.nodes.filter((r) => r.type === "aws_vpc" || r.type === "aws_subnet"),
          ...filteredResources,
        ]
      : graph.nodes;

    const dedup = new Map<string, Resource>();
    for (const r of allForLayout) dedup.set(r.id, r);
    const { nodes } = buildHierarchicalLayout([...dedup.values()]);
    const visible = new Set(filteredResources.map((r) => r.id));
    return { layoutedNodes: nodes, visibleResourceIds: visible };
  }, [graph, filteredResources, filter, search]);

  useEffect(() => {
    setNodes(layoutedNodes);
  }, [layoutedNodes]);

  // Edge highlighting on hover
  const focusedArn = hoveredArn || selectedArn;
  const neighborArns = useMemo(() => {
    if (!graph || !focusedArn) return new Set<string>();
    const set = new Set<string>();
    for (const e of graph.edges) {
      if (e.source === focusedArn) set.add(e.target);
      if (e.target === focusedArn) set.add(e.source);
    }
    return set;
  }, [graph, focusedArn]);

  // Decorate nodes with dimmed / highlighted state
  const decoratedNodes = useMemo(() => {
    return nodes.map((n) => {
      if (n.type !== "resource") return n;
      const arn = n.id;
      const isVisible = visibleResourceIds.has(arn);
      const isFocused = focusedArn === arn || neighborArns.has(arn);
      return {
        ...n,
        data: {
          ...n.data,
          dimmed: !isVisible || (focusedArn != null && !isFocused),
          highlighted: focusedArn === arn,
        },
        hidden: false,
      };
    });
  }, [nodes, visibleResourceIds, focusedArn, neighborArns]);

  const rfEdges: RFEdge[] = useMemo(() => {
    if (!graph) return [];
    return graph.edges
      .filter((e) => {
        // Hide edges whose endpoints are filtered out OR are container relations
        // we already represent via parent-child grouping.
        if (e.type === "in_subnet" || e.type === "in_vpc") return false;
        return visibleResourceIds.has(e.source) && visibleResourceIds.has(e.target);
      })
      .map((e, i) => {
        const semantic = classifyEdge(e.type);
        const isFocused =
          focusedArn != null && (e.source === focusedArn || e.target === focusedArn);
        return {
          id: `${e.source}|${e.target}|${i}`,
          source: e.source,
          target: e.target,
          type: "smoothstep",
          style: edgeStyleFor(semantic, isFocused),
          data: { semantic },
          zIndex: isFocused ? 1000 : 1,
        };
      });
  }, [graph, visibleResourceIds, focusedArn]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes((nds) => applyNodeChanges(changes, nds)),
    [],
  );

  const onNodeClick = useCallback(
    (_: unknown, node: Node) => {
      if (node.type === "resource") setSelectedArn(node.id);
    },
    [setSelectedArn],
  );

  const onNodeMouseEnter = useCallback(
    (_: unknown, node: Node) => {
      if (node.type === "resource") setHoveredArn(node.id);
    },
    [],
  );
  const onNodeMouseLeave = useCallback(() => setHoveredArn(null), []);

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

  return (
    <div className="space-y-4">
      <Filters
        resources={graph.nodes}
        search={search}
        onSearchChange={setSearch}
      />

      <div className="flex items-center justify-between gap-3">
        <GraphModeToggle />
        <div className="text-[11px] font-mono text-neutral-500">
          {filteredResources.length} of {graph.nodes.length}
        </div>
      </div>

      {graphMode === "list" ? (
        <div className="relative">
          <ResourceList resources={filteredResources} />
          <ResourceDetail resource={selectedResource} />
        </div>
      ) : (
        <div className="relative h-[calc(100dvh-300px)] rounded-3xl border border-slate-200/60 bg-white overflow-hidden">
          <ReactFlow
            nodes={decoratedNodes}
            edges={rfEdges}
            nodeTypes={NODE_TYPES}
            onNodesChange={onNodesChange}
            onNodeClick={onNodeClick}
            onNodeMouseEnter={onNodeMouseEnter}
            onNodeMouseLeave={onNodeMouseLeave}
            onPaneClick={() => setSelectedArn(null)}
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
                const state = (n.data as { state?: string })?.state;
                if (state === "drift") return "#ef4444";
                if (state === "aws_only") return "#f59e0b";
                if (state === "tf_only") return "#94a3b8";
                return "#10b981";
              }}
              nodeStrokeWidth={3}
            />
          </ReactFlow>
          <GraphLegend />
          <ResourceDetail resource={selectedResource} />
        </div>
      )}
    </div>
  );
}
