import { useEffect, useRef } from "react";
import { cn } from "./cn";

// A single requestAnimationFrame ticker shared by every spinner.
//
// A plain CSS `animate-spin` FREEZES on macOS WKWebView after this window's iframe is hidden and
// re-shown: WebKit tears down the compositor layer and doesn't repaint the animation on return.
// That's exactly what happens running as an AgentsPoppy extension when you leave a domain setup
// mid-flow (e.g. to the Dashboard) and come back — the spinners appear stuck. Driving the rotation
// from JS forces a real repaint every animation frame the page is visible, so spinners resume the
// instant you return instead of staying frozen. Nodes are mutated directly (not via React state),
// so N spinners share ONE rAF loop with zero per-frame re-renders.
const nodes = new Set<HTMLElement>();
let rafId: number | null = null;
let lastT = 0;
let angle = 0;

function tick(t: number): void {
  if (lastT) angle = (angle + (t - lastT) * 0.36) % 360; // 0.36 deg/ms ≈ one turn per second
  lastT = t;
  const transform = `rotate(${angle}deg)`;
  for (const n of nodes) n.style.transform = transform;
  rafId = nodes.size ? requestAnimationFrame(tick) : null;
}

function register(node: HTMLElement): () => void {
  nodes.add(node);
  if (rafId === null) {
    lastT = 0;
    rafId = requestAnimationFrame(tick);
  }
  return () => {
    nodes.delete(node);
    if (nodes.size === 0 && rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  };
}

export function Spinner({ className }: { className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => (ref.current ? register(ref.current) : undefined), []);
  return (
    <span
      ref={ref}
      aria-hidden
      className={cn(
        "inline-block size-4 rounded-full border-2 border-surface-container-highest border-t-primary align-[-3px]",
        className,
      )}
    />
  );
}
