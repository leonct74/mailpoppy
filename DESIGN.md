# Mailpoppy — Design Document

> **Status:** Planning / pre-implementation. No code yet.
> **Last updated:** 2026-06-01
> **Working name:** Mailpoppy (`mailpoppy.com` secured). Note: the name sits in a crowded
> "MailPop / Poppy" email-app cluster — run a USPTO TSDR + EUIPO trademark clearance
> (Nice classes 9 / 38 / 42) before investing in the brand.

---

## 1. One-liner

**Mailpoppy lets AWS administrators host email for their own domains entirely inside their
own AWS account — set up in minutes, paid for once, with a built-in desktop (later mobile)
mail client. Your mail, your cloud, no per-seat subscription, no lock-in.**

---

## 2. Why now — the market window

AWS is shutting down **WorkMail**:

| Date | Event |
|---|---|
| 31 Mar 2026 | Shutdown announced |
| 30 Apr 2026 | WorkMail stops accepting **new** customers |
| 31 Mar 2027 | **Full end of support** — all mailboxes, calendars, contacts, attachments become permanently inaccessible |

This strands a population of existing WorkMail users who already manage their domains in
Route53, on a hard ~10-month deadline. AWS pushes them toward *third-party* providers
(Kopano, Zoho, M365, Google) — **nobody offers "stay on your own AWS, just rewire it."**
That gap is Mailpoppy's wedge, and the deadline creates urgency.

**Target user:** AWS administrators / Route53 users with one or more custom domains —
including agencies/MSPs managing email for *multiple* client domains. Technical enough to
have an AWS account and bill; motivated by a deadline. Narrow but well-aimed and high-intent.

---

## 3. Positioning & differentiators

Incumbents sell email **per-user, per-month, forever** (WorkMail ~$4/user/mo, Google
Workspace / M365 ~$6/user/mo, Zoho ~$1/user/mo). A 10-person company pays ~$500–700/year,
indefinitely.

Mailpoppy's pitch is a **different shape of cost and ownership**:

- **Own it, don't rent it** — email runs in *your* AWS account; you hold the data.
- **Pay once per domain** — no per-seat tax; unlimited mailboxes per domain.
- **Serverless & cheap** — ~$0 at idle; you pay AWS only for what you actually use.
- **No lock-in** — standards-based (SES/IMAP-exportable); your mail isn't hostage to us.
- **100% in your control** — admin-configurable retention, filtering, and policy.

---

## 4. Core architectural principle (read this first)

**S3 is not a mail server.** This single fact shapes everything.

- SES *receives* inbound mail and *sends* outbound mail.
- S3 *stores* the raw `.eml` files — nothing more. A bucket is a flat pile of message files.
- **None of the familiar email concepts exist in S3** — no inbox, unread/read, folders,
  threads, deleted, or search. **Mailpoppy manufactures all of that itself** in a DynamoDB
  index that it builds and maintains on top of the raw S3 files.

So the pipeline is:

```
Route53 (DNS)  →  SES (transport)  →  S3 (raw storage) + Lambda (processing)
                                              ↓
                                    DynamoDB (the mailbox: state, flags, folders, threads, search index)
                                              ↓
                          API Gateway + Lambda (Cognito-authorized access API)
                                              ↓
                                    Mailpoppy client (desktop, later mobile)
```

Everything runs **serverless** and **inside the customer's own AWS account** ("BYO-AWS").
Mailpoppy the vendor holds no customer mail and runs no per-customer infrastructure.

---

## 5. High-level architecture

### 5.1 Provisioned into the customer's AWS account (per deployment)

| Service | Role |
|---|---|
| **Route53** | DNS records: MX, SPF, DKIM (3 CNAMEs), DMARC, autoconfig |
| **SES — inbound** | Receipt rules; spam/virus/auth verdicts; write raw message to S3 + trigger Lambda |
| **SES — outbound** | Send mail (API + SMTP credentials for "bring your own client") |
| **S3** | Raw `.eml` storage (+ later: extracted attachments, sent copies, trash prefix) |
| **Lambda — inbound processor** | Parse MIME → write metadata to DynamoDB; apply forwarding rules |
| **Lambda — access API** | Cognito-authorized: list/read/flag/move/search/send on behalf of the logged-in user |
| **Lambda — janitor** | Scheduled (EventBridge); enforces retention policy (purge per admin config) |
| **DynamoDB** | `index` table (the mailbox) + `settings`/`policy` table (per-deployment & per-domain config) |
| **Cognito** | User Pool (mailbox identities) + Identity Pool (scoped temp AWS creds) |
| **API Gateway** | HTTP API fronting the access-API Lambda, with a Cognito JWT authorizer |
| **SNS** | Bounce/complaint notifications → suppression-list Lambda; (later) push to APNs/FCM |

### 5.2 On the vendor side (reuse ScrutiBank infra)

- **License server**: Stripe + Firebase + website — issues per-domain licenses, tracks
  maintenance-expiry, validates activations (with offline grace).
- **Update/distribution**: signed desktop builds + auto-update channel.

### 5.3 The client

- **Mailpoppy desktop app** (Tauri v2 + React + TS + Tailwind — same stack as ScrutiBank).
  Role-aware single app:
  - **Admin mode** (AWS creds connected): the setup/provisioning wizard, mailbox-user
    management, policy panels, licensing — *plus* the admin's own mailbox.
  - **Mailbox mode** (Cognito login only): just the user's own mail. No AWS access.
- **Mobile** (later): React Native (Expo), sharing the `core` + `api-client` packages.

---

## 6. The two credential planes (critical)

There are **two completely separate** credential contexts. Conflating them breaks
multi-user, mobile, and device changes.

| | **Plane 1 — Provisioning** | **Plane 2 — Mailbox access** |
|---|---|---|
| **Who** | The AWS admin, once (at setup / upgrades) | Every end-user, continuously (incl. admin on mobile, and other people the admin set up) |
| **Does** | Builds/upgrades the AWS stack | Reads/writes **only that user's own** mail |
| **Mechanism** | Admin's **AWS credential chain** (named profile / SSO / keys) via boto3 | **Cognito** login (email/password + MFA) → Identity Pool issues **short-lived, scoped** AWS creds |
| **Privilege** | High (account-wide, scoped by a least-privilege policy) | Minimal (one mailbox) |
| **Devices** | Admin's machine | Any device, any time — it's a *login*, not a device key |
| **Where it runs** | Desktop sidecar (boto3) using the admin's local AWS profile | Client → API Gateway (HTTPS + Cognito JWT). **No AWS creds on the mail path.** |

Key consequence: the **mail path never needs AWS credentials** — the client authenticates a
user via Cognito and calls the deployed API over HTTPS. This is what makes multi-user and
mobile possible. The admin's powerful credentials are used **only** by the provisioning
wizard, only at setup/upgrade time, and never leave their machine.

**Credentials decisions (locked):**
- **Provisioning:** lean on the standard AWS credential provider chain (named profiles,
  SSO-backed or key-backed) + a "paste access keys" fallback. Ship a tight least-privilege
  IAM policy and an optional one-click CloudFormation role. ("SSO vs keys" becomes a profile
  the admin already manages — not our problem to build.)
- **Mailbox access:** Cognito User Pool + Identity Pool, **provisioned into the admin's own
  account** (so the vendor still holds nothing), fronted by a thin Cognito-authorized API so
  authorization logic lives in one audited place and is shared by all clients.

---

## 7. Identity & multi-domain model

- A **deployment** = one customer's Mailpoppy stack in their AWS account.
- A deployment supports **multiple domains** (primary use case includes agencies/MSPs).
- Each domain supports **unlimited mailboxes** (this is a headline differentiator — no
  per-seat tax).
- A **mailbox user** = a Cognito User Pool identity (email + password + optional MFA),
  mapped to a primary address + optional **aliases**; **catch-all** optional per domain.
- **Isolation** is enforced server-side in the access-API Lambda using the verified Cognito
  claims: user X can only see/act on X's mailbox, even though all mailboxes share one AWS
  account. This must be airtight (security-critical).
- The **admin** manages mailbox users via the admin panel (Cognito admin APIs):
  create/invite, reset, assign aliases, suspend.

---

## 8. Data model (initial)

### 8.1 S3 layout (one bucket per deployment; prefixes per concern)

```
s3://<deployment-bucket>/
  inbound/<domain>/<mailbox>/<message-id>.eml      # raw received mail
  sent/<domain>/<mailbox>/<message-id>.eml         # sent copies (SES keeps none — we write them)
  trash/<domain>/<mailbox>/<message-id>.eml        # soft-deleted (lifecycle/janitor purges)
  attachments/<message-id>/<n>-<filename>          # (later) extracted attachments for previews
```

### 8.2 DynamoDB — `index` table (the mailbox)

- **PK** = `<domain>#<mailbox>` (partition per mailbox; underpins isolation)
- **SK** = `<folder>#<timestamp>#<message-id>` (sortable by folder + recency)
- Attributes: `from`, `to`, `subject`, `snippet`, `s3Key`, `threadId`, `flags`
  (`unread`, `starred`, etc.), `folder`, `hasAttachments`, `spamVerdict`, `authVerdicts`,
  `sizeBytes`.
- GSIs as needed: by `threadId` (conversation view), by sender/date (search).

### 8.3 DynamoDB — `settings` / `policy` table

- Per-deployment default policy + per-domain overrides (retention, verdict actions,
  allow/block lists, attachment soft-cap, search tier, etc.). See §10.

---

## 9. "Life of an email" (the two core flows)

### 9.1 Inbound — someone emails `you@yourdomain.com`

1. Sender's server looks up the **MX record** (Route53) → routes to SES inbound for the region.
2. SES receives it; runs spam/virus scan + SPF/DKIM/DMARC checks → produces **verdicts**.
3. The receipt rule **writes the raw `.eml` to S3** and triggers the **inbound Lambda**.
4. Lambda parses MIME, computes the thread (`Message-ID`/`In-Reply-To`/`References`), and
   **writes a metadata record to DynamoDB** (`unread:true, folder:inbox, …`); applies the
   admin's verdict policy (e.g. virus → quarantine, spam → Junk).
5. *(Optional)* applies forwarding rules; *(mobile, later)* publishes SNS → push notification.
6. The **client**, on refresh, queries DynamoDB via the access API → shows the inbox list.
   Opening a message fetches the raw file from S3, renders it (safe HTML), and flips
   `unread:false` in DynamoDB.

### 9.2 Outbound — you send / reply

1. Client builds a raw MIME message (HTML + plaintext fallback, attachments, threading
   headers).
2. Access-API Lambda sends via **SES** (enforcing that the user may only send *as* their own
   addresses).
3. Lambda **writes a "Sent" copy** to S3 + DynamoDB (SES keeps none).
4. SES emits **bounce/complaint** events → SNS → suppression-list Lambda (ignore this and AWS
   throttles/suspends sending).

---

## 10. Configuration & policy model

Design philosophy: **great defaults so a solo admin needs zero config; full policy for
businesses that need control; heavy features as opt-ins the admin pays for in their own AWS.**
(Same pattern as ScrutiBank's `default_settings.json` + editable `settings.json`.) Everything
sorts into four buckets:

| Bucket | Examples |
|---|---|
| **Fixed engineering** (internal, we decide) | attachment storage model; search core; verdict plumbing; janitor-Lambda delete mechanism |
| **Admin policy** (default + per-deployment/per-domain override) | **retention**; verdict actions (spam/virus/auth → junk/reject/tag); allow/block lists; attachment soft-cap; Junk-folder behavior; **per-mailbox storage quota** |
| **Cost-bearing opt-in** (admin enables, billed in their AWS) | advanced spam filtering (rspamd / 3rd-party); deep server-side search (Athena); extended retention/storage; **GuardDuty Malware Protection for S3** (attachment virus scanning) |
| **Hard AWS limits** (nobody can change) | ~40 MB message cap; SES inbound region availability; SES sandbox |

**Resolved defaults:**

- **Retention** — admin-configurable. Default: soft-delete to Trash + 30-day auto-purge.
  Options: custom window, never-purge / legal-hold, hard-delete, **per-domain override**.
  Enforced by the scheduled janitor Lambda reading the policy store. Guardrail: tightening a
  policy can trigger mass purge → require confirmation + warning; purges are irreversible.
- **Spam/virus/auth** — consume SES verdicts (no numeric score; PASS/FAIL/GRAY). Admin sets
  the action per verdict. Safe defaults: **virus → reject/quarantine (never inbox)**,
  spam → Junk, auth-fail → tag + Junk. Sender allow/block lists. Optional paid upgrade to
  heavier filtering.
- **Attachments** — stored in **S3** inside the raw `.eml` (MVP) → extract to separate objects
  later for previews/lazy-load. Hard ceiling ~40 MB (AWS). Optional admin soft-cap below that.
  Later: "send large files as S3 link." Storage ≈ $0.023/GB-mo billed to the *user's* AWS
  account (the main TCO driver); old mail can lifecycle-tier to cheaper classes.
- **Per-mailbox storage quota** — ✅ **built + live-verified (2026-06-03)**. Admin caps each mailbox
  in GB (settings table, key `quota#<address>`); the inbox shows a live "X% of Y used" bar. Chosen
  over-quota behavior = **bounce + notify the sender** (an "Undeliverable" NDR from `mailer-daemon@`)
  rather than silent drop or accept-over: the `inbound-processor` sums `sizeBytes` under the mailbox
  PK and, when a new message would exceed the cap, **does not store it** and returns the NDR (system
  senders exempt to avoid bounce loops). Default = no limit. *(Post-MVP: full DSN instead of a text
  bounce; a running usage counter instead of the O(N) per-inbound sum.)*
- **Attachment malware scanning** — SES already runs a built-in spam/virus scan and emits verdicts
  (surfaced to the user; virus → never inbox). For deeper, S3-object-level scanning, **GuardDuty
  Malware Protection for S3** is an **optional, "(recommended)"** opt-in (default on in the wizard)
  that tags each stored object `GuardDutyMalwareScanStatus`; the access-API download endpoint
  **blocks (403) any object tagged `THREATS_FOUND`** (fail-open for un-scanned/clean). Cost-bearing
  in the admin's own AWS — **$0.09/GB + $0.215/1000 objects, 1 GB + 1000 objects/mo free tier** —
  hence opt-in. ✅ **built + live-verified (2026-06-03)**.
- **Search** — default = DynamoDB metadata search (sender/subject/date/folder/flags) **+
  client-side full-text** over locally cached mail (free, offline, desktop-natural).
  Deep server-side search = **Athena over S3** (cheap, pay-per-query) as an admin opt-in.
  Avoid OpenSearch Serverless by default — its monthly floor (hundreds of $) breaks the
  near-zero idle promise; reserve for large orgs that accept the cost.

---

## 11. "Bring your own client" (Outlook / Apple Mail / etc.)

Serverless can satisfy most of this without an always-on server:

| User want | Serverless? | How |
|---|---|---|
| **Send** as their domain from any client | ✅ | SES **SMTP credentials** |
| **Forward** a specific address to an existing mailbox | ✅ | SES inbound → Lambda re-send (mind SPF/SRS) |
| **Read** the S3 inbox *inside* Outlook/Apple Mail via IMAP | ❌ | Needs an always-on IMAP server — an **optional later bolt-on** the admin opts into (and pays ~$5–15/mo for) |

Mental model: **Mailpoppy is where mail is *read*; standard clients can always *send*, and any
address can be *forwarded* out.** Native IMAP read in 3rd-party clients is the one thing that
requires leaving pure-serverless.

---

## 12. Pricing & licensing

**Model (locked): per-domain perpetual license + optional annual updates/maintenance fee
capped at ≤ $15/yr** (JetBrains/Sublime style).

- **Value metric = per domain**, with **unlimited mailboxes** under each licensed domain.
- **Perpetual:** the version bought keeps working forever — "pay once, forget us" is literally
  true. Operation is **never** gated by the license check.
- **Optional annual fee (≤ $15/yr, locked ceiling)** funds AWS-compatibility maintenance +
  support + updates. Lapse = app keeps running, just stops receiving updates. (Funds the part
  that never ends — §15 — so a continuity stream is in the customer's interest too.)
- **One-time perpetual price:** illustrative ~$29–39 per domain (still TBD — see §20).
- **The price is software only.** Storage + transport are the user's own (cheap) AWS bill —
  Mailpoppy never pays for them. This is what lets us undercut bundled providers without
  bleeding margin.

**Competitive framing vs Zoho** (~$0.90/user/mo for 5 GB = ~$11/user/yr, *per user, forever,
storage bundled*). The honest comparison isn't "$15 vs $0.90" — it's **per-domain/unlimited
vs per-user/forever**:

| Mailboxes | Zoho /yr | Mailpoppy /yr (≤$15 license + ~AWS usage) |
|---|---|---|
| 1 | ~$11 | ~$16 |
| 5 | ~$54 | ~$18 |
| 20 | ~$216 | ~$25 |
| 50 | ~$540 | ~$40 |

Zoho wins only at **exactly one mailbox** (barely). For any 2+ user team, per-domain/unlimited
crushes it, and the gap widens with headcount + storage.

- **Free single-domain tier** mops up that single-mailbox edge case (where Zoho is otherwise
  marginally cheaper) and captures the WorkMail-exodus surge; upsell to multi-domain.
- **Enforcement:** honest-friendly. License server (Stripe + Firebase) tracks per-domain
  entitlements + maintenance expiry; client validates periodically with an **offline grace
  period**; never hard-fails operation.
- Licensing lives entirely in the **admin plane** and is **invisible to end-users**.

---

## 13. Deliverability strategy (the boss fight)

This is the **highest, never-ending risk** — bigger than any AWS plumbing.

- **DNS auth:** correct SPF, DKIM (SES-managed keys), DMARC — set up automatically, then
  *verified* asynchronously (poll until SES confirms).
- **SES sandbox:** every customer account starts sandboxed (send only to verified addresses).
  **Production access is a manual AWS review, per account** — Mailpoppy can pre-fill and link
  it, but can't click it. Design the UX around a "provisioned → pending verification/approval"
  state.
- **Reputation:** a fresh domain has none. Inbox placement (Gmail/Outlook) is an ongoing
  fight; consider guidance on warm-up and sending volume.
- **Bounce/complaint handling + suppression** is mandatory once sending — neglect it and AWS
  throttles or suspends the account.
- **Validate this in Phase 0, by hand, before building anything else.**

---

## 14. The client app — feature surface

- **Core mail:** message list, conversation/threading, read/unread/star, folders/labels,
  compose with **rich-text → HTML (+ plaintext fallback)**, attachments, search, **offline
  cache** + local full-text index.
- **Safe HTML rendering** (sanitize; block remote images/tracking by default) — security item.
  ✅ **done** (`apps/desktop/src/lib/mailBody.ts`): postal-mime parse → DOMPurify sanitize
  (strip script/iframe/handlers, harden links), remote images/trackers blocked by default with a
  per-message "Load images" toggle; rendered in `InboxView`.
- **Auth:** Cognito login (email/password + MFA); fresh device = just log in.
- **Security transparency** (a top concern for admins evaluating vs. WorkMail) — ✅ **done**
  (`views/SecurityInfo.tsx`, 🔒 button in the inbox): an at-a-glance panel of the 8 S3/mailbox
  protections (SSE-S3, TLS-only bucket policy, no public access, presigned-only time-limited
  downloads, server-side tenant isolation, SES spam/virus verdicts, safe-HTML rendering, optional
  GuardDuty). Inbound virus verdict shown as a 🛡 badge; a dismissible banner explains SES's
  built-in scan. Pairs with the §14.1 resource transparency view.
- **Per-mailbox storage** — ✅ **done**: usage bar in the inbox ("X% of Y used"; amber ≥80%, red
  "Full" ≥100%) + admin set/clear quota per mailbox in the management list. Enforced server-side
  (over-quota → bounce + NDR, see §10).
- **Admin panel:** domain setup wizard (the headline feature), health/verification dashboard
  (DKIM verified? out of sandbox? records correct?), mailbox-user management, policy panels,
  licensing.
- **Mobile (later):** React Native (Expo); auth via Cognito; **new-mail push** via inbound
  Lambda → SNS → APNs/FCM. Reuses the shared `core` + `api-client` packages.

### 14.1 Resource transparency & audit ledger (REQUIRED — trust feature)

Because Mailpoppy operates **inside the admin's own AWS account**, the admin must be able to see
**exactly what Mailpoppy created, changed, or deleted** — by AWS service and by resource
name/ARN — so they stay fully in control and can independently verify everything in their own
console. This is a **non-negotiable product requirement**, not a nice-to-have: *no surprise
resources, ever.*

The app ships a dedicated **"AWS resources" view** ("What Mailpoppy did to your account") that
shows, grouped by service (Route53 / SES / S3 / Lambda / DynamoDB / Cognito / API Gateway /
SNS / EventBridge / IAM):

- **Every resource**, with its **logical name, physical name/ARN, type, region, status**, and
  **when it was created** (and, after a teardown, **when it was deleted** — or **RETAINed**, with
  the reason, e.g. "kept to protect your mail data").
- A **created vs. deleted** timeline (append-only) so the admin can audit the full history of
  Mailpoppy's actions, including upgrades (§15) and uninstall.
- A **deep link to the AWS console** for each resource (region-aware) so the admin can verify
  it first-hand and inspect/cost/delete it themselves if they ever want to.
- A **reconciliation check**: the view must be complete and reconcilable — if Mailpoppy created
  something, it appears here; if the admin sees something here, it provably came from Mailpoppy.

**How it's sourced (authoritative, not hand-maintained):**

- **CloudFormation is the source of truth for the deployed stack.** Everything in the backend is
  one CFN stack (§15), so `cloudformation:DescribeStackResources` / `ListStackResources` returns
  the authoritative, always-current inventory (logical id, physical id, type, status) with zero
  drift. The view renders that list directly — Mailpoppy cannot "hide" a stack resource.
- **A local append-only provisioning ledger** records the few **out-of-stack** mutations the
  provisioning sidecar makes directly (Route53 MX/SPF/DKIM/DMARC records, the SES domain
  identity, the `SetActiveReceiptRuleSet` activation): `{action: created|deleted, service,
  resourceType, name/ARN, region, timestamp, actor}`. Shown alongside the CFN inventory so the
  *complete* footprint is one screen.
- On **uninstall/teardown** the same view reports what was deleted and what was deliberately
  **retained** (S3 mail bucket, DynamoDB tables, Cognito pool carry `RemovalPolicy.RETAIN` to
  protect data), with the exact names so the admin can finish cleanup by hand if they choose.

This view backstops the §6 trust story (it's *their* cloud) and the §13 deliverability/DNS work
(they can see precisely which DNS records were written).

---

## 15. Deployed-backend upgrade strategy

Because the backend lives in *customers'* accounts, you must be able to **ship updates to
already-deployed stacks** over time (AWS APIs drift, features evolve, deliverability practices
change).

- Define the whole backend as **Infrastructure-as-Code** — **AWS CDK (TypeScript)** synthesized
  to a CloudFormation template, deployed by the provisioning wizard via the CloudFormation API
  (customers never need CDK installed).
- Version the stack; the admin app detects "update available," and applies the CDK/CFN change
  set to the customer's deployment (using Plane-1 admin creds), with migrations for DynamoDB
  schema changes.
- This ongoing capability is exactly what the **maintenance fee** funds.

---

## 16. Complexity assessment

The product is really **three fused products**; the original "auto-setup tool" is the *easiest*
third.

1. **Provisioning/admin engine** — SDK/IaC orchestration of Route53/SES/S3/Lambda/DynamoDB/
   Cognito/IAM + verification & sandbox UX. **Moderate.** Well-trodden; async verification is
   fiddly, not hard.
2. **Serverless mail backend** (deployed into customer accounts) — inbound MIME-parse Lambda,
   Cognito-authorized access API, send/threading/sent-copy, bounce/complaint + spam-verdict
   handling, janitor. **Moderate-high**, and must be *reliable* (it's email). Hidden cost:
   the deployed-stack upgrade path (§15).
3. **From-scratch cross-platform mail client** — full mail UX + safe HTML + threading + search
   + offline; later mobile + push. **High** — the biggest UX surface.

**Cross-cutting hard parts:** deliverability + per-account SES sandbox (unbounded, highest
risk, not fully automatable); airtight multi-user isolation in one account (security-critical);
the deployed-backend upgrade path; AWS API drift.

**Bottom line:** no part is research-grade or infeasible — all known AWS patterns — but the
total surface is **substantial and larger/riskier than ScrutiBank**, mainly because email
deliverability never "finishes," you maintain backends inside other people's accounts, and a
hand-built mail client is a lot of UX. Rough shape: a credible **MVP** (single admin, single
domain, desktop, read + send) is a few months of focused work; the **full** product
(multi-domain, multi-user, mobile, deliverability-hardened) is a multi-quarter effort.

---

## 17. Risk register

| Risk | Severity | Mitigation |
|---|---|---|
| Email deliverability / inbox placement | **High, ongoing** | Auto SPF/DKIM/DMARC; warm-up guidance; validate in Phase 0 |
| SES sandbox per-account (manual approval) | High (UX friction) | Pre-fill + link the request; clear "pending" UX; document |
| Multi-user isolation in one AWS account | High (security) | Enforce in access-API Lambda from verified Cognito claims; tests |
| Upgrading backends in customer accounts | Medium-high | CDK/CFN change sets + schema migrations; funded by maintenance fee |
| Mail-client UX surface (esp. mobile + push) | Medium-high | Desktop-first; reuse ScrutiBank stack; defer mobile |
| AWS API / pricing drift | Medium, ongoing | Maintenance subscription; IaC; thin abstraction over SDK |
| SES inbound region limits | Medium | Detect/guide supported regions at setup |
| ~40 MB attachment ceiling | Low-medium | Set expectations; "large files as link" later |
| Trademark/name cluster (MailPop/Poppy) | Medium | USPTO TSDR + EUIPO clearance before brand investment |

---

## 18. Phased build plan

**Phase 0 — De-risk by hand (½–1 day; before any app code).** Manually wire one real domain:
Route53 records, SES domain + DKIM verify, inbound rule → S3, send + receive a test, and
confirm a message lands in a **Gmail inbox, not spam**. Forces the SES-sandbox + deliverability
realities up front.

**Phase 1 — Setup/migration wizard (the wedge; shippable alone).** Tauri desktop app takes the
admin's AWS profile and one-click provisions the full stack (Route53/SES/S3/Lambda/DynamoDB/
Cognito/IAM). Health/verification dashboard + sandbox-exit guidance + the **resource
inventory view (§14.1)** so the admin sees exactly what was created in their account. *"Escape
WorkMail — move to your own AWS in minutes."*

✅ **One-click in-app deploy built (2026-06-03) — no terminal, no `cdk`, no `cdk bootstrap`.** The
backend stack was made **asset-free** (Lambda code from S3 via CFN params; SES rule-set activation
moved out of the stack into the sidecar) so the desktop app deploys it with raw
`cloudformation:CreateStack`. The synthesized template + a prebuilt Lambda zip are embedded in the
sidecar binary; at deploy time the sidecar uploads them to a `mailpoppy-deploy-*` bucket and
Create/UpdateStacks, polls to completion, then activates the receipt rule set. Wizard flow: domain
→ **Deploy backend** → **Set up domain mail (SES + DNS)** → **test**, then create a mailbox — all
in-app. `/provision` was reduced to SES identity + DKIM/MX/DMARC only (the stack owns the S3 bucket
+ receipt rule). ✅ **Live-verified 2026-06-03** on ollydigital.com via the sidecar `CreateStack`
path (not `cdk deploy`): stack reached `CREATE_COMPLETE` with Lambdas running from the uploaded zip,
rule set auto-activated, mailbox created, and a loopback email arrived in the inbox (deployed
inbound-processor ran) — then full teardown + clean sweep.

**Phase 2 — Read mail.** Inbound Lambda (MIME → DynamoDB index). Client: inbox list, read,
render (safe HTML), attachments, read/unread, folders, basic search.
🚧 *Backend built & synth-validated (2026-06-02):* the deployable CDK stack (`infra/lib/mail-stack.ts`)
now wires SES receipt rule → S3 + `inbound-processor` Lambda → DynamoDB, plus the Cognito-JWT
HTTP API → `access-api` Lambda (list/raw/flags/move/send), a daily `janitor`, and
bounce/complaint `suppression`. Shared mailbox logic + verdict/spam-policy routing live in
`@mailpoppy/core` (unit-tested). `cdk synth` produces a valid template.
*Desktop inbox UI added same day:* `apps/desktop/src/views/InboxView.tsx` (folder nav, read
pane, read/unread/star, trash/restore, compose→send) runs against a `MailClient` interface —
the shared `api-client` when a backend is deployed, or an in-memory demo client offline — so the
same view will serve desktop and React Native.
✅ **Proven live end-to-end (2026-06-02)** on `ollydigital.com`/`eu-west-1`: `cdk deploy` (47
resources) → test email → SES→S3→`inbound-processor`→a correct DynamoDB inbox row
(`folder=inbox`, `spam=PASS dkim=PASS`, parsed headers, `unread`). The live run caught a real
DynamoDB-marshalling bug (fixed: `removeUndefinedValues`). Test stack fully torn down afterward;
account verified clean. The desktop inbox still defaults to demo data (no persistent deployment).

**Phase 3 — Send mail.** Compose UI → SES with threading headers + attachments; Sent copy;
bounce/complaint → suppression. *(Send path + Sent-copy + suppression Lambda implemented in the
Phase 2 backend.)* 🚧 **In progress:** compose dialog + **Reply / Reply-all / Forward** with
`In-Reply-To`/`References` threading (`apps/desktop/src/lib/reply.ts`, unit-tested; wired into
`InboxView`). **Receive attachments**: the inbound-processor extracts each MIME attachment to S3
(`attachments/<id>/<i>-<name>`), `GET /messages/{id}/attachments/{index}` returns a short-lived
presigned URL (owned-mailbox-scoped), and `InboxView` shows download chips
(✅ **verified live end-to-end 2026-06-02**, then torn down). **Rich-text compose**: the compose
body is Markdown → sanitized HTML (+ plaintext fallback) with a live Preview (`lib/compose.ts`,
reuses the read-pane sanitizer) — fulfils the original "write well-formatted / HTML emails" goal.
**Send attachments**: the compose dialog reads files to base64 (`lib/attachments.ts`) → access-API
`/send` passes them to SESv2 (`Message.Attachments`) and stores each to S3 so the Sent copy's
attachments are downloadable via the same endpoint. **Phase 3 is now feature-complete.**

**Desktop shell packaged (✅ 2026-06-02).** The React frontend + Node provisioning sidecar are now
wrapped in a real **Tauri v2** shell (`apps/desktop/src-tauri/`). The Rust core stays thin: on
launch it spawns the sidecar (shipped as a Tauri `externalBin`) and kills it on exit
(`src/lib.rs`). The sidecar is compiled into a **single self-contained executable** so end users
need no Node install — esbuild bundles it, then Node 22 SEA injects the bundle into the runtime
(macOS: thin the universal Node to the target arch with `lipo`, then ad-hoc `codesign`); see
`node-sidecar/scripts/build-sidecar.mjs`. `npm run tauri:build` produces `Mailpoppy.app` +
`Mailpoppy_<ver>_aarch64.dmg`. **Verified end-to-end**: launching the bundled `.app` spawns the
embedded sidecar, which answers `/health` on `127.0.0.1:8787`; quitting the app tears the sidecar
down with no orphan. (Windows/Linux triples + signing/notarization are Phase 5.)

**Phase 4 — Migrate existing WorkMail data (deadline-driven).** 🚧 **Built (2026-06-02):** WorkMail
(and any IMAP server) → the desktop sidecar connects with the user's IMAP credentials (which never
leave the machine), fetches each message, and writes it straight into the deployed backend's S3
(raw `.eml` at `inbound/<id>` + extracted attachments) and DynamoDB index — producing rows
**identical** to what the inbound Lambda creates, so imported mail renders in the normal inbox with
no special-casing. Idempotent (row id = `mig-<sha256(raw)>` → re-runs never duplicate); folders
mapped via IMAP special-use + name heuristics (lossless: unknown folders preserved as sanitized
custom folders, `#` stripped so sort keys stay safe); `\Seen/\Flagged/\Answered` → flags;
`\Deleted` skipped. Pieces: pure mapping in `@mailpoppy/core` (`migration.ts`, unit-tested);
`node-sidecar/src/migration.ts` (imapflow + mailparser; resolves bucket/table from CFN stack
outputs; records a migration entry in the transparency ledger); sidecar `POST /migrate/imap/test`
(verify creds + preview folders/counts) + `POST /migrate/imap/run` (import or dry-run);
`apps/desktop/src/views/MigrationView.tsx` ("Bring your old mail across" — connect → preview
folders → import selected → per-folder summary). The provisioning IAM policy gained scoped
`s3:PutObject` + `dynamodb:PutItem` on the stack's bucket/table (re-validated, no findings).
✅ **Live-verified end-to-end (2026-06-02)**: a local GreenMail IMAP server (INBOX ×2 incl. an
attachment + a "Sent Items" message) → `POST /migrate/imap/run` (resolved bucket/table from CFN
outputs, imapflow fetched + wrote to a real deployed stack) → read back via the access API with a
real Cognito JWT: inbox=2, sent=1 ("Sent Items" correctly mapped to **sent**, `\Seen`→read), the
attachment downloaded **byte-identical**, raw `.eml` retrievable. **The live run caught a real
idempotency bug**: the sort key embeds the date, and the fallback was `new Date()`, so re-running
duplicated rows for messages lacking a `Date:` header. Fixed to fall back to the stable IMAP
`INTERNALDATE`; a 2nd run then left inbox/sent unchanged (idempotent). Stack + retained
resources fully torn down; account verified clean. (No SES/DNS is created for migration.)

**Phase 5 — Deliverability & hardening.** DMARC report ingestion; reputation monitoring; act on
spam/virus verdicts; aliases/catch-all; allow/block lists; policy panels; the full
created/deleted **resource audit ledger (§14.1)** with console deep-links and teardown
reconciliation; multi-domain.
🚧 **Several hardening items landed early (2026-06-03, from real-mail admin testing), all
live-verified on ollydigital.com:**
- **In-app teardown / uninstall** ("Remove everything" in the AWS-resources view) — deactivate
  rule set → DeleteStack → delete RETAINed orphans (bucket/tables/Cognito) → deploy bucket → SES
  identity → DNS records; the user-facing form of §14.1 teardown reconciliation.
- **Attachment malware scanning** via optional GuardDuty Malware Protection for S3 + a download
  gate that 403s `THREATS_FOUND` objects (see §10). ✅ verified: tag→403, retag→200.
- **Per-mailbox storage quota** with bounce-the-sender enforcement + in-app usage visibility (§10).
  ✅ verified: over-quota mail bounced (NDR to sender), not stored, usage unchanged.
- **Email-security transparency panel** (§14) so an admin can see the S3/mailbox protections at a
  glance — directly addresses the "is this as safe as WorkMail?" evaluation question.
- *(Also fixed in this pass: attachment send/receive — raw-MIME `Content.Raw` send so Gmail can
  open them, + `tauri-plugin-opener` and a fallback link so received attachments download. The
  "still failing" symptom was a **stale prebuilt sidecar binary** masking re-deploys — always
  rebuild the binary after Lambda/template changes.)*

**Phase 6 — Mobile.** Flutter/React Native client; Cognito auth; SNS → APNs/FCM push.

---

## 19. Tech stack (decided)

**All-TypeScript** to maximize reuse across the React desktop and React Native mobile clients.

- **Monorepo** (npm workspaces; Turborepo optional later): shared TS packages — `core`
  (types/models/validation/MIME + mailbox logic), `api-client` (Cognito-JWT calls to API
  Gateway, shared desktop+mobile), optional `ui` — consumed by both apps.
- **Desktop client:** Tauri v2 + React 18 + TypeScript + Tailwind. Rust stays **only** as
  Tauri's thin shell.
- **Desktop provisioning engine:** **Node/TS sidecar** using AWS SDK for JS v3 (the credential-
  provider chain supports profiles + SSO, matching the credentials decision). **Desktop-admin-
  only — mobile never runs it.**
- **Mobile client (later):** **React Native (Expo)** — mailbox plane only, via the shared
  `api-client`.
- **Backend Lambdas:** **TypeScript** (inbound processor, access API, janitor, suppression) —
  share `core` types with the clients.
- **IaC:** AWS **CDK (TypeScript)**. At build time `cdk synth` → a CloudFormation template the
  app ships and deploys into the customer account via `cloudformation:CreateStack/UpdateStack`,
  so customers never need CDK installed (runtime deploy is just an API call).
- **Identity:** Amazon Cognito (User Pool + Identity Pool).
- **License server:** reuse Stripe + Firebase + the existing website.

**Admin split (maximizes reuse):** *stack provisioning* needs raw AWS creds → desktop sidecar
only; *ongoing admin* (create mailbox users, set policy) routes through the Cognito-authorized
API, so it's cross-platform TS (an admin can manage users from mobile too).

> Why not Python (the ScrutiBank pattern)? ScrutiBank used Python for PDF/OCR/forensics where
> its libraries dominate. Mailpoppy has no such workload — its backend is AWS-SDK orchestration
> + MIME parsing, which TS does fine — so going all-TS unifies the codebase and shares the
> client layer across desktop + React Native. (See the sidecar-pain notes in ScrutiBank memory.)

---

## 20. Open questions / still to decide

- Single combined app (role-aware) vs. separate admin + mail-client apps. *(Leaning: single,
  role-aware.)*
- IAM least-privilege policy: ✅ **done** in `infra/policies/`. Two validated policies (both
  pass `accessanalyzer validate-policy` with no findings): the narrow **provisioning** policy
  (direct-API Route53/SES/S3, S3 scoped to `mailpoppy-*`, + read-only CloudFormation for the
  §14.1 inventory view) and the broader **deploy-time** policy for the `cloudformation:CreateStack`
  path (CFN/IAM/Lambda/DynamoDB/Cognito/API GW/SNS/EventBridge/SES/S3/Logs, scoped to
  `MailpoppyMailStack-*`/`mailpoppy*`), shipped with a CloudFormation **service role** so the
  admin's own identity stays at `cloudformation:* + iam:PassRole`.
- DynamoDB key schema details + which GSIs (depends on search/threading needs).
- Calendar/contacts (CalDAV/CardDAV) — WorkMail had them; out of MVP scope, revisit for parity.
- Whether to support a hosted-web client later (would change the BYO-AWS trust model — a web
  backend would have to hold credentials).
- Final **one-time** per-domain price (annual updates ceiling locked at ≤ $15/yr) + free-tier
  feature gating.
- Trademark clearance outcome for "Mailpoppy."
