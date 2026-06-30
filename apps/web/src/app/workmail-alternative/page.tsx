import type { Metadata } from "next";
import Link from "next/link";
import type { ComponentType, ReactNode } from "react";
import { Logo } from "@/components/webmail/Logo";
import { SITE_URL, SITE_NAME } from "@/lib/site";
import {
  ArrowRightIcon,
  ClockIcon,
  ServerIcon,
  ShieldIcon,
  CoinsIcon,
  CheckCircleIcon,
  BoltIcon,
  LockIcon,
  MailIcon,
  CloudIcon,
} from "@/components/webmail/icons";

const TITLE = "AWS WorkMail Alternative — Migrate Before the 2027 Shutdown | MailPoppy";
const DESCRIPTION =
  "Amazon WorkMail is shutting down on March 31, 2027 — no new customers since April 30, 2026. MailPoppy is the natural move for WorkMail users: keep your email inside AWS, but in an account you fully own, with no per-seat fees. Import your mailboxes over IMAP.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  keywords: [
    "AWS WorkMail alternative",
    "Amazon WorkMail alternative",
    "WorkMail shutdown",
    "WorkMail end of life",
    "WorkMail end of support",
    "WorkMail replacement",
    "WorkMail migration",
    "migrate from AWS WorkMail",
    "WorkMail 2027",
    "email in your own AWS",
  ],
  alternates: { canonical: "/workmail-alternative" },
  openGraph: {
    type: "article",
    url: `${SITE_URL}/workmail-alternative`,
    siteName: SITE_NAME,
    title: TITLE,
    description: DESCRIPTION,
  },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

// WorkMail-specific FAQ — visible accordion AND FAQPage structured data share this
// one array, so they never drift (same SEO discipline as the homepage).
const WM_FAQS: { q: string; a: string }[] = [
  {
    q: "Is AWS WorkMail really shutting down?",
    a: "Yes. AWS has announced the end of support for Amazon WorkMail. New customers could no longer sign up after April 30, 2026, and after March 31, 2027 the WorkMail console and all WorkMail resources — including emails, contacts and calendars — become inaccessible. AWS recommends existing customers migrate to a third-party solution before then.",
  },
  {
    q: "When do I need to migrate by?",
    a: "Before March 31, 2027 — but sooner is safer. Migrations involving many mailboxes take time to plan, pilot and cut over, and leaving it until early 2027 risks a rushed move. Starting now means you switch on your own schedule, not under deadline pressure.",
  },
  {
    q: "Why is MailPoppy a natural fit for WorkMail users?",
    a: "You already chose to run your email inside AWS — that was the whole point of WorkMail. MailPoppy keeps that, but in an account you fully own and control: the entire email service is deployed into your own AWS, no vendor sits in the path of your mail, and there is no per-seat fee. It's the same 'email in AWS' idea, without the vendor who just walked away from it.",
  },
  {
    q: "Can I bring my existing email and folders across?",
    a: "Yes. MailPoppy imports your existing mailboxes over IMAP, preserving your folders and history, so you keep your mail when you switch. See the migration guide for the step-by-step.",
  },
  {
    q: "Does MailPoppy include calendar and contacts like WorkMail did?",
    a: "Not today — and we'd rather be upfront than surprise you. MailPoppy is focused on email: mailboxes on your domain, a webmail client, and native iPhone and Android apps. If calendar and contacts are essential to your team, factor that into your migration plan.",
  },
  {
    q: "Can I keep using Outlook?",
    a: "Today you read and send mail in MailPoppy's own webmail and mobile apps rather than a third-party desktop client. Standard IMAP/SMTP client support (so you could use Outlook or Apple Mail) is on the roadmap, not available yet — so if Outlook is a hard requirement right now, it's worth knowing before you switch.",
  },
  {
    q: "What will it cost compared to WorkMail?",
    a: "WorkMail charged per user, per month. MailPoppy has no per-seat fee — because the service runs in your own AWS account, you pay AWS directly for usage, which is typically a few dollars a month for a whole domain regardless of how many mailboxes you create. MailPoppy's own app pricing is coming soon.",
  },
  {
    q: "Is my email private with MailPoppy?",
    a: "Yes. Every message lives only inside your own AWS account — MailPoppy operates no servers that receive, store or read your mail. And the engine that runs it is open source, so that privacy is something you can verify, not just take on trust.",
  },
];

export default function WorkMailAlternative() {
  return (
    <main className="bg-bg text-text">
      <StructuredData />
      <Header />
      <Hero />
      <Timeline />
      <WhyMailpoppy />
      <Comparison />
      <Honest />
      <MigrateSteps />
      <Faq />
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
        <Link href="/migrate" className="text-muted hover:text-text hidden text-sm font-semibold sm:inline">
          Migration guide
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
    <section className="relative overflow-hidden px-5 pt-20 pb-16 sm:pt-24">
      <div
        aria-hidden
        className="bg-primary-bright pointer-events-none absolute -top-40 left-1/2 h-[32rem] w-[32rem] -translate-x-1/2 rounded-full opacity-[0.09] blur-3xl"
      />
      <div className="relative mx-auto max-w-3xl text-center">
        <span className="border-hairline bg-surface text-muted inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-semibold">
          <ClockIcon size={14} />
          Amazon WorkMail end of support — March 31, 2027
        </span>
        <h1 className="text-heading mt-6 text-4xl font-bold tracking-tight sm:text-6xl">
          WorkMail is shutting down.
          <br className="hidden sm:block" /> Move to email you own.
        </h1>
        <p className="text-muted mx-auto mt-5 max-w-2xl text-lg leading-relaxed">
          AWS is retiring Amazon WorkMail — no new customers since April 30, 2026, and full shutdown on{" "}
          <span className="text-text font-semibold">March 31, 2027</span>. You liked having your email in AWS. MailPoppy
          keeps it there — but in an account <span className="text-text font-semibold">you fully own</span>, with no
          per-seat fee and no vendor who can switch it off.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/app"
            className="bg-primary text-primary-text flex w-full items-center justify-center gap-2 rounded-2xl px-7 py-3.5 text-base font-bold tracking-wide transition-opacity hover:opacity-90 sm:w-auto"
          >
            Open MailPoppy
            <ArrowRightIcon size={18} />
          </Link>
          <Link
            href="/migrate"
            className="border-hairline bg-surface text-text hover:bg-surface-variant flex w-full items-center justify-center gap-2 rounded-2xl border px-7 py-3.5 text-base font-semibold transition-colors sm:w-auto"
          >
            Read the migration guide
          </Link>
        </div>
        <p className="text-dim mt-4 text-xs">Import your mailboxes over IMAP · Keep your folders and history</p>
      </div>
    </section>
  );
}

/* ─────────────────────────── Timeline ─────────────────────────── */

function Timeline() {
  const events: { date: string; title: string; body: string }[] = [
    {
      date: "April 30, 2026",
      title: "No new customers",
      body: "Amazon WorkMail stopped accepting new sign-ups. Existing customers can keep using it — for now.",
    },
    {
      date: "March 31, 2027",
      title: "Full shutdown",
      body: "Access to the WorkMail console and all resources ends. Emails, contacts and calendars become inaccessible.",
    },
    {
      date: "Before then",
      title: "Migrate out",
      body: "AWS recommends moving to another solution. The earlier you start, the calmer the cut-over.",
    },
  ];
  return (
    <Section tone="elevated">
      <SectionHeading eyebrow="The deadline" title="What's happening, and when" />
      <div className="mt-12 grid gap-4 md:grid-cols-3">
        {events.map((e, i) => (
          <div key={e.date} className="border-hairline bg-surface relative rounded-2xl border p-6">
            <span className="text-primary/30 absolute top-5 right-5 text-4xl font-bold">{i + 1}</span>
            <span className="text-primary text-xs font-semibold tracking-wide uppercase">{e.date}</span>
            <h3 className="text-text mt-2 text-base font-bold">{e.title}</h3>
            <p className="text-muted mt-2 text-sm leading-relaxed">{e.body}</p>
          </div>
        ))}
      </div>
      <p className="text-dim mx-auto mt-8 max-w-2xl text-center text-xs leading-relaxed">
        Dates per Amazon&apos;s WorkMail end-of-support announcement. After the shutdown, AWS has not announced any
        post-shutdown data recovery — so export or migrate your mail before March 31, 2027.
      </p>
    </Section>
  );
}

/* ─────────────────────────── Why MailPoppy ─────────────────────────── */

function WhyMailpoppy() {
  const points: { icon: ComponentType<{ size?: number }>; title: string; body: string }[] = [
    {
      icon: ServerIcon,
      title: "Still in AWS — but yours",
      body: "The whole email service deploys into your own AWS account. Same cloud you already trust, except now you hold the keys and no vendor can retire it out from under you.",
    },
    {
      icon: CoinsIcon,
      title: "No per-seat fee",
      body: "WorkMail billed per user. MailPoppy doesn't — you pay AWS usage directly, typically a few dollars a month for a whole domain, with unlimited mailboxes.",
    },
    {
      icon: ShieldIcon,
      title: "Private by architecture",
      body: "No MailPoppy server sits in the path of your mail. We can't read it, scan it or hand it over — and because the engine is open source, you can verify that.",
    },
    {
      icon: BoltIcon,
      title: "One-click in, one-click out",
      body: "The desktop app deploys the entire backend for you and tears it all down just as easily. Your domain and data stay portable — no second lock-in.",
    },
  ];
  return (
    <Section>
      <SectionHeading
        eyebrow="Why WorkMail users move here"
        title="Keep what you liked. Drop what you didn't."
        subtitle="WorkMail's appeal was email inside AWS. Its problem turned out to be that it was someone else's product to discontinue. MailPoppy gives you the first without the second."
      />
      <div className="mt-12 grid gap-4 sm:grid-cols-2">
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

/* ─────────────────────────── Comparison ─────────────────────────── */

function Comparison() {
  const rows: { label: string; wm: string; mp: string }[] = [
    { label: "Future", wm: "Shutting down March 31, 2027", mp: "Yours to keep — no vendor sunset" },
    { label: "Where it runs", wm: "AWS, managed by Amazon", mp: "Your own AWS account, owned by you" },
    { label: "Pricing", wm: "Per user, per month", mp: "AWS usage — no per-seat fee" },
    { label: "Who can read it", wm: "The provider", mp: "Only you" },
    { label: "Leaving", wm: "Forced migration by 2027", mp: "One-click teardown, anytime" },
    { label: "Verifiable privacy", wm: "Closed", mp: "Open-source engine" },
  ];
  return (
    <Section tone="elevated">
      <SectionHeading eyebrow="WorkMail vs. MailPoppy" title="The email-in-AWS idea, without the sunset" />
      <div className="border-hairline mt-10 overflow-hidden rounded-2xl border">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-hairline bg-surface-container border-b">
              <th className="text-muted px-4 py-4 font-semibold sm:px-6"> </th>
              <th className="text-muted px-4 py-4 font-semibold sm:px-6">Amazon WorkMail</th>
              <th className="text-primary px-4 py-4 font-bold sm:px-6">MailPoppy</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.label} className={`border-hairline ${i < rows.length - 1 ? "border-b" : ""}`}>
                <td className="text-text px-4 py-4 font-medium sm:px-6">{r.label}</td>
                <td className="text-muted px-4 py-4 sm:px-6">{r.wm}</td>
                <td className="text-text bg-primary/[0.04] px-4 py-4 sm:px-6">
                  <span className="flex items-start gap-2">
                    <span className="text-primary mt-0.5 shrink-0">
                      <CheckCircleIcon size={16} />
                    </span>
                    {r.mp}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

/* ─────────────────────────── Honest "what to know" ─────────────────────────── */

function Honest() {
  return (
    <Section>
      <div className="border-hairline bg-surface-container relative overflow-hidden rounded-3xl border p-8 sm:p-12">
        <div className="relative mx-auto max-w-2xl">
          <span className="text-primary text-sm font-semibold tracking-wide uppercase">Before you switch</span>
          <h2 className="text-heading mt-3 text-2xl font-bold tracking-tight">A few honest things to know</h2>
          <p className="text-muted mt-4 leading-relaxed">
            We&apos;d rather you switch with clear eyes than be disappointed later. MailPoppy is the right move if email
            ownership is what you&apos;re after — but it isn&apos;t a like-for-like WorkMail clone:
          </p>
          <ul className="mt-6 grid gap-3">
            {[
              "It's email-focused today — calendar and contacts aren't included.",
              "You read mail in MailPoppy's own webmail and iPhone/Android apps; standard Outlook/IMAP client support is on the roadmap, not shipped yet.",
              "A brand-new sending domain can land in spam for a week or two while reputation builds — that's normal and improves on its own.",
              "MailPoppy can't create your AWS account for you (AWS needs your own email and card), but the app guides every step.",
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
      </div>
    </Section>
  );
}

/* ─────────────────────────── Migrate steps ─────────────────────────── */

function MigrateSteps() {
  const steps: { icon: ComponentType<{ size?: number }>; title: string; body: string }[] = [
    {
      icon: CloudIcon,
      title: "Deploy MailPoppy in your AWS",
      body: "Install the desktop app, connect your AWS account once, and it builds the whole email backend in your account.",
    },
    {
      icon: MailIcon,
      title: "Recreate your mailboxes",
      body: "Add your addresses on your domain in seconds, then import your existing WorkMail mail over IMAP — folders and history intact.",
    },
    {
      icon: LockIcon,
      title: "Cut over your domain",
      body: "Point your domain's mail records to your new MailPoppy setup, and you're sending and receiving from infrastructure you own.",
    },
  ];
  return (
    <Section tone="elevated">
      <SectionHeading
        eyebrow="Migrating off WorkMail"
        title="Three steps to email you own"
        subtitle="The desktop app walks you through each step. Most of the work is automated — and your credentials never leave your computer."
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
        Full instructions, including the IMAP import details:{" "}
        <Link href="/migrate" className="text-primary font-semibold hover:underline">
          Read the migration guide →
        </Link>
      </p>
    </Section>
  );
}

/* ─────────────────────────── FAQ ─────────────────────────── */

function Faq() {
  return (
    <Section>
      <SectionHeading eyebrow="WorkMail migration FAQ" title="Questions, answered" />
      <div className="mx-auto mt-10 max-w-3xl space-y-3">
        {WM_FAQS.map((f) => (
          <details key={f.q} className="border-hairline bg-surface group rounded-2xl border p-5">
            <summary className="text-text flex cursor-pointer items-center justify-between gap-4 text-base font-semibold [&::-webkit-details-marker]:hidden">
              {f.q}
              <span className="text-primary shrink-0 transition-transform group-open:rotate-45">
                <PlusIcon />
              </span>
            </summary>
            <p className="text-muted mt-3 text-sm leading-relaxed">{f.a}</p>
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
    <Section>
      <div className="border-hairline bg-surface-container relative overflow-hidden rounded-3xl border p-10 text-center sm:p-14">
        <div
          aria-hidden
          className="bg-primary-bright pointer-events-none absolute -top-24 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full opacity-[0.12] blur-3xl"
        />
        <div className="relative">
          <Logo size="lg" className="mx-auto" />
          <h2 className="text-heading mt-6 text-3xl font-bold tracking-tight sm:text-4xl">
            Don&apos;t wait for the shutdown.
          </h2>
          <p className="text-muted mx-auto mt-4 max-w-lg leading-relaxed">
            Move your email to an account you own — same AWS, no per-seat bill, no vendor who can turn it off. Start on
            your own schedule, well before March 2027.
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
          <Link href="/migrate" className="hover:text-text transition-colors">Migrate</Link>
          <Link href="/privacy" className="hover:text-text transition-colors">Privacy</Link>
          <Link href="/account" className="hover:text-text transition-colors">Sign in</Link>
        </nav>
      </div>
    </footer>
  );
}

/* ─────────────────────────── Layout helpers ─────────────────────────── */

function Section({ tone = "base", children }: { tone?: "base" | "elevated"; children: ReactNode }) {
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

/* ─────────────────────────── Structured data (SEO) ─────────────────────────── */

function StructuredData() {
  const graph = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
          { "@type": "ListItem", position: 2, name: "AWS WorkMail alternative", item: `${SITE_URL}/workmail-alternative` },
        ],
      },
      {
        "@type": "FAQPage",
        mainEntity: WM_FAQS.map((f) => ({
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
