import { cn } from "@/lib/cn";
import type { AuthorVia } from "@/types/graph";

const VIA_STYLE: Record<AuthorVia, { bg: string; text: string }> = {
  Terraform: { bg: "bg-violet-100", text: "text-violet-700" },
  CloudFormation: { bg: "bg-orange-100", text: "text-orange-700" },
  Console: { bg: "bg-amber-100", text: "text-amber-700" },
  CLI: { bg: "bg-sky-100", text: "text-sky-700" },
  SDK: { bg: "bg-emerald-100", text: "text-emerald-700" },
  Unknown: { bg: "bg-neutral-100", text: "text-neutral-500" },
};

export function AuthorBadge({
  via,
  name,
  size = "sm",
  className,
}: {
  via: AuthorVia;
  name?: string | null;
  size?: "xs" | "sm" | "md";
  className?: string;
}) {
  const style = VIA_STYLE[via] ?? VIA_STYLE.Unknown;
  const sizes = {
    xs: "text-[9px] px-1.5 py-0",
    sm: "text-[10px] px-2 py-0.5",
    md: "text-[11px] px-2.5 py-0.5",
  } as const;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md font-medium",
        style.bg,
        style.text,
        sizes[size],
        className,
      )}
      title={name ? `${via} · ${name}` : via}
    >
      <span className={cn(
        "inline-block w-1 h-1 rounded-full",
        via === "Terraform" ? "bg-violet-500" :
        via === "Console" ? "bg-amber-500" :
        via === "CLI" ? "bg-sky-500" :
        via === "SDK" ? "bg-emerald-500" :
        via === "CloudFormation" ? "bg-orange-500" :
        "bg-neutral-400",
      )} />
      <span>{via}</span>
      {name && size !== "xs" && (
        <span className="opacity-70 font-mono truncate max-w-[80px]">{name}</span>
      )}
    </span>
  );
}
