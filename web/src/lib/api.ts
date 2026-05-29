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

/** Optional, per-request AWS credentials for high-fidelity TF plans. Never
 *  persisted — held only in component state and sent as multipart fields. */
export interface AwsCreds {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  region?: string;
}

export interface CredCheck {
  ok: boolean;
  account_id?: string;
  arn?: string;
  code?: string;
  error?: string;
  hint?: string | null;
}

/** Optional GitLab CI/CD source for resolving `var.*` (non-masked only). The
 *  token is sensitive — sent per-request as a multipart field, never stored. */
export interface GitlabSource {
  token: string;
  project?: string;
  group?: string;
  environment?: string;
  baseUrl?: string;
}

/** Non-sensitive view of server-side saved credentials. Secret values are
 *  never returned — only whether each is configured plus a few hints. */
export interface SavedCredentialsStatus {
  aws: { configured: boolean; access_key_tail: string | null; region: string | null };
  gitlab: {
    configured: boolean;
    project: string | null;
    group: string | null;
    environment: string | null;
  };
  tf_vars: { configured: boolean; count: number; names: string[] };
}

export interface SaveCredentialsBody {
  aws_access_key_id?: string;
  aws_secret_access_key?: string;
  aws_session_token?: string;
  aws_region?: string;
  gitlab_token?: string;
  gitlab_project?: string;
  gitlab_group?: string;
  gitlab_environment?: string;
  gitlab_base_url?: string;
  // Manual TF_VAR_* values stored encrypted on the server. Keys are bare names
  // (no TF_VAR_ prefix). Set `tf_vars_replace: true` to wipe existing entries
  // instead of merging.
  tf_vars?: Record<string, string>;
  tf_vars_replace?: boolean;
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

  // TF-only architecture diagram from a zip of .tf files. The result is
  // ephemeral — nothing is persisted server-side.
  //
  // `mode: "plan"` runs terraform init+plan+show inside the container, which
  // resolves modules, count/for_each, variables and gives each node a
  // planned_action. Slower (~30-60s first time) and may fail if data sources
  // need real AWS credentials.
  //
  // `mode: "hcl"` parses raw .tf files; fast and creds-free but produces
  // less accurate edges (no module expansion, no variable resolution).
  // Pre-flight credential check: calls sts:GetCallerIdentity from the api
  // container so the user knows in <1s whether the keys work here.
  // Server-side saved credentials (encrypted at rest, configured once).
  getSavedCredentials: () =>
    req<SavedCredentialsStatus>("/api/settings/credentials"),
  saveCredentials: (body: SaveCredentialsBody) =>
    req<SavedCredentialsStatus>("/api/settings/credentials", {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  clearCredentials: () =>
    req<{ cleared: boolean }>("/api/settings/credentials", { method: "DELETE" }),

  validateCreds: async (creds: AwsCreds): Promise<CredCheck> => {
    const form = new FormData();
    form.append("aws_access_key_id", creds.accessKeyId);
    form.append("aws_secret_access_key", creds.secretAccessKey);
    if (creds.sessionToken) form.append("aws_session_token", creds.sessionToken);
    if (creds.region) form.append("aws_region", creds.region);
    const r = await fetch(`${BASE}/api/aws/validate-creds`, { method: "POST", body: form });
    return r.json() as Promise<CredCheck>;
  },

  tfDiagram: async (
    zipFile: File,
    mode: "plan" | "hcl",
    creds?: AwsCreds,
    gitlab?: GitlabSource,
    tfVarsText?: string,
  ): Promise<Graph> => {
    const form = new FormData();
    form.append("file", zipFile);
    // Credentials only apply to the plan path and are sent per-request as
    // multipart fields; they are never stored client-side.
    if (mode === "plan" && creds?.accessKeyId && creds?.secretAccessKey) {
      form.append("aws_access_key_id", creds.accessKeyId);
      form.append("aws_secret_access_key", creds.secretAccessKey);
      if (creds.sessionToken) form.append("aws_session_token", creds.sessionToken);
      if (creds.region) form.append("aws_region", creds.region);
    }
    if (mode === "plan" && gitlab?.token && (gitlab.project || gitlab.group)) {
      form.append("gitlab_token", gitlab.token);
      if (gitlab.project) form.append("gitlab_project", gitlab.project);
      if (gitlab.group) form.append("gitlab_group", gitlab.group);
      if (gitlab.environment) form.append("gitlab_environment", gitlab.environment);
      if (gitlab.baseUrl) form.append("gitlab_base_url", gitlab.baseUrl);
    }
    if (mode === "plan" && tfVarsText && tfVarsText.trim()) {
      form.append("tf_vars_text", tfVarsText);
    }
    const path = mode === "plan" ? "/api/tf/diagram/plan" : "/api/tf/diagram";
    const r = await fetch(`${BASE}${path}`, { method: "POST", body: form });
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      throw new Error(t || `${r.status} ${r.statusText}`);
    }
    return r.json() as Promise<Graph>;
  },
};
