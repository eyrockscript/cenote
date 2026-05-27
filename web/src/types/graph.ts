export type DriftSeverity = "high" | "medium" | "low";
export type ResourceState = "matched" | "drift" | "tf_only" | "aws_only";
export type AuthorVia =
  | "Terraform"
  | "Console"
  | "CLI"
  | "SDK"
  | "CloudFormation"
  | "Unknown";

export interface DriftField {
  field: string;
  tf_value: unknown;
  aws_value: unknown;
  severity: DriftSeverity;
}

export interface Author {
  principal_arn: string | null;
  principal_name: string | null;
  via: AuthorVia;
  event_id: string | null;
  event_time: string | null;
  confidence: number;
}

export interface Containers {
  vpc_id: string | null;
  subnet_id: string | null;
  az: string | null;
}

export interface Resource {
  id: string;
  type: string;
  name: string;
  region: string;
  account_id: string;
  tf_state: { address: string; module: string | null; attributes: Record<string, unknown> } | null;
  aws_state: { attributes: Record<string, unknown>; last_seen: string } | null;
  drift: DriftField[];
  author: Author | null;
  tags: Record<string, string>;
  containers: Containers;
  blast_radius: number;
}

export interface Edge {
  source: string;
  target: string;
  type: string;
  metadata: Record<string, unknown>;
  discovered_via: string;
}

export interface Graph {
  snapshot_id: string;
  nodes: Resource[];
  edges: Edge[];
}

export interface Snapshot {
  id: string;
  account_id: string;
  region: string;
  created_at: string;
  source: "live" | "plan" | "tfstate";
  resource_count: number;
  drift_count: number;
  orphan_count: number;
  declared_only_count: number;
}

export type ChangeKind = "added" | "removed" | "modified" | "unchanged";

export interface FieldChange {
  field: string;
  before: unknown;
  after: unknown;
}

export interface ResourceChange {
  arn: string;
  type: string;
  name: string;
  change: ChangeKind;
  fields: FieldChange[];
}

export interface GraphDiff {
  base_snapshot: string;
  head_snapshot: string;
  added: ResourceChange[];
  removed: ResourceChange[];
  modified: ResourceChange[];
  unchanged_count: number;
}

export function resourceState(r: Resource): ResourceState {
  if (r.tf_state && r.aws_state) {
    return r.drift.length > 0 ? "drift" : "matched";
  }
  if (r.tf_state) return "tf_only";
  return "aws_only";
}
