// Shared page chrome for the /guides tutorials (top bar, footer, section title).
// Kept in one place so the guide pages stay focused on content and their nav
// never drifts from each other. Mirrors the self-contained chrome used by
// /migrate and /workmail-alternative, with a "Guides" entry added to the footer.
import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/webmail/Logo";
import { ArrowRightIcon } from "@/components/webmail/icons";

export function DocTopBar() {
  return (
    <header className="border-hairline bg-bg/80 sticky top-0 z-30 border-b backdrop-blur">
      <div className="mx-auto flex max-w-3xl items-center gap-4 px-5 py-3">
        <Link href="/" aria-label="MailPoppy home">
          <Logo size="sm" />
        </Link>
        <div className="flex-1" />
        <Link href="/guides" className="text-muted hover:text-text text-sm font-medium transition-colors">
          Guides
        </Link>
        <Link
          href="/app"
          className="bg-primary text-primary-text flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-bold tracking-wide transition-opacity hover:opacity-90"
        >
          Open MailPoppy
          <ArrowRightIcon size={16} />
        </Link>
      </div>
    </header>
  );
}

export function DocFooter() {
  return (
    <footer className="border-hairline border-t">
      <div className="text-muted mx-auto flex max-w-3xl flex-col items-center justify-between gap-4 px-5 py-8 text-sm sm:flex-row">
        <Logo size="sm" />
        <nav className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
          <Link href="/guides" className="hover:text-text transition-colors">Guides</Link>
          <Link href="/migrate" className="hover:text-text transition-colors">Migrate</Link>
          <Link href="/workmail-alternative" className="hover:text-text transition-colors">WorkMail alternative</Link>
          <Link href="/privacy" className="hover:text-text transition-colors">Privacy</Link>
        </nav>
      </div>
    </footer>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="text-heading text-2xl font-bold tracking-tight">{children}</h2>;
}

/** A calm, non-alarming call-out box (used for "what to expect" notes). "important"
 *  is a touch more prominent than "info" but stays on the primary palette — never a
 *  red/danger alarm, so it informs without scaring people off. */
export function Callout({
  icon,
  title,
  children,
  tone = "info",
}: {
  icon?: ReactNode;
  title: ReactNode;
  children: ReactNode;
  tone?: "info" | "important";
}) {
  const ring = tone === "important" ? "border-primary/40 bg-surface-high" : "border-primary/25 bg-primary/10";
  return (
    <div className={`rounded-2xl border p-6 ${ring}`}>
      <h3 className="text-text flex items-center gap-2 text-base font-bold">
        {icon && <span className="text-primary">{icon}</span>}
        {title}
      </h3>
      <div className="text-muted mt-2 text-sm leading-relaxed [&_b]:text-text [&_strong]:text-text">{children}</div>
    </div>
  );
}

/** A numbered step list — one card per step. */
export function StepList({ steps }: { steps: { title: string; body: ReactNode }[] }) {
  return (
    <ol className="mt-6 space-y-4">
      {steps.map((s, i) => (
        <li key={s.title} className="border-hairline bg-surface flex gap-4 rounded-2xl border p-5">
          <span className="bg-primary/12 text-primary flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm font-bold">
            {i + 1}
          </span>
          <div>
            <h3 className="text-text text-base font-bold">{s.title}</h3>
            <div className="text-muted mt-1.5 text-sm leading-relaxed">{s.body}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}
