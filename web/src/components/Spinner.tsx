import { cn } from "@/lib/cn";

interface SpinnerProps {
  /** Diameter in px. Border scales with size. */
  size?: number;
  className?: string;
}

/**
 * Minimal neutral spinner — a ring with one dark quarter that rotates.
 * Matches the inline spinner used across SourceLoader so loading states
 * look consistent everywhere.
 */
export function Spinner({ size = 16, className }: SpinnerProps) {
  const border = Math.max(2, Math.round(size / 8));
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cn(
        "inline-block rounded-full border-neutral-300 border-t-neutral-900 animate-spin",
        className,
      )}
      style={{ width: size, height: size, borderWidth: border }}
    />
  );
}
