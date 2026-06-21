# Broker product brief — "AgentsPoppy / BrokerPoppy"

*Strategy note — created 2026-06-18. **Keep this private** — do not place it in any repo
that may become public (same rule as [OPEN-vs-CLOSED.md](OPEN-vs-CLOSED.md)).*

*Builds on [OPEN-vs-CLOSED.md](OPEN-vs-CLOSED.md) (the open/closed cut line) and
[repo-split.md](repo-split.md) (the already-staged `mailpoppy-engine` / `mailpoppy-app`
split). This is **not a new product to build now** — it's the framing for what the open
engine could become, and the decisions to keep open while we ship MailPoppy.*

---

## One-paragraph concept

Extract the AWS-touching engine into a standalone, separately-branded, **open** product: a
**permission broker** that sits between any app/agent and a user's *own* cloud account. An
app declares the permissions it needs; the user reviews and approves them in
human-understandable terms; the broker grants scoped access and **enforces + audits** every
call in real time. Think **"OAuth for your own AWS account"** / **Plaid-for-cloud**. MailPoppy
becomes its first client. The broker is fully open (trust via auditability); MailPoppy's app
stays closed (the business).

## Positioning

- It is a **broker / consent + enforcement layer**, not "a safer CLI." Lead with the broker
  framing; the closest business analogy is **Plaid** (trusted broker apps connect *through* to
  reach a user's sensitive accounts, with consent — and developers pay).
- **Don't** market it as "safer than the AWS CLI" — that invites comparison to aws-vault /
  Granted / Leapp (credential tools for developers at a terminal) and loses. Our niche is
  different: an **end-user/agent-facing broker** that scopes, enforces, and audits access to
  the user's *own* account through a GUI.

## The wedge: AI agents

This is the timely, fear-driven, present-tense need and should be the headline. "Run agents
on your machine with **limited, user-approved, auditable, revocable** cloud permissions." It
reframes the broker from "BYO-AWS for a niche app" into "the trust/permission layer for agent
cloud access" — a much bigger thesis. Tie-in: expose the broker as an **MCP server** whose
every tool call is policy-checked and human-approvable — *ride* the agent-tooling standard
rather than compete with it.

## Architecture decision: ENFORCEMENT (chosen)

Not the easy "mint scoped creds + audit after the fact" model — **real-time enforcement**:

- **Apps/agents hold no AWS credentials.** The broker holds them locally and **signs +
  forwards every request** (SigV4) only after a per-call policy check. The app just has a
  handle to a local broker.
- This is the only model that supports the strong claim: *"this agent literally cannot do X,
  even if it tries"* — and it unlocks the demoable agent-safety features:
  - spend caps / rate limits ("≤ $20/day")
  - **human-in-the-loop approval** for irreversible/expensive actions ("delete 400 objects?")
  - instant **kill switch** (revoke mid-task)
  - live, comprehensible audit

### The two make-or-break problems (where the hard thinking goes)

1. **Authenticating the caller.** Enforcement is only as strong as knowing *which* process is
   calling and that it's the approved app — not malware impersonating it over local IPC
   (trivially spoofable by default). Need process identity / code-signature verification /
   per-app capability tokens. If we can't answer "who is calling," the guarantee is theater.
2. **Closing bypasses.** Enforcement only covers AWS access we broker. Honest caveats:
   **presigned URLs** (bearer hits AWS directly, around the proxy — disallow or specially
   mediate); **side channels** (any other creds/network path defeats the gate; at the limit
   this pushes toward OS-level network sandboxing). Market as *"controls all AWS access through
   the connector,"* never *"controls everything."*

### Two framing rules that keep it sane

- **Complement IAM, don't reimplement it.** A scoped IAM role is the static *floor* (AWS
  enforces it regardless); the broker adds the *dynamic* layer (caps, approvals, time windows,
  anomaly blocks). Start with **coarse enforcement** (service + action + ARN) and add deep
  per-service parsing only for high-blast-radius services (S3, IAM, EC2, Lambda, DynamoDB,
  billing).
- **Local-first credential custody.** The broker runs on the user's machine and holds *their*
  creds *there*. Never centralize keys server-side — that would make us the juiciest breach
  target on the internet, and it preserves the privacy/liability story.

### The real differentiating UX problem

Showing the user a policy's JSON is *not* transparency. Explaining the **blast radius** in
terms a non-expert can consent to (wildcards, `iam:PassRole`, condition keys,
privilege-escalation paths) is the hard, unsolved-in-general problem. Nail this = the moat.

## Open / closed line (extends OPEN-vs-CLOSED.md)

The clever part of this whole idea: **open the broker, keep MailPoppy closed.** We earn the
"trustworthy/auditable" label exactly where it matters (the thing touching the user's cloud
account) **without** giving away the paid product. The broker == the already-staged
`mailpoppy-engine`, taken further into its own brand.

- **License:** source-available (FSL), consistent with the [OPEN-vs-CLOSED.md](OPEN-vs-CLOSED.md)
  doctrine (readable/auditable, but reselling/competing forbidden; limits in open code are
  removable, so anything that *is* a limit stays in the closed layer). The reason to open is
  **trust + marketing + auditability**, not free labour; contributions are a bonus, never a
  dependency. *(If a true third-party ecosystem ever becomes the goal, the permissive-vs-FSL
  license question reopens — but that's a later, demand-pulled decision.)*

## Brand / naming

- **Confirmed: AgentsPoppy** (decided 2026-06-18). Leads with the agent wedge for attention;
  markets the durable broker capability underneath it.
- **Logo:** an "A" monogram — red→navy gradient legs with a navy upward chevron nested in the
  negative space, on black (the Poppy crimson-navy palette; reduces cleanly to a small
  monochrome mark). Asset to be version-controlled under `brand/` in the engine repo.
- The shared **"Poppy" family brand is a trust asset** — signals a common trusted house, which
  is exactly the trust-transfer we want.
- *(Rejected: BrokerPoppy — more accurate to the function, but drier and less timely.)*

## Business model (DEFERRED — do not build yet)

Developer fee to connect + repayment in placement on a "trusted connected apps" directory
(Plaid / app-store shape). Caveats: cold-start (few apps → weak publicity value → charge
*later*, seed with free early adopters); a **"trusted" badge makes us a trust authority** =
real vetting burden + liability, not a free directory. Park the registry/fees/marketplace
until there is outside pull.

## The decision that de-risks everything

**The first (and for now only) consumer is MailPoppy, connected by us.** Therefore this is
**internal architecture + an open license on the right layer**, *not* "launch a second
product." Cold-start, outside-dev chicken-and-egg, support burden, marketplace — all
deferred. Bonus: we get to harden the broker API against one real, demanding in-house
consumer before exposing it (how good platform APIs actually get built).

## Sequencing

- **Now (pure upside):** finish the engine extraction ([repo-split.md](repo-split.md) is
  already staged), keep the broker boundary clean, make MailPoppy its first client. This is
  just good decoupling and it earns the trust label while MailPoppy stays closed.
- **Cheap to honor now, expensive to retrofit:** no MailPoppy-specific assumptions leak into
  the broker; the consent/enforcement UX stays app-agnostic; version the API from day one.
- **Defer until pulled:** docs/SDK polish, trusted-apps registry, developer fees, marketplace,
  and **multi-cloud** (enforcement is per-provider, heavy work — don't assume contributors
  build GCP/Azure backends for free; assume we'll do the next cloud if it matters). Stay
  **AWS-only** to start; design so other clouds are *possible*, don't promise them.

## PIVOT (2026-06-18, later same day) — AgentsPoppy is a SEPARATE agnostic product

The earlier framing in this brief — *"AgentsPoppy == the rebranded `mailpoppy-engine`"* — is
**superseded.** Decision: AgentsPoppy must be **genuinely agnostic** (zero mail code) — a
standalone permission broker with its own API, its own UI, and its own domain (agentspoppy.com,
purchased) that MailPoppy *connects to* as its first client. A cosmetic rebrand of the mail
engine was the wrong vehicle, because that repo *is* mail code.

**What was done:**
- The cosmetic AgentsPoppy rebrand of `mailpoppy-engine` was **reverted** — that repo is
  MailPoppy's private mail engine again (single commit, not pushed).
- New repo scaffolded **locally** at `/Users/mt/Projects/agentspoppy` (`agentspoppy`,
  FSL-1.1-Apache-2.0): meta (README/NOTICE/TRADEMARK/LICENSE) + `brand/` logo + `packages/core`
  — the agnostic domain model, per-app inventory/ledger helpers (generalised from MailPoppy),
  and the consent/permission model with enforceable tag-attribution. **17 tests + typecheck
  green. No git remote, not published.**
- v1 design: [agentspoppy-v1-spec.md](agentspoppy-v1-spec.md) — model (ConnectedAccount →
  Connection → per-app Inventory), attribution + teardown, the basic API, and the boundary
  rule *"does the daily MailPoppy user need it?"* (e.g. Sending health stays in MailPoppy;
  CloudFormation stacks are AgentsPoppy-only).

**Next:** broker API service + desktop UI → wire MailPoppy as first client → shed MailPoppy's
admin UI (`AccountView`/`ResourcesView` move to AgentsPoppy).

## Pre-publish gate — AgentsPoppy → public (DO NOT publish until user approves)

`agentspoppy` is **local-only**. Before it ever goes public (only on explicit go):

- [x] **License:** FSL `LICENSE` + `NOTICE` + `TRADEMARK` (reserve "AgentsPoppy" + "Poppy") +
      SPDX headers on all `.ts`.
- [ ] **Sensitive-data scan** once more code lands (no keys / account-ids / credential files).
- [ ] **Create the GitHub repo + remote**, then flip public — on explicit go only.

*(The old engine-rename / `mailpoppy-app` submodule-repoint steps are obsolete: the engine
stays MailPoppy's, unchanged.)*

## Open decisions still to make

1. Caller-authentication mechanism (the security crux).
2. How presigned URLs / side channels are handled (the bypass-coverage honesty line).
3. Lead threat for the opening demo: runaway agent **spend**, **destructive actions**, or
   **data exfiltration**? (Picks the first enforcement feature + the demo.)
4. ~~Final name~~ — **Resolved: AgentsPoppy** (2026-06-18). Grab `agentspoppy.com`; add the
   logo to the engine repo `brand/` dir.
