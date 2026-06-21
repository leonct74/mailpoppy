# AgentsPoppy — v1 spec (the basic broker + per-app monitor)

*Created 2026-06-18. Technical spec for AgentsPoppy v1. Builds on
[broker-product-brief.md](broker-product-brief.md) (strategy — keep private) and
[OPEN-vs-CLOSED.md](OPEN-vs-CLOSED.md). This file is technical, not business-sensitive, and
will move into the new AgentsPoppy repo when it's scaffolded.*

---

## What AgentsPoppy is

A **local-first permission broker for your own AWS**. It holds your AWS access on *your*
machine, lets apps/agents connect with a **declared, human-approved permission set**, and —
the part that makes the trust story tangible — **tracks what each connected app built in your
cloud and lets you pause it or tear it all down in one click.**

MailPoppy is its **first client**, connected like any other. AgentsPoppy contains **zero mail
code** — it is genuinely agnostic.

### Non-goals / boundaries (load-bearing)

- **Local-first credentials.** AWS creds live on the user's machine and never leave it.
  agentspoppy.com / Firebase hosting is **marketing only** — no credential ever touches it.
- **No app-specific logic.** Nothing about email, or any one consumer, leaks into the broker.
- **v1 is the scoped-credentials model**, not the full per-call enforcement proxy (that's the
  roadmap — see "v1 scope" below).

## The model (the hierarchy the user asked for)

```
AgentsPoppy (local)
└── ConnectedAccount            ← a linked AWS identity (you can link more than one)
     ├── accountId · alias · region(s) · credentials (held locally)
     └── Connection             ← a connected app (e.g. MailPoppy), one per app per account
          ├── app: id · name · icon
          ├── status: pending | active | paused | revoked
          ├── permissionSet     ← what it's allowed to do (human-readable)
          ├── grant             ← the scoped role/policy AgentsPoppy enforces
          ├── Inventory         ← what THIS app created in the cloud  (monitor + teardown)
          │      ├── stacks[]            (CloudFormation — the unit of teardown)
          │      └── outOfStack[]        (tagged standalone resources + ledger entries)
          └── audit[]           ← append-only log of what this app did / was granted
```

> **Terminology check:** "user" here = a **ConnectedAccount** (an AWS identity you linked) —
> *not* multiple human end-users of AgentsPoppy itself. AgentsPoppy stays single-operator and
> local. (Flagged as an open decision in case the intent was multi-tenant.)

## Infra attribution & teardown (the crux)

To show "what *this* app created" and remove it, every resource an app provisions must be
**attributable** to that app + connection. Three layers, generalised from MailPoppy's proven
approach ([ledger.ts](../apps/desktop/node-sidecar/src/ledger.ts),
[resources.ts](../apps/desktop/src/lib/resources.ts), `AccountView.tsx`):

1. **CloudFormation stack = the unit of deployment & teardown.** Apps deploy through a stack;
   AgentsPoppy records `stack ↔ connection`. The live inventory is read from
   `DescribeStackResources` (source of truth), and **teardown = DeleteStack** — atomic,
   dependency-ordered. This is exactly how MailPoppy removes its own footprint today.
2. **Mandatory tagging.** AgentsPoppy stamps every brokered create with
   `agentspoppy:app`, `agentspoppy:connection`, `agentspoppy:account`. This lets it
   reconcile against AWS (Resource Groups Tagging API) to catch drift and find anything
   created outside a stack, and to sweep-delete on teardown.
3. **Append-only ledger** for out-of-stack mutations (the things with no CloudFormation
   record). Per-connection, best-effort, never breaks the operation.

**Enforceable attribution (recommended for v1):** scope each connection's credentials with IAM
conditions (`aws:RequestTag/agentspoppy:connection` required on create;
`aws:ResourceTag/...` limiting mutate/delete to *own*-tagged resources). Then an app
**literally cannot** create resources that aren't stamped as its own, and cannot touch
another app's — so "show what it made / wipe what it made" is guaranteed, not convention.

### Lifecycle semantics

- **Pause** — stop vending new credentials for the connection (and, in the enforcement era,
  block calls). Existing infra keeps running; the app just can't act until resumed.
- **Revoke** — pause permanently + invalidate the grant. Infra is left intact (separate from
  teardown — revoking access ≠ destroying the user's data).
- **Tear down** — delete the app's stack(s) + sweep its tagged out-of-stack resources +
  reverse ledger'd mutations. Shows progress; double-confirm. This is the per-app version of
  MailPoppy's "remove everything."

## The basic API (v1, localhost only)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/accounts` | List linked AWS identities |
| `POST` | `/accounts` | Link a new AWS identity (profile/keys/SSO) |
| `POST` | `/connections` | App requests a connection `{ app, accountId, permissionSet }` → `pending` |
| `GET` | `/connections` · `/connections/:id` | List / inspect connections |
| `POST` | `/connections/:id/approve` · `/deny` | User decision (from the UI) |
| `POST` | `/connections/:id/credentials` | Vend short-lived scoped STS creds (only if `active`) |
| `POST` | `/connections/:id/pause` · `/resume` | Toggle the connection |
| `GET` | `/connections/:id/inventory` | CFN resources + tagged + ledger (the per-app view) |
| `POST` | `/connections/:id/teardown` | Delete this app's infra |
| `DELETE` | `/connections/:id` | Revoke |
| `GET` | `/connections/:id/audit` | Per-app audit trail |

### Permission set (human-consentable)

```jsonc
{
  "id": "mailpoppy.default",
  "name": "MailPoppy — host email in your AWS",
  "description": "Deploy and run a mail backend in your account.",
  "grants": [
    { "service": "cloudformation", "actions": ["Create/Update/DeleteStack", "Describe*"],
      "resourceScope": "stack/agentspoppy-mailpoppy-*" },
    { "service": "ses", "actions": ["..."], "resourceScope": "tagged-as-self" }
    // ...
  ],
  "requiredTags": ["agentspoppy:app", "agentspoppy:connection", "agentspoppy:account"],
  "limits": null   // v1: none. Roadmap: spend caps, per-action approval, time windows.
}
```

The consent UI renders this as **blast radius in plain terms** ("can create & delete its own
mail infrastructure; cannot touch anything not tagged as MailPoppy's"). Deep blast-radius
explanation (wildcards, `iam:PassRole`, escalation paths) is the long-term moat — v1 shows the
honest coarse version.

## The per-app view (your "Account-style" screen, but per connection)

Mirrors MailPoppy's `AccountView`: resources grouped by service (friendly names + AWS console
deep-links via the generalised `serviceFor` / `awsConsoleUrl`), live status from CloudFormation,
plus the connection header (status, scope) and the controls: **Pause · Revoke · Tear down**.

## Division of responsibility (why every app gets simpler)

AgentsPoppy owns the **administrative / monitoring / lifecycle plane** for *all* connected
apps, in one place. So each consumer app drops that burden and becomes a focused, feature-only
product — the user monitors everything from one app, and each app's UI is only about what it
actually does.

| Concern | Before (baked into each app) | After |
|---|---|---|
| AWS credentials / connect | each app collects & stores creds | AgentsPoppy — connect once, consent per app |
| Resource monitoring / inventory | per-app admin screen | AgentsPoppy — cross-app *and* per-app |
| Teardown / "remove everything" | per-app | AgentsPoppy — pause / revoke / tear down |
| Audit of AWS footprint | per-app ledger | AgentsPoppy |
| The actual product features | app | app — now the *whole* app |

**MailPoppy specifically:**
- *Sheds:* the credential-entry/connect step, `AccountView` + `ResourcesView` (resource
  monitoring + console links), and the "remove everything"/teardown UI → all become
  AgentsPoppy.
- *Keeps:* the email UX (inbox, compose, threads), mail-specific config (domains, mailboxes,
  mail rules, retention), **Sending health** (SES sandbox / production access, bounce /
  complaint / DMARC stats, suppression list — email-deliverability *interpretation*, a mail
  feature, **not** admin), and the **"set up my email backend" action** — all of which now run
  through AgentsPoppy-vended scoped creds, while the resulting stack is monitored/torn-down in
  AgentsPoppy.
- *Net:* MailPoppy's first run becomes **"Connect via AgentsPoppy"** (consent) instead of
  "paste your AWS keys" — simpler *and* more trustworthy.

> **The boundary rule — "does the daily MailPoppy user need it?"** The test is *not* "infra vs
> product" and *not* "does it touch AWS?" — it's **whether someone running MailPoppy
> day-to-day needs or benefits from it.**
>
> - **Redundancy is fine.** If a piece of info is useful to the daily operator, MailPoppy may
>   show it *even though* AgentsPoppy also has it — we don't strip useful info just because it
>   also lives in the admin plane.
> - **Pure technical / security detail lives only in AgentsPoppy** — the "nerdy part."
>   A MailPoppy user doesn't care about the **CloudFormation stack**, raw resource lists, or
>   the full audit log; putting them in MailPoppy is pointless. The security-minded user (or
>   anyone curious) checks AgentsPoppy.
> - **AgentsPoppy is the authoritative, complete view** of the cloud footprint, credentials,
>   audit, and lifecycle. MailPoppy shows a *useful subset*, in product terms.
> - **Examples.** Sending health (out of sandbox? bounce rate?) → *useful daily* → stays in
>   MailPoppy. CloudFormation stack / raw resource inventory → *nerdy* → AgentsPoppy only.
>
> `AccountView` today mixes both: when MailPoppy sheds its admin UI, Sending health is
> relocated (stays in MailPoppy) and the stack / resource monitoring moves to AgentsPoppy.

**Sequencing:** this MailPoppy simplification lands *after* AgentsPoppy v1 ships and MailPoppy
is wired as its first client. v1 itself is not blocked by it.

## v1 scope

**In:** linked accounts · connections + consent · scoped STS credential vending · mandatory
tagging + (recommended) IAM-condition enforcement of it · per-app inventory (CFN + tags +
ledger) · pause/resume/revoke/teardown · per-app audit · the broker UI (own brand) · a small
TS client SDK · MailPoppy wired as first client.

**Out (roadmap):** full per-call enforcement proxy (sign+forward every SigV4 call) · spend
caps / per-action human approval / kill-switch mid-call · caller-authentication hardening ·
bypass coverage (presigned URLs, side channels) · trusted-apps directory · multi-cloud.

## Reuse from MailPoppy (generalise, don't copy mail logic)

- `node-sidecar/src/ledger.ts` → generic per-connection append-only ledger.
- `src/lib/resources.ts` (`serviceFor`, `awsConsoleUrl`, `groupByService`, inventory shape) →
  generic, app-agnostic.
- `src/views/AccountView.tsx` + the CFN-inventory sidecar endpoint → the per-app monitor view.
- The teardown flow (stack delete + out-of-stack reversal) → generic per-app teardown.

## Branding — "poppy" = a connected app (2026-06-18)

In all AgentsPoppy communications (the repo, the app UI, the website), **"poppy" means any
application connected to AgentsPoppy** (MailPoppy is one); plural "poppies". It reinforces the
shared **Poppy** family — a common, trusted house. Already used in the UI copy ("Connected
Poppies", "No poppies connected yet"). NB this is the generic-noun device; "AgentsPoppy" and
"Poppy" remain reserved marks (TRADEMARK.md).

## Build status (2026-06-18)

Scaffolded locally at `/Users/mt/Projects/agentspoppy` (FSL, **no remote, not published**):
`packages/core` (model + inventory/ledger + consent), `packages/broker` (local API on
127.0.0.1, AWS seams stubbed), `app/` (React UI — connected poppies, per-app footprint,
consent, pause/revoke/teardown). 38 tests + typecheck + vite build green. **Next:** real AWS
providers (STS scoped creds + CloudFormation inventory/teardown) and the Tauri desktop wrapper,
then wire MailPoppy as first client.

## Open decisions

1. **"User" =** linked AWS account/identity (assumed), or AgentsPoppy multi-tenant humans?
2. **Enforce tagging via IAM session-policy conditions in v1** (stronger, guarantees
   attribution) or start with tagging-by-convention + reconcile, and add enforcement later?
3. **Require apps to deploy via CloudFormation** (clean atomic teardown — recommended) or also
   support raw resource creation (teardown then leans on the tag-sweep)?
4. **Form of the UI** confirmed as standalone desktop app — Tauri (reuse MailPoppy's shell
   patterns) vs other? (impl detail)
