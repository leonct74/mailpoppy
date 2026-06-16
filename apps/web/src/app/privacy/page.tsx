import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/webmail/Logo";
import { PRIVACY_INTRO, PRIVACY_LAST_UPDATED, PRIVACY_SECTIONS } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Privacy Policy — MailPoppy",
  description: "How the MailPoppy app handles information, and who controls the mailbox you sign in to.",
};

export default function PrivacyPage() {
  return (
    <div className="bg-bg min-h-screen px-5 py-10">
      <div className="mx-auto max-w-2xl">
        <div className="mb-8 flex items-center justify-between">
          <Logo size="sm" />
          <Link
            href="/app"
            className="text-muted hover:bg-surface-variant rounded-lg px-3 py-1.5 text-sm transition-colors"
          >
            Back to mail
          </Link>
        </div>

        <h1 className="text-heading text-3xl font-bold">Privacy Policy</h1>
        <p className="text-muted mt-2 text-sm font-medium">Last updated: {PRIVACY_LAST_UPDATED}</p>

        <p className="text-text mt-6 text-[15px] leading-relaxed">{PRIVACY_INTRO}</p>

        {PRIVACY_SECTIONS.map((section) => (
          <section key={section.heading} className="mt-8">
            <h2 className="text-heading text-lg font-bold">{section.heading}</h2>
            {section.blocks.map((block, i) =>
              "ul" in block ? (
                <ul key={i} className="text-text mt-3 space-y-2 text-sm leading-relaxed">
                  {block.ul.map((item, j) => (
                    <li key={j} className="flex gap-2.5">
                      <span className="text-primary mt-px font-bold">•</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p key={i} className="text-text mt-3 text-sm leading-relaxed">
                  {block.p}
                </p>
              ),
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
