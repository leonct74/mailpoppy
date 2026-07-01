import type { Metadata } from "next";
import Link from "next/link";
import { DocTopBar, DocFooter, SectionTitle, Callout, StepList } from "@/components/webmail/DocChrome";
import { SITE_URL, SITE_NAME } from "@/lib/site";
import {
  ArrowRightIcon,
  SendIcon,
  BoltIcon,
  ShieldIcon,
  KeyIcon,
  MailIcon,
  CheckCircleIcon,
  GlobeIcon,
  RocketIcon,
} from "@/components/webmail/icons";

const TITLE = "Transactional & no-reply email on your domain — MailPoppy guide";
const DESCRIPTION =
  "Only need to SEND automated email — order confirmations, password resets, receipts, alerts from a no-reply address? You don't need a mailbox. Set your domain up in MailPoppy and you can send from any address on it, authenticated and landing in inboxes.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  keywords: [
    "transactional email own domain",
    "no-reply email address setup",
    "send email without a mailbox",
    "SES transactional email SMTP",
    "send-only email your own AWS",
    "order confirmation email domain",
  ],
  alternates: { canonical: "/guides/transactional-email" },
  openGraph: { type: "article", url: `${SITE_URL}/guides/transactional-email`, siteName: SITE_NAME, title: TITLE, description: DESCRIPTION },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

// SES SMTP send endpoints, for the regions MailPoppy supports.
const SMTP_HOSTS: { region: string; label: string; host: string }[] = [
  { region: "eu-west-1", label: "Europe (Ireland)", host: "email-smtp.eu-west-1.amazonaws.com" },
  { region: "us-east-1", label: "US East (N. Virginia)", host: "email-smtp.us-east-1.amazonaws.com" },
  { region: "us-west-2", label: "US West (Oregon)", host: "email-smtp.us-west-2.amazonaws.com" },
];

const STEPS: { title: string; body: string }[] = [
  {
    title: "Set your domain up in MailPoppy",
    body: "This is the only MailPoppy step. It verifies your domain and adds the records (SPF, DKIM, DMARC) that prove your mail is really from you, so your automated messages land in inboxes instead of spam. You don't create a mailbox for the sending address — sending is allowed for the whole domain.",
  },
  {
    title: "Lift the sending limit",
    body: "A brand-new setup starts in a “try-it-out” mode that only sends to a few approved addresses. In the app, use the one-click “request production access” step so you can send to anyone. AWS reviews it, usually within a day.",
  },
  {
    title: "Get your sending credentials from AWS",
    body: "Automated email is sent by your website or app, so it needs credentials to hand to it. In the AWS console's email service (SES), create a set of SMTP credentials — a username and password made just for sending. This is a one-time step and takes a couple of minutes.",
  },
  {
    title: "Point your app at those settings and send",
    body: "Wherever your app or platform asks for “SMTP settings”, enter the host below, port 587, your SMTP username and password, and set the From address to noreply@yourdomain.com. Send a test and confirm it arrives. That's it — you're sending on your own domain.",
  },
];

export default function TransactionalEmailGuide() {
  return (
    <main className="bg-bg text-text min-h-screen">
      <HowToSchema />
      <DocTopBar />

      {/* Hero */}
      <section className="px-5 pt-16 pb-10">
        <div className="mx-auto max-w-3xl text-center">
          <span className="text-primary text-sm font-semibold tracking-wide uppercase">Guide · Send-only email</span>
          <h1 className="text-heading mt-3 text-4xl font-bold tracking-tight sm:text-5xl">
            Transactional &amp; no-reply email
          </h1>
          <p className="text-muted mx-auto mt-5 max-w-2xl text-lg leading-relaxed">
            Only need to <span className="text-text font-semibold">send</span> — order confirmations, password
            resets, receipts, alerts from a <span className="font-mono text-base">noreply@</span> address? Then you
            don't need a mailbox at all. Setting your domain up in MailPoppy is enough.
          </p>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-2">
            {[
              { icon: SendIcon, label: "No mailbox needed" },
              { icon: ShieldIcon, label: "Lands in the inbox" },
              { icon: GlobeIcon, label: "Runs in your own AWS" },
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
        {/* The headline reassurance */}
        <section>
          <Callout tone="important" icon={<BoltIcon size={18} />} title="Just need to send? A domain is all you need.">
            <p>
              A <b>mailbox</b> in MailPoppy is for <i>receiving</i> — it's an inbox someone signs into. Sending is
              different: once your domain is verified, you can send from <b>any</b> address on it
              (<span className="font-mono text-xs">noreply@</span>, <span className="font-mono text-xs">receipts@</span>,{" "}
              <span className="font-mono text-xs">alerts@</span>…) without creating a mailbox for each one.
            </p>
            <p className="mt-2.5">
              So if your address only ever sends and never needs to receive replies, you're done after the domain
              step. No mailbox, no extra setup per address.
            </p>
          </Callout>
        </section>

        {/* What counts */}
        <section>
          <SectionTitle>What this covers</SectionTitle>
          <p className="text-muted mt-3 text-sm leading-relaxed">
            “Transactional” or “send-only” email is anything your systems send automatically, that people aren't meant
            to reply to — for example:
          </p>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {[
              { icon: CheckCircleIcon, t: "Order & payment confirmations", d: "Receipts, invoices, “your order has shipped” — sent from something like orders@ or noreply@." },
              { icon: KeyIcon, t: "Account emails", d: "Password resets, email-verification links, sign-in alerts — the messages your app sends when someone acts." },
              { icon: MailIcon, t: "Notifications", d: "“Someone commented”, low-stock alerts, reminders — automated updates from your product." },
              { icon: SendIcon, t: "Newsletters from a no-reply", d: "One-way announcements where replies aren't expected. (If you want replies, see the note at the end.)" },
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

        {/* Steps */}
        <section>
          <SectionTitle>How to set it up</SectionTitle>
          <p className="text-muted mt-3 text-sm leading-relaxed">
            One step in MailPoppy, then you point your app at AWS to do the actual sending.
          </p>
          <StepList steps={STEPS} />
          <p className="text-muted mt-4 text-sm leading-relaxed">
            New here?{" "}
            <Link href="/guides/new-domain" className="text-primary font-semibold hover:underline">
              Set up a new domain
            </Link>{" "}
            or{" "}
            <Link href="/guides/existing-email" className="text-primary font-semibold hover:underline">
              move a domain that already has email
            </Link>{" "}
            first — then come back here for the sending part.
          </p>
        </section>

        {/* SMTP settings */}
        <section>
          <SectionTitle>Your sending server details</SectionTitle>
          <p className="text-muted mt-3 text-sm leading-relaxed">
            Most apps and platforms just ask for “SMTP settings”. Use <span className="text-text font-semibold">port
            587</span>, your SMTP username and password from AWS, and the host for the region your domain is set up in:
          </p>
          <div className="border-hairline mt-6 overflow-hidden rounded-2xl border">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-hairline bg-surface-container border-b">
                  <th className="text-muted px-4 py-3 font-semibold">Region</th>
                  <th className="text-muted px-4 py-3 font-semibold">SMTP host</th>
                </tr>
              </thead>
              <tbody>
                {SMTP_HOSTS.map((r, i) => (
                  <tr key={r.region} className={`border-hairline ${i < SMTP_HOSTS.length - 1 ? "border-b" : ""}`}>
                    <td className="text-text px-4 py-3">{r.label}</td>
                    <td className="text-text px-4 py-3 font-mono text-xs">{r.host}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-dim mt-3 text-xs leading-relaxed">
            Prefer code over SMTP? You can also send with the AWS SES API from any AWS SDK — same result. Either way,
            set the “from” to an address on your verified domain, like{" "}
            <span className="text-text font-mono">noreply@yourdomain.com</span>.
          </p>
        </section>

        {/* Good to know */}
        <section>
          <SectionTitle>Good to know</SectionTitle>
          <div className="mt-5 space-y-4">
            <Callout icon={<ShieldIcon size={18} />} title="Deliverability is already handled">
              Because MailPoppy sets up SPF, DKIM and DMARC when you add the domain, your transactional mail is signed
              and trusted — the main reason automated email lands in spam is missing exactly those records, and you've
              got them.
            </Callout>
            <Callout icon={<MailIcon size={18} />} title="Replies to a no-reply will bounce — and that's fine">
              A send-only address has no mailbox, so if someone replies, they get a “couldn't be delivered” note. For a
              genuine no-reply that's the intended behaviour. If you'd actually like to read replies to that address,
              just{" "}
              <Link href="/guides/existing-email" className="text-primary font-semibold hover:underline">
                give it a mailbox
              </Link>{" "}
              — then it can receive too.
            </Callout>
            <Callout icon={<RocketIcon size={18} />} title="Lift the sending limit before you go live">
              New setups can only send to a few approved addresses until you request production access (one click in
              the app). Do that before you start sending to real customers.
            </Callout>
          </div>
        </section>

        {/* CTA */}
        <section className="border-hairline bg-surface-container rounded-3xl border p-8 text-center sm:p-12">
          <h2 className="text-heading text-2xl font-bold tracking-tight">Set up your domain, start sending</h2>
          <p className="text-muted mx-auto mt-3 max-w-xl leading-relaxed">
            Add your domain in MailPoppy — that alone unlocks sending from every address on it. No mailboxes required
            for send-only mail.
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
              href="/guides"
              className="border-hairline bg-surface text-text hover:bg-surface-variant flex w-full items-center justify-center gap-2 rounded-2xl border px-7 py-3.5 text-base font-semibold transition-colors sm:w-auto"
            >
              All guides
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
    name: "Set up transactional / no-reply email on your domain with MailPoppy",
    description: DESCRIPTION,
    totalTime: "PT10M",
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
