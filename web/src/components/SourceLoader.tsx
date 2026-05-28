import { useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FileArrowUp,
  CloudArrowDown,
  Folder,
  Play,
  CheckCircle,
  Warning,
  type Icon,
} from "@phosphor-icons/react";
import { api } from "@/lib/api";
import { useStore } from "@/lib/store";
import { Button } from "@/components/Button";
import { cn } from "@/lib/cn";

type Kind = "tfstate-file" | "plan-file" | "tfstate-s3" | "tf-dir";

const KINDS: { id: Kind; label: string; Icon: Icon; desc: string }[] = [
  {
    id: "tfstate-file",
    label: "tfstate (file)",
    Icon: FileArrowUp,
    desc: "Drop a terraform.tfstate from your local machine. Best for reviewing the current declared state.",
  },
  {
    id: "plan-file",
    label: "plan.json (file)",
    Icon: FileArrowUp,
    desc: "Drop a `terraform show -json plan.bin` output to review what is about to change before apply.",
  },
  {
    id: "tfstate-s3",
    label: "tfstate (S3)",
    Icon: CloudArrowDown,
    desc: "Download a tfstate directly from S3 using the API container's AWS credentials.",
  },
  {
    id: "tf-dir",
    label: "Directory",
    Icon: Folder,
    desc: "Point at a directory of .tf files. Cenote runs terraform init+plan inside the container.",
  },
];

type State =
  | { kind: "idle" }
  | { kind: "working"; message: string }
  | { kind: "error"; message: string }
  | { kind: "done"; snapshotId: string };

interface Props {
  onScanComplete: (snapshotId: string) => void;
  liveOnly?: boolean;
}

export function SourceLoader({ onScanComplete, liveOnly = false }: Props) {
  const region = useStore((s) => s.region);
  const [active, setActive] = useState<Kind>("tfstate-file");
  const [state, setState] = useState<State>({ kind: "idle" });

  const handleResult = (snapId: string) => {
    setState({ kind: "done", snapshotId: snapId });
    onScanComplete(snapId);
  };

  const handleError = (msg: string) => setState({ kind: "error", message: msg });

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 200, damping: 24 }}
      className="rounded-3xl border border-slate-200/70 bg-white p-6 md:p-7"
    >
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-5">
        <div>
          <div className={cn(
            "text-[11px] uppercase tracking-[0.14em] font-semibold mb-1",
            liveOnly ? "text-amber-700" : "text-neutral-500",
          )}>
            {liveOnly ? "No Terraform loaded" : "Load Terraform"}
          </div>
          <h3 className="text-[15px] font-semibold tracking-tight">
            {liveOnly
              ? "Choose a source to enable drift and reconciliation"
              : "Run a new scan from any source"}
          </h3>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 mb-5">
        {KINDS.map(({ id, label, Icon }) => {
          const isActive = id === active;
          return (
            <motion.button
              key={id}
              onClick={() => {
                setActive(id);
                setState({ kind: "idle" });
              }}
              whileTap={{ scale: 0.97 }}
              transition={{ type: "spring", stiffness: 400, damping: 30 }}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors",
                isActive
                  ? "bg-neutral-900 text-white"
                  : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200",
              )}
            >
              <Icon size={13} weight="regular" />
              {label}
            </motion.button>
          );
        })}
      </div>

      <p className="text-[12px] text-neutral-500 leading-relaxed mb-4">
        {KINDS.find((k) => k.id === active)?.desc}
      </p>

      <AnimatePresence mode="wait">
        <motion.div
          key={active}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.15 }}
        >
          {active === "tfstate-file" && (
            <FileInput
              accept=".tfstate,.json"
              onSubmit={async (file) => {
                setState({ kind: "working", message: `Uploading ${file.name}…` });
                try {
                  const { path } = await api.uploadArtifact(file, "tfstate");
                  setState({ kind: "working", message: "Reconciling AWS…" });
                  const snap = await api.scan({ tfstate_path: path, region: region ?? undefined, include_authorship: true });
                  handleResult(snap.id);
                } catch (e) {
                  handleError(e instanceof Error ? e.message : String(e));
                }
              }}
              busy={state.kind === "working"}
              ctaIdle="Upload tfstate"
            />
          )}
          {active === "plan-file" && (
            <FileInput
              accept=".json"
              onSubmit={async (file) => {
                setState({ kind: "working", message: `Uploading ${file.name}…` });
                try {
                  const { path } = await api.uploadArtifact(file, "plan");
                  setState({ kind: "working", message: "Parsing plan and reconciling…" });
                  const snap = await api.scan({ tfplan_path: path, region: region ?? undefined, include_authorship: true });
                  handleResult(snap.id);
                } catch (e) {
                  handleError(e instanceof Error ? e.message : String(e));
                }
              }}
              busy={state.kind === "working"}
              ctaIdle="Upload plan.json"
            />
          )}
          {active === "tfstate-s3" && (
            <UriInput
              placeholder="s3://my-tf-bucket/env/prod/terraform.tfstate"
              onSubmit={async (uri) => {
                setState({ kind: "working", message: "Downloading from S3 and reconciling…" });
                try {
                  const snap = await api.scan({ tfstate_s3: uri, region: region ?? undefined, include_authorship: true });
                  handleResult(snap.id);
                } catch (e) {
                  handleError(e instanceof Error ? e.message : String(e));
                }
              }}
              busy={state.kind === "working"}
              hint="The api container uses AWS_PROFILE to download. The profile must have s3:GetObject on the target bucket."
            />
          )}
          {active === "tf-dir" && (
            <UriInput
              placeholder="/tf"
              defaultValue="/tf"
              onSubmit={async (dir) => {
                setState({ kind: "working", message: "Running terraform init + plan… (may take 10-90s)" });
                try {
                  const snap = await api.scan({ terraform_dir: dir, region: region ?? undefined, include_authorship: true });
                  handleResult(snap.id);
                } catch (e) {
                  handleError(e instanceof Error ? e.message : String(e));
                }
              }}
              busy={state.kind === "working"}
              hint={`Path inside the container. By default, the host folder ./tf is mounted at /tf — see tf/README.md to point it at your project.`}
            />
          )}
        </motion.div>
      </AnimatePresence>

      {state.kind === "working" && (
        <div className="mt-4 rounded-xl border border-slate-200 bg-neutral-50 px-3 py-2 flex items-center gap-2">
          <div className="w-3 h-3 rounded-full border-2 border-neutral-300 border-t-neutral-900 animate-spin" />
          <p className="text-[12px] text-neutral-700">{state.message}</p>
        </div>
      )}
      {state.kind === "error" && (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50/60 px-3 py-2 flex items-start gap-2">
          <Warning size={14} weight="duotone" className="text-red-600 mt-0.5 shrink-0" />
          <p className="text-[11px] font-mono text-red-700 break-words leading-relaxed whitespace-pre-wrap">
            {state.message}
          </p>
        </div>
      )}
      {state.kind === "done" && (
        <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50/60 px-3 py-2 flex items-center gap-2">
          <CheckCircle size={14} weight="duotone" className="text-emerald-600 shrink-0" />
          <p className="text-[12px] text-emerald-700">
            Reconciled — snapshot <span className="font-mono">{state.snapshotId.slice(0, 12)}</span>
          </p>
        </div>
      )}
    </motion.div>
  );
}

function FileInput({
  accept,
  onSubmit,
  busy,
  ctaIdle,
}: {
  accept: string;
  onSubmit: (file: File) => void;
  busy: boolean;
  ctaIdle: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="flex items-center gap-3">
      <input
        ref={ref}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onSubmit(f);
          e.target.value = "";
        }}
      />
      <Button onClick={() => ref.current?.click()} disabled={busy}>
        {busy ? "Working…" : ctaIdle}
      </Button>
    </div>
  );
}

function UriInput({
  placeholder,
  defaultValue,
  onSubmit,
  busy,
  hint,
}: {
  placeholder: string;
  defaultValue?: string;
  onSubmit: (value: string) => void;
  busy: boolean;
  hint?: string;
}) {
  const [value, setValue] = useState(defaultValue ?? "");
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          disabled={busy}
          className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[12px] font-mono focus:outline-none focus:border-neutral-900 disabled:opacity-50"
          onKeyDown={(e) => {
            if (e.key === "Enter" && value.trim() && !busy) onSubmit(value.trim());
          }}
        />
        <Button
          onClick={() => value.trim() && onSubmit(value.trim())}
          disabled={busy || !value.trim()}
        >
          <Play size={12} />
          Scan
        </Button>
      </div>
      {hint && (
        <p className="text-[11px] text-neutral-500 leading-relaxed">{hint}</p>
      )}
    </div>
  );
}
