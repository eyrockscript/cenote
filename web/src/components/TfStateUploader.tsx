import { useRef, useState } from "react";
import { motion } from "framer-motion";
import { FileArrowUpIcon, CheckCircleIcon, WarningIcon } from "@phosphor-icons/react";
import { api } from "@/lib/api";
import { Button } from "@/components/Button";

interface Props {
  onScanComplete: (snapshotId: string) => void;
}

type State =
  | { kind: "idle" }
  | { kind: "uploading"; filename: string }
  | { kind: "scanning"; filename: string }
  | { kind: "error"; message: string }
  | { kind: "done"; snapshotId: string };

export function TfStateUploader({ onScanComplete }: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<State>({ kind: "idle" });

  const handleFile = async (file: File) => {
    setState({ kind: "uploading", filename: file.name });
    try {
      const { path } = await api.uploadTfstate(file);
      setState({ kind: "scanning", filename: file.name });
      const snap = await api.scan({ tfstate_path: path, include_authorship: false });
      setState({ kind: "done", snapshotId: snap.id });
      onScanComplete(snap.id);
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  };

  const busy = state.kind === "uploading" || state.kind === "scanning";

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 200, damping: 24 }}
      className="rounded-3xl border border-slate-200/70 bg-white p-6 md:p-7 flex flex-col md:flex-row md:items-center gap-5"
    >
      <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-amber-100/60 shrink-0">
        <FileArrowUpIcon size={22} weight="duotone" className="text-amber-700" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="text-[11px] uppercase tracking-[0.14em] text-amber-700 font-semibold mb-1">
          No Terraform loaded
        </div>
        <h3 className="text-[15px] font-semibold tracking-tight mb-1">
          Upload a tfstate to enable drift and orphan detection
        </h3>
        <p className="text-[12px] text-neutral-500 leading-relaxed">
          Without a tfstate, every AWS resource looks like an orphan because there is no
          declaration to compare against. Run <code className="font-mono text-neutral-700">terraform state pull</code>{" "}
          locally and drop the file here.
        </p>

        {state.kind === "error" && (
          <div className="mt-3 rounded-xl border border-red-200 bg-red-50/60 px-3 py-2 flex items-start gap-2">
            <WarningIcon size={14} weight="duotone" className="text-red-600 mt-0.5 shrink-0" />
            <p className="text-[11px] font-mono text-red-700 break-words">{state.message}</p>
          </div>
        )}
        {state.kind === "done" && (
          <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50/60 px-3 py-2 flex items-center gap-2">
            <CheckCircleIcon size={14} weight="duotone" className="text-emerald-600 shrink-0" />
            <p className="text-[12px] text-emerald-700">
              Reconciled — snapshot{" "}
              <span className="font-mono">{state.snapshotId.slice(0, 12)}</span>
            </p>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 shrink-0">
        <input
          ref={fileInput}
          type="file"
          accept=".tfstate,.json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            e.target.value = ""; // allow re-uploading same file
          }}
        />
        <Button
          variant="primary"
          onClick={() => fileInput.current?.click()}
          disabled={busy}
        >
          {state.kind === "uploading" && `Uploading ${state.filename}…`}
          {state.kind === "scanning" && "Reconciling…"}
          {(state.kind === "idle" || state.kind === "error" || state.kind === "done") &&
            "Upload tfstate"}
        </Button>
      </div>
    </motion.div>
  );
}
