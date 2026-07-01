import type { Metadata } from "next";
import Link from "next/link";
import { DocTopBar, DocFooter, SectionTitle, Callout, StepList } from "@/components/webmail/DocChrome";
import { SITE_URL, SITE_NAME } from "@/lib/site";
import {
  ArrowRightIcon,
  MailIcon,
  MailOpenIcon,
  GlobeIcon,
  KeyIcon,
  ShieldIcon,
  CheckCircleIcon,
  ServerIcon,
  ClockIcon,
} from "@/components/webmail/icons";

const TITLE = "Move a domain that already has email to MailPoppy — what to expect";
const DESCRIPTION =
  "If your domain already sends or receives email, here's exactly what changes when you switch it to MailPoppy — where incoming mail goes, why an address needs a mailbox before it can receive, and the safe order to switch in so no message is lost.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  keywords: [
    "move existing email to my own AWS",
    "switch email provider keep domain",
    "change domain email without losing mail",
    "adopt existing domain email",
    "MailPoppy existing email guide",
  ],
  alternates: { canonical: "/guides/existing-email" },
  openGraph: { type: "article", url: `${SITE_URL}/guides/existing-email`, siteName: SITE_NAME, title: TITLE, description: DESCRIPTION },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

const STEPS: { title: string; body: string }[] = [
  {
    title: "Write down every address that RECEIVES mail",
    body: "Make a quick list of the addresses on your domain that people send messages to — you@, info@, sales@, support@, and so on. You'll create a mailbox for each of these in MailPoppy. (Addresses that only ever send, like a no-reply, don't need to be on the list.)",
  },
  {
    title: "Make sure your domain's DNS is in AWS (Route 53)",
    body: "MailPoppy sets up your domain's email by editing its DNS in AWS Route 53. If your domain's DNS is managed somewhere else today (your registrar, or another host), move it to Route 53 first — a one-time change on your provider's side. Nothing about your mail changes yet at this point.",
  },
  {
    title: "Set up the domain in MailPoppy",
    body: "In the app, choose your domain and press “Set up email for this domain.” This is the moment your domain's incoming mail starts arriving in MailPoppy instead of at your old provider, and your sending records are put in place. It usually takes a few minutes to take effect.",
  },
  {
    title: "Immediately create a mailbox for each address on your list",
    body: "Right after setup, add a mailbox for every receiving address you wrote down. Until an address has a mailbox, messages sent to it can't come in — so doing this straight away is what keeps your mail flowing without a gap.",
  },
  {
    title: "Bring your old mail across",
    body: "Use MailPoppy's import to copy your existing folders and history into the new mailboxes over IMAP, so you keep everything. See the Import guide for the exact settings for your old provider.",
  },
  {
    title: "Test, then you're done",
    body: "Send a message to each address from an outside inbox (like your phone) and check it arrives in MailPoppy. Once you're happy, you can close your old email service. Keep it running until you've confirmed everything came across.",
  },
];

export default function ExistingEmailGuide() {
  return (
    <main className="bg-bg text-text min-h-screen">
      <HowToSchema />
      <DocTopBar />

      {/* Hero */}
      <section className="px-5 pt-16 pb-10">
        <div className="mx-auto max-w-3xl text-center">
          <span className="text-primary text-sm font-semibold tracking-wide uppercase">Guide · Already have email</span>
          <h1 className="text-heading mt-3 text-4xl font-bold tracking-tight sm:text-5xl">
            Moving a domain that already has email
          </h1>
          <p className="text-muted mx-auto mt-5 max-w-2xl text-lg leading-relaxed">
            Your domain already sends or receives mail somewhere else. Switching to MailPoppy is straightforward — but
            because real mail is flowing today, it's worth two minutes to understand exactly what changes, so nothing
            slips through the cracks.
          </p>
        </div>
      </section>

      <div className="mx-auto max-w-3xl space-y-14 px-5 pb-24">
        {/* The one big thing */}
        <section>
          <Callout
            tone="important"
            icon={<MailOpenIcon size={18} />}
            title="The one thing to understand first"
          >
            <p>
              When you set up your domain in MailPoppy, you're telling the internet to deliver your domain's incoming
              mail <b>to MailPoppy from now on</b>, instead of to your current provider.
            </p>
            <p className="mt-2.5">
              And there's a simple rule for incoming mail: an address can only receive once it has a{" "}
              <b>mailbox</b> in MailPoppy. Until then, messages to that address are turned away — the person who wrote
              gets a note saying it couldn't be delivered. Nothing is lost on your side, and it's fixed the instant you
              add the mailbox.
            </p>
            <p className="mt-2.5">
              So the golden rule is: <b>set up the domain, then create a mailbox for each of your addresses straight
              away.</b> The steps below walk you through doing exactly that, in the right order.
            </p>
          </Callout>
        </section>

        {/* What changes */}
        <section>
          <SectionTitle>What actually changes</SectionTitle>
          <div className="mt-5 grid gap-4 sm:grid-cols-3">
            {[
              { icon: MailIcon, t: "Where incoming mail goes", d: "New messages to your domain start arriving in MailPoppy instead of at your old provider. That's the switch you're making — on purpose." },
              { icon: ServerIcon, t: "How your mail is sent", d: "MailPoppy sets up the records (SPF, DKIM, DMARC) that prove your mail is really from you, so it keeps landing in inboxes, not spam." },
              { icon: KeyIcon, t: "Who can receive", d: "Each address needs its own mailbox in MailPoppy to receive. Creating them takes seconds and there's no per-mailbox fee." },
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

        {/* Before you begin */}
        <section>
          <SectionTitle>Before you begin</SectionTitle>
          <div className="border-hairline bg-surface-container mt-5 rounded-2xl border p-6">
            <ul className="space-y-3">
              {[
                "Keep your current email running. Don't cancel anything until your new mailboxes are set up and you've checked your mail arrives. Switching is reversible right up to the end.",
                "Have your list of receiving addresses ready (from step 1 below) so you can create their mailboxes the moment setup finishes.",
                "Make sure your domain's DNS is managed in AWS (Route 53), or move it there first — that's how MailPoppy sets your domain up.",
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

        {/* The safe way to switch */}
        <section>
          <SectionTitle>The safe way to switch</SectionTitle>
          <p className="text-muted mt-3 text-sm leading-relaxed">
            Follow these in order and your mail keeps flowing throughout — no gap, no lost messages.
          </p>
          <StepList steps={STEPS} />
        </section>

        {/* Send-only addresses */}
        <section>
          <SectionTitle>Addresses that only send (like no-reply)</SectionTitle>
          <div className="mt-5 space-y-4">
            <Callout icon={<MailIcon size={18} />} title="They don't need a mailbox — and they keep working">
              An address your systems only <i>send</i> from — an order-confirmation <code className="text-text font-mono text-xs">no-reply@</code>,
              for example — doesn't receive anything, so it doesn't need a mailbox and won't show up in your mailbox
              list. It carries on sending exactly as before. For setting one of these up from scratch, see the{" "}
              <Link href="/guides/transactional-email" className="text-primary font-semibold hover:underline">
                transactional &amp; no-reply email guide
              </Link>
              .
            </Callout>
            <Callout icon={<MailOpenIcon size={18} />} title="Just remember: replies to it will bounce">
              If someone <i>replies</i> to a send-only address that has no mailbox, that reply is turned away. For a
              genuine “no-reply” that's usually what you want. But if you'd actually like to read replies (say a{" "}
              <code className="text-text font-mono text-xs">support@</code> that also sends), just give it a mailbox
              too and its replies will land in your inbox.
            </Callout>
          </div>
        </section>

        {/* Already in SES */}
        <section>
          <SectionTitle>If your domain was already set up in Amazon SES</SectionTitle>
          <p className="text-muted mt-3 text-sm leading-relaxed">
            Some people have already added their domain to Amazon's email service (SES) at some point — maybe for a
            website's contact form — and it might show as <span className="text-text font-semibold">“not verified.”</span>{" "}
            That just means an old, half-finished setup that never completed. You don't need to clean anything up:
            MailPoppy adopts the domain, refreshes its setup for you, and takes it through to verified as part of the
            normal “Set up email for this domain” step. If a domain sits on the checking step for a while, that's just
            the internet catching up with the change — it clears on its own.
          </p>
        </section>

        {/* Good to know */}
        <section>
          <SectionTitle>Good to know</SectionTitle>
          <div className="mt-5 space-y-4">
            <Callout icon={<ClockIcon size={18} />} title="Do the mailboxes soon, not later">
              The only way a message goes undelivered is if it arrives for an address that doesn't have a mailbox yet.
              Creating your mailboxes right after setup closes that window — it takes only a minute or two for a
              handful of addresses.
            </Callout>
            <Callout icon={<ShieldIcon size={18} />} title="Your old mail is never touched">
              Importing copies your history across — it never deletes anything from your old account. You can go back
              and forth until you're sure everything is in MailPoppy.
            </Callout>
            <Callout icon={<GlobeIcon size={18} />} title="No lock-in">
              Everything runs in your own AWS account, and one action removes the whole setup if you ever change your
              mind.
            </Callout>
          </div>
        </section>

        {/* CTA */}
        <section className="border-hairline bg-surface-container rounded-3xl border p-8 text-center sm:p-12">
          <h2 className="text-heading text-2xl font-bold tracking-tight">Ready when you are</h2>
          <p className="text-muted mx-auto mt-3 max-w-xl leading-relaxed">
            Set up your domain, create your mailboxes, then bring your old mail across. Take it in that order and the
            switch is smooth.
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
              href="/migrate"
              className="border-hairline bg-surface text-text hover:bg-surface-variant flex w-full items-center justify-center gap-2 rounded-2xl border px-7 py-3.5 text-base font-semibold transition-colors sm:w-auto"
            >
              See the import guide
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
    name: "Move a domain that already has email to MailPoppy",
    description: DESCRIPTION,
    totalTime: "PT20M",
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
