// Marketing-site constants and shared content (FAQ reused by the visible
// accordion AND the FAQPage structured data, so they never drift). Override the
// canonical URL per environment with NEXT_PUBLIC_SITE_URL.

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://mailpoppy.com").replace(/\/$/, "");
export const SITE_NAME = "MailPoppy";
export const SITE_TAGLINE = "Email you own — in your own AWS";
export const SITE_DESCRIPTION =
  "MailPoppy is a desktop app for Mac and Windows that turns your own AWS account into a private email service for your domain. Connect AWS once, then create unlimited mailboxes in seconds with no per-seat fees — and read your mail on the web, iPhone and Android. Every message lives only in your AWS, and the engine that runs it is open source, so its privacy is verifiable — not just promised.";

// The public, source-available engine repo. While the repo is still private,
// keep REPO_PUBLIC = false: the "Open & verifiable" section still tells the story
// but renders no dead GitHub links. Flip to true the moment the repo goes public.
export const REPO_URL = "https://github.com/leonct74/mailpoppy-engine";
export const REPO_PUBLIC = false;

export const FAQS: { q: string; a: string }[] = [
  {
    q: "Does MailPoppy store or read my email?",
    a: "No. Your mailbox and every message live inside your own AWS account. MailPoppy operates no servers that receive, store, or have access to your email — it is private by architecture, not just by policy.",
  },
  {
    q: "Do I need to be technical, or know AWS, to use it?",
    a: "No. You don't need any cloud experience — if you've never created an AWS account or set up infrastructure in your life, you'll be fine. MailPoppy is an app you install on your own computer (Mac or Windows); you follow plain-language, on-screen steps, and it deploys the whole email backend for you — inbound and outbound mail, storage, anti-spam and DNS records included. No servers to run, no command line, no config files. Most people go from nothing to a working, professional email setup for their domain in about five minutes.",
  },
  {
    q: "How many mailboxes can I create?",
    a: "As many as you want. Once your domain is set up, creating a new mailbox takes seconds, and there's no per-seat fee — add one address or a hundred for the same flat AWS usage. Each mailbox can have its own storage limit.",
  },
  {
    q: "What does it cost?",
    a: "Because everything runs in your own AWS account, you pay AWS directly for what you use — typically a few dollars a month for an entire domain, with no per-mailbox subscription. MailPoppy's own pricing is coming soon.",
  },
  {
    q: "Can I use my own domain?",
    a: "Yes. MailPoppy is built for your custom domain. It sets up the sending records (SPF, DKIM, DMARC and a custom MAIL FROM) so your mail lands in the inbox, not the spam folder.",
  },
  {
    q: "Can I move my existing email over?",
    a: "Yes. MailPoppy can import your existing mailboxes over IMAP, so you keep your history when you switch.",
  },
  {
    q: "What if I want to leave?",
    a: "There is no lock-in. A single action tears the whole deployment back down and removes it from your AWS account. Your data was always yours — and it stays that way.",
  },
  {
    q: "Is it secure?",
    a: "Mail is filtered for spam and, optionally, scanned for malware with AWS GuardDuty. You set retention, per-mailbox storage limits and your AWS region, so you control where your data lives and how long it's kept. And because the engine is open source, the security is verifiable — you don't have to take our word for it.",
  },
  {
    q: "Is MailPoppy open source?",
    a: "The engine is. The parts that matter most for trust — the mail backend that runs inside your AWS, the infrastructure definition with its least-privilege IAM policies, and the local component that handles your AWS credentials — are published as source-available code under the Functional Source License (which becomes Apache-2.0 two years after each release). The polished desktop app and any Pro features are proprietary, but the security-critical code is open for anyone to read.",
  },
  {
    q: "How do I know my mail and credentials are really private?",
    a: "You can verify it instead of trusting a promise. Because the code that runs in your AWS and the code that touches your AWS credentials are open, you — or your security team — can read exactly what MailPoppy does: that your mail never leaves your account, and that your keys are never sent to us. \"Private by architecture\" is a claim you can check line by line.",
  },
  {
    q: "Could MailPoppy copy or misuse my AWS credentials?",
    a: "No. The admin app runs on your own computer and talks directly to AWS — there is no MailPoppy server in the middle. Your keys are saved only in your standard AWS config file (~/.aws/credentials, owner-only permissions), in a separate \"mailpoppy\" profile that never alters your other profiles, and they are never sent to us or written to logs. For extra peace of mind, connect a least-privilege IAM user or temporary SSO credentials — and revoke them whenever you like.",
  },
  {
    q: "Do I have to give MailPoppy admin access to my AWS account?",
    a: "No — and you shouldn't. MailPoppy only needs permission to create and manage its own email stack. Connect a dedicated IAM user limited to those permissions (or temporary IAM Identity Center credentials) instead of your root or full-admin keys, so the app can never touch anything else in your account. You can delete that user, and tear the whole deployment down, at any time.",
  },
  {
    q: "Where can I read my mail?",
    a: "Everywhere: a webmail client in any browser, plus native apps for iPhone and Android. The desktop app is for the administrator who sets everything up.",
  },
];
