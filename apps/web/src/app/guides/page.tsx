import type { Metadata } from "next";
import Link from "next/link";
import type { ComponentType } from "react";
import { DocTopBar, DocFooter } from "@/components/webmail/DocChrome";
import { SITE_URL, SITE_NAME } from "@/lib/site";
import { ArrowRightIcon, GlobeIcon, MailIcon, SendIcon, ServerIcon } from "@/components/webmail/icons";

const TITLE = "MailPoppy guides — set up email on your domain, step by step";
const DESCRIPTION =
  "Plain-language guides for setting up email with MailPoppy: starting fresh on a brand-new domain, moving a domain that already sends and receives email, or sending transactional / no-reply mail (no mailbox needed) — with exactly what to expect.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  keywords: [
    "MailPoppy guide",
    "set up email on your own domain",
    "move existing email to your own AWS",
    "email setup tutorial",
    "domain email MX change",
  ],
  alternates: { canonical: "/guides" },
  openGraph: { type: "website", url: `${SITE_URL}/guides`, siteName: SITE_NAME, title: TITLE, description: DESCRIPTION },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

const GUIDES: {
  href: string;
  icon: ComponentType<{ size?: number }>;
  tag: string;
  title: string;
  body: string;
}[] = [
  {
    href: "/guides/new-domain",
    icon: GlobeIcon,
    tag: "Starting fresh",
    title: "Set up email on a new domain",
    body: "Your domain has no email yet. Go from nothing to working mailboxes on your own domain in about five minutes — with everything running inside your own AWS account.",
  },
  {
    href: "/guides/existing-email",
    icon: MailIcon,
    tag: "Already have email",
    title: "Move a domain that already has email",
    body: "Your domain already sends or receives mail somewhere else. Here's exactly what changes when you switch to MailPoppy, and the safe order to do it in so no message goes missing.",
  },
  {
    href: "/guides/transactional-email",
    icon: SendIcon,
    tag: "Send-only",
    title: "Transactional & no-reply email",
    body: "You only need to send — order confirmations, password resets, alerts from a no-reply. No mailbox needed: setting your domain up is enough to send from any address on it.",
  },
  {
    href: "/migrate",
    icon: ServerIcon,
    tag: "Bring your history",
    title: "Import your old mailboxes",
    body: "Already switched? Copy your existing folders and history across over IMAP — from AWS WorkMail, Gmail, Microsoft 365 and more — so you keep everything.",
  },
];

export default function GuidesIndex() {
  return (
    <main className="bg-bg text-text min-h-screen">
      <DocTopBar />

      <section className="px-5 pt-16 pb-10">
        <div className="mx-auto max-w-3xl text-center">
          <span className="text-primary text-sm font-semibold tracking-wide uppercase">Guides</span>
          <h1 className="text-heading mt-3 text-4xl font-bold tracking-tight sm:text-5xl">
            Set up email your way
          </h1>
          <p className="text-muted mx-auto mt-5 max-w-2xl text-lg leading-relaxed">
            Short, plain-language walkthroughs — no cloud experience needed. Pick the one that matches what you need.
            If you already run email on your domain, read that guide first so you know exactly what to expect.
          </p>
        </div>
      </section>

      <div className="mx-auto max-w-3xl space-y-5 px-5 pb-24">
        {GUIDES.map((g) => (
          <Link
            key={g.href}
            href={g.href}
            className="border-hairline bg-surface hover:bg-surface-variant group flex items-start gap-5 rounded-2xl border p-6 transition-colors"
          >
            <span className="bg-primary/12 text-primary flex h-12 w-12 shrink-0 items-center justify-center rounded-xl">
              <g.icon size={24} />
            </span>
            <div className="min-w-0 flex-1">
              <span className="text-primary text-xs font-semibold tracking-wide uppercase">{g.tag}</span>
              <h2 className="text-text mt-1 flex items-center gap-2 text-lg font-bold">
                {g.title}
                <ArrowRightIcon size={16} />
              </h2>
              <p className="text-muted mt-1.5 text-sm leading-relaxed">{g.body}</p>
            </div>
          </Link>
        ))}
      </div>

      <DocFooter />
    </main>
  );
}
