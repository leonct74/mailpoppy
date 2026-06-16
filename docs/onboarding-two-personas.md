# MailPoppy — Two-persona onboarding (Express vs. Advanced)

*Design note — created 2026-06-14. **Not yet built** (the desktop admin's AWS onboarding
was just reworked toward the Advanced shape; see §7). Keep **private** — discusses the
closed admin app's credential handling and security posture.*

This note records a product direction agreed in discussion: the AWS-connection onboarding
should offer **two user-chosen workflows** — a guided **Express** path for non-technical
users and a transparent **Advanced** path for technical / security-conscious users. It exists
because of the mission, and it depends on the trust posture in [[OPEN-vs-CLOSED]] and the
**build-provenance / `/verify` roadmap** (recommended in the trust discussion; not yet written
up — `drafts/SECURITY.md` today is only a vuln-reporting policy).

---

## 1. Mission (and the website line)

**MailPoppy democratises personal email** — professional email on your own domain, in minutes,
whether or not you're technical. This is the through-line that ties the two existing pillars
together: *open-source / verifiable* **and** *no-tech-needed*. It should be stated plainly on
the website (a follow-up copy task in `mailpoppy-web`), e.g.:

> *"MailPoppy democratises personal email — professional email on your own domain, in minutes,
> whether or not you're technical."*

The two-persona onboarding is the product expression of that sentence.

---

## 2. The two users

| | **Non-technical** | **Technical / security-conscious** |
|---|---|---|
| Wants | To feel safe and be looked after; speed | To verify; full control |
| Can audit? | No | Yes |
| Will use | Whatever the app recommends | The CLI / their own tooling |
| Risk if we get it wrong | **High** — can't detect a problem | Low — will catch issues |

---

## 3. Principle: same safety floor; differ on explanation, not security

> **The axis between the two paths is how much is *explained and controlled*, NOT how *safe*
> the path is.** Both paths sit on the same security floor.

The temptation is to frame Express as "skip the security warnings." That is backwards: the
non-technical user is precisely the one who **can't audit anything** and is most exposed if
something is wrong. Handing the most vulnerable user the least-safe flow contradicts the
mission. So:

- **Both paths enforce least-privilege** (a scoped IAM user, never account root). Express
  *automates* it with friendly wording; Advanced *exposes* it for inspection.
- **Both paths keep the credential boundary** the architecture already has. Express defaults
  to the simplest safe option; Advanced offers the CLI credential-chain (MailPoppy never sees
  the secret).
- Express defers the *rationale* behind quiet "Is this safe?" disclosures; it does not remove
  the protection.

Marketing upside: *"Simple enough for anyone, transparent enough for an engineer."*

---

## 4. The two paths

### Express (guided) — for the non-technical user
- Minimal jargon, maximum hand-holding; MailPoppy makes the safe choices **for** the user.
- Deep-links the right AWS console pages, pre-fills the **scoped** provisioning policy,
  auto-detects the pasted key, validates instantly.
- Security is present but reassuring, not scary: "we'll set up a limited-access key so MailPoppy
  can only do email things," with the *why* behind an "Is this safe?" link.
- Feeling: *"it just works and I'm looked after."*

### Advanced (full control) — for the technical user
- CLI credential-chain first (`aws configure --profile mailpoppy` / SSO) — **the secret never
  enters MailPoppy's window**, only the open-source sidecar reads it.
- Shows the IAM policy, "here's exactly what will be created," CloudTrail pointers, the
  self-deploy-from-source escape hatch.
- Feeling: *"I verified it myself."*

Same outcome, same safety; different verbosity and control.

---

## 5. Two honest ceilings (design around these)

1. **MailPoppy cannot create the AWS account.** AWS requires the user's own email, card, and
   phone verification. Express = the smoothest possible *hand-hold*, not full automation. Do
   not let the wizard promise magic it can't deliver.
2. **The Express user will almost certainly paste keys** (the CLI chain is the technical path),
   and pasting means trusting the closed binary. The **scoped least-privilege key** is what
   *bounds* that risk, which is why Express must still enforce it. This is also the strongest
   reason to ship **build provenance + signing + a `/verify` page** (a roadmap item from the
   trust discussion — not yet documented): it's what turns "fully trust us" from a request into
   something earned. Treat provenance as a hard dependency of the Express promise, not a
   nice-to-have.

---

## 6. Shape of the implementation

- A **chooser** as the first onboarding screen (rendered when no AWS creds resolve):
  - *"New to AWS? **Express setup** — we'll guide you, ~5 minutes."*
  - *"Know your way around / want to verify? **Advanced** — full control."*
- **Persist** the choice (settings / localStorage) and always offer a "Switch to
  advanced/simple" link, so it's never a trap.
- **Build them as two presentations of ONE flow** — shared steps, validation, and the sidecar
  endpoints; different chrome and verbosity. Not two parallel code paths (they would drift and
  you could no longer guarantee "equally secure"). The current onboarding becomes the Advanced
  view; Express is a thinner, reassuring wrapper over the same engine.

---

## 7. What already exists (the basis)

The desktop admin's AWS onboarding (`apps/desktop/src/views/AwsOnboarding.tsx`, closed app) was
reworked toward the Advanced shape:
- Recommended path is now the **AWS CLI** (`aws configure --profile mailpoppy`) with the
  "your secret never enters MailPoppy's window" line; the in-app **paste** path is downranked
  behind a disclosure with an honest trade-off note.
- **Least-privilege** is promoted to the top (scoped provisioning policy first).
- Sidecar fix (open engine): `/aws/readiness` re-detects a `mailpoppy` profile created via the
  CLI after launch, so "Check connection" works without a restart.
- Related: a **"Remove leftover infrastructure"** full-teardown button now appears on the
  overview only when a backend exists but no domains remain — a clean factory-reset for
  re-running onboarding.

So Express is the remaining piece: a chooser + a guided wrapper over this same flow.

---

## 8. Dependencies & sequencing

- **Do not build yet.** Sequence *after*: dogfooding the current flow → creating the
  mailpoppy.com mailboxes → pushing Hub Phase A ([[mailpoppy-hub-design]] §10).
- Pairs with the **provenance / `/verify`** work — that underwrites the Express user's trust
  (see §5.2). That work still needs its own write-up; `drafts/SECURITY.md` is currently just a
  vuln-reporting policy.
- Website mission line (§1) is an independent, low-effort copy task and can land any time.

---

## 9. Open questions

- Where does the chooser live relative to the Setup wizard's existing steps? (Likely Step 0,
  before/replacing the current readiness panel when no creds resolve.)
- Does Express ever surface the CLI path at all, or only as an "advanced users" link out?
- How loud should the "Is this safe?" disclosures be by default in Express — collapsed vs. a
  one-line reassurance always visible?
- Should the choice be remembered per-machine or re-asked each fresh deployment?
