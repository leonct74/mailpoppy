import { cn } from "./cn";

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block size-4 animate-spin rounded-full border-2 border-surface-container-highest border-t-primary align-[-3px]", className)}
    />
  );
}
