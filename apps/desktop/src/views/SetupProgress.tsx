import { Check, Lock, Clock } from "lucide-react";
import { Spinner, cn } from "../ui";
import type { PhaseView } from "../lib/setupProgress";

// The persistent progress map shown alongside the wizard. It never disappears,
// so the user always sees which steps are done (✓), which one is live (spinner
// or highlighted "your turn"), and which are still ahead — plus a plain-language
// time expectation, and an amber stall warning on steps AWS can hold up (DKIM).

function PhaseIcon({ phase, index }: { phase: PhaseView; index: number }) {
  if (phase.busy) return <Spinner className="mt-0.5 size-5 shrink-0" />;
  if (phase.status === "done") {
    return (
      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-secondary/20 text-secondary">
        <Check className="size-3.5" />
      </span>
    );
  }
  if (phase.status === "current") {
    // "Your turn" — a filled, gently pulsing badge draws the eye to the next action.
    return (
      <span className="relative mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-on-primary">
        <span aria-hidden className="absolute inset-0 animate-ping rounded-full bg-primary/40" />
        <span className="relative">{index + 1}</span>
      </span>
    );
  }
  return (
    <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-outline-variant/30 text-on-surface-variant/50">
      <Lock className="size-3" />
    </span>
  );
}

export function SetupProgress({ phases, reconciling }: { phases: PhaseView[]; reconciling?: boolean }) {
  const done = phases.filter((p) => p.status === "done").length;
  return (
    <section aria-label="Setup progress" className="rounded-xl border border-outline-variant/15 bg-surface-container p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-on-surface">Your setup progress</h3>
        {reconciling ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-on-surface-variant">
            <Spinner className="size-3.5" /> Checking…
          </span>
        ) : (
          <span className="font-mono text-xs text-on-surface-variant/70">
            {done}/{phases.length}
          </span>
        )}
      </div>

      <ol className="flex flex-col gap-3">
        {phases.map((p, idx) => (
          <li key={p.key} className="flex items-start gap-3">
            <PhaseIcon phase={p} index={idx} />
            <div className="min-w-0 flex-1">
              <div
                className={cn(
                  "text-sm",
                  p.status === "upcoming" ? "font-medium text-on-surface-variant/60" : "font-semibold text-on-surface",
                )}
              >
                {p.label}
              </div>
              <div className={cn("text-xs leading-snug", p.status === "upcoming" ? "text-on-surface-variant/50" : "text-on-surface-variant")}>
                {p.detail}
              </div>
              {p.canStall && p.status !== "done" && (
                <div className="mt-1 inline-flex items-start gap-1 rounded border border-amber-400/30 bg-amber-400/10 px-1.5 py-1 text-[11px] leading-snug text-amber-200">
                  <Clock className="mt-px size-3 shrink-0" />
                  <span>This can take a while — it runs automatically, so you can leave the app and come back.</span>
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
