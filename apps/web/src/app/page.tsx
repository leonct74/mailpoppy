import type { Metadata } from "next";
import Link from "next/link";
import type { ComponentType } from "react";
import { Logo } from "@/components/webmail/Logo";
import { SITE_URL, SITE_NAME, SITE_DESCRIPTION, FAQS, REPO_URL, REPO_PUBLIC } from "@/lib/site";
import { FaqAnswer } from "@/lib/faq-renderer";
import {
  ShieldIcon,
  ServerIcon,
  CoinsIcon,
  GlobeIcon,
  DevicesIcon,
  BoltIcon,
  CheckCircleIcon,
  AtSignIcon,
  RocketIcon,
  CloudIcon,
  LockIcon,
  KeyIcon,
  TrashIcon,
  MailIcon,
  SearchIcon,
  ComposeIcon,
  PaperclipIcon,
  ArrowRightIcon,
  GithubIcon,
  CodeIcon,
  EyeIcon,
  ClockIcon,
  WandIcon,
} from "@/components/webmail/icons";

export const metadata: Metadata = {
  title: "MailPoppy — Email you own, in your own AWS",
  description: SITE_DESCRIPTION,
  keywords: [
    "self-hosted email",
    "email on your own AWS",
    "private email hosting",
    "custom domain email",
    "email without subscription",
    "own your email data",
    "AWS SES email app",
    "Google Workspace alternative",
    "Microsoft 365 email alternative",
    "data sovereignty email",
    "open source email",
    "open source email server",
    "auditable email",
    "verifiable private email",
    "self-hosted email open source",
  ],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: SITE_NAME,
    title: "MailPoppy — Email you own, in your own AWS",
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: "MailPoppy — Email you own, in your own AWS",
    description: SITE_DESCRIPTION,
  },
};

const NAV = [
  { href: "#features", label: "Features" },
  { href: "#how", label: "How it works" },
  { href: "#security", label: "Security" },
  { href: "#open", label: "Open source" },
  { href: "#pricing", label: "Pricing" },
  { href: "#faq", label: "FAQ" },
];

export default function Home() {
  return (
    <main className="bg-bg text-text">
      <StructuredData />
      <WorkMailBanner />
      <Header />
      <Hero />
      <TrustStrip />
      <WhatIsIt />
      <NoExpertise />
      <Audience />
      <Differentiators />
      <Features />
      <HowItWorks />
      <Security />
      <AwsTrust />
      <OpenSource />
      <Clients />
      <Comparison />
      <Pricing />
      <Faq />
      <FinalCta />
      <Footer />
    </main>
  );
}

/* ─────────────────────────── WorkMail announcement bar ─────────────────────────── */

function WorkMailBanner() {
  return (
    <Link
      href="/workmail-alternative"
      className="border-hairline bg-primary/10 hover:bg-primary/15 block border-b text-center transition-colors"
    >
      <div className="text-text mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-2 gap-y-1 px-5 py-2.5 text-xs font-medium sm:text-sm">
        <span className="text-primary">
          <ClockIcon size={14} />
        </span>
        <span>
          <b className="font-bold">AWS WorkMail is shutting down in 2027.</b> Move to email you own —
        </span>
        <span className="text-primary inline-flex items-center gap-1 font-semibold">
          see the WorkMail alternative <ArrowRightIcon size={14} />
        </span>
      </div>
    </Link>
  );
}

/* ─────────────────────────── Header ─────────────────────────── */

function Header() {
  return (
    <header className="border-hairline bg-bg/80 sticky top-0 z-30 border-b backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-6 px-5 py-3">
        <Logo size="sm" />
        <nav className="text-muted ml-2 hidden items-center gap-6 text-sm font-medium md:flex">
          {NAV.map((n) => (
            <a key={n.href} href={n.href} className="hover:text-text transition-colors">
              {n.label}
            </a>
          ))}
        </nav>
        <div className="flex-1" />
        <Link href="/app" className="text-muted hover:text-text hidden text-sm font-semibold sm:inline">
          Sign in
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

/* ─────────────────────────── Hero ─────────────────────────── */

function Hero() {
  return (
    <section className="relative overflow-hidden px-5 pt-20 pb-16 sm:pt-28">
      <div
        aria-hidden
        className="bg-primary-bright pointer-events-none absolute -top-40 left-1/2 h-[32rem] w-[32rem] -translate-x-1/2 rounded-full opacity-[0.09] blur-3xl"
      />
      <div className="relative mx-auto max-w-3xl text-center">
        <div className="flex flex-wrap items-center justify-center gap-2">
          <span className="border-hairline bg-surface text-muted inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-semibold">
            <ShieldIcon size={14} />
            Private by architecture — your mail never touches our servers
          </span>
          <span className="border-hairline bg-surface text-muted inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-semibold">
            <GithubIcon size={14} />
            Open source &amp; auditable
          </span>
        </div>
        <h1 className="text-heading mt-6 text-4xl font-bold tracking-tight sm:text-6xl">
          Your domain&apos;s email,
          <br className="hidden sm:block" /> in your own AWS.
        </h1>
        <p className="text-muted mx-auto mt-5 max-w-2xl text-lg leading-relaxed">
          MailPoppy is a desktop app for your Mac or PC. Connect your AWS account once and it builds a complete
          email service on your domain — then create{" "}
          <span className="text-text font-semibold">unlimited mailboxes in seconds</span>, with no per-seat fees.
          Everyone reads their mail on the web, iPhone and Android.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/app"
            className="bg-primary text-primary-text flex w-full items-center justify-center gap-2 rounded-2xl px-7 py-3.5 text-base font-bold tracking-wide transition-opacity hover:opacity-90 sm:w-auto"
          >
            Open MailPoppy
            <ArrowRightIcon size={18} />
          </Link>
          <a
            href="#how"
            className="border-hairline bg-surface text-text hover:bg-surface-variant flex w-full items-center justify-center gap-2 rounded-2xl border px-7 py-3.5 text-base font-semibold transition-colors sm:w-auto"
          >
            See how it works
          </a>
        </div>
        <p className="text-dim mt-4 text-xs">No AWS experience needed · Guided setup in about 5 minutes</p>
      </div>

      <InboxMock />
    </section>
  );
}

// A lightweight, pure-CSS browser frame showing a faux inbox — gives the hero a
// product feel without shipping a screenshot asset.
function InboxMock() {
  const rows = [
    { who: "Aanya Volkov", subj: "Q3 board pack — final", snip: "Numbers are in, deck attached for tomorrow.", tint: "#3b5a7a", unread: true, clip: true },
    { who: "billing@yourdomain.com", subj: "Your AWS invoice is ready", snip: "This month's usage summary for the team.", tint: "#7a3b4b", unread: true },
    { who: "Tomas Eriksen", subj: "Re: launch checklist", snip: "Looks good — shipping Thursday once DNS is live.", tint: "#3b7a5a" },
    { who: "Noor Haddad", subj: "Welcome to the team 🎉", snip: "Your new @yourdomain.com mailbox is set up.", tint: "#5a3b7a" },
  ];
  return (
    <div className="relative mx-auto mt-14 max-w-3xl">
      <div
        aria-hidden
        className="bg-primary pointer-events-none absolute inset-x-8 -bottom-6 h-12 rounded-full opacity-20 blur-2xl"
      />
      <div className="border-hairline bg-surface-container relative overflow-hidden rounded-2xl border shadow-2xl">
        {/* window chrome */}
        <div className="border-hairline flex items-center gap-2 border-b px-4 py-3">
          <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
          <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
          <span className="h-3 w-3 rounded-full bg-[#28c840]" />
          <div className="bg-surface-high text-dim mx-auto flex items-center gap-2 rounded-md px-3 py-1 text-xs">
            <LockIcon size={11} />
            mail.yourdomain.com
          </div>
        </div>
        {/* faux toolbar */}
        <div className="border-hairline flex items-center gap-2 border-b px-4 py-2.5">
          <Logo size="sm" />
          <div className="flex-1" />
          <span className="bg-primary text-primary-text flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold">
            <ComposeIcon size={13} /> Compose
          </span>
          <span className="bg-surface-high text-dim hidden items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs sm:flex">
            <SearchIcon size={13} /> Search
          </span>
        </div>
        {/* rows */}
        <ul className="space-y-2 p-3">
          {rows.map((r, i) => (
            <li key={i} className="bg-surface relative flex items-start gap-3 rounded-xl p-3">
              {r.unread && <span className="bg-primary absolute top-1/2 left-0 h-7 w-[3px] -translate-y-1/2 rounded-r" />}
              <span
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
                style={{ backgroundColor: r.tint }}
              >
                {r.who.trim()[0]?.toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className={`truncate text-sm ${r.unread ? "text-text font-bold" : "text-muted"}`}>{r.who}</span>
                  <span className={`shrink-0 text-[11px] ${r.unread ? "text-primary" : "text-dim"}`}>{i === 0 ? "9:41" : "Tue"}</span>
                </div>
                <div className={`truncate text-sm ${r.unread ? "text-text font-semibold" : "text-text"}`}>{r.subj}</div>
                <div className="text-dim flex items-center gap-1 truncate text-xs">
                  {r.clip && <PaperclipIcon size={12} />}
                  <span className="truncate">{r.snip}</span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/* ─────────────────────────── Trust strip ─────────────────────────── */

function TrustStrip() {
  const items = [
    { icon: DevicesIcon, label: "Runs on your Mac & PC" },
    { icon: BoltIcon, label: "Unlimited mailboxes in seconds" },
    { icon: ServerIcon, label: "Lives in your own AWS" },
    { icon: ShieldIcon, label: "We never see your mail" },
  ];
  return (
    <section className="border-hairline border-y">
      <div className="mx-auto grid max-w-6xl grid-cols-2 gap-px md:grid-cols-4">
        {items.map((it) => (
          <div key={it.label} className="text-muted flex items-center justify-center gap-2.5 px-4 py-5 text-sm font-semibold">
            <span className="text-primary">
              <it.icon size={18} />
            </span>
            {it.label}
          </div>
        ))}
      </div>
    </section>
  );
}

/* ─────────────────────────── What is MailPoppy ─────────────────────────── */

function WhatIsIt() {
  const points: { icon: ComponentType<{ size?: number }>; t: string; d: string }[] = [
    { icon: DevicesIcon, t: "Runs on your computer", d: "A Mac & Windows app — no server to host or maintain." },
    { icon: BoltIcon, t: "Unlimited mailboxes in seconds", d: "Add as many addresses as you want, instantly, at no extra cost." },
    { icon: ShieldIcon, t: "Your AWS, your data", d: "Everything lives in your account — we never see it." },
  ];
  return (
    <Section id="what">
      <div className="mx-auto max-w-3xl text-center">
        <span className="text-primary text-sm font-semibold tracking-wide uppercase">What is MailPoppy</span>
        <h2 className="text-heading mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
          A desktop app that gives you your own email service
        </h2>
        <p className="text-text mt-5 text-lg leading-relaxed">
          MailPoppy is an app you install on your own computer. It connects to your AWS account and, in a few
          minutes, sets up a complete, private email service for your domain — inbound and outbound mail, storage,
          spam filtering and the DNS records, all done for you.
        </p>
        <p className="text-muted mt-4 leading-relaxed">
          From then on, creating a new address — one for every teammate, an alias for every project — takes
          seconds, with no extra cost. Everyone signs in to the webmail or the iPhone and Android apps, and every
          message stays inside your AWS account.
        </p>
      </div>
      <div className="mx-auto mt-10 grid max-w-3xl gap-4 sm:grid-cols-3">
        {points.map((x) => (
          <div key={x.t} className="border-hairline bg-surface rounded-2xl border p-5 text-center">
            <div className="bg-primary/12 text-primary mx-auto flex h-11 w-11 items-center justify-center rounded-xl">
              <x.icon size={22} />
            </div>
            <h3 className="text-text mt-3 text-sm font-bold">{x.t}</h3>
            <p className="text-muted mt-1.5 text-xs leading-relaxed">{x.d}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

/* ─────────────────────────── No expertise needed ─────────────────────────── */

function NoExpertise() {
  const points: { icon: ComponentType<{ size?: number }>; title: string; body: string }[] = [
    {
      icon: RocketIcon,
      title: "Never used AWS? Perfect.",
      body: "You don't need a cloud background, an AWS account, or any technical experience. If you've never set up infrastructure in your life, MailPoppy is built exactly for you.",
    },
    {
      icon: WandIcon,
      title: "No command line, no config",
      body: "Everything happens in a friendly app — buttons and plain-language steps. There's nothing to script, no servers to wire up, no settings files to edit.",
    },
    {
      icon: ClockIcon,
      title: "Ready in about 5 minutes",
      body: "Open the app, follow the on-screen instructions, and you'll have a complete, professional email setup for your domain in roughly five minutes.",
    },
    {
      icon: ShieldIcon,
      title: "It does the hard parts for you",
      body: "Mail servers, DNS records, anti-spam, security — the things experts normally sweat over are configured automatically, correctly, behind the scenes.",
    },
  ];
  const handled = ["AWS setup", "Mail servers", "DNS records", "SPF / DKIM / DMARC", "Spam & malware filtering", "Storage & backups", "The command line"];
  return (
    <Section id="easy" tone="elevated">
      <SectionHeading
        eyebrow="No tech skills required"
        title="You don't need to be technical"
        subtitle="“Run your own email in your own AWS” sounds like a job for an IT department. It isn't. MailPoppy is for normal people — founders, freelancers, small teams — not just developers. If you can install an app and follow a few prompts, you can build a professional email service in about five minutes."
      />
      <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {points.map((p) => (
          <div key={p.title} className="border-hairline bg-surface rounded-2xl border p-6">
            <div className="bg-primary/12 text-primary flex h-11 w-11 items-center justify-center rounded-xl">
              <p.icon size={22} />
            </div>
            <h3 className="text-text mt-4 text-base font-bold">{p.title}</h3>
            <p className="text-muted mt-2 text-sm leading-relaxed">{p.body}</p>
          </div>
        ))}
      </div>
      <div className="border-hairline bg-surface-container mt-4 rounded-2xl border p-6 text-center sm:p-8">
        <p className="text-heading text-sm font-bold tracking-wide uppercase">All handled for you — you never touch any of this</p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          {handled.map((h) => (
            <span key={h} className="border-hairline bg-surface text-muted inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium">
              <span className="text-primary">
                <CheckCircleIcon size={13} />
              </span>
              {h}
            </span>
          ))}
        </div>
      </div>
    </Section>
  );
}

/* ─────────────────────────── Audience ─────────────────────────── */

function Audience() {
  const cards: { icon: ComponentType<{ size?: number }>; title: string; body: string }[] = [
    {
      icon: RocketIcon,
      title: "Startups & small teams",
      body: "Professional email on your domain without paying a monthly fee for every person you hire.",
    },
    {
      icon: ShieldIcon,
      title: "Privacy-first organisations",
      body: "Keep correspondence out of big-tech inboxes. No profiling, no scanning, no third party in the middle.",
    },
    {
      icon: ServerIcon,
      title: "Developers & founders",
      body: "You already have an AWS account. Run your email there too — serverless, low-cost, fully in your control.",
    },
    {
      icon: GlobeIcon,
      title: "Compliance & data residency",
      body: "Pick your AWS region, set your own retention, and keep every message on infrastructure you own.",
    },
  ];
  return (
    <Section id="audience">
      <SectionHeading
        eyebrow="Who it's for"
        title="Built for people who want their email to be theirs"
        subtitle="If you own a domain and an AWS account, MailPoppy turns them into a real, private email service."
      />
      <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <div key={c.title} className="border-hairline bg-surface rounded-2xl border p-6">
            <div className="bg-primary/12 text-primary flex h-11 w-11 items-center justify-center rounded-xl">
              <c.icon size={22} />
            </div>
            <h3 className="text-text mt-4 text-base font-bold">{c.title}</h3>
            <p className="text-muted mt-2 text-sm leading-relaxed">{c.body}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

/* ─────────────────────────── Differentiators ─────────────────────────── */

function Differentiators() {
  const points = [
    {
      icon: ServerIcon,
      title: "Your data plane, not ours",
      body: "Unlike every mainstream email provider, your mailboxes live in your AWS account — not on a company server you have to trust. MailPoppy is the only one where the inbox is genuinely yours.",
    },
    {
      icon: LockIcon,
      title: "We literally can't read your mail",
      body: "There are no MailPoppy servers in the path of your email. We can't open it, can't reset your password, can't hand it over. That's a guarantee of design, not a promise in fine print.",
    },
    {
      icon: CoinsIcon,
      title: "Pay AWS, not a per-seat tax",
      body: "Spin up unlimited mailboxes in seconds. You pay AWS's usage rates — typically a few dollars a month for a whole domain — instead of a monthly bill that grows with every hire.",
    },
    {
      icon: BoltIcon,
      title: "One-click deploy, one-click exit",
      body: "The desktop app stands up the entire backend for you, and tears it all back down just as easily. No vendor lock-in, ever — your domain and data stay portable.",
    },
  ];
  return (
    <Section id="why" tone="elevated">
      <SectionHeading
        eyebrow="Why MailPoppy"
        title="The email service where you hold the keys"
        subtitle="Most providers ask you to trust them with your inbox. MailPoppy is designed so you never have to."
      />
      <div className="mt-12 grid gap-4 md:grid-cols-2">
        {points.map((p) => (
          <div key={p.title} className="border-hairline bg-surface flex gap-4 rounded-2xl border p-6">
            <div className="bg-primary/12 text-primary flex h-11 w-11 shrink-0 items-center justify-center rounded-xl">
              <p.icon size={22} />
            </div>
            <div>
              <h3 className="text-heading text-lg font-bold">{p.title}</h3>
              <p className="text-muted mt-2 text-sm leading-relaxed">{p.body}</p>
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

/* ─────────────────────────── Features ─────────────────────────── */

function Features() {
  const feats: { icon: ComponentType<{ size?: number }>; title: string; body: string }[] = [
    { icon: AtSignIcon, title: "Unlimited mailboxes in seconds", body: "Create as many addresses on your domain as you want — instantly, with no per-seat fee — each with its own storage limit." },
    { icon: ShieldIcon, title: "Spam & malware protection", body: "Inbound mail is spam-filtered and can be scanned for malware with AWS GuardDuty." },
    { icon: CheckCircleIcon, title: "Deliverability done right", body: "SPF, DKIM, DMARC and a custom MAIL FROM are configured for you, so you reach the inbox." },
    { icon: MailIcon, title: "Import your old email", body: "Migrate existing mailboxes over IMAP and keep your history when you switch." },
    { icon: GlobeIcon, title: "Your region, your rules", body: "Choose the AWS region your mail lives in, and set retention windows that suit you." },
    { icon: DevicesIcon, title: "Apps everywhere", body: "A polished webmail client plus native iPhone and Android apps — all sharing one look and feel." },
  ];
  return (
    <Section id="features">
      <SectionHeading
        eyebrow="Features"
        title="Everything a modern mailbox needs"
        subtitle="A complete email service — without a server to babysit or a subscription to renew."
      />
      <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {feats.map((f) => (
          <div key={f.title} className="border-hairline bg-surface rounded-2xl border p-6">
            <div className="bg-primary/12 text-primary flex h-11 w-11 items-center justify-center rounded-xl">
              <f.icon size={22} />
            </div>
            <h3 className="text-text mt-4 text-base font-bold">{f.title}</h3>
            <p className="text-muted mt-2 text-sm leading-relaxed">{f.body}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

/* ─────────────────────────── How it works ─────────────────────────── */

function HowItWorks() {
  const steps = [
    { icon: CloudIcon, title: "Install the app, connect AWS", body: "Install MailPoppy on your Mac or PC and link your AWS account once. It deploys the entire email backend for you — no command line, no servers to host." },
    { icon: AtSignIcon, title: "Add your domain & mailboxes", body: "Point your domain, and MailPoppy sets up the sending records. Then create as many mailboxes as you want in seconds — and migrate your old mail over IMAP if you like." },
    { icon: DevicesIcon, title: "Use it everywhere", body: "Sign in on the web, iPhone or Android and start sending. Everything you read and write stays in your AWS account." },
  ];
  return (
    <Section id="how" tone="elevated">
      <SectionHeading
        eyebrow="How it works"
        title="From zero to your own email in three steps"
        subtitle="No mail server to configure, no IP reputation to fight, and no AWS experience required. The app walks you through each step — most people are done in about five minutes."
      />
      <div className="mt-12 grid gap-4 md:grid-cols-3">
        {steps.map((s, i) => (
          <div key={s.title} className="border-hairline bg-surface relative rounded-2xl border p-6">
            <span className="text-primary/30 absolute top-5 right-5 text-4xl font-bold">{i + 1}</span>
            <div className="bg-primary/12 text-primary flex h-11 w-11 items-center justify-center rounded-xl">
              <s.icon size={22} />
            </div>
            <h3 className="text-text mt-4 text-base font-bold">{s.title}</h3>
            <p className="text-muted mt-2 text-sm leading-relaxed">{s.body}</p>
          </div>
        ))}
      </div>
      <p className="text-muted mt-8 text-center text-sm">
        On AWS WorkMail (shutting down in 2027)?{" "}
        <Link href="/workmail-alternative" className="text-primary font-semibold hover:underline">
          See why MailPoppy is the natural move →
        </Link>
      </p>
      <p className="text-muted mt-2 text-center text-sm">
        Coming from Gmail or Microsoft 365?{" "}
        <Link href="/migrate" className="text-primary font-semibold hover:underline">
          Read the migration guide →
        </Link>
      </p>
    </Section>
  );
}

/* ─────────────────────────── Security ─────────────────────────── */

function Security() {
  const items = [
    "Your mailboxes and messages stay inside your own AWS account",
    "MailPoppy operates no servers that receive, store or read your email",
    "Optional malware scanning with AWS GuardDuty",
    "Spam filtering with policies you control",
    "SPF, DKIM and DMARC configured for trusted delivery",
    "Choose your AWS region and set your own retention",
  ];
  return (
    <Section id="security">
      <div className="border-hairline bg-surface-container relative overflow-hidden rounded-3xl border p-8 sm:p-12">
        <div
          aria-hidden
          className="bg-primary-bright pointer-events-none absolute -top-24 -right-16 h-72 w-72 rounded-full opacity-10 blur-3xl"
        />
        <div className="relative grid gap-10 lg:grid-cols-2 lg:items-center">
          <div>
            <span className="text-primary text-sm font-semibold tracking-wide uppercase">Security &amp; privacy</span>
            <h2 className="text-heading mt-3 text-3xl font-bold tracking-tight">
              Privacy that&apos;s structural, not a setting
            </h2>
            <p className="text-muted mt-4 leading-relaxed">
              With MailPoppy there is no third party between you and your mail. Because the whole service lives in your
              AWS account, your messages can&apos;t be mined for ads, handed to anyone, or read by us — there&apos;s
              nothing for us to read.
            </p>
          </div>
          <ul className="grid gap-3">
            {items.map((it) => (
              <li key={it} className="text-text flex items-start gap-3 text-sm leading-relaxed">
                <span className="text-primary mt-0.5 shrink-0">
                  <CheckCircleIcon size={20} />
                </span>
                {it}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Section>
  );
}

/* ─────────────────────────── AWS trust ─────────────────────────── */

function AwsTrust() {
  const points: { icon: ComponentType<{ size?: number }>; title: string; body: string }[] = [
    {
      icon: ServerIcon,
      title: "Runs on your computer",
      body: "The app is local and calls AWS directly from your machine. There's no MailPoppy server in the path — so there's nothing to send your keys to.",
    },
    {
      icon: LockIcon,
      title: "Keys stay in your AWS config",
      body: "They're saved only in your standard ~/.aws/credentials file (owner-only), in a separate “mailpoppy” profile that never touches your others. Never logged, never uploaded.",
    },
    {
      icon: ShieldIcon,
      title: "Give it least privilege",
      body: "Connect a dedicated IAM user scoped to just the email stack — not your root or admin keys — so MailPoppy can never reach anything else in your account.",
    },
    {
      icon: KeyIcon,
      title: "Or use temporary credentials",
      body: "Works with IAM Identity Center (SSO) and short-lived session tokens, so there's nothing long-lived to leak in the first place.",
    },
    {
      icon: TrashIcon,
      title: "Revoke at any time",
      body: "Rotate or delete the key whenever you like, and MailPoppy's one-click teardown removes everything it ever created in your account.",
    },
  ];
  return (
    <Section id="trust">
      <SectionHeading
        eyebrow="Your AWS, your keys"
        title="Connecting your AWS, safely"
        subtitle="A fair question for any tool that touches your cloud: could it copy your credentials? With MailPoppy, you connect AWS the same way every AWS tool does — and you decide exactly how much access to grant."
      />
      <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {points.map((p) => (
          <div key={p.title} className="border-hairline bg-surface rounded-2xl border p-6">
            <div className="bg-primary/12 text-primary flex h-11 w-11 items-center justify-center rounded-xl">
              <p.icon size={22} />
            </div>
            <h3 className="text-text mt-4 text-base font-bold">{p.title}</h3>
            <p className="text-muted mt-2 text-sm leading-relaxed">{p.body}</p>
          </div>
        ))}
        <div className="border-hairline bg-surface-container flex flex-col justify-center rounded-2xl border p-6">
          <p className="text-heading text-base font-bold">In short</p>
          <p className="text-muted mt-2 text-sm leading-relaxed">
            Your credentials are used on your machine, kept in your own config, and limited to exactly what you
            grant. Nothing about your AWS ever reaches us.
          </p>
        </div>
      </div>
    </Section>
  );
}

/* ─────────────────────────── Open source ─────────────────────────── */

function OpenSource() {
  const points: { icon: ComponentType<{ size?: number }>; title: string; body: string }[] = [
    {
      icon: EyeIcon,
      title: "Read what runs in your AWS",
      body: "The mail backend that receives and stores your email is open. You can confirm it only ever writes to your own account — nothing phones home, nothing is copied out.",
    },
    {
      icon: KeyIcon,
      title: "Audit how your keys are handled",
      body: "The component that reads your AWS credentials is open source too. See for yourself that they stay on your machine and are never sent to us or written to logs.",
    },
    {
      icon: ShieldIcon,
      title: "Least privilege, in the open",
      body: "The exact IAM permissions MailPoppy asks for are published — so you can verify it only ever touches its own email stack, and nothing else in your account.",
    },
    {
      icon: CodeIcon,
      title: "Source-available under the FSL",
      body: "Free to read, run and build on under the Functional Source License — and every release becomes Apache-2.0 two years later. No black box, no lock-in.",
    },
  ];
  return (
    <Section id="open">
      <SectionHeading
        eyebrow="Open source & verifiable"
        title="Don't trust us. Verify."
        subtitle="Most email providers ask you to take their privacy promises on faith. MailPoppy doesn't. The security-critical code — everything that runs in your AWS and everything that touches your AWS credentials — is open source, so the claims on this page are ones you can check line by line."
      />
      <div className="mt-12 grid gap-4 sm:grid-cols-2">
        {points.map((p) => (
          <div key={p.title} className="border-hairline bg-surface rounded-2xl border p-6">
            <div className="bg-primary/12 text-primary flex h-11 w-11 items-center justify-center rounded-xl">
              <p.icon size={22} />
            </div>
            <h3 className="text-text mt-4 text-base font-bold">{p.title}</h3>
            <p className="text-muted mt-2 text-sm leading-relaxed">{p.body}</p>
          </div>
        ))}
      </div>
      <div className="border-hairline bg-surface-container relative mt-4 overflow-hidden rounded-3xl border p-8 text-center sm:p-12">
        <div
          aria-hidden
          className="bg-primary-bright pointer-events-none absolute -top-24 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full opacity-10 blur-3xl"
        />
        <div className="relative mx-auto max-w-2xl">
          <h3 className="text-heading text-2xl font-bold tracking-tight">
            Privacy you can audit is privacy you can trust
          </h3>
          <p className="text-muted mt-3 leading-relaxed">
            &ldquo;Private by architecture&rdquo; only means something if you can confirm it. Bring your own engineers,
            or your security team — the code that handles your mail and your keys is theirs to inspect.
          </p>
          <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
            {REPO_PUBLIC ? (
              <a
                href={REPO_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="bg-primary text-primary-text flex w-full items-center justify-center gap-2 rounded-2xl px-7 py-3.5 text-base font-bold tracking-wide transition-opacity hover:opacity-90 sm:w-auto"
              >
                <GithubIcon size={18} />
                Read the source on GitHub
                <ArrowRightIcon size={16} />
              </a>
            ) : (
              <span className="border-hairline bg-surface text-muted flex w-full items-center justify-center gap-2 rounded-2xl border px-7 py-3.5 text-base font-semibold sm:w-auto">
                <GithubIcon size={18} />
                Public repository opening shortly
              </span>
            )}
          </div>
        </div>
      </div>
    </Section>
  );
}

/* ─────────────────────────── Clients ─────────────────────────── */

function Clients() {
  const apps = [
    { icon: ServerIcon, title: "Desktop admin (Mac & PC)", body: "Runs on your own computer. Deploy, add domains, create unlimited mailboxes and set policies — the control centre for your email." },
    { icon: GlobeIcon, title: "Webmail", body: "A fast, modern inbox in any browser. Compose in rich text, search, and manage folders." },
    { icon: DevicesIcon, title: "iPhone & Android", body: "Native apps with push notifications, swipe actions and the same crimson-navy design." },
  ];
  return (
    <Section id="clients" tone="elevated">
      <SectionHeading
        eyebrow="Clients"
        title="One service, every device"
        subtitle="Set it up once on the desktop; read and send from anywhere."
      />
      <div className="mt-12 grid gap-4 md:grid-cols-3">
        {apps.map((a) => (
          <div key={a.title} className="border-hairline bg-surface rounded-2xl border p-6">
            <div className="bg-primary/12 text-primary flex h-11 w-11 items-center justify-center rounded-xl">
              <a.icon size={22} />
            </div>
            <h3 className="text-text mt-4 text-base font-bold">{a.title}</h3>
            <p className="text-muted mt-2 text-sm leading-relaxed">{a.body}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

/* ─────────────────────────── Comparison ─────────────────────────── */

function Comparison() {
  const rows: { label: string; mp: string; saas: string }[] = [
    { label: "Where your email lives", mp: "Your own AWS account", saas: "The provider's servers" },
    { label: "Who can read it", mp: "Only you", saas: "The provider (and its partners)" },
    { label: "Pricing model", mp: "AWS usage — no per-seat fee", saas: "Monthly, per user" },
    { label: "Adding mailboxes", mp: "Free — just create them", saas: "Another seat to pay for" },
    { label: "Leaving", mp: "One-click teardown, no lock-in", saas: "Export and hope" },
    { label: "Data region", mp: "You choose", saas: "Often fixed" },
    { label: "Can you verify the privacy?", mp: "Yes — the engine is open source", saas: "No — closed, trust required" },
  ];
  return (
    <Section id="compare">
      <SectionHeading
        eyebrow="MailPoppy vs. typical email"
        title="The difference is who's in control"
      />
      <div className="border-hairline mt-10 overflow-hidden rounded-2xl border">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-hairline bg-surface-container border-b">
              <th className="text-muted px-4 py-4 font-semibold sm:px-6"> </th>
              <th className="text-primary px-4 py-4 font-bold sm:px-6">MailPoppy</th>
              <th className="text-muted px-4 py-4 font-semibold sm:px-6">Typical email SaaS</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.label} className={`border-hairline ${i < rows.length - 1 ? "border-b" : ""}`}>
                <td className="text-text px-4 py-4 font-medium sm:px-6">{r.label}</td>
                <td className="text-text bg-primary/[0.04] px-4 py-4 sm:px-6">
                  <span className="flex items-start gap-2">
                    <span className="text-primary mt-0.5 shrink-0">
                      <CheckCircleIcon size={16} />
                    </span>
                    {r.mp}
                  </span>
                </td>
                <td className="text-muted px-4 py-4 sm:px-6">{r.saas}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

/* ─────────────────────────── Pricing ─────────────────────────── */

function Pricing() {
  return (
    <Section id="pricing" tone="elevated">
      <SectionHeading
        eyebrow="Pricing"
        title="You pay AWS at cost — not us, per seat"
        subtitle="Because everything runs in your account, your only running cost is your AWS usage, which is typically a few dollars a month for a whole domain."
      />
      <div className="mx-auto mt-10 max-w-md">
        <div className="border-hairline bg-surface rounded-3xl border p-8 text-center">
          <span className="bg-primary/12 text-primary inline-block rounded-full px-3 py-1 text-xs font-semibold tracking-wide uppercase">
            Coming soon
          </span>
          <p className="text-heading mt-5 text-2xl font-bold">Simple, one-time pricing</p>
          <p className="text-muted mt-3 text-sm leading-relaxed">
            MailPoppy&apos;s own pricing is on the way. No subscriptions to us, no per-mailbox tax — just the app that
            sets it all up. In the meantime, you can look around the webmail today.
          </p>
          <Link
            href="/app"
            className="bg-primary text-primary-text mt-6 inline-flex items-center gap-2 rounded-2xl px-6 py-3 text-sm font-bold tracking-wide transition-opacity hover:opacity-90"
          >
            Open MailPoppy
            <ArrowRightIcon size={16} />
          </Link>
        </div>
      </div>
    </Section>
  );
}

/* ─────────────────────────── FAQ ─────────────────────────── */

function Faq() {
  return (
    <Section id="faq">
      <SectionHeading eyebrow="FAQ" title="Questions, answered" />
      <div className="mx-auto mt-10 max-w-3xl space-y-3">
        {FAQS.map((f) => (
          <details key={f.q} className="border-hairline bg-surface group rounded-2xl border p-5">
            <summary className="text-text flex cursor-pointer items-center justify-between gap-4 text-base font-semibold [&::-webkit-details-marker]:hidden">
              {f.q}
              <span className="text-primary shrink-0 transition-transform group-open:rotate-45">
                <PlusIcon />
              </span>
            </summary>
            <FaqAnswer question={f.q} answer={f.a} />
          </details>
        ))}
      </div>
    </Section>
  );
}

function PlusIcon() {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

/* ─────────────────────────── Final CTA ─────────────────────────── */

function FinalCta() {
  return (
    <Section id="get-started">
      <div className="border-hairline bg-surface-container relative overflow-hidden rounded-3xl border p-10 text-center sm:p-14">
        <div
          aria-hidden
          className="bg-primary-bright pointer-events-none absolute -top-24 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full opacity-[0.12] blur-3xl"
        />
        <div className="relative">
          <Logo size="lg" className="mx-auto" />
          <h2 className="text-heading mt-6 text-3xl font-bold tracking-tight sm:text-4xl">
            Take your email back.
          </h2>
          <p className="text-muted mx-auto mt-4 max-w-lg leading-relaxed">
            Professional email on your domain, private by design, with no per-seat bill and no lock-in. It runs in your
            AWS, so it&apos;s yours — start in minutes.
          </p>
          <Link
            href="/app"
            className="bg-primary text-primary-text mt-8 inline-flex items-center gap-2 rounded-2xl px-8 py-3.5 text-base font-bold tracking-wide transition-opacity hover:opacity-90"
          >
            Open MailPoppy
            <ArrowRightIcon size={18} />
          </Link>
        </div>
      </div>
    </Section>
  );
}

/* ─────────────────────────── Footer ─────────────────────────── */

function Footer() {
  return (
    <footer className="border-hairline border-t">
      <div className="text-muted mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-5 py-8 text-sm sm:flex-row">
        <div className="flex items-center gap-2">
          <Logo size="sm" />
        </div>
        <nav className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
          <a href="#features" className="hover:text-text transition-colors">Features</a>
          <a href="#security" className="hover:text-text transition-colors">Security</a>
          <a href="#open" className="hover:text-text transition-colors">Open source</a>
          <Link href="/workmail-alternative" className="hover:text-text transition-colors">WorkMail alternative</Link>
          <Link href="/migrate" className="hover:text-text transition-colors">Migrate</Link>
          <a href="#pricing" className="hover:text-text transition-colors">Pricing</a>
          <a href="#faq" className="hover:text-text transition-colors">FAQ</a>
          <Link href="/privacy" className="hover:text-text transition-colors">Privacy</Link>
          <Link href="/app" className="hover:text-text transition-colors">Sign in</Link>
        </nav>
        <div className="text-dim flex items-center gap-1.5 text-xs">
          <CloudIcon size={13} />
          Powered by AWS
        </div>
      </div>
      <div className="text-dim px-5 pb-8 text-center text-xs">
        © {new Date().getFullYear()} MailPoppy · Your email, in your own AWS.
      </div>
    </footer>
  );
}

/* ─────────────────────────── Layout helpers ─────────────────────────── */

function Section({
  id,
  tone = "base",
  children,
}: {
  id: string;
  tone?: "base" | "elevated";
  children: React.ReactNode;
}) {
  return (
    <section id={id} className={`scroll-mt-20 ${tone === "elevated" ? "bg-bg-elevated" : ""}`}>
      <div className="mx-auto max-w-6xl px-5 py-20">{children}</div>
    </section>
  );
}

function SectionHeading({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle?: string }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <span className="text-primary text-sm font-semibold tracking-wide uppercase">{eyebrow}</span>
      <h2 className="text-heading mt-3 text-3xl font-bold tracking-tight sm:text-4xl">{title}</h2>
      {subtitle && <p className="text-muted mt-4 leading-relaxed">{subtitle}</p>}
    </div>
  );
}

/* ─────────────────────────── Structured data (SEO) ─────────────────────────── */

function StructuredData() {
  const graph = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${SITE_URL}/#organization`,
        name: SITE_NAME,
        url: SITE_URL,
        logo: `${SITE_URL}/logo-mark.png`,
        description: SITE_DESCRIPTION,
      },
      {
        "@type": "WebSite",
        "@id": `${SITE_URL}/#website`,
        url: SITE_URL,
        name: SITE_NAME,
        publisher: { "@id": `${SITE_URL}/#organization` },
      },
      {
        "@type": "SoftwareApplication",
        name: SITE_NAME,
        applicationCategory: "BusinessApplication",
        operatingSystem: "macOS, Windows, Web, iOS, Android",
        description: SITE_DESCRIPTION,
        url: SITE_URL,
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD", description: "Runs on your own AWS usage; MailPoppy pricing coming soon." },
      },
      {
        "@type": "FAQPage",
        mainEntity: FAQS.map((f) => ({
          "@type": "Question",
          name: f.q,
          acceptedAnswer: { "@type": "Answer", text: f.a },
        })),
      },
    ],
  };
  return (
    <script
      type="application/ld+json"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: JSON.stringify(graph) }}
    />
  );
}
