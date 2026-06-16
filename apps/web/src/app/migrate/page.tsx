import type { Metadata } from "next";
import Link from "next/link";
import type { ComponentType } from "react";
import { Logo } from "@/components/webmail/Logo";
import { SITE_URL, SITE_NAME } from "@/lib/site";
import {
  ArrowRightIcon,
  ServerIcon,
  KeyIcon,
  LockIcon,
  CheckCircleIcon,
  ClockIcon,
  ShieldIcon,
  CloudIcon,
  AtSignIcon,
  EyeIcon,
} from "@/components/webmail/icons";

const TITLE = "Migrate your email to MailPoppy — from AWS WorkMail, Gmail, Microsoft 365 & more";
const DESCRIPTION =
  "Step-by-step guide to importing your existing mailboxes into MailPoppy over IMAP — including AWS WorkMail, Google Workspace, Microsoft 365, iCloud, Yahoo and Fastmail. Keep all your folders and history; your credentials never leave your computer.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  keywords: [
    "migrate from AWS WorkMail",
    "AWS WorkMail alternative",
    "WorkMail to MailPoppy",
    "email migration IMAP",
    "import email into your own AWS",
    "migrate Google Workspace email",
    "migrate Microsoft 365 email",
    "IMAP migration tutorial",
  ],
  alternates: { canonical: "/migrate" },
  openGraph: {
    type: "article",
    url: `${SITE_URL}/migrate`,
    siteName: SITE_NAME,
    title: TITLE,
    description: DESCRIPTION,
  },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

// Generic, provider-agnostic steps — mirror the desktop app's Migration view.
const STEPS: { title: string; body: string }[] = [
  {
    title: "Open Migration in the MailPoppy app",
    body: "On the desktop admin app, open “Bring your old mail across.” Migration runs locally — your old account's password is sent only to the helper on your own machine, never to MailPoppy.",
  },
  {
    title: "Enter your old mailbox's IMAP details",
    body: "Type your previous provider's IMAP host, port 993 with TLS, your full email address as the username, and that account's password (an app-specific password if it uses 2-factor sign-in).",
  },
  {
    title: "Test the connection & preview",
    body: "Click Test connection. MailPoppy lists every folder with its message count and shows where each will land. Tick “Preview only” for a dry run that counts messages without importing anything.",
  },
  {
    title: "Pick the destination mailbox & import",
    body: "Choose which MailPoppy mailbox the mail should land in, then Import. Your folders are mapped across and your messages appear in the Inbox — ready before you switch off the old account.",
  },
];

const WORKMAIL_REGIONS: { region: string; label: string; host: string }[] = [
  { region: "us-east-1", label: "US East (N. Virginia)", host: "imap.mail.us-east-1.awsapps.com" },
  { region: "us-west-2", label: "US West (Oregon)", host: "imap.mail.us-west-2.awsapps.com" },
  { region: "eu-west-1", label: "Europe (Ireland)", host: "imap.mail.eu-west-1.awsapps.com" },
];

const PROVIDERS: { name: string; host: string; port: string; note: string }[] = [
  { name: "Google Workspace / Gmail", host: "imap.gmail.com", port: "993", note: "Use an App Password (turn on 2-Step Verification first). Workspace admins must allow IMAP for the org." },
  { name: "Microsoft 365 / Outlook", host: "outlook.office365.com", port: "993", note: "Microsoft is retiring Basic IMAP authentication — your admin may need to enable IMAP/authenticated access for the mailbox, and basic-auth sign-in may stop working. Migrate sooner rather than later." },
  { name: "iCloud Mail", host: "imap.mail.me.com", port: "993", note: "Requires an app-specific password generated in your Apple Account settings." },
  { name: "Yahoo Mail", host: "imap.mail.yahoo.com", port: "993", note: "Requires an app password generated in Account Security." },
  { name: "Fastmail", host: "imap.fastmail.com", port: "993", note: "Requires an app password with IMAP access." },
  { name: "cPanel / web-host mailbox", host: "mail.yourdomain.com", port: "993", note: "Use your mailbox password. Check your host's webmail for the exact server name if mail.yourdomain.com doesn't connect." },
];

export default function MigratePage() {
  return (
    <main className="bg-bg text-text min-h-screen">
      <HowToSchema />
      <TopBar />

      {/* Hero */}
      <section className="px-5 pt-16 pb-10">
        <div className="mx-auto max-w-3xl text-center">
          <span className="text-primary text-sm font-semibold tracking-wide uppercase">Migration guide</span>
          <h1 className="text-heading mt-3 text-4xl font-bold tracking-tight sm:text-5xl">
            Bring your existing email across
          </h1>
          <p className="text-muted mx-auto mt-5 max-w-2xl text-lg leading-relaxed">
            Switching to MailPoppy doesn&apos;t mean leaving your history behind. The app imports your old mailboxes
            over <span className="text-text font-semibold">IMAP</span> — AWS WorkMail, Gmail, Microsoft 365, iCloud,
            your web host, anything that speaks IMAP — straight into your new mailboxes. Your credentials never leave
            your computer.
          </p>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-2">
            {[
              { icon: MailFolders, label: "Keeps your folders & history" },
              { icon: LockIcon, label: "Credentials stay on your machine" },
              { icon: EyeIcon, label: "Preview before you import" },
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
                "Deploy your MailPoppy backend and create the destination mailbox first — in the app's Setup tab. Imported mail needs a mailbox to land in.",
                "Keep your old account running until the import has finished and you've checked your mail is all there. Nothing is deleted from the old side.",
                "Have the old account's IMAP server, your full email address, and its password ready — an app-specific password if that account uses 2-factor sign-in.",
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
        </section>

        {/* How it works */}
        <section>
          <SectionTitle>How migration works</SectionTitle>
          <p className="text-muted mt-3 text-sm leading-relaxed">
            The same four steps work for every provider — only the server settings change.
          </p>
          <ol className="mt-6 space-y-4">
            {STEPS.map((s, i) => (
              <li key={s.title} className="border-hairline bg-surface flex gap-4 rounded-2xl border p-5">
                <span className="bg-primary/12 text-primary flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm font-bold">
                  {i + 1}
                </span>
                <div>
                  <h3 className="text-text text-base font-bold">{s.title}</h3>
                  <p className="text-muted mt-1.5 text-sm leading-relaxed">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* WorkMail (featured) */}
        <section>
          <span className="text-primary text-sm font-semibold tracking-wide uppercase">Featured</span>
          <h2 className="text-heading mt-2 text-2xl font-bold tracking-tight">Migrating from AWS WorkMail</h2>
          <p className="text-muted mt-3 text-sm leading-relaxed">
            Already on AWS WorkMail? You&apos;re a short hop away — and you keep everything inside your own AWS, just
            on a service you fully own and control.
          </p>

          <div className="border-hairline bg-surface-container mt-6 rounded-2xl border p-6">
            <h3 className="text-text flex items-center gap-2 text-sm font-bold">
              <ServerIcon size={16} />
              1. Find your WorkMail region
            </h3>
            <p className="text-muted mt-2 text-sm leading-relaxed">
              WorkMail runs in one AWS region. You can see it in the WorkMail console, or in your web-app URL
              (<code className="text-text font-mono text-xs">https://&lt;alias&gt;.awsapps.com/mail</code>). Your IMAP
              host is <code className="text-text font-mono text-xs">imap.mail.&lt;region&gt;.awsapps.com</code>:
            </p>
            <div className="border-hairline mt-4 overflow-hidden rounded-xl border">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-hairline bg-surface border-b">
                    <th className="text-muted px-4 py-3 font-semibold">Region</th>
                    <th className="text-muted px-4 py-3 font-semibold">IMAP host</th>
                  </tr>
                </thead>
                <tbody>
                  {WORKMAIL_REGIONS.map((r, i) => (
                    <tr key={r.region} className={`border-hairline ${i < WORKMAIL_REGIONS.length - 1 ? "border-b" : ""}`}>
                      <td className="text-text px-4 py-3">{r.label}</td>
                      <td className="text-text px-4 py-3 font-mono text-xs">{r.host}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h3 className="text-text mt-7 flex items-center gap-2 text-sm font-bold">
              <KeyIcon size={16} />
              2. Use these settings in MailPoppy
            </h3>
            <ul className="text-text mt-3 space-y-2 text-sm leading-relaxed">
              <li className="flex gap-2.5"><span className="text-primary">•</span><span><span className="font-semibold">Port:</span> <span className="font-mono text-xs">993</span>, with TLS (the default).</span></li>
              <li className="flex gap-2.5"><span className="text-primary">•</span><span><span className="font-semibold">Username:</span> your full WorkMail address, e.g. <span className="font-mono text-xs">you@yourdomain.com</span>.</span></li>
              <li className="flex gap-2.5"><span className="text-primary">•</span><span><span className="font-semibold">Password:</span> your normal WorkMail password — IMAP is enabled on WorkMail by default.</span></li>
            </ul>

            <h3 className="text-text mt-7 flex items-center gap-2 text-sm font-bold">
              <ArrowRightIcon size={16} />
              3. Test, import, and verify
            </h3>
            <p className="text-muted mt-2 text-sm leading-relaxed">
              Test the connection, import your folders, and confirm everything arrived in MailPoppy. Repeat the import
              for each WorkMail user you&apos;re moving across. Your old mail is now safe in MailPoppy — keep the
              WorkMail account running until you&apos;ve confirmed it&apos;s all there.
            </p>
          </div>
        </section>

        {/* Other providers */}
        <section>
          <SectionTitle>Settings for other providers</SectionTitle>
          <p className="text-muted mt-3 text-sm leading-relaxed">
            Any IMAP mailbox works. Drop these into the same Migration form (host, port 993, TLS, your full email,
            and the password).
          </p>
          <div className="border-hairline mt-6 overflow-hidden rounded-2xl border">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-hairline bg-surface-container border-b">
                  <th className="text-muted px-4 py-3 font-semibold">Provider</th>
                  <th className="text-muted px-4 py-3 font-semibold">IMAP host</th>
                  <th className="text-muted hidden px-4 py-3 font-semibold sm:table-cell">Port</th>
                  <th className="text-muted px-4 py-3 font-semibold">Sign-in</th>
                </tr>
              </thead>
              <tbody>
                {PROVIDERS.map((p, i) => (
                  <tr key={p.name} className={`border-hairline ${i < PROVIDERS.length - 1 ? "border-b" : ""}`}>
                    <td className="text-text px-4 py-3 align-top font-medium">{p.name}</td>
                    <td className="text-text px-4 py-3 align-top font-mono text-xs">{p.host}</td>
                    <td className="text-muted hidden px-4 py-3 align-top font-mono text-xs sm:table-cell">{p.port}</td>
                    <td className="text-muted px-4 py-3 align-top text-xs leading-relaxed">{p.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-dim mt-3 text-xs leading-relaxed">
            Providers and their settings change over time — if a connection is refused, double-check the host and
            port in your provider&apos;s own help pages, and that IMAP access is switched on for the account.
          </p>
        </section>

        {/* Tips */}
        <section>
          <SectionTitle>Tips &amp; troubleshooting</SectionTitle>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            {[
              { icon: LockIcon, t: "App passwords for 2-factor accounts", d: "If the old account uses 2-step verification, your normal password won't work over IMAP — generate an app-specific password and use that instead." },
              { icon: ShieldIcon, t: "Turn on IMAP", d: "Some providers ship with IMAP off. Enable IMAP in the account's settings before you connect, or the server will refuse the login." },
              { icon: ClockIcon, t: "Large mailboxes take a while", d: "Big accounts import in the background — let it run. Re-running skips messages already imported, so it's safe to resume." },
              { icon: CheckCircleIcon, t: "Verify before you cancel", d: "Check your imported mail in MailPoppy before you shut the old account down. The import never deletes anything on the old side." },
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

        {/* CTA */}
        <section className="border-hairline bg-surface-container rounded-3xl border p-8 text-center sm:p-12">
          <h2 className="text-heading text-2xl font-bold tracking-tight">Ready to make the move?</h2>
          <p className="text-muted mx-auto mt-3 max-w-xl leading-relaxed">
            Set up your own email on your domain in about five minutes, then bring your old mail across — no AWS
            experience needed.
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
              href="/#how"
              className="border-hairline bg-surface text-text hover:bg-surface-variant flex w-full items-center justify-center gap-2 rounded-2xl border px-7 py-3.5 text-base font-semibold transition-colors sm:w-auto"
            >
              See how it works
            </Link>
          </div>
        </section>
      </div>

      <Footer />
    </main>
  );
}

function TopBar() {
  return (
    <header className="border-hairline bg-bg/80 sticky top-0 z-30 border-b backdrop-blur">
      <div className="mx-auto flex max-w-3xl items-center gap-4 px-5 py-3">
        <Link href="/" aria-label="MailPoppy home">
          <Logo size="sm" />
        </Link>
        <div className="flex-1" />
        <Link href="/" className="text-muted hover:text-text text-sm font-medium transition-colors">
          ← Home
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

function Footer() {
  return (
    <footer className="border-hairline border-t">
      <div className="text-muted mx-auto flex max-w-3xl flex-col items-center justify-between gap-4 px-5 py-8 text-sm sm:flex-row">
        <Logo size="sm" />
        <nav className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
          <Link href="/#features" className="hover:text-text transition-colors">Features</Link>
          <Link href="/#open" className="hover:text-text transition-colors">Open source</Link>
          <Link href="/migrate" className="hover:text-text transition-colors">Migrate</Link>
          <Link href="/privacy" className="hover:text-text transition-colors">Privacy</Link>
        </nav>
        <div className="text-dim flex items-center gap-1.5 text-xs">
          <CloudIcon size={13} />
          Powered by AWS
        </div>
      </div>
    </footer>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-heading text-2xl font-bold tracking-tight">{children}</h2>;
}

// Small bespoke "folders" glyph for the hero pill (reuses the icon stroke style).
function MailFolders({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 7a2 2 0 0 1 2-2h3l2 2h9a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
      <path d="M3 11h18" />
    </svg>
  );
}

function HowToSchema() {
  const graph = {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: "Migrate your existing email into MailPoppy",
    description: DESCRIPTION,
    totalTime: "PT15M",
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
