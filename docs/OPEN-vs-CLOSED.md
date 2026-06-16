# MailPoppy — What to open vs. keep closed

*Strategy note — created 2026-06-14; updated 2026-06-14 for the self-served legal track.
**Not legal advice**, but written to be usable without a lawyer (see "Legal posture" at the
end). A lawyer's review is worth getting later if/when affordable.*

This is a strategy note. Keep it **private** — do not place it in any repo that may
become public.

---

## Guiding principle

**Open what touches the user's AWS and their mail** — that's what earns trust and makes
the privacy/credential claims verifiable. **Keep closed what makes it a business** —
distribution, brand, and paid modules. Use a **source-available** license (not permissive
open source): the code is readable and auditable, but reselling or building a competing
product is forbidden.

The reason to open is **trust + marketing + auditability**, *not* free labour. Treat any
outside contributions as a bonus, never a dependency.

---

## The cut line, by path

| Path (repo) | Open? | Why | Suggested license |
|---|---|---|---|
| `lambdas/` *(monorepo)* | **Open** | Runs **inside the user's AWS** and handles their mail — core of the "we never read your mail" claim. | Source-available (FSL) |
| `infra/` + **`infra/policies/`** *(monorepo)* | **Open** | Shows *exactly* what's created in their account, plus the **least-privilege IAM policy** — answers "how much access does it want?" | Source-available (FSL) |
| `packages/core`, `packages/api-client` *(monorepo)* | **Open** | Shared logic; needed to make the rest auditable/buildable. | Source-available (FSL) |
| `apps/desktop/node-sidecar/` *(monorepo)* | **Open** | The **engine that reads your AWS keys and deploys** (`awsProfile.ts`, `provisioning.ts`). The part that answers *"could it copy my credentials?"* — the whole reason for going open. | Source-available (FSL) |
| `mailpoppy-web` (webmail) | **Open** | Touches your mail in the browser; config holds only public client IDs, no secrets. *(Marketing site lives here too — fine to be public.)* | Source-available (FSL) |
| `mailpoppy-mobile` | **Open** | Touches your mail on device. | Source-available (FSL) |
| `apps/desktop/src` + `src-tauri` (Tauri/React UI shell) | **Closed** (revised — see *Monetisation*) | The product UX **and the only place a usage limit can hold.** Limits in open code are removable, so the app stays closed. | Proprietary |
| Build/release pipeline, **code-signing certs**, notarization | **Closed** | Secrets + the thing that makes a download *trusted*. A clone can't sign/notarize as you. | Proprietary / private |
| Brand: name, logo, domain | **Closed + trademarked** | The literal block on "reproduce under a different name" — they'd have to drop your name and reputation. | Trademark |
| Future **Pro/Business modules** + license/update server | **Closed** | Your paid surface (team admin, audit export, multi-domain at scale, SSO). | Proprietary |

---

## The one real lift: a small repo restructure

A GitHub repo is public or private *as a whole*, so you can't open half the monorepo. To
execute this you'd split it:

- **`mailpoppy` → make source-available**, but **move the closed bits out first**:
  - build/signing pipeline and any Pro modules → a separate **private** repo.
  - if you keep the desktop **UI shell** closed (Option B), move `apps/desktop/src` +
    `src-tauri` to the private repo too; the public repo keeps the **sidecar engine** + runtime.
- `mailpoppy-web` and `mailpoppy-mobile` are already separate — just relicense and flip to
  public when ready.

---

## Two options for the desktop UI shell (pick one)

- **Option A — open the whole desktop app (recommended for a trust-first product).**
  Everything is auditable → strongest trust story ("read every line"). You still monetise
  via **paid signed builds + the FSL license (no competing use) + trademark + Pro modules**.
  Simplest: no splitting of `apps/desktop`. A competitor gets readable code but no brand, no
  signed/notarised distribution, no updates, no right to compete.

- **Option B — keep the UI shell closed, open only the sidecar engine.**
  Maximum control over the product's "look," but: requires the repo split above, and a
  hardcore skeptic can't audit the *whole* app from source (they can still inspect its live
  network traffic). The credential claim is still covered, because the **sidecar** — the only
  part that touches keys — is open.

**Revised lean: the hybrid (Option B).** Option A looked best for *pure* trust — but a **paid
tier with limits is incompatible with an open client** (see **Monetisation & enforcement**
below). So open the **runtime + sidecar engine** for trust, and keep the **desktop UI shell +
Pro modules closed** for the business. The credential-sensitive part (the sidecar) stays open —
which is what matters most for the trust claim — while the thin UI shell's behaviour is still
observable via network inspection even when closed.

---

## Monetisation & enforcement

**The rule: never put a usage meter or paid gate in open code.** MailPoppy runs entirely on the
user's machine, against their own AWS — there is no MailPoppy server in the path to check a
licence against. Any limit in code they can read and recompile (e.g. "1 free domain") is deleted
and rebuilt away in seconds. This is true of *every* open-source, bring-your-own-cloud product;
open source removes even the reverse-engineering step. It is not a MailPoppy flaw.

> **Consequence:** "1 free domain, pay for more" and "open-source the app" are **incompatible**
> *if the meter lives in open code.* You get one or the other. The hybrid resolves it:

- **Open (source-available):** runtime (`lambdas`, `infra`, `packages`) + the **sidecar engine**
  → trust / auditability.
- **Closed (proprietary):** the **desktop UI shell** + **Pro modules** + signed distribution
  → the product, and the only place a limit can hold. Any free-tier check lives here, in the
  closed app (enforceable to the same degree as any paid desktop software).

### Chosen enforcement: a MailPoppy account + subscription

The gate is **not** a usage meter and **not** the AWS account ID. Instead:

- The admin **signs up for a MailPoppy account** and subscribes — billing on the **website**, via
  Stripe.
- The **closed admin app requires login** and checks *"does this account have an active
  subscription?"* against a MailPoppy entitlement API before it will deploy or manage anything.
- Harden it: make the **deploy action itself require a fresh signed entitlement token** from the
  server, so patching the UI's check isn't enough.

This is per **customer/account, not per-seat** — end-users log into their own mailboxes and never
touch MailPoppy billing, so the "no per-seat fees" promise holds. Standard SaaS-desktop pattern;
reuse what `mailpoppy-web` can provide (Firebase Auth + Stripe).

**Three identities — don't conflate them:** (1) the end-user's **mailbox login** (Cognito *in the
user's own AWS*); (2) the admin's **AWS credentials** (to deploy); (3) **NEW — the MailPoppy
account + subscription** (vendor-side auth + billing you operate; does not exist yet).

**Optional metering:** you don't need the AWS account ID to bill. But `sts:GetCallerIdentity`
returns it for free (no special permission) — useful *only* if a plan **caps how many AWS
accounts/deployments one subscription covers** (metering, not identity).

**Privacy — the two planes (must disclose):**
- *Mail plane* — your email and AWS keys **never** reach MailPoppy. Unchanged; still the core pitch.
- *Account/billing plane* — MailPoppy now holds an **account (email) + payment via Stripe** and runs
  a **licence-activation check** (account + entitlement only, never mail/creds). This is new personal
  data MailPoppy holds → **the privacy policy needs a section for it.**

### App-store payments — keeping Apple's cut out of it

Apple's 15–30% only applies to digital purchases made **inside an iOS app**. Keep it out:

1. **Sell the subscription on the website** (Stripe), to the admin/org — never inside the iOS app.
2. **The iOS app sells/unlocks nothing** — it's a free mail client end-users log into.
3. **Ship the desktop admin app by direct download** (notarised), **not via the Mac App Store** —
   then Apple's payment rules don't apply to it at all.

Then there is no in-app purchase → no Apple commission. This is the standard B2B pattern
(guideline 3.1.3(b) multiplatform / 3.1.3(d) enterprise). **Anti-steering caveat:** outside the US
and EU, keep the iOS app silent about where to pay (a plain login screen); the US (2025 injunction)
and EU (DMA) now allow linking out. Confirm against current guidelines at launch.

### Can someone download from GitHub and fully use the paid app for free?

- **The paid app and Pro capabilities — no.** They're closed; there is nothing public to patch.
- **The basic engine — a technical user could.** They could drive the open sidecar / CDK directly
  to deploy for themselves. **That's fine by design:** those people are self-hosters who would
  never have paid, and they get no app, no Pro features, no support, and no signed builds. Your
  buyers (non-technical) want exactly those things — that's what they pay for.

### Gate on capabilities, not a counter

"Pay for a 2nd domain" is weak even in closed code — a second domain is just "run the deploy
again," with nothing distinct to withhold. **Drop the "1 free domain" cap** and sell real,
separable capabilities and services instead. Starter split:

| Free | Pro / Business (paid, closed) |
|---|---|
| The closed app's free tier: deploy to your AWS, your domain(s), unlimited mailboxes | Team / multi-admin management |
| Webmail + iOS/Android apps | Audit-log export & retention reporting |
| Spam + malware protection, retention, IMAP import, one-click teardown | Admin SSO (IAM Identity Center / SAML) |
| Community support | Branded / white-label webmail |
| *(Engine is open — technical users can self-serve the basics)* | Priority support + SLA; signed, auto-updating builds |

**Licence as backstop, not enforcement.** The FSL can state that commercial use beyond the free
capabilities requires a paid licence — making unlicensed use a *violation* (recourse that matters
to businesses). It is **not** technical enforcement; don't rely on it to stop individuals.

---

## Licenses in plain terms

- **Source-available parts → FSL** (Functional Source License): "use it for anything *except*
  competing with us," and it **auto-converts to Apache-2.0 after 2 years.** Reads as fair and
  confident; trivial to apply (one `LICENSE` file per repo). *(BSL 1.1 is the heavier
  alternative if a lawyer prefers it.)*
- **Closed parts → a normal proprietary EULA** for the binary + Pro. *(Written:
  `drafts/EULA.md` — fill your legal name + governing-law jurisdiction.)*
- **Add two small files** to each public repo: a `TRADEMARK.md` (you may use the code, not the
  name/logo) and — if you accept outside contributions — a **CLA** so you keep the right to
  relicense later (see Contributions below). *(Both written: `drafts/TRADEMARK.md`,
  `drafts/CLA.md`.)*

---

## Contributions & community

**Can people contribute?** Yes — anyone can open issues and pull requests against a public
repo, even under a source-available license. But set expectations honestly:

- **Most projects get very few external code contributions.** Contribution is the exception,
  not the rule. Open for *trust + marketing*; count any code help as a bonus.
- **Source-available slightly shrinks the pool** — some developers only contribute to
  OSI-approved licenses. The FSL's automatic conversion to Apache-2.0 after 2 years softens
  this, and is worth stating plainly.

**Why people *do* contribute (in rough order of likelihood):**

1. **Scratch their own itch** — they use MailPoppy, hit a bug or want a feature, and fix it
   for themselves. By far the #1 driver, and your audience (self-hosters, founders, devs) are
   exactly these people.
2. **They need it to work in their setup** — an AWS-region quirk, an IMAP-import edge case for
   a specific provider, a locale/translation, an accessibility fix.
3. **Reputation / portfolio** — contributing to a real, used product looks good.
4. **Learning** — a real-world Tauri / CDK / SES codebase to learn on.
5. **Mission alignment** — privacy-minded developers wanting a privacy-first tool to succeed.
6. **Client work** — consultants/agencies who deploy MailPoppy for clients upstream their fixes.

**What kills contribution motivation (and how to handle it):**

- *"Why work for free on something a company sells?"* — the central tension of
  source-available. Mitigate with transparency about the model, the FSL→open timeline,
  visible credit for contributors, and a clear scope of what you'll accept.
- Friction or silence — missing `CONTRIBUTING.md`, slow/no review.
- Feeling their work just becomes someone's profit with no acknowledgement.

**Contributions you actually want (high value, low risk):** bug reports, **security
disclosures**, AWS/region/edge-case fixes, IMAP-import compatibility, docs, translations,
accessibility.
**Contributions you should NOT expect or depend on:** large features, and anything in the
closed **Pro** modules (keep those closed regardless).

**Set-up to welcome contribution without depending on it:**

- `CONTRIBUTING.md` (scope + how to build/test), `CODE_OF_CONDUCT.md`, issue/PR templates,
  `good first issue` labels.
- **A CLA** (Contributor License Agreement) so contributors grant you the rights to use and
  relicense their work — important because you're commercial and may dual-license / relicense.
  *(A lighter DCO is possible but grants you fewer rights; a CLA is the safer choice for a
  commercial source-available product.)*
- **`SECURITY.md`** with a responsible-disclosure process. For a trust product this is the
  most valuable "contribution" of all — independent security review reinforces the whole
  pitch. Researchers are motivated by credit (and bounties, if you offer them).

**Bottom line:** opening the code mainly buys you *credibility*; the occasional bug fix or
translation is gravy. Architect for trust first, contribution second.

---

## Roadmap: premium clients (CRM)

The "clients are the product" model means new paid clients can be added on top of the open engine
over time **without re-architecting**. Strongest near-term bet: a **MailPoppy CRM**.

- **Why it fits:** the buyer who wants *unlimited addresses* is usually doing relationship-heavy
  business (sales/outreach, per-client or per-project addresses). They want to manage conversations,
  not just hold mailboxes.
- **Unfair advantage:** the email *is* the CRM substrate (already captured/threaded/indexed in the
  user's AWS — no inbox-sync), the relationships **stay in the user's own AWS** ("your CRM, in your
  own AWS"), and **no per-seat tax**.
- **Tiering fit:** a closed premium client → justifies a higher plan ("Business / CRM") far better
  than a domain counter. CRM data also deploys into the user's AWS.
- **Cautions:** (1) sequence as **v2** — ship core email + billing + open-source first; a cheap early
  taste is a "contacts + full conversation history per person" view. (2) **Deliverability /
  compliance landmine** — keep it *relationship management*, not a cold-email cannon (CAN-SPAM /
  GDPR / SES reputation + abuse risk). Lean on the *email-native + in-your-AWS + no per-seat* wedge;
  don't try to out-feature HubSpot.

---

## Suggested sequence (low-risk)

1. **Publish the name + logo** and use them as the brand — this establishes the
   **common-law (unregistered) trademark** you defend with `TRADEMARK.md` (no registration
   needed now; independent of any code decision).
2. Open the **runtime** (`lambdas` + `infra` + `packages`) under FSL — lowest-risk,
   highest-trust, no UI involved.
3. Open the **sidecar engine** next — the part that kills the credential fear.
4. Keep the **desktop UI shell + Pro modules closed** (hybrid decision); replace the "1 free
   domain" cap with the free-vs-Pro capability split above. Open `mailpoppy-web` /
   `mailpoppy-mobile` whenever.
5. Add the **"Open & auditable"** point to the website (links to the public repos) +
   `SECURITY.md`.

> You can always open *more* later. You generally **cannot re-close** an OSI release — but
> FSL/BSL let you change terms *going forward*, which is part of why they fit here.

---

## Execution plan (how to proceed)

Owner tags: **[you]** founder decision/action · **[build]** code work (Claude can do).
No lawyer in the loop for now (self-served — see "Legal posture" below). Order matters;
**publishing is the only irreversible step.**

**Phase 0 — Gating decisions (do first)**
- [you] **FSL chosen** (over BSL) — the `drafts/LICENSE` is the canonical FSL text; just fill
  your legal name. Revisit with a lawyer only if a dispute or investor ever requires it.
- [you] **Trademark = common-law, no registration now** — publish the name + logo and use them
  as the brand; defend with `drafts/TRADEMARK.md`. Register later if/when affordable.
- [you] Confirm the **repo boundaries** (the cut-line table above).

**Phase 1 — Safe prep (reversible; nothing public yet → Claude can do all of this now)**
- [build] **Secret-scrub audit** of every repo to be opened — *including git history* (a public repo
  exposes **all past commits**, not just current files). Hunt for AWS keys, account IDs, `.env`,
  Stripe/Firebase secrets, the `[mailpoppy]` profile creds, customer data. **This gates everything.**
- [build] ✅ **Repo split — DONE (staged locally 2026-06-14, see `repo-split.md`).** Two fresh
  local repos: `mailpoppy-engine` (public-bound: `packages` + `lambdas` + `infra` + `node-sidecar`,
  squashed history, fully verified green) and `mailpoppy-app` (private: the Tauri/React UI,
  consuming the engine via a git submodule). Monorepo untouched as the archive. Remaining =
  create remotes + push (outward-facing, your go-ahead) then the Phase-2 flip.
- [build] **Governance + licence files** in each to-be-public repo: `LICENSE` (FSL), `README`
  (explains the model + the "auditable" pitch), `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`,
  `SECURITY.md`, `TRADEMARK.md`, and a CLA.
- [build] **Extract the least-privilege IAM policy** from `infra/policies/` into a copy-paste block
  (for the website *and* the open-source "least access" story).

**Phase 2 — Publish (IRREVERSIBLE — needs your explicit go-ahead)**
- [you] Flip the chosen repos to **public** (or push freshly history-scrubbed repos). *Changing a
  repo's visibility is an access-control change — Claude will not do this unilaterally.* Once public,
  history cannot be un-published. Make sure every placeholder (your legal name; governing-law
  jurisdiction in the EULA) is filled and the `security@`/`support@` aliases exist first.
- [build] Add the **"Open & auditable"** trust point to the website (links to the public repos), and
  update the **privacy policy** for the MailPoppy account + licence activation (the two planes).

**Phase 3 — Monetisation infra (separate track; real build, not part of open-sourcing)**
- [build] MailPoppy account + subscription: Firebase Auth + **Stripe**, an entitlement API,
  admin-app login + entitlement check, and a signed entitlement token required at deploy.
- **Designed: see `mailpoppy-hub-design.md`** — the "MailPoppy Hub" realises this AND solves
  multi-tenant client login (email-domain → backend directory, gated by subscription). Pulled
  forward because the mobile clients can't ship to stores or be paywalled without it.

> **What Claude can start right now, safely:** all of Phase 1 — the secret-scrub audit, the
> governance/licence drafts, the repo-split mechanics, and the IAM-policy extraction. None of it
> publishes anything; the irreversible flip in Phase 2 stays with you.

---

## Legal posture (self-served for now)

No lawyer is in the loop yet (cost). The docs below are written to be usable as-is; each
carries a short "not legal advice" note. Decisions taken:

- **Licence: FSL-1.1-Apache-2.0** (not BSL). Canonical text in `drafts/LICENSE`.
- **CLA: written** (`drafts/CLA.md`) — individual, inbound=outbound + relicensing.
- **EULA: written** (`drafts/EULA.md`) — proprietary desktop app + Pro; covers subscription,
  your-AWS responsibility, no-warranty, liability cap, governing law.
- **Trademark: common-law (unregistered)** — `drafts/TRADEMARK.md`; defend via public use of
  name + logo. No registration now.

**Fill-ins:** legal name (Marco Tomasello) and governing law (the Netherlands) are now set in
LICENSE, CLA, EULA, TRADEMARK. **Remaining before publishing:** create the
`security@mailpoppy.com` alias (referenced in `SECURITY.md`).

**Worth a lawyer's eyes later, if/when affordable** (none blocks launch): FSL enforceability
in your jurisdiction, EULA liability/consumer-law specifics, and a trademark registration if
the brand becomes worth defending more strongly.
