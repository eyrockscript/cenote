import type { Graph, GraphDiff, Snapshot } from "@/types/graph";

const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    headers: { "content-type": "application/json", ...(init?.headers || {}) },
    ...init,
  });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`${r.status} ${r.statusText} — ${text}`);
  }
  return r.json() as Promise<T>;
}

export interface AwsHealth {
  ok: boolean;
  account_id?: string;
  principal_arn?: string;
  region?: string;
  profile?: string;
  error?: string;
}

export interface RegionList {
  current: string;
  regions: string[];
  source: "account" | "static";
}

export const api = {
  health: () => req<{ status: string; version: string }>("/health"),
  healthAws: () => req<AwsHealth>("/api/health/aws"),
  listRegions: () => req<RegionList>("/api/aws/regions"),
  listSnapshots: () => req<Snapshot[]>("/api/snapshots"),
  getGraph: (id: string) => req<Graph>(`/api/snapshots/${id}/graph`),
  getDiff: (baseId: string, headId: string) =>
    req<GraphDiff>(`/api/snapshots/${baseId}/diff/${headId}`),
  scan: (body: {
    region?: string;
    tfstate_path?: string;
    tfstate_s3?: string;
    tfplan_path?: string;
    terraform_dir?: string;
    include_authorship?: boolean;
  }) =>
    req<Snapshot>("/api/scan", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  uploadArtifact: async (file: File, kind: "tfstate" | "plan" = "tfstate") => {
    const form = new FormData();
    form.append("file", file);
    const r = await fetch(`${BASE}/api/upload?kind=${kind}`, {
      method: "POST",
      body: form,
    });
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      throw new Error(`upload failed: ${r.status} ${t}`);
    }
    return r.json() as Promise<{ path: string; kind: string }>;
  },
  deleteSnapshot: async (id: string): Promise<void> => {
    const r = await fetch(`${BASE}/api/snapshots/${id}`, { method: "DELETE" });
    if (!r.ok && r.status !== 204) {
      throw new Error(`delete failed: ${r.status}`);
    }
  },
  deleteAllSnapshots: () =>
    req<{ deleted: number }>("/api/snapshots", { method: "DELETE" }),
};
