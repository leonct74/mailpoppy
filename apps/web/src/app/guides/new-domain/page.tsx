import type { Metadata } from "next";
import Link from "next/link";
import { DocTopBar, DocFooter, SectionTitle, Callout, StepList } from "@/components/webmail/DocChrome";
import { SITE_URL, SITE_NAME } from "@/lib/site";
import {
  ArrowRightIcon,
  GlobeIcon,
  KeyIcon,
  RocketIcon,
  MailIcon,
  ShieldIcon,
  CheckCircleIcon,
  ServerIcon,
  ClockIcon,
} from "@/components/webmail/icons";

const TITLE = "Set up email on a new domain — MailPoppy step-by-step guide";
const DESCRIPTION =
  "A plain-language walkthrough for putting email on a domain that has none yet: connect your AWS account once, set up the email service, add your domain, create mailboxes, and send your first message — all inside your own AWS.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  keywords: [
    "set up email on a new domain",
    "create email for my domain",
    "own email server AWS",
    "MailPoppy setup guide",
    "professional email your own domain",
  ],
  alternates: { canonical: "/guides/new-domain" },
  openGraph: { type: "article", url: `${SITE_URL}/guides/new-domain`, siteName: SITE_NAME, title: TITLE, description: DESCRIPTION },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

const STEPS: { title: string; body: string }[] = [
  {
    title: "Connect your AWS account (once)",
    body: "Open the MailPoppy desktop app and follow the on-screen steps to connect your AWS account. You don't need any cloud experience — the app checks it can reach everything it needs and tells you in plain words if anything's missing. This is a one-time step; every domain after this skips it.",
  },
  {
    title: "Add your domain",
    body: "Type your domain (like yourdomain.com) and press Continue. MailPoppy checks it can find your domain and gets ready to set things up.",
  },
  {
    title: "Set up the email service",
    body: "Press “Set up email service.” MailPoppy builds everything your email needs inside your own AWS account — the part that receives, stores and sends your mail. It takes about one to three minutes and runs in the background, so you can leave the screen and come back.",
  },
  {
    title: "Set up your domain's email",
    body: "Press “Set up email for this domain.” MailPoppy adds the settings that let your domain send and receive mail, and that keep your messages out of the spam folder. You'll then see a short “checking your domain” step — usually a few minutes while the change spreads across the internet.",
  },
  {
    title: "Create your first mailbox",
    body: "Once the domain is ready, add a mailbox — an email address (like you@yourdomain.com) and a password. That's the address you sign in with to read and send mail. You can add as many as you like, any time, for no extra per-mailbox fee.",
  },
  {
    title: "Send a test and you're live",
    body: "Send a test message to a personal inbox you can open (your Gmail or the like) to confirm it arrives. Then read your mail anywhere — in your browser, or the iPhone and Android apps.",
  },
];

export default function NewDomainGuide() {
  return (
    <main className="bg-bg text-text min-h-screen">
      <HowToSchema />
      <DocTopBar />

      {/* Hero */}
      <section className="px-5 pt-16 pb-10">
        <div className="mx-auto max-w-3xl text-center">
          <span className="text-primary text-sm font-semibold tracking-wide uppercase">Guide · Starting fresh</span>
          <h1 className="text-heading mt-3 text-4xl font-bold tracking-tight sm:text-5xl">
            Set up email on a new domain
          </h1>
          <p className="text-muted mx-auto mt-5 max-w-2xl text-lg leading-relaxed">
            Your domain has no email yet — a clean start, and the simplest way to begin. In about five minutes you'll
            have real mailboxes on your own domain, running entirely inside{" "}
            <span className="text-text font-semibold">your own AWS account</span>. No servers to run, no command
            line.
          </p>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-2">
            {[
              { icon: ClockIcon, label: "About 5 minutes" },
              { icon: ShieldIcon, label: "Stays in your AWS" },
              { icon: MailIcon, label: "Unlimited mailboxes" },
            ].map((p) => (
              <span
                key={p.label}
                className="border-hairline bg-surface text-muted inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-semibold"
              >
                <p.icon size={14} />
                {p.label}
              </span>
            ))}
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-3xl space-y-14 px-5 pb-24">
        {/* Before you begin */}
        <section>
          <SectionTitle>Before you begin</SectionTitle>
          <div className="border-hairline bg-surface-container mt-5 rounded-2xl border p-6">
            <ul className="space-y-3">
              {[
                "Install the MailPoppy desktop app on your Mac or Windows computer — that's where you set everything up.",
                "Have an AWS account ready. If you don't have one yet, the app links out to create one; it's free to open and you only pay AWS for what your email actually uses (usually a few dollars a month for a whole domain).",
                "Own a domain — and make sure its DNS is managed in AWS (Route 53). MailPoppy adds your email settings there automatically. If your domain's DNS lives somewhere else today, point it to Route 53 first (a one-time change with your domain provider).",
              ].map((t) => (
                <li key={t} className="text-text flex items-start gap-3 text-sm leading-relaxed">
                  <span className="text-primary mt-0.5 shrink-0">
                    <CheckCircleIcon size={18} />
                  </span>
                  {t}
                </li>
              ))}
            </ul>
          </div>
          <p className="text-dim mt-3 text-xs leading-relaxed">
            New to DNS? It's just the “address book” that tells the internet where your domain's email and website
            live. MailPoppy fills in the email entries for you — it only needs your domain's address book to be kept
            in AWS so it can do that automatically.
          </p>
        </section>

        {/* Steps */}
        <section>
          <SectionTitle>Step by step</SectionTitle>
          <p className="text-muted mt-3 text-sm leading-relaxed">
            Every step happens inside the app, in plain language. Here's the whole journey.
          </p>
          <StepList steps={STEPS} />
        </section>

        {/* What gets created */}
        <section>
          <SectionTitle>What MailPoppy sets up in your AWS</SectionTitle>
          <p className="text-muted mt-3 text-sm leading-relaxed">
            Everything lives in your own account — you can see it all in the app, and a single button removes the lot
            whenever you want. In short, MailPoppy creates:
          </p>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {[
              { icon: ServerIcon, t: "The mail engine", d: "The service that receives, stores and sends your email, plus the storage your messages live in — all in the AWS region you choose." },
              { icon: KeyIcon, t: "Your mailboxes", d: "Each address you create is a sign-in you fully control. Add or remove them any time, with no per-mailbox fee." },
              { icon: GlobeIcon, t: "Your domain's email settings", d: "The entries (in Route 53) that let your domain send and receive, and that help your mail reach the inbox instead of spam." },
              { icon: ShieldIcon, t: "Spam & malware protection", d: "Incoming mail is filtered for spam and, if you like, scanned for viruses — set up for you, running in your account." },
            ].map((x) => (
              <div key={x.t} className="border-hairline bg-surface rounded-2xl border p-5">
                <div className="bg-primary/12 text-primary flex h-10 w-10 items-center justify-center rounded-xl">
                  <x.icon size={20} />
                </div>
                <h3 className="text-text mt-3 text-sm font-bold">{x.t}</h3>
                <p className="text-muted mt-1.5 text-sm leading-relaxed">{x.d}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Good to know */}
        <section>
          <SectionTitle>Good to know</SectionTitle>
          <div className="mt-5 space-y-4">
            <Callout icon={<ClockIcon size={18} />} title="A brand-new domain warms up">
              For the first days or weeks, mail from a fresh domain can land in the spam folder while it builds a good
              reputation with the big email providers. This is normal and gets better on its own — MailPoppy already
              sets up the records that help (SPF, DKIM and DMARC).
            </Callout>
            <Callout icon={<MailIcon size={18} />} title="Sending limits at the start">
              New setups begin in a “try-it-out” mode with a daily sending limit, which is plenty for getting going.
              When you're ready to send more, the app has a one-click step to request the higher limit from AWS.
            </Callout>
            <Callout icon={<ShieldIcon size={18} />} title="No lock-in, ever">
              Your mail was always yours. One action in the app tears the whole setup back out of your AWS account —
              nothing to cancel, no one to email.
            </Callout>
          </div>
        </section>

        {/* CTA */}
        <section className="border-hairline bg-surface-container rounded-3xl border p-8 text-center sm:p-12">
          <h2 className="text-heading text-2xl font-bold tracking-tight">Ready to start?</h2>
          <p className="text-muted mx-auto mt-3 max-w-xl leading-relaxed">
            Open MailPoppy and set up your first domain. Already using email on this domain elsewhere? Read the other
            guide first.
          </p>
          <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/app"
              className="bg-primary text-primary-text flex w-full items-center justify-center gap-2 rounded-2xl px-7 py-3.5 text-base font-bold tracking-wide transition-opacity hover:opacity-90 sm:w-auto"
            >
              Open MailPoppy
              <ArrowRightIcon size={18} />
            </Link>
            <Link
              href="/guides/existing-email"
              className="border-hairline bg-surface text-text hover:bg-surface-variant flex w-full items-center justify-center gap-2 rounded-2xl border px-7 py-3.5 text-base font-semibold transition-colors sm:w-auto"
            >
              I already have email on my domain
            </Link>
          </div>
        </section>
      </div>

      <DocFooter />
    </main>
  );
}

function HowToSchema() {
  const graph = {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: "Set up email on a new domain with MailPoppy",
    description: DESCRIPTION,
    totalTime: "PT5M",
    step: STEPS.map((s, i) => ({
      "@type": "HowToStep",
      position: i + 1,
      name: s.title,
      text: s.body,
    })),
  };
  return (
    <script
      type="application/ld+json"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: JSON.stringify(graph) }}
    />
  );
}
