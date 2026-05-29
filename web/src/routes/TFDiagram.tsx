import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { FileArchive, DownloadSimple, ArrowsClockwise, CaretRight, LockSimple, Eye, EyeSlash, ShieldCheck } from "@phosphor-icons/react";

import { api, type AwsCreds, type CredCheck } from "@/lib/api";
import {
  buildHierarchicalLayout,
  classifyEdge,
  edgeStyleFor,
} from "@/lib/layout";
import { ContainerNode } from "@/components/ContainerNode";
import { AwsResourceNode } from "@/components/AwsResourceNode";
import { ResourceDetailPanel } from "@/components/ResourceDetailPanel";
import { awsCategory, CATEGORY_LABEL } from "@/components/AwsServiceIcon";
import { Spinner } from "@/components/Spinner";
import { cn } from "@/lib/cn";
import type { Graph } from "@/types/graph";

const NODE_TYPES = { resource: AwsResourceNode, container: ContainerNode };

type ParseMode = "plan" | "hcl";

interface UIState {
  status: "idle" | "uploading" | "ready" | "error";
  graph: Graph | null;
  error: string | null;
  filename: string | null;
  mode: ParseMode | null;        // which parser ultimately produced the graph
  fallbackReason: string | null; // populated when we fell back from plan→hcl
  phase: ParseMode | null;       // which step is currently running (while uploading)
  credsError: string | null;     // set when supplied AWS creds were rejected by AWS
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
    mode: null,
    fallbackReason: null,
    phase: null,
    credsError: null,
  });
  const [nodes, setNodes] = useState<Node[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);

  const onUpload = useCallback(async (file: File, creds?: AwsCreds) => {
    setUI({
      status: "uploading",
      graph: null,
      error: null,
      filename: file.name,
      mode: null,
      fallbackReason: null,
      phase: "plan",
      credsError: null,
    });
    // Try the high-fidelity plan path first (resolves modules, count,
    // for_each, variables, gives planned actions). Fall back to raw HCL
    // parsing if terraform plan can't run — typically when a `data` source
    // requires real AWS credentials, or the providers can't be downloaded.
    let graph: Graph | null = null;
    let mode: ParseMode = "plan";
    let fallbackReason: string | null = null;
    let credsError: string | null = null;
    try {
      graph = await api.tfDiagram(file, "plan", creds);
    } catch (planErr) {
      const planMessage =
        planErr instanceof Error ? planErr.message : String(planErr);
      setUI((prev) => ({ ...prev, phase: "hcl" }));
      // If the user supplied credentials and AWS rejected them, that's a hard
      // error they need to fix — surface it prominently instead of burying it
      // in the generic amber "fallback" note.
      if (creds && _isCredentialError(planMessage)) {
        credsError = _credentialHelp(creds, planMessage);
      }
      try {
        graph = await api.tfDiagram(file, "hcl");
        mode = "hcl";
        fallbackReason = credsError ? null : _shortErrorReason(planMessage);
      } catch (hclErr) {
        const message = hclErr instanceof Error ? hclErr.message : "upload failed";
        setUI({
          status: "error",
          graph: null,
          error: message,
          filename: file.name,
          mode: null,
          fallbackReason: null,
          phase: null,
          credsError: null,
        });
        return;
      }
    }
    const { nodes: laid } = buildHierarchicalLayout(graph.nodes);
    setNodes(laid);
    setUI({
      status: "ready",
      graph,
      error: null,
      filename: file.name,
      mode,
      fallbackReason,
      phase: null,
      credsError,
    });
  }, []);

  const reset = useCallback(() => {
    setUI({
      status: "idle",
      graph: null,
      error: null,
      filename: null,
      mode: null,
      fallbackReason: null,
      phase: null,
      credsError: null,
    });
    setNodes([]);
    setSelectedId(null);
  }, []);

  // Resources that already exist in AWS (data sources) — new resources that
  // point at one of these are "plugging into existing infra".
  const existingIds = useMemo(
    () =>
      new Set(
        (ui.graph?.nodes ?? [])
          .filter((n) => n.planned_action === "read")
          .map((n) => n.id),
      ),
    [ui.graph],
  );

  const rfEdges: RFEdge[] = useMemo(() => {
    if (!ui.graph) return [];
    return ui.graph.edges
      // Containment is already shown as a parent/child rectangle.
      .filter((e) => e.type !== "in_vpc" && e.type !== "in_subnet")
      .map((e, i) => {
        const semantic = classifyEdge(e.type);
        const toExisting = existingIds.has(e.target);
        const base = edgeStyleFor(semantic, false);
        return {
          id: `${e.source}|${e.target}|${i}`,
          source: e.source,
          target: e.target,
          type: "smoothstep",
          // Connections into existing infra are dashed + labelled so it's
          // obvious where the new stack hooks into what's already there.
          style: toExisting
            ? { ...base, stroke: "#64748b", strokeDasharray: "5 4" }
            : base,
          label: toExisting ? "connects to existing" : undefined,
          labelStyle: toExisting
            ? { fontSize: 9, fill: "#475569", fontFamily: "monospace" }
            : undefined,
          labelBgStyle: toExisting ? { fill: "#f8fafc" } : undefined,
          data: { semantic },
        };
      });
  }, [ui.graph, existingIds]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes((nds) => applyNodeChanges(changes, nds)),
    [],
  );

  const onNodeClick = useCallback((_: unknown, node: Node) => {
    // Containers (VPC/subnet rectangles) aren't resources — ignore.
    if (node.type === "container") return;
    setSelectedId(node.id);
  }, []);

  const onPaneClick = useCallback(() => setSelectedId(null), []);

  const selectedResource = useMemo(
    () => ui.graph?.nodes.find((n) => n.id === selectedId) ?? null,
    [ui.graph, selectedId],
  );

  if (ui.status === "uploading") {
    return <PlanningView filename={ui.filename} phase={ui.phase} />;
  }

  if (ui.status !== "ready" || !ui.graph) {
    return (
      <DropZone status={ui.status} error={ui.error} onPick={onUpload} />
    );
  }

  const counts = countByCategory(ui.graph);
  const actionCounts = countByAction(ui.graph);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="text-sm font-medium text-neutral-900">{ui.filename}</div>
          <div className="text-[11px] font-mono text-neutral-500">
            {ui.graph.nodes.length} resources · {ui.graph.edges.length} relationships
          </div>
          <ModeBadge mode={ui.mode} />
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

      {ui.credsError && (
        <div className="rounded-xl border border-red-200 bg-red-50/70 px-3 py-2.5 text-[12px] text-red-900">
          <span className="font-medium">AWS rejected the credentials. </span>
          {ui.credsError}{" "}
          <span className="text-red-700/80">
            Showing the raw-HCL diagram below (no module/variable expansion).
          </span>
        </div>
      )}

      {ui.fallbackReason && (
        <div className="rounded-xl border border-amber-200/80 bg-amber-50/60 px-3 py-2 text-[12px] text-amber-900">
          <span className="font-medium">Used HCL fallback. </span>
          Terraform plan couldn&apos;t run, so modules, <code className="font-mono">count</code>,{" "}
          <code className="font-mono">for_each</code> and variables were not expanded.{" "}
          <span className="text-amber-700/80">Reason: {ui.fallbackReason}</span>
        </div>
      )}

      <PlanSummary graph={ui.graph} mode={ui.mode} />

      {ui.mode === "plan" && (
        <ActionLegend counts={actionCounts} />
      )}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-[11px]">
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
          onNodeClick={onNodeClick}
          onPaneClick={onPaneClick}
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
        {selectedResource && (
          <ResourceDetailPanel
            resource={selectedResource}
            graph={ui.graph}
            onClose={() => setSelectedId(null)}
          />
        )}
      </div>
      {!selectedResource && (
        <p className="text-[11px] text-neutral-400 text-center">
          Tip: click any resource to inspect its configuration and relationships.
        </p>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Planning / loading

/**
 * Long-running loading view for the upload. `terraform plan` can take 30–60s
 * (provider download on the first run), so a tiny "parsing…" string isn't
 * enough — we show the active phase, an elapsed timer, and an indeterminate
 * bar so the user knows work is happening and roughly how long to expect.
 */
function PlanningView({
  filename,
  phase,
}: {
  filename: string | null;
  phase: ParseMode | null;
}) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const id = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - started) / 1000));
    }, 250);
    return () => window.clearInterval(id);
  }, []);

  const isFallback = phase === "hcl";
  const title = isFallback ? "Parsing HCL directly" : "Running terraform plan";
  const detail = isFallback
    ? "Plan couldn't run, so we're parsing the raw .tf files. Modules, count, for_each and variables won't be expanded."
    : "Resolving modules, count, for_each and variables, then computing planned actions. The first run downloads providers, so this can take 30–60s.";

  return (
    <div className="grid place-items-center min-h-[calc(100dvh-220px)]">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 200, damping: 24 }}
        className="w-full max-w-md rounded-[2rem] border border-slate-200/70 bg-white p-8 text-center"
      >
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-slate-100 mb-5">
          <Spinner size={26} />
        </div>
        <h2 className="text-lg font-semibold tracking-tight text-neutral-900">{title}</h2>
        {filename && (
          <p className="mt-1 text-[12px] font-mono text-neutral-500 truncate">{filename}</p>
        )}
        <p className="mt-3 text-[13px] text-neutral-500 leading-relaxed">{detail}</p>

        <div className="mt-6 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
          <motion.div
            className={cn("h-full w-1/3 rounded-full", isFallback ? "bg-amber-400" : "bg-neutral-900")}
            animate={{ x: ["-110%", "330%"] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
          />
        </div>

        <div className="mt-4 flex items-center justify-center gap-2 text-[11px] font-mono text-neutral-400">
          <span
            className={cn(
              "inline-block w-1.5 h-1.5 rounded-full",
              isFallback ? "bg-amber-500" : "bg-emerald-500 animate-pulse",
            )}
          />
          {isFallback ? "fallback" : "working"} · {elapsed}s elapsed
        </div>
      </motion.div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Drop zone

interface DropZoneProps {
  status: UIState["status"];
  error: string | null;
  onPick: (f: File, creds?: AwsCreds) => void;
}

function DropZone({ status, error, onPick }: DropZoneProps) {
  const [dragging, setDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [creds, setCreds] = useState<AwsCreds>({
    accessKeyId: "",
    secretAccessKey: "",
    sessionToken: "",
    region: "us-east-1",
  });

  const credsForRequest = useCallback((): AwsCreds | undefined => {
    if (creds.accessKeyId.trim() && creds.secretAccessKey.trim()) return creds;
    return undefined;
  }, [creds]);

  // Picking a file only *stages* it now — building is an explicit click below.
  // Previously the diagram started the moment a zip was dropped, which fired a
  // 30–60s terraform plan before the user could paste credentials.
  const handleFiles = useCallback((files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".zip")) {
      // The endpoint enforces this too, but warn early to avoid the round-trip.
      alert("Please upload a .zip file containing your .tf files");
      return;
    }
    setSelectedFile(file);
  }, []);

  const build = useCallback(() => {
    if (selectedFile) onPick(selectedFile, credsForRequest());
  }, [selectedFile, onPick, credsForRequest]);

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

        <label
          className={cn(
            "mt-6 inline-flex items-center gap-2 cursor-pointer rounded-xl px-4 py-2.5 text-[13px] font-medium transition-colors border",
            selectedFile
              ? "bg-white text-neutral-700 border-slate-200 hover:bg-slate-50"
              : "bg-neutral-900 text-white border-neutral-900 hover:bg-neutral-800",
          )}
        >
          <input
            type="file"
            accept=".zip,application/zip"
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
          {selectedFile ? "Choose a different .zip" : "Choose .zip file"}
        </label>

        <CredentialsForm creds={creds} onChange={setCreds} />

        {/* Build is an explicit step — the diagram no longer starts on upload. */}
        <div className="mt-6">
          {selectedFile && (
            <p className="text-[12px] font-mono text-neutral-500 mb-2 truncate">
              <FileArchive size={13} weight="duotone" className="inline mb-0.5 mr-1 text-neutral-400" />
              {selectedFile.name}
            </p>
          )}
          <button
            type="button"
            onClick={build}
            disabled={!selectedFile}
            className="inline-flex items-center gap-2 rounded-xl bg-neutral-900 text-white px-5 py-2.5 text-[13px] font-medium hover:bg-neutral-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <CaretRight size={14} weight="bold" />
            Build diagram
          </button>
          {!selectedFile && (
            <p className="text-[11px] text-neutral-400 mt-2">
              Choose or drop a .zip to enable the build.
            </p>
          )}
        </div>

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
// Optional AWS credentials (for data sources / plan-time API validation)

function CredentialsForm({
  creds,
  onChange,
}: {
  creds: AwsCreds;
  onChange: (c: AwsCreds) => void;
}) {
  const [open, setOpen] = useState(false);
  const [testing, setTesting] = useState(false);
  const [check, setCheck] = useState<CredCheck | null>(null);
  const set = (patch: Partial<AwsCreds>) => {
    setCheck(null); // any edit invalidates the previous test result
    onChange({ ...creds, ...patch });
  };

  const canTest = creds.accessKeyId.trim() !== "" && creds.secretAccessKey.trim() !== "";
  const runTest = async () => {
    setTesting(true);
    setCheck(null);
    try {
      setCheck(await api.validateCreds(creds));
    } catch (e) {
      setCheck({ ok: false, error: e instanceof Error ? e.message : "request failed" });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="mt-4 text-left max-w-md mx-auto">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 text-[12px] text-neutral-500 hover:text-neutral-800"
      >
        <CaretRight
          size={12}
          weight="bold"
          className={cn("transition-transform", open && "rotate-90")}
        />
        Use AWS credentials (optional, for <code className="font-mono">data</code> sources)
      </button>

      {open && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          transition={{ duration: 0.18 }}
          className="overflow-hidden"
        >
          <div className="mt-3 space-y-2">
            <CredInput
              placeholder="AWS_ACCESS_KEY_ID"
              value={creds.accessKeyId}
              onChange={(v) => set({ accessKeyId: v })}
            />
            <CredInput
              placeholder="AWS_SECRET_ACCESS_KEY"
              value={creds.secretAccessKey}
              onChange={(v) => set({ secretAccessKey: v })}
              type="password"
            />
            <CredInput
              placeholder="AWS_SESSION_TOKEN (optional)"
              value={creds.sessionToken ?? ""}
              onChange={(v) => set({ sessionToken: v })}
              type="password"
            />
            <CredInput
              placeholder="Region (e.g. us-east-1)"
              value={creds.region ?? ""}
              onChange={(v) => set({ region: v })}
            />
          </div>

          {creds.accessKeyId.trim().toUpperCase().startsWith("ASIA")
            && !creds.sessionToken?.trim() && (
            <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-2 text-[11px] text-amber-900 leading-relaxed">
              That looks like a <span className="font-medium">temporary</span> key
              (<code className="font-mono">ASIA…</code>). It will be rejected unless you
              also paste the <span className="font-medium">session token</span>.
            </div>
          )}

          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={runTest}
              disabled={!canTest || testing}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-40"
            >
              {testing ? <Spinner size={13} /> : <ShieldCheck size={14} weight="duotone" />}
              {testing ? "Testing…" : "Test credentials"}
            </button>
            <span className="text-[11px] text-neutral-400">
              Calls sts:GetCallerIdentity — verifies the keys work here.
            </span>
          </div>

          {check && (
            <div
              className={cn(
                "mt-2 rounded-xl border px-3 py-2 text-[11px] leading-relaxed",
                check.ok
                  ? "border-emerald-200 bg-emerald-50/70 text-emerald-900"
                  : "border-red-200 bg-red-50/70 text-red-900",
              )}
            >
              {check.ok ? (
                <>
                  <span className="font-medium">Credentials valid.</span>{" "}
                  <span className="font-mono">{check.arn}</span> · account{" "}
                  <span className="font-mono">{check.account_id}</span>
                </>
              ) : (
                <>
                  <span className="font-medium">
                    Rejected{check.code ? ` (${check.code})` : ""}.
                  </span>{" "}
                  {check.hint ?? check.error}
                </>
              )}
            </div>
          )}

          <div className="mt-3 flex items-start gap-2 rounded-xl border border-slate-200/70 bg-slate-50 px-3 py-2">
            <LockSimple size={14} weight="duotone" className="text-neutral-500 mt-0.5 shrink-0" />
            <p className="text-[11px] text-neutral-500 leading-relaxed">
              Used only for this plan — sent once, never stored, logged, or persisted.
              Prefer <span className="font-medium">read-only</span> keys or temporary
              session credentials, and connect over HTTPS.
            </p>
          </div>
        </motion.div>
      )}
    </div>
  );
}

function CredInput({
  placeholder,
  value,
  onChange,
  type = "text",
}: {
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  type?: "text" | "password";
}) {
  // Secret/token fields are masked by default but get a reveal toggle so the
  // user can verify exactly what they pasted (a hidden trailing space or
  // mistyped char is the usual cause of SignatureDoesNotMatch).
  const isSecret = type === "password";
  const [revealed, setRevealed] = useState(false);
  const inputType = isSecret && !revealed ? "password" : "text";

  return (
    <div className="relative">
      <input
        type={inputType}
        value={value}
        placeholder={placeholder}
        // Block browser autofill / password managers from overwriting what the
        // user pastes — a wrong autofilled secret causes SignatureDoesNotMatch.
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        data-1p-ignore
        data-lpignore="true"
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[12px] font-mono focus:outline-none focus:border-neutral-900",
          isSecret && "pr-9",
        )}
      />
      {isSecret && value && (
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setRevealed((v) => !v)}
          aria-label={revealed ? "Hide" : "Show"}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-700"
        >
          {revealed ? <EyeSlash size={15} /> : <Eye size={15} />}
        </button>
      )}
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

// ────────────────────────────────────────────────────────────────────────────
// Mode badge + action legend

function ModeBadge({ mode }: { mode: ParseMode | null }) {
  if (!mode) return null;
  if (mode === "plan") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
        terraform plan
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
      hcl fallback
    </span>
  );
}

const ACTION_LEGEND: { key: string; label: string; dot: string; tone: string }[] = [
  { key: "create", label: "Create",       dot: "bg-emerald-500", tone: "text-emerald-700" },
  { key: "update", label: "Update",       dot: "bg-amber-500",   tone: "text-amber-700"   },
  { key: "delete", label: "Delete",       dot: "bg-red-500",     tone: "text-red-700"     },
  { key: "read",   label: "Data (exists)", dot: "bg-sky-500",    tone: "text-sky-700"     },
  { key: "no-op",  label: "No-op",        dot: "bg-slate-400",   tone: "text-slate-600"   },
];

/** Plain-language headline so a non-author instantly gets the gist:
 *  what will be created, and whether it plugs into anything that exists. */
function PlanSummary({ graph, mode }: { graph: Graph; mode: ParseMode | null }) {
  const a = countByAction(graph);
  const created = a.create ?? 0;
  const updated = a.update ?? 0;
  const deleted = a.delete ?? 0;
  const existing = a.read ?? 0;

  if (mode !== "plan") {
    // HCL parse still tells created (managed) from existing (data sources),
    // it just can't reconcile against live AWS (so a "created" resource that
    // already exists in your account can't be detected without a plan).
    return (
      <div className="rounded-2xl border border-slate-200/70 bg-white px-4 py-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[13px]">
        <span className="text-neutral-700">
          <span className="font-semibold text-emerald-700">{created}</span> declared to be{" "}
          <span className="font-medium">created</span>
        </span>
        <span className="text-neutral-500">·</span>
        <span className="text-neutral-700">
          <span className="font-semibold text-slate-600">{existing}</span> already{" "}
          <span className="font-medium">exist</span>{" "}
          <span className="text-neutral-400">(data sources, dashed)</span>
        </span>
        <span className="text-[11px] text-neutral-400">
          — parsed from code; connect AWS credentials to reconcile against live state
        </span>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200/70 bg-white px-4 py-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[13px]">
      <span className="text-neutral-700">
        <span className="font-semibold text-emerald-700">{created}</span> will be{" "}
        <span className="font-medium">created</span>
      </span>
      {updated > 0 && (
        <span className="text-neutral-700">
          <span className="font-semibold text-amber-700">{updated}</span> updated
        </span>
      )}
      {deleted > 0 && (
        <span className="text-neutral-700">
          <span className="font-semibold text-red-700">{deleted}</span> destroyed
        </span>
      )}
      <span className="text-neutral-500">·</span>
      <span className="text-neutral-700">
        <span className="font-semibold text-slate-600">{existing}</span> already{" "}
        <span className="font-medium">exist</span>{" "}
        <span className="text-neutral-400">(referenced, dashed)</span>
      </span>
      {existing === 0 && (
        <span className="text-[11px] text-neutral-400">
          — this stack is self-contained (no existing AWS resources referenced)
        </span>
      )}
    </div>
  );
}

function ActionLegend({ counts }: { counts: Record<string, number> }) {
  // Only show legend entries that actually appear in the graph.
  const present = ACTION_LEGEND.filter((entry) => (counts[entry.key] ?? 0) > 0);
  if (present.length === 0) return null;
  return (
    <div className="flex items-center gap-3 text-[11px] flex-wrap rounded-xl border border-slate-200/60 bg-white px-3 py-2">
      <span className="text-neutral-500 font-mono uppercase tracking-wider text-[10px]">
        Plan
      </span>
      {present.map(({ key, label, dot, tone }) => (
        <span key={key} className={cn("inline-flex items-center gap-1.5", tone)}>
          <span className={cn("inline-block w-1.5 h-1.5 rounded-full", dot)} />
          {label}
          <span className="font-mono text-neutral-500">({counts[key]})</span>
        </span>
      ))}
    </div>
  );
}

function countByAction(graph: Graph): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of graph.nodes) {
    const a = r.planned_action ?? "unknown";
    out[a] = (out[a] ?? 0) + 1;
  }
  return out;
}

function _shortErrorReason(message: string): string {
  // Terraform errors are multi-line and noisy; keep the first useful sentence.
  const cleaned = message
    .replace(/^terraform (init|plan|show.*?) failed:\s*/i, "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("│") && !l.startsWith("╷") && !l.startsWith("╵") && !l.startsWith("with") && !l.startsWith("on "));
  const first = cleaned.find((l) => l.toLowerCase().startsWith("error:")) ?? cleaned[0] ?? message;
  return first.slice(0, 240);
}

/** True when a terraform plan failure is an AWS credential rejection (rather
 *  than missing data, a bad data source, etc.). */
function _isCredentialError(message: string): boolean {
  return /InvalidClientTokenId|SignatureDoesNotMatch|ExpiredToken|security token|GetCallerIdentity|StatusCode: 403|AccessDenied|UnrecognizedClientException|validating provider credentials/i.test(
    message,
  );
}

/** Actionable guidance for a rejected-credentials plan, tailored to the most
 *  common causes so the user can self-serve the fix. */
function _credentialHelp(creds: AwsCreds, message: string): string {
  const isTemp = creds.accessKeyId.trim().toUpperCase().startsWith("ASIA");
  if (isTemp && !creds.sessionToken?.trim()) {
    return "Your access key is temporary (ASIA…) — these require a session token. Paste the AWS_SESSION_TOKEN as well.";
  }
  if (/ExpiredToken/i.test(message)) {
    return "The credentials have expired. Generate a fresh set (and session token, if temporary) and try again.";
  }
  if (/SignatureDoesNotMatch/i.test(message)) {
    return "The secret access key doesn't match the access key id — re-copy the secret, watching for trailing spaces.";
  }
  if (/AccessDenied|UnrecognizedClientException/i.test(message)) {
    return "AWS accepted the request but denied it. Confirm the key is active and the identity is allowed to call sts:GetCallerIdentity.";
  }
  return "Verify the access key id and secret are correct and active, the region is right, and—if the key is temporary (ASIA…)—include the session token.";
}

function countByCategory(graph: Graph): { label: string; count: number }[] {
  // Tally by the same service categories that drive the icon colors, so the
  // chips match what's on the canvas. Only non-empty categories are shown.
  const counts: Record<string, number> = {};
  for (const r of graph.nodes) {
    const cat = awsCategory(r.type);
    counts[cat] = (counts[cat] ?? 0) + 1;
  }
  return Object.entries(counts)
    .sort(([, a], [, b]) => b - a)
    .map(([key, count]) => ({ label: CATEGORY_LABEL[key] ?? key, count }));
}
