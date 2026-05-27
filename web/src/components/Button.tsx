import { forwardRef } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "ghost" | "outline";

interface Props extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

const STYLES: Record<Variant, string> = {
  primary:
    "bg-neutral-900 text-white hover:bg-neutral-800 active:translate-y-[1px] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]",
  ghost:
    "bg-transparent text-neutral-700 hover:bg-neutral-100 active:translate-y-[1px]",
  outline:
    "border border-slate-200 bg-white text-neutral-700 hover:bg-neutral-50 active:translate-y-[1px]",
};

export const Button = forwardRef<HTMLButtonElement, Props>(
  ({ className, variant = "primary", ...rest }, ref) => (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center gap-2 rounded-full px-4 py-2 text-[13px] font-medium transition-colors disabled:opacity-40 disabled:pointer-events-none",
        STYLES[variant],
        className,
      )}
      {...rest}
    />
  ),
);
Button.displayName = "Button";
