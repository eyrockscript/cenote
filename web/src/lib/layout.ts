import dagre from "dagre";
import type { Node, Edge as RFEdge } from "reactflow";

export function dagreLayout(nodes: Node[], edges: RFEdge[], direction: "LR" | "TB" = "TB") {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: direction, nodesep: 50, ranksep: 80 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const n of nodes) {
    g.setNode(n.id, { width: 180, height: 70 });
  }
  for (const e of edges) {
    g.setEdge(e.source, e.target);
  }
  dagre.layout(g);

  return {
    nodes: nodes.map((n) => {
      const pos = g.node(n.id);
      return {
        ...n,
        position: { x: pos.x - 90, y: pos.y - 35 },
        targetPosition: direction === "TB" ? "top" : ("left" as any),
        sourcePosition: direction === "TB" ? "bottom" : ("right" as any),
      };
    }),
    edges,
  };
}
