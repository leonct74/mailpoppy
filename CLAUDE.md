# CLAUDE.md — Mailpoppy

Operating guide for working in this repo. For full rationale and decisions, see **`DESIGN.md`**
(source of truth). For the proven AWS wiring, see **`phase0-derisk.md`**.

> This is a **standalone project**. It is unrelated to and must never touch the user's other
> repos (`scrutibank`, `scrutibankV2`, etc.).

---

## What Mailpoppy is

A desktop app (later mobile) that lets an **AWS administrator host email for their own
domains entirely inside their own AWS account** — set up in minutes, with a built-in mail
client. Targets WorkMail refugees (WorkMail EOL **31 Mar 2027**). Pitch: *your mail, your
cloud, pay once per domain, unlimited mailboxes, no per-seat subscription, no lock-in.*

## Three things you MUST internalize

1. **S3 is not a mail server.** SES *receives* and *sends*; S3 only *stores* raw `.eml` files.
   There is no inbox / unread / folders / threads / search in S3 — **the app manufactures all
   mailbox state in DynamoDB** on top of the raw files. This is the single biggest source of
   work and the most common misconception.
2. **BYO-AWS.** Everything runs in the **customer's own AWS account**. Mailpoppy (the vendor)
   holds no customer mail and runs no per-customer infrastructure. Pure **serverless**
   (Lambda/S3/DynamoDB/SES/Cognito/API Gateway) → ~$0 at idle.
3. **Two credential planes** (never conflate — see DESIGN §6):
   - **Provisioning** = the admin's AWS credential chain (profile/SSO/keys via the Node/TS
     sidecar + AWS SDK v3), used once at setup/upgrade. **Desktop-admin-only — mobile never
     runs provisioning.** Never leaves their machine.
   - **Mailbox access** = **Cognito** login → scoped temp creds. The **mail path never uses
     AWS credentials** — clients call API Gateway (HTTPS + Cognito JWT). This is what makes
     multi-user and mobile possible.

## Status

- ✅ Planning complete (`DESIGN.md`).
- ✅ **Phase 0 de-risk PASSED** (2026-06-01) — inbound→S3 and outbound→Gmail-inbox proven live
  on a real domain in `eu-west-1`; SPF/DKIM/DMARC all pass. See `phase0-derisk.md`.
- 🚧 **Phase 1 (setup wizard) functional.** Monorepo installs + typechecks. The wizard runs
  the full loop live: **Step 0 readiness gate** (`provisioning.ts::checkReadiness` — credentials
  + per-service permission probes + optional CLI detection) → preflight → provision → DKIM poll
  → in-app deliverability test. **The AWS CLI is NOT required** (the SDK reads `~/.aws`/SSO
  directly); Step 0 only gates on resolvable creds + permissions so setup never fails midway.
- 🚧 **Phase 2 (backend) built & synth-validated** (2026-06-02). The CDK stack
  (`infra/lib/mail-stack.ts`) is fully wired: SES receipt rule → S3 + `inbound-processor`
  Lambda → DynamoDB index; Cognito-JWT **HTTP API** → `access-api` Lambda
  (`GET /messages`, `/messages/{id}/raw`, `PATCH .../flags`, `POST .../move`, `POST /send`);
  daily `janitor`; bounce/complaint `suppression`. Tenant isolation + verdict/spam routing live
  as pure, unit-tested functions in `@mailpoppy/core` (`mailbox.ts`). `npm run synth` emits a
  valid CloudFormation template; `npm run typecheck` + `npm run test` are green.
- ✅ **Phase 2 backend PROVEN LIVE end-to-end** (2026-06-02) on `ollydigital.com` / `eu-west-1`
  (account 675546221165). `cdk deploy` stood up the full stack (47 resources); a test email →
  SES receiving (MX) → S3 `.eml` → `inbound-processor` → a correct DynamoDB inbox row
  (`pk=ollydigital.com#demo@ollydigital.com`, `folder=inbox`, `spam=PASS dkim=PASS`, parsed
  subject/from/to, `unread=true`). **The live run caught a real bug** the unit tests/synth didn't:
  the DocumentClient rejected `undefined` optional fields → fixed with
  `marshallOptions.removeUndefinedValues=true` on all four Lambdas (commit `a896f07`). The test
  stack was **fully torn down afterward** (stack destroyed; RETAINed bucket/tables/UserPool
  deleted; MX+DKIM+SES identity removed; active rule set cleared — account verified clean).
- 🚧 **Desktop inbox UI** (`apps/desktop/src/views/InboxView.tsx`): folder nav, read pane
  (sanitized HTML, remote images blocked by default — see `lib/mailBody.ts`), read/unread/star,
  trash/restore, compose→send. It depends on a
  `MailClient` interface (`apps/desktop/src/lib/mailClient.ts`) implemented by the shared
  `@mailpoppy/api-client` (live) **or** an in-memory `DemoMailClient` (offline) — same view for
  desktop + future React Native.
- 🚧 **Mailbox login wired** (mailbox plane, not provisioning): `lib/auth.ts` (`CognitoAuth`
  via `amazon-cognito-identity-js`, SRP + NEW_PASSWORD challenge + token refresh — portable to
  RN), `lib/deploymentConfig.ts` (the 4 stack Outputs in localStorage), `views/ConnectView.tsx`
  + `views/LoginView.tsx`. `App.tsx`'s Inbox tab is a state machine: **no config → demo inbox →
  connect → login → live `MailClient` with the Cognito JWT.** Auth/views are dependency-injected
  so they're unit-tested with mocks (no live Cognito needed).
  **Backend not yet deployed to live AWS** → the inbox runs on demo data until a deploy exists.
- 🚧 **Resource transparency view built** (DESIGN §14.1): `views/ResourcesView.tsx` ("What
  Mailpoppy did to your account") — the deployed stack's resources grouped by service with
  region-aware **console deep-links**, plus a created/deleted **change log** for out-of-stack
  mutations; empty state when no stack. Backed by the sidecar `GET /aws/inventory/:stackName`
  (CloudFormation `DescribeStackResources` + the append-only `node-sidecar/src/ledger.ts`
  `~/.mailpoppy/provisioning-ledger.json`). Provisioning mutators record ledger entries
  (best-effort). Pure helpers in `lib/resources.ts` (`serviceFor`/`awsConsoleUrl`/`groupByService`)
  are unit-tested; the view is tested with an injected mock loader. 3rd App tab: **AWS Resources**.

## Architecture (concise)

```
Route53 (MX/SPF/DKIM/DMARC) → SES inbound → S3 (raw .eml) + Lambda (parse→index)
   → DynamoDB (mailbox state: flags, folders, threads, search) 
   → API Gateway + Lambda (Cognito-authorized access API) → client
Outbound: client → access-API Lambda → SES send (+ write Sent copy to S3/Dynamo)
Bounces/complaints: SES → SNS → suppression Lambda.  Retention: scheduled "janitor" Lambda.
```

Provisioned **into the customer's account**: Route53 records, SES (in/out + SMTP creds), S3,
Lambdas (inbound processor, access API, janitor), DynamoDB (`index` + `settings/policy`),
Cognito (User Pool + Identity Pool), API Gateway, SNS. Vendor-side: license server (Stripe +
Firebase, reuse existing).

## Tech stack — all TypeScript (monorepo)

One language end-to-end to maximize reuse across the React desktop and React Native clients.

- **Monorepo:** **npm workspaces** (Turborepo can be layered on later). Shared packages:
  `core` (types/models/validation/MIME + mailbox logic), `api-client` (Cognito-JWT calls to
  API Gateway, shared desktop+mobile), optional `ui`.
- **Desktop:** Tauri v2 + React 18 + TypeScript + Tailwind. Rust is **only** the thin shell.
- **Provisioning/admin engine:** **Node/TS sidecar** using AWS SDK for JS v3 (credential-
  provider chain → profiles + SSO). **Desktop-admin-only; mobile never runs it.**
- **Mobile (later):** **React Native (Expo)** — mailbox plane only, via shared `api-client`.
- **Backend Lambdas + IaC:** **TypeScript** Lambdas; **CDK (TS)** → `cdk synth` to a
  CloudFormation template the app deploys via `cloudformation:CreateStack/UpdateStack`
  (customers never need CDK installed).
- **Identity:** Amazon Cognito. **License server:** reuse Stripe + Firebase + website.
- **Admin split:** stack provisioning (AWS creds) is desktop-only; ongoing admin (users/policy)
  routes through the Cognito API → cross-platform.

## Proposed repo layout (monorepo — Phase 1 will scaffold this; does not exist yet)

```
mailpoppy/                      # pnpm + Turborepo, all TypeScript
├── CLAUDE.md · DESIGN.md · phase0-derisk.md
├── packages/
│   ├── core/                   # shared types, models, validation, mailbox/MIME logic
│   ├── api-client/             # API Gateway calls (Cognito JWT) — shared desktop+mobile
│   └── ui/                     # shared components (optional; RN-Web/Tamagui if pursued)
├── apps/
│   ├── desktop/                # Tauri + React; src-tauri/ (thin Rust shell) + node-sidecar/ (AWS SDK v3 provisioning)
│   └── mobile/                 # React Native (Expo) mailbox client
├── infra/                      # AWS CDK (TS) → synth → CloudFormation template shipped in the app
└── lambdas/                    # TS: inbound processor, access API, janitor, suppression
```

## Commands (fill in once scaffolded)

- Install (monorepo root): `npm install`
- Typecheck everything (core/api-client/lambdas/infra): `npm run typecheck`
- Run tests (core mailbox logic + desktop wizard): `npm run test`
- Synth backend CloudFormation template (bundles Lambdas via esbuild): `npm run synth`
- Desktop frontend dev: `npm run dev -w @mailpoppy/desktop`
- Provisioning sidecar dev: `npm run dev -w @mailpoppy/desktop-sidecar`
- Phase-0-style manual AWS checks: see `phase0-derisk.md`

## Phase plan (DESIGN §18) — current = Phase 1

0. ✅ De-risk (done). 1. **Setup/migration wizard** (provision the stack + health/verification
UX). 2. Read mail. 3. Send mail. 4. Migrate existing WorkMail (IMAP import). 5. Deliverability
& hardening + policy panels + multi-domain. 6. Mobile.

The Phase 1 wizard automates **exactly** the sequence proven in `phase0-derisk.md` — use that
as the reference implementation.

## Critical AWS constraints & gotchas

- **SES inbound is region-limited.** Validated in **`eu-west-1`**; also `us-east-1`,
  `us-west-2`. Confirm support before promising a region.
- **SES sandbox is per-account** and production access is a **manual AWS review** — software
  can pre-fill/link it but not click it. Design "provisioned → pending approval" UX.
- **~40 MB** hard cap on SES message size (email + attachments). Not configurable.
- **No "Sent" folder for free** — SES keeps no copy; the app must write sent mail to S3+index.
- **DMARC passes via DKIM alignment** (DKIM `d=` matches `From:` domain). SPF need not be
  aligned for DMARC to pass; a custom MAIL FROM subdomain (for SPF alignment) is a later nicety.
- **Route53 `UPSERT` replaces the whole record set** for a name+type — when adding SPF to an
  apex TXT, merge with existing TXT values (don't clobber). (Bit us-adjacent in Phase 0.)
- **Search:** default = DynamoDB metadata + client-side local index (free). Deep search =
  Athena opt-in. **Avoid OpenSearch by default** (hundreds-$/mo floor breaks the cost model).

## Config/policy model (DESIGN §10)

Defaults + admin overrides. Four buckets: **fixed engineering** (internal) · **admin policy**
(per-deployment/per-domain: retention, spam/virus/auth verdict actions, allow/block lists,
attachment soft-cap) · **cost-bearing opt-in** (advanced spam, deep search, extended
retention — billed in the admin's own AWS) · **hard AWS limits**. Ship great defaults so a
solo admin needs zero config.

## Security

- **Multi-tenant isolation** within one AWS account is enforced **server-side** in the
  access-API Lambda from verified Cognito claims — user X can only touch X's mailbox. Treat as
  security-critical; test it.
- **Least-privilege IAM**: `infra/policies/` has **two** validated policies (both pass
  `accessanalyzer validate-policy` with no findings):
  - **provisioning** (`mailpoppy-provisioning-policy.json` + `-role.yaml`) — direct-API
    Route53/SES/S3 (S3 locked to `mailpoppy-*`) + read-only CloudFormation for the §14.1
    inventory view. What Step 0 tells admins to attach instead of `AdministratorAccess`.
  - **deploy-time** (`mailpoppy-deploy-policy.json` + `-role.yaml`) — the `cloudformation:CreateStack`
    path (CFN/IAM/Lambda/DynamoDB/Cognito/API GW/SNS/EventBridge/SES/S3/Logs), scoped to
    `MailpoppyMailStack-*`/`mailpoppy*`. Shipped as a CloudFormation **service role** (passed via
    `RoleARN`) so the admin's own identity stays at `cloudformation:* + iam:PassRole`.
  Verified accurate against the real Phase 2 deploy. The *deployed* Lambda/Cognito roles remain
  tightly scoped inside the CDK stack.
- **Safe HTML rendering** in the client: ✅ done — `apps/desktop/src/lib/mailBody.ts`
  (`parseBody` via postal-mime + `sanitizeHtml` via DOMPurify): strips script/iframe/handlers,
  hardens links (`target=_blank rel=noopener`), and **blocks remote images/trackers by default**
  with a per-message "Load images" toggle. Rendered in `InboxView` (HTML when present, text/raw
  fallback). Unit-tested (sanitizer in jsdom, parser in node — postal-mime misbehaves in jsdom).
- Never store or transmit customer mail to the vendor side.
- **Resource transparency (REQUIRED — DESIGN §14.1):** the app MUST show the admin exactly what
  Mailpoppy created/changed/deleted in *their* account — by service + resource name/ARN — with
  a created/deleted timeline and console deep-links. *No surprise resources.* Source it from
  **CloudFormation** (`DescribeStackResources` = authoritative stack inventory, no drift) plus a
  local append-only **provisioning ledger** for out-of-stack mutations the sidecar makes
  directly (Route53 records, SES identity, `SetActiveReceiptRuleSet`). Any code path that creates
  or deletes an AWS resource MUST record it so the inventory stays complete and reconcilable.

## Working agreements (live AWS work)

- **Get explicit user confirmation before any AWS command that creates/changes/deletes
  resources or DNS.** Read-only checks (sts, list/describe) are fine to run.
- **Use a spare domain/subdomain** for live tests — never a production mail domain (MX gets
  hijacked). **Tear down** test resources afterward and verify the account is back to original.
- When a design decision changes, **update `DESIGN.md`** (source of truth) in the same change.

## Terminology / positioning (keep consistent)

- Sell **per domain, unlimited mailboxes** — never frame as "per seat / per user."
- "**Pay once**" (perpetual) + optional **≤ $15/yr** updates. No "subscription"-led messaging.
- Lead with **ownership / your-own-AWS / no lock-in**.

## Cross-references

- `DESIGN.md` — full architecture, data model, flows, pricing, risk register, phase detail.
- `phase0-derisk.md` — proven, copy-pasteable AWS sequence + the logged PASS result.
