import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/webmail/Logo";
import { SITE_URL, SITE_NAME } from "@/lib/site";
import {
  ArrowRightIcon,
  ShieldIcon,
  KeyIcon,
  CloudIcon,
  CheckCircleIcon,
  MailIcon,
  LockIcon,
  ServerIcon,
} from "@/components/webmail/icons";

const TITLE = "Creator Setup Guide — MailPoppy Least-Privilege Setup";
const DESCRIPTION =
  "A safe, step-by-step guide for content creators making MailPoppy tutorials. Create a dedicated, scoped IAM user and deploy MailPoppy with zero-trust, least-privilege principles.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  keywords: [
    "MailPoppy setup guide",
    "MailPoppy IAM user",
    "MailPoppy least privilege",
    "MailPoppy creator guide",
    "AWS IAM setup",
    "MailPoppy tutorial",
    "MailPoppy deployment guide",
  ],
  alternates: { canonical: "/setup" },
  openGraph: {
    type: "article",
    url: `${SITE_URL}/setup`,
    siteName: SITE_NAME,
    title: TITLE,
    description: DESCRIPTION,
  },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

export default function SetupGuide() {
  return (
    <main className="bg-bg text-text">
      <Header />
      <Hero />
      <WhyLeastPrivilege />
      <Steps />
      <Policies />
      <FinalCta />
      <Footer />
    </main>
  );
}

/* ─────────────────────────── Header ─────────────────────────── */

function Header() {
  return (
    <header className="border-hairline bg-bg/80 sticky top-0 z-30 border-b backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-6 px-5 py-3">
        <Link href="/" aria-label="MailPoppy home">
          <Logo size="sm" />
        </Link>
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
        <span className="border-hairline bg-surface text-muted inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-semibold">
          <ShieldIcon size={14} />
          For content creators &amp; tutorial makers
        </span>
        <h1 className="text-heading mt-6 text-4xl font-bold tracking-tight sm:text-6xl">
          The safe way to set up
          <br className="hidden sm:block" /> MailPoppy for tutorials
        </h1>
        <p className="text-muted mx-auto mt-5 max-w-2xl text-lg leading-relaxed">
          If you're making a MailPoppy tutorial, walkthrough, or demo, follow this guide. It shows you how to create a
          dedicated, scoped IAM user with the minimum permissions MailPoppy needs — so you stay on the least-privilege
          rails and show your audience the right way from the start.
        </p>
        <p className="text-dim mx-auto mt-3 max-w-2xl text-sm">
          Takes about 10 minutes. No special AWS knowledge required.
        </p>
      </div>
    </section>
  );
}

/* ─────────────────────────── Why least privilege ─────────────────────────── */

function WhyLeastPrivilege() {
  const points = [
    {
      icon: ShieldIcon,
      title: "Never use your root or admin keys",
      body: "Root AWS credentials are precious. If they leak in a screenshot or on a GitHub repo, your entire AWS account is compromised. Use a dedicated user instead.",
    },
    {
      icon: LockIcon,
      title: "Give MailPoppy only what it needs",
      body: "MailPoppy has two policies: one to deploy the email backend, one to add domains and create mailboxes. A scoped IAM user can't reach anything else in your account.",
    },
    {
      icon: KeyIcon,
      title: "Easy to audit and rotate",
      body: "If you're done with a tutorial or demo, delete the scoped user and its credentials. No cleanup headaches, no risk of old credentials floating around.",
    },
    {
      icon: CheckCircleIcon,
      title: "Show good security practices",
      body: "If your audience sees you use root keys or overly broad permissions, they learn the wrong lesson. Modeling least privilege from the start sets the right tone.",
    },
  ];
  return (
    <Section tone="elevated">
      <SectionHeading
        eyebrow="Security first"
        title="Why we do this on least privilege"
        subtitle="Any AWS tool that asks for your credentials deserves scrutiny — and you deserve to know exactly what it can reach. MailPoppy is designed from the ground up to work with scoped, dedicated credentials."
      />
      <div className="mt-12 grid gap-4 sm:grid-cols-2">
        {points.map((p) => (
          <div key={p.title} className="border-hairline bg-surface flex gap-4 rounded-2xl border p-6">
            <div className="bg-primary/12 text-primary flex h-11 w-11 shrink-0 items-center justify-center rounded-xl">
              <p.icon size={22} />
            </div>
            <div>
              <h3 className="text-heading text-base font-bold">{p.title}</h3>
              <p className="text-muted mt-2 text-sm leading-relaxed">{p.body}</p>
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

/* ─────────────────────────── Steps ─────────────────────────── */

function Steps() {
  const steps = [
    {
      step: "1",
      title: "Create a dedicated IAM user in your AWS console",
      body: (
        <div className="space-y-3">
          <p className="text-muted text-sm leading-relaxed">
            Log in to your AWS account as an admin or root user, then go to <code className="bg-surface-high px-2 py-1 rounded text-xs">IAM → Users</code> and
            click <code className="bg-surface-high px-2 py-1 rounded text-xs">Create user</code>.
          </p>
          <ul className="text-muted text-sm space-y-2 ml-4">
            <li>• <strong>Name:</strong> something memorable like <code className="bg-surface-high px-2 py-1 rounded text-xs">mailpoppy-deploy</code></li>
            <li>• <strong>Console access:</strong> optional (you only need programmatic access)</li>
            <li>• <strong>Access key type:</strong> Access key (for the CLI / desktop app)</li>
          </ul>
          <p className="text-dim text-xs mt-3">
            MailPoppy uses these credentials to authenticate with AWS. They never leave your computer and are stored only in your local config.
          </p>
        </div>
      ),
    },
    {
      step: "2",
      title: "Attach the two MailPoppy policies",
      body: (
        <div className="space-y-3">
          <p className="text-muted text-sm leading-relaxed">
            After creating the user, attach two policies. You can copy-paste the JSON directly, or search by name if they're available in your account:
          </p>
          <ul className="text-muted text-sm space-y-2 ml-4">
            <li>
              • <strong>mailpoppy-deploy-policy</strong> — needed once, to deploy the email stack to your account
            </li>
            <li>
              • <strong>mailpoppy-provisioning-policy</strong> — needed to add domains and create mailboxes
            </li>
          </ul>
          <p className="text-dim text-xs mt-3">
            These policies grant MailPoppy access only to resources it creates (prefixed with <code className="bg-surface-high px-2 py-1 rounded text-xs">Mailpoppy</code>, <code className="bg-surface-high px-2 py-1 rounded text-xs">MailpoppyMailStack</code>, etc.) — nothing else in your account.
          </p>
        </div>
      ),
    },
    {
      step: "3",
      title: "Generate an access key",
      body: (
        <div className="space-y-3">
          <p className="text-muted text-sm leading-relaxed">
            Under the user's "Security credentials" tab, click <code className="bg-surface-high px-2 py-1 rounded text-xs">Create access key</code>. Choose <code className="bg-surface-high px-2 py-1 rounded text-xs">CLI</code> as the use case.
          </p>
          <p className="text-muted text-sm leading-relaxed">
            AWS will show you an <code className="bg-surface-high px-2 py-1 rounded text-xs">Access Key ID</code> and <code className="bg-surface-high px-2 py-1 rounded text-xs">Secret Access Key</code>. Copy them —
            this is the only time you'll see the secret.
          </p>
          <p className="text-dim text-xs mt-3">
            In your tutorial, you'll paste these into the MailPoppy desktop app. They'll be stored locally in <code className="bg-surface-high px-2 py-1 rounded text-xs">~/.aws/credentials</code> under a <code className="bg-surface-high px-2 py-1 rounded text-xs">mailpoppy</code> profile.
          </p>
        </div>
      ),
    },
    {
      step: "4",
      title: "Open MailPoppy and connect your AWS account",
      body: (
        <div className="space-y-3">
          <p className="text-muted text-sm leading-relaxed">
            Launch the MailPoppy desktop app. The setup wizard will ask for your AWS credentials. Paste the <code className="bg-surface-high px-2 py-1 rounded text-xs">Access Key ID</code> and <code className="bg-surface-high px-2 py-1 rounded text-xs">Secret Access Key</code> from step 3.
          </p>
          <p className="text-muted text-sm leading-relaxed">
            MailPoppy will verify your credentials and check that the policies are correctly attached. If you're missing a policy, it'll tell you exactly what to add.
          </p>
          <p className="text-dim text-xs mt-3">
            From here on, the MailPoppy wizard guides you through the rest: deploying the backend to your AWS account (takes 2–3 minutes), adding your domain, and creating mailboxes.
          </p>
        </div>
      ),
    },
    {
      step: "5",
      title: "Demo away — and clean up when you're done",
      body: (
        <div className="space-y-3">
          <p className="text-muted text-sm leading-relaxed">
            Now you're running a full, real email service in your AWS account. Walk through sending a message, creating a new mailbox, importing old email — whatever your tutorial needs.
          </p>
          <p className="text-muted text-sm leading-relaxed">
            When you're done, either leave it running or use MailPoppy's one-click teardown to delete everything it created. Then go back to the AWS console and delete the <code className="bg-surface-high px-2 py-1 rounded text-xs">mailpoppy-deploy</code> user.
          </p>
          <p className="text-dim text-xs mt-3">
            Your domain remains yours; your AWS account is clean; and your credentials never entered a leak surface.
          </p>
        </div>
      ),
    },
  ];

  return (
    <Section>
      <SectionHeading
        eyebrow="Step-by-step"
        title="How to set up MailPoppy safely"
        subtitle="Five steps, about 10 minutes total."
      />
      <div className="mt-12 space-y-6">
        {steps.map((s) => (
          <div key={s.step} className="border-hairline bg-surface rounded-2xl border p-6">
            <div className="flex items-start gap-4">
              <span className="text-primary/40 text-3xl font-bold shrink-0 w-8">{s.step}</span>
              <div className="flex-1 min-w-0">
                <h3 className="text-text text-base font-bold">{s.title}</h3>
                <div className="mt-3">{s.body}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

/* ─────────────────────────── Policy files ─────────────────────────── */

function Policies() {
  const policies = [
    {
      name: "mailpoppy-deploy-policy",
      purpose: "Deploy the email backend stack",
      link: "https://raw.githubusercontent.com/leonct74/mailpoppy/main/infra/policies/mailpoppy-deploy-policy.json",
      when: "Needed once when MailPoppy first creates the backend in your account.",
    },
    {
      name: "mailpoppy-provisioning-policy",
      purpose: "Add domains and create mailboxes",
      link: "https://raw.githubusercontent.com/leonct74/mailpoppy/main/infra/policies/mailpoppy-provisioning-policy.json",
      when: "Needed every time you add a domain or create a mailbox.",
    },
  ];
  return (
    <Section tone="elevated">
      <SectionHeading
        eyebrow="The policies"
        title="Exactly what MailPoppy can access"
        subtitle="Both policies are in the MailPoppy repository. Copy the JSON, paste it into your IAM user, and you're done."
      />
      <div className="mt-12 grid gap-4 md:grid-cols-2">
        {policies.map((p) => (
          <div key={p.name} className="border-hairline bg-surface rounded-2xl border p-6">
            <h3 className="text-text text-sm font-bold uppercase tracking-wide">{p.name}</h3>
            <p className="text-muted mt-2 text-sm leading-relaxed">{p.purpose}</p>
            <p className="text-dim mt-3 text-xs leading-relaxed">{p.when}</p>
            <a
              href={p.link}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary mt-4 inline-flex items-center gap-1.5 text-sm font-semibold hover:underline"
            >
              View on GitHub
              <ArrowRightIcon size={14} />
            </a>
          </div>
        ))}
      </div>
      <div className="border-hairline bg-surface-container mt-8 rounded-2xl border p-6 text-center">
        <p className="text-heading text-sm font-bold uppercase tracking-wide">A note on transparency</p>
        <p className="text-muted mt-3 text-sm leading-relaxed">
          These policies are public and auditable. If you or your viewers want to verify that MailPoppy can only reach
          its own email stack — and nothing else in your AWS account — you can read the JSON line by line.
        </p>
      </div>
    </Section>
  );
}

/* ─────────────────────────── Final CTA ─────────────────────────── */

function FinalCta() {
  return (
    <Section>
      <div className="border-hairline bg-surface-container relative overflow-hidden rounded-3xl border p-10 text-center sm:p-14">
        <div
          aria-hidden
          className="bg-primary-bright pointer-events-none absolute -top-24 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full opacity-[0.12] blur-3xl"
        />
        <div className="relative">
          <Logo size="lg" className="mx-auto" />
          <h2 className="text-heading mt-6 text-3xl font-bold tracking-tight sm:text-4xl">
            You&apos;re ready to demo.
          </h2>
          <p className="text-muted mx-auto mt-4 max-w-lg leading-relaxed">
            With a scoped IAM user and the two MailPoppy policies, you can walk through a complete setup in your own AWS
            account — securely, least-privilege, the right way.
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
        <Link href="/" className="flex items-center gap-2">
          <Logo size="sm" />
        </Link>
        <nav className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
          <Link href="/" className="hover:text-text transition-colors">Home</Link>
          <Link href="/workmail-alternative" className="hover:text-text transition-colors">WorkMail alternative</Link>
          <Link href="/migrate" className="hover:text-text transition-colors">Migrate</Link>
          <Link href="/privacy" className="hover:text-text transition-colors">Privacy</Link>
          <Link href="/app" className="hover:text-text transition-colors">Sign in</Link>
        </nav>
        <div className="text-dim flex items-center gap-1.5 text-xs">
          <CloudIcon size={13} />
          Powered by AWS
        </div>
      </div>
    </footer>
  );
}

/* ─────────────────────────── Layout helpers ─────────────────────────── */

function Section({ tone = "base", children }: { tone?: "base" | "elevated"; children: React.ReactNode }) {
  return (
    <section className={tone === "elevated" ? "bg-bg-elevated" : ""}>
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
