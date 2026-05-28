/**
 * Hierarchical graph layout for AWS resources.
 *
 * Structure:
 *   Global container (no VPC) — S3, IAM, orphan Lambdas, etc.
 *   ┌─ VPC ────────────────────────────────────────┐
 *   │  VPC-level resources (SG, RT, IGW, NAT…)     │
 *   │  ┌─ Subnet ────┐  ┌─ Subnet ────┐            │
 *   │  │  EC2, RDS,  │  │  EC2, NAT,  │            │
 *   │  │  Lambda…    │  │  …          │            │
 *   │  └─────────────┘  └─────────────┘            │
 *   └──────────────────────────────────────────────┘
 */

import type { Node, Edge as RFEdge } from "reactflow";
import type { Resource } from "@/types/graph";

const RESOURCE_W = 190;
const RESOURCE_H = 96;
const RESOURCE_GAP_X = 24;
const RESOURCE_GAP_Y = 20;
const HEADER_H = 56;
const PAD = 22;
const SUBNET_GAP = 28;
const VPC_GAP = 36;
const GLOBAL_GAP = 36;
const COLS_PER_SUBNET = 3;
const COLS_PER_GLOBAL = 6;

interface VpcGroup {
  id: string;                 // vpc id
  name: string;
  vpcLevel: Resource[];       // SG/RT/IGW/NAT without a subnet
  subnets: Map<string, { name: string; resources: Resource[] }>;
}

export interface LayoutOutput {
  nodes: Node[];
  // containers expose their resources for edge filtering / focus, but the
  // GraphView mostly only needs the node array.
}

function _resourceLabel(r: Resource): string {
  return r.name || r.id;
}

export function buildHierarchicalLayout(resources: Resource[]): {
  nodes: Node[];
  resourceParent: Map<string, string>; // resource arn -> container node id
} {
  // Bucket resources by VPC + subnet
  const byVpc = new Map<string | null, VpcGroup>();
  const ungrouped: Resource[] = [];

  // First pass: find the VPC name for any VPC we encounter as a container
  const vpcNames = new Map<string, string>();
  for (const r of resources) {
    if (r.type === "aws_vpc") {
      const vpcId = (r.aws_state?.attributes?.id as string) || r.id;
      vpcNames.set(vpcId, _resourceLabel(r));
    }
  }
  const subnetNames = new Map<string, string>();
  for (const r of resources) {
    if (r.type === "aws_subnet") {
      const sid = (r.aws_state?.attributes?.id as string) || r.id;
      subnetNames.set(sid, _resourceLabel(r));
    }
  }

  for (const r of resources) {
    // VPC and Subnet themselves are NOT placed as nodes — they become containers
    if (r.type === "aws_vpc" || r.type === "aws_subnet") continue;

    const vpcId = r.containers?.vpc_id || null;
    const subnetId = r.containers?.subnet_id || null;

    if (!vpcId) {
      ungrouped.push(r);
      continue;
    }

    if (!byVpc.has(vpcId)) {
      byVpc.set(vpcId, {
        id: vpcId,
        name: vpcNames.get(vpcId) || vpcId,
        vpcLevel: [],
        subnets: new Map(),
      });
    }
    const vpc = byVpc.get(vpcId)!;

    if (subnetId) {
      if (!vpc.subnets.has(subnetId)) {
        vpc.subnets.set(subnetId, {
          name: subnetNames.get(subnetId) || subnetId,
          resources: [],
        });
      }
      vpc.subnets.get(subnetId)!.resources.push(r);
    } else {
      vpc.vpcLevel.push(r);
    }
  }

  // Also include VPCs declared in TF that have no resources inside (or any vpc
  // we know about that didn't appear yet)
  for (const [vpcId, name] of vpcNames) {
    if (!byVpc.has(vpcId)) {
      byVpc.set(vpcId, { id: vpcId, name, vpcLevel: [], subnets: new Map() });
    }
  }

  const nodes: Node[] = [];
  const resourceParent = new Map<string, string>();

  let cursorY = 0;

  // Layout each VPC
  for (const vpc of byVpc.values()) {
    const vpcContainerId = `container:vpc:${vpc.id}`;
    const subnetEntries = [...vpc.subnets.entries()];
    const subnetCount = subnetEntries.length;

    // Lay out subnets in a row inside the VPC
    const subnetSlots: { id: string; w: number; h: number; resources: Resource[] }[] = [];
    let totalSubnetWidth = 0;
    for (const [sid, sn] of subnetEntries) {
      const cols = Math.min(COLS_PER_SUBNET, Math.max(1, sn.resources.length));
      const rows = Math.ceil(sn.resources.length / cols) || 1;
      const w = PAD * 2 + cols * RESOURCE_W + (cols - 1) * RESOURCE_GAP_X;
      const h = HEADER_H + PAD + rows * RESOURCE_H + (rows - 1) * RESOURCE_GAP_Y + PAD;
      subnetSlots.push({ id: sid, w, h, resources: sn.resources });
      totalSubnetWidth += w;
    }
    if (subnetCount > 1) totalSubnetWidth += (subnetCount - 1) * SUBNET_GAP;

    // VPC-level resources row (laid out in a wide row at the bottom of the VPC)
    const vpcLevelCols = Math.max(1, Math.min(6, vpc.vpcLevel.length));
    const vpcLevelRows = Math.ceil(vpc.vpcLevel.length / vpcLevelCols) || 0;
    const vpcLevelWidth =
      vpc.vpcLevel.length > 0
        ? vpcLevelCols * RESOURCE_W + (vpcLevelCols - 1) * RESOURCE_GAP_X
        : 0;
    const vpcLevelHeight =
      vpcLevelRows > 0 ? vpcLevelRows * RESOURCE_H + (vpcLevelRows - 1) * RESOURCE_GAP_Y : 0;

    const innerWidth = Math.max(totalSubnetWidth, vpcLevelWidth, 320);
    const subnetsHeight = subnetSlots.reduce((m, s) => Math.max(m, s.h), 0);
    const vpcInnerHeight =
      HEADER_H +
      (subnetsHeight > 0 ? subnetsHeight + PAD : 0) +
      (vpcLevelHeight > 0 ? vpcLevelHeight + PAD : 0) +
      PAD;
    const vpcWidth = innerWidth + PAD * 2;
    const vpcHeight = vpcInnerHeight;

    nodes.push({
      id: vpcContainerId,
      type: "container",
      position: { x: 0, y: cursorY },
      data: { kind: "vpc", title: vpc.name, subtitle: vpc.id, badge: `vpc · ${vpc.subnets.size} subnet${vpc.subnets.size === 1 ? "" : "s"}` },
      style: { width: vpcWidth, height: vpcHeight, zIndex: 0 },
      selectable: false,
      draggable: false,
    });

    // Subnets (children of VPC)
    let subnetCursorX = PAD;
    const subnetsY = HEADER_H;
    for (const slot of subnetSlots) {
      const subnetContainerId = `container:subnet:${slot.id}`;
      nodes.push({
        id: subnetContainerId,
        type: "container",
        parentNode: vpcContainerId,
        extent: "parent",
        position: { x: subnetCursorX, y: subnetsY },
        data: { kind: "subnet", title: slot.resources[0]?.containers?.subnet_id ? (subnetNames.get(slot.id) || slot.id) : slot.id, subtitle: slot.id },
        style: { width: slot.w, height: slot.h, zIndex: 1 },
        selectable: false,
        draggable: false,
      });

      // Resources in this subnet
      slot.resources.forEach((r, i) => {
        const col = i % COLS_PER_SUBNET;
        const row = Math.floor(i / COLS_PER_SUBNET);
        nodes.push({
          id: r.id,
          type: "resource",
          parentNode: subnetContainerId,
          extent: "parent",
          position: {
            x: PAD + col * (RESOURCE_W + RESOURCE_GAP_X),
            y: HEADER_H + row * (RESOURCE_H + RESOURCE_GAP_Y),
          },
          data: { resource: r, state: _stateOf(r) },
          style: { zIndex: 2 },
        });
        resourceParent.set(r.id, subnetContainerId);
      });

      subnetCursorX += slot.w + SUBNET_GAP;
    }

    // VPC-level resources (free row inside the VPC, below subnets)
    if (vpc.vpcLevel.length > 0) {
      const vpcLevelY = subnetsY + subnetsHeight + (subnetsHeight > 0 ? PAD : 0);
      vpc.vpcLevel.forEach((r, i) => {
        const col = i % vpcLevelCols;
        const row = Math.floor(i / vpcLevelCols);
        nodes.push({
          id: r.id,
          type: "resource",
          parentNode: vpcContainerId,
          extent: "parent",
          position: {
            x: PAD + col * (RESOURCE_W + RESOURCE_GAP_X),
            y: vpcLevelY + row * (RESOURCE_H + RESOURCE_GAP_Y),
          },
          data: { resource: r, state: _stateOf(r) },
          style: { zIndex: 2 },
        });
        resourceParent.set(r.id, vpcContainerId);
      });
    }

    cursorY += vpcHeight + VPC_GAP;
  }

  // Global (no VPC) container — only if needed
  if (ungrouped.length > 0) {
    const cols = Math.min(COLS_PER_GLOBAL, ungrouped.length);
    const rows = Math.ceil(ungrouped.length / cols);
    const w = PAD * 2 + cols * RESOURCE_W + (cols - 1) * RESOURCE_GAP_X;
    const h = HEADER_H + PAD + rows * RESOURCE_H + (rows - 1) * RESOURCE_GAP_Y + PAD;
    const globalId = "container:global";
    nodes.push({
      id: globalId,
      type: "container",
      position: { x: 0, y: cursorY },
      data: {
        kind: "global",
        title: "Outside any VPC",
        subtitle: "S3, IAM, Lambda…",
        badge: `${ungrouped.length} resource${ungrouped.length === 1 ? "" : "s"}`,
      },
      style: { width: w, height: h, zIndex: 0 },
      selectable: false,
      draggable: false,
    });
    ungrouped.forEach((r, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      nodes.push({
        id: r.id,
        type: "resource",
        parentNode: globalId,
        extent: "parent",
        position: {
          x: PAD + col * (RESOURCE_W + RESOURCE_GAP_X),
          y: HEADER_H + row * (RESOURCE_H + RESOURCE_GAP_Y),
        },
        data: { resource: r, state: _stateOf(r) },
        style: { zIndex: 2 },
      });
      resourceParent.set(r.id, globalId);
    });
    cursorY += h + GLOBAL_GAP;
  }

  return { nodes, resourceParent };
}

function _stateOf(r: Resource): "matched" | "drift" | "tf_only" | "aws_only" {
  if (r.tf_state && r.aws_state) {
    return r.drift.length > 0 ? "drift" : "matched";
  }
  if (r.tf_state) return "tf_only";
  return "aws_only";
}

// ────────────────────────────────────────────────────────────────────────────
// Edge styling

export type StyledEdge = RFEdge & {
  data?: { semantic: EdgeSemantic };
};

export type EdgeSemantic = "containment" | "uses" | "routes" | "attaches" | "references" | "targets";

const EDGE_TYPE_TO_SEMANTIC: Record<string, EdgeSemantic> = {
  in_vpc: "containment",
  in_subnet: "containment",
  attached_to: "attaches",
  mounts: "attaches",
  uses_sg: "uses",
  routes_via: "routes",
  routes_to: "routes",
  references_sg: "references",
  targets: "targets",
};

export function classifyEdge(edgeType: string): EdgeSemantic {
  return EDGE_TYPE_TO_SEMANTIC[edgeType] ?? "uses";
}

const SEMANTIC_STYLE: Record<EdgeSemantic, { stroke: string; strokeWidth: number; strokeDasharray?: string; animated?: boolean }> = {
  containment: { stroke: "#cbd5e1", strokeWidth: 1, strokeDasharray: "2 4" },
  uses:        { stroke: "#94a3b8", strokeWidth: 1.2 },
  routes:      { stroke: "#0ea5e9", strokeWidth: 1.6 },
  attaches:    { stroke: "#a78bfa", strokeWidth: 1.4 },
  references:  { stroke: "#f59e0b", strokeWidth: 1.2, strokeDasharray: "3 3" },
  targets:     { stroke: "#10b981", strokeWidth: 1.6 },
};

export function edgeStyleFor(semantic: EdgeSemantic, highlighted: boolean): React.CSSProperties {
  const base = SEMANTIC_STYLE[semantic];
  return {
    stroke: highlighted ? "#0a0a0a" : base.stroke,
    strokeWidth: highlighted ? base.strokeWidth + 1 : base.strokeWidth,
    strokeDasharray: base.strokeDasharray,
    opacity: highlighted ? 1 : 0.7,
  };
}

export const EDGE_LEGEND: { semantic: EdgeSemantic; label: string }[] = [
  { semantic: "containment", label: "Containment" },
  { semantic: "uses", label: "Uses" },
  { semantic: "routes", label: "Routes" },
  { semantic: "attaches", label: "Attaches" },
  { semantic: "references", label: "References" },
  { semantic: "targets", label: "Targets" },
];

export function edgeLegendColor(semantic: EdgeSemantic): string {
  return SEMANTIC_STYLE[semantic].stroke;
}
