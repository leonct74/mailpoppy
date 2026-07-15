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
- ✅ **Full backend re-verified live** (2026-06-02, 2nd pass): a real email **with an attachment**
  → inbound-processor extracted it to S3 (content intact); then via the **access API with a real
  Cognito JWT** (obtained through the app's SRP path): `GET /messages` (tenant-scoped),
  `GET /messages/{id}/attachments/0` → presigned-URL download (bytes intact), `POST /send` →
  `messageId` + a Sent copy in `folder=sent`. So Cognito login + attachment extraction +
  presigned download + send are all proven on real AWS. Stack fully torn down; account clean.
- ✅ **Send-with-attachments verified live, both directions** (2026-06-02, 3rd pass) on
  `ollydigital.com` / `eu-west-1`: `POST /send` (real Cognito SRP JWT) with a base64 `proof.txt`
  attachment → SESv2 built the multipart message → (1) the **Sent** row carried the attachment
  meta and `GET /messages/{id}/attachments/0` returned a presigned URL whose bytes were
  **identical** to the original (correct `Content-Disposition: attachment; filename="proof.txt"`);
  and the same message looped back through SES inbound → (2) `inbound-processor` **extracted** the
  attachment to S3 (`attachments/<msgId>/0-proof.txt`, 62 B) and its presigned download was also
  byte-identical. So send→multipart→SES→extract→download is end-to-end proven. Stack fully torn
  down; clean sweep re-verified (no Mailpoppy CFN stack / DynamoDB tables / S3 bucket / SES
  `ollydigital.com` identity / Cognito pool / Route53 MX+DKIM records).
- 🚧 **Desktop inbox UI** (`apps/desktop/src/views/InboxView.tsx`): folder nav, client-side
  **search** (`lib/search.ts` — local filter over the loaded folder; deep/Athena search is a
  later opt-in), read pane
  (sanitized HTML, remote images blocked by default — see `lib/mailBody.ts`), read/unread/star,
  trash/restore, compose→send, **Reply / Reply-all / Forward** with In-Reply-To/References
  threading (`lib/reply.ts`, unit-tested), and **attachment downloads** (inbound-processor
  extracts attachments to S3 → `GET /messages/{id}/attachments/{index}` presigned URL → download
  chips), and **Markdown→HTML compose** (`lib/compose.ts`: marked + the read-pane sanitizer, with
  a live Preview; sends HTML + plaintext fallback). It depends on a
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
- ✅ **Desktop shell packaged (Tauri v2)** — `apps/desktop/src-tauri/`: thin Rust core
  (`src/lib.rs`) spawns the provisioning sidecar (a Tauri `externalBin`) on launch and kills it on
  exit; `tauri.conf.json` wires devUrl `:1420` / frontendDist `../dist` / `externalBin`
  `binaries/mailpoppy-sidecar`. The sidecar ships as a **single self-contained executable**
  (`node-sidecar/scripts/build-sidecar.mjs`: esbuild bundle → Node 22 SEA → `lipo`-thin to the
  target arch on macOS → ad-hoc `codesign`) so end users need no Node. `npm run tauri:build` →
  `Mailpoppy.app` + `Mailpoppy_0.1.0_aarch64.dmg`. **Verified live (2026-06-02)**: launching the
  bundled `.app` spawns the embedded sidecar → `/health` 200 on `127.0.0.1:8787`; quitting kills
  the sidecar (no orphan). The CORS allowlist now includes `tauri://localhost` +
  `https://tauri.localhost`. The sidecar binary is git-ignored (per-platform build artifact).
  **Build it with `npm run build:sidecar` (or `tauri:build`) — never commit it.** Windows/Linux
  targets + signing/notarization are Phase 5.
- ✅ **One-click in-app backend deploy (no terminal/cdk for the user)** — the wizard's "Deploy
  backend" button stands up the FULL stack via CloudFormation from the sidecar. How it works:
  - **Asset-free stack** (`infra/lib/mail-stack.ts`): Lambda code = `Code.fromBucket` via CFN params
    `LambdaCodeBucket`/`LambdaCodeKey` (not CDK assets); the in-stack `AwsCustomResource` for
    SES `SetActiveReceiptRuleSet` was removed (it would re-introduce an asset) — the sidecar
    activates the rule set post-deploy via the new `RuleSetName` output. `bin/mailpoppy.ts` uses
    `DefaultStackSynthesizer({generateBootstrapVersionRule:false})` so **no `cdk bootstrap`** is
    needed. Verified: synth has zero `aws:asset`/bootstrap refs.
  - **Build pipeline** (`node-sidecar/scripts/build-backend-bundle.mjs`, run by `build:binary` +
    `pre{dev,typecheck}`): esbuild-bundles the 4 handlers → one zip (handlers `<name>.handler`),
    `cdk synth` → template, emits git-ignored `src/generated/backend-bundle.ts`
    (`templateJson` + `lambdaZipBase64` + content-addressed `lambdaCodeKey`) which the SEA binary
    embeds. **The 4 Lambdas now ship in ONE zip; no NodejsFunction at deploy time.**
  - **Sidecar** (`prov.deployBackend`/`getDeployStatus`, routes `POST /deploy/backend` +
    `GET /deploy/backend/:stack/status`): ensure a `mailpoppy-deploy-<acct>-<region>` bucket, upload
    template+zip, Create/UpdateStack (TemplateURL, params, CAPABILITY_IAM/NAMED_IAM/AUTO_EXPAND;
    ROLLBACK_COMPLETE → delete+recreate), poll; on `*_COMPLETE` activate the rule set. Ledger entry.
  - **Wizard** (`lib/deploy.ts` + SetupWizard): flow is now domain → **2. Deploy backend** (progress
    poll, saves deployment config from outputs so Inbox auto-connects) → **3. Set up domain mail
    (SES+DNS)** → **4. test**. `POST /provision` was **reconciled** to do ONLY SES identity + DKIM/MX/
    DMARC (the stack owns the bucket + receipt rule, so no more dueling rule-sets/buckets).
  - IAM: provisioning policy gained `cloudformation:Create/Update/Delete/Describe*` on
    `MailpoppyMailStack/*` (deploy bucket already covered by `mailpoppy-*`); accessanalyzer clean.
  - ✅ **Live-verified end-to-end (2026-06-03)** on ollydigital.com/eu-west-1 via the real sidecar
    path (NOT `cdk deploy`): `POST /deploy/backend` → CreateStack reached `CREATE_COMPLETE` (Lambdas
    running from the uploaded zip), rule set auto-activated → `/provision` (SES+DNS) → DKIM verified
    → `/mailbox/create` → SRP JWT → access-API `/send` loopback → the message arrived in the inbox
    (`spam PASS`, proving the **deployed inbound-processor Lambda ran**) + a Sent copy. Then full
    teardown (DeleteStack + RETAIN orphans + deploy/stray buckets + SES identity + DNS), clean sweep
    verified. **Live-test gotcha:** the reconciled `/provision` only takes effect after rebuilding
    the SEA binary — a stale binary recreated the old `mailpoppy-<domain>` bucket + "mailpoppy" rule
    set and stole the active-rule-set pointer; rebuild then re-activate the stack's `RuleSetName`.
    `createMailBucket`/`createReceiptPipeline` in provisioning.ts are now unused (kept, harmless).
- ✅ **Mailbox management (Cognito users)** — a mailbox = a Cognito user in the deployed backend's
  user pool (so it requires the CDK stack, not just the wizard's SES/DNS/S3 wiring). Sidecar:
  `prov.createMailbox`/`listMailboxes` (`@aws-sdk/client-cognito-identity-provider`:
  AdminCreateUser SUPPRESS + AdminSetUserPassword permanent + ListUsers); routes
  `POST /mailbox/create` {stackName?,email,password} + `GET /mailbox/list/:stackName` resolve the
  pool from CFN outputs and 404 with a "deploy the backend first" message if absent. Desktop:
  `lib/mailbox.ts` + a **Mailboxes** section in `SetupWizard.tsx` (create/list; on create it
  `saveDeploymentConfig` so the Inbox tab is immediately connectable). IAM: `MailboxAdmin` stmt on
  `userpool/*` (accessanalyzer clean).
- 🛠️ **Setup wizard UX hardening (2026-06-03, from user testing)**: Step 0 shows a spinner +
  **auto-retries** `/aws/readiness` for ~10s while the sidecar boots (no premature "can't reach
  helper"); credentials guidance now explains `AWS_PROFILE` is a **profile name** in
  `~/.aws/credentials` (run `aws configure list-profiles`), **not** the account number, and that a
  `[default]` profile can be omitted; domain/email inputs are **force-lowercased** + `autoCapitalize=off`
  (a capitalized domain previously broke the Route53 lookup); domain placeholder is `yourdomain.com`.
  MigrationView clarifies the IMAP password is the **source/old account's** (WorkMail), not the new
  mailbox's.
- ✅ **Phase 4 — WorkMail/IMAP migration (live-verified 2026-06-02)**. The desktop sidecar
  imports existing mail into the deployed backend, producing rows **identical** to the inbound
  Lambda's so imported mail shows up in the normal inbox. Pieces:
  - `@mailpoppy/core/migration.ts` — pure `mapImapFolder` (special-use + name heuristics; unknown
    folders preserved as sanitized custom folders; **`#` stripped** so SKs stay safe),
    `imapFlagsToFlags`, `isImapDeleted` (10 unit tests).
  - `node-sidecar/src/migration.ts` — `imapflow` + `mailparser`. `testImap` (creds + folder/counts
    preview) and `migrate` (fetch → `mig-<sha256(raw)>` id → raw `.eml` to `inbound/<id>` + extract
    attachments → DynamoDB row via core helpers; **idempotent**; `removeUndefinedValues`; skips
    `\Deleted`; resolves bucket/table from CFN outputs via `prov.getStackOutputs`; records a
    `Migration` entry in the transparency ledger).
  - sidecar routes `POST /migrate/imap/test` + `POST /migrate/imap/run` (run resolves
    `MailBucketName`/`IndexTableName` from the stack unless overridden).
  - `views/MigrationView.tsx` (4th App tab **Migrate**) — IMAP form → preview folders → import
    selected → per-folder summary; dry-run toggle; injectable `test`/`run` for tests (4 tests).
  - provisioning IAM policy gained scoped `s3:PutObject`/`GetObject` on `mailpoppymailstack-*` and
    `dynamodb:PutItem`/`BatchWriteItem` on `MailpoppyMailStack-*` (accessanalyzer: no findings).
  - **Live-verified (2026-06-02)** against a local GreenMail IMAP server into a real deployed
    stack: imported INBOX(2, incl. attachment) + "Sent Items"(1→**sent**), read back via the
    access API (correct folders/flags), attachment downloaded byte-identical. **The live run
    caught a real idempotency bug**: the SK embeds the date and the fallback was `new Date()`, so
    re-running duplicated rows for messages with no `Date:` header. **Fixed** → fall back to IMAP
    `INTERNALDATE` (stable); a 2nd run is now a no-op. Stack fully torn down; account clean.
    **Idempotency rule for any re-runnable importer: the sort-key date MUST be deterministic —
    never `new Date()`.**
- ✅ **Attachments fixed end-to-end, both directions (2026-06-03, from real-mail user testing)** —
  three layered bugs the earlier teardown-after-test passes missed because the user ran a
  *persistent* deploy and a *stale* sidecar binary:
  - **Outbound "Unsupported file type" in Gmail**: SESv2 `Content.Simple` + attachments built
    unopenable MIME → the attachment path now hand-builds **raw MIME** (`packages/core/src/mime.ts`
    `buildMimeMessage`: multipart/mixed + multipart/alternative, base64 wrapped at 76, RFC 2047
    subject, `Content-Disposition: attachment`) sent via SES **`Content.Raw`**; needs IAM
    **`ses:SendRawEmail`** (added to access-api in `mail-stack.ts`). Octet-stream attachments fixed
    with `core/contentType.ts` (`resolveContentType` by extension) on both send + inbound store.
  - **Received-attachment download did nothing**: `window.open()` is a no-op in Tauri WKWebView →
    added **`tauri-plugin-opener`** (Rust plugin + `opener:allow-open-url` capability +
    `lib/openExternal.ts`) AND a guaranteed **fallback link panel** (Open/Copy) shown when
    `openExternal()` reports it couldn't open.
  - **The "still fails" root cause**: the user was running a **stale prebuilt sidecar binary**, so
    re-deploys returned `NO_CHANGE` and fixes never reached the deployed Lambdas (deployed
    `lambdaCodeKey` ≠ freshly-built key). **After any Lambda/template change you MUST
    `npm run build:sidecar` and fully restart the app** — same class of bug as the ScrutiBank
    stale-PyInstaller-bundle gotcha.
  - ✅ **Live-verified 2026-06-03** on ollydigital.com/eu-west-1: a PNG sent from the app opened
    fine in Gmail, and an inbound attachment downloaded **byte-identical** (after a 500 traced to a
    missing `ses:SendRawEmail`, which the IAM fix resolved).
- ✅ **In-app teardown — "Remove everything" (2026-06-03)** — `views/ResourcesView.tsx` Danger Zone
  (type-the-domain-to-confirm) → sidecar `POST /teardown` → `prov.teardownAll`: deactivate the SES
  rule set → `DeleteStack` (+wait) → delete the **RETAINed orphans** (mail bucket, DynamoDB tables,
  Cognito pool) → deploy bucket → SES identity → DNS records (`removeDnsRecords` strips the
  amazonses MX/SPF/DKIM, keeps unrelated TXT). The user-facing version of the clean-sweep every live
  test already did by hand. IAM gained scoped deletes (s3:DeleteBucket/DeleteObject,
  dynamodb:DeleteTable, cognito-idp:DeleteUserPool; access-analyzer clean).
- ✅ **Email-security transparency + optional malware scanning (2026-06-03)** — for the
  admin-evaluating-vs-WorkMail ("are attachments virus-scanned?"):
  - **`views/SecurityInfo.tsx`** modal (🔒 button in the inbox) lists the 8 S3/mailbox protections
    (SSE-S3, TLS-only bucket policy, no public access, presigned-only time-limited access,
    server-side tenant isolation, SES spam/virus verdicts, safe-HTML rendering, GuardDuty). A
    dismissible inbox banner (`scanNoteDismissed` localStorage) explains SES's built-in spam/virus
    checks; the inbound virus verdict shows as a 🛡 badge.
  - **GuardDuty Malware Protection for S3** as an **optional, "(recommended)"** toggle in the Deploy
    step (default on). CDK: `EnableMalwareProtection` CfnParameter + `MalwareProtectionEnabled`
    condition gate `AWS::GuardDuty::MalwareProtectionPlan` (object-tagging ENABLED) + its scan IAM
    role (exact AWS-documented policy, no KMS); sidecar threads `enableMalwareProtection` through
    `deployBackend`. **Download gate**: `access-api::getAttachment` reads the
    `GuardDutyMalwareScanStatus` object tag → **403 if `THREATS_FOUND`** (fail-open for
    un-scanned/`NO_THREATS_FOUND`). Pricing surfaced to the admin: **$0.09/GB + $0.215/1000 objects,
    1 GB + 1000 objects/mo free tier**.
  - ✅ **Live-verified 2026-06-03** on the real stack: deployed with `MalwareProtection: "enabled"`,
    plan + scan role `CREATE_COMPLETE`; tagging an attachment object `THREATS_FOUND` → download
    **403**; retagging `NO_THREATS_FOUND` → **200 + presigned url**. (Gate logic verified by manual
    tagging, not by waiting on a real GuardDuty scan.) **NB: GuardDuty is currently left ENABLED on
    the user's live `MailpoppyMailStack`** at the recommended default — re-deploy with the box
    unchecked to disable (small AWS cost otherwise).
- ✅ **Per-mailbox storage quota + usage visibility (2026-06-03)** — admin caps each mailbox (GB) in
  the Mailboxes list (`views/MailboxStorageRow.tsx`); the inbox shows a live **"X% of Y used"** bar
  (amber ≥80%, red "Full — new mail is bounced" ≥100%). Quota lives in the settings table keyed
  **`quota#<address>`** (`core/storage.ts`: `quotaSettingsKey`, `formatBytes`, `usagePercent`,
  `usageLevel`, `wouldExceedQuota`). Enforcement (chosen behavior = **bounce + notify sender**):
  `inbound-processor` sums `sizeBytes` under the mailbox PK and, if the new message would exceed the
  quota, **skips storing it and sends the sender an NDR** ("Undeliverable…", from `mailer-daemon@`;
  system senders exempt to avoid bounce loops). Sidecar `GET /mailbox/storage/:stack/:email` +
  `POST /mailbox/quota`; access-api `GET /usage` (sum + quota) feeds the inbox bar. inbound-processor
  gained `SETTINGS_TABLE` + `ses:SendEmail`/`SendRawEmail`. **Post-MVP follow-ups:** the NDR is a
  basic text bounce (not a full DSN); usage is summed O(N) per inbound (could be a running counter).
  - ✅ **Live-verified 2026-06-03** on the real stack: delivered a small message (usage 3676 B) →
    set quota = 3676 (full) → a second message was **blocked from the inbox**, the sender received an
    "Undeliverable" NDR, and usage stayed unchanged. Throwaway test mailboxes deleted afterward
    (only `marco@` remains).
- ✅ **SES sandbox-exit (production access) flow (2026-06-04)** — the single biggest blocker
  between "demos live" and "send real mail to anyone." SES starts every account in a sandbox
  (verified recipients only, ~200/day) until AWS grants production access via a manual review.
  - **Core** (`packages/core/src/sesAccount.ts`): pure `sendingAccessState` → one of
    *sandbox / pending / production / denied / disabled / unknown*; `validateProductionAccessRequest`
    (URL, ≥30-char use-case, language, contact emails). 13 unit tests.
  - **Sidecar** (`provisioning.ts`): `getSesAccount` (SESv2 `GetAccount` → normalized status +
    send quota) and `requestProductionAccess` (validates in core, then SESv2 `PutAccountDetails`
    with `ProductionAccessEnabled:true`, ledger-logged). Routes `GET /ses/account` +
    `POST /ses/production-access` (400 on a bad request, *before* any AWS call).
  - **Desktop** (`views/SendingAccessView.tsx`, mounted in the wizard): status banner per state +
    live send quota; in sandbox/denied it shows a request form (mail type, website, use-case,
    language, extra contacts) with an **inline confirm** (webview-safe, no `window.confirm`).
    `lib/sesAccount.ts` client; injectable `load`/`submit` for tests (5 desktop tests).
  - **IAM**: provisioning policy gained `ses:PutAccountDetails` (`ses:GetAccount` already present);
    re-validated with `accessanalyzer validate-policy` → **no findings**.
  - ✅ **Live-verified 2026-06-04** via the real sidecar route: `GET /ses/account` returned the
    correctly-mapped status, and an invalid `POST /ses/production-access` was rejected **400 with no
    AWS call**. The real account (675546221165) is **already in production** (`ProductionAccessEnabled:
    true`, 50k/day) → the panel correctly shows the green "granted" state. The *submit* path was
    **not** fired live (it opens a real AWS Support case, and the account is already production).
  - 🧹 Drive-by fix: the desktop **sidecar wasn't covered by the root `npm run typecheck`**, hiding a
    latent `ExclusiveStartKey` type error in `getMailboxStorage` — fixed (typed via the SDK's
    `AttributeValue`). Run `npm run typecheck -w @mailpoppy/desktop-sidecar` after sidecar changes.
- ✅ **Custom MAIL FROM domain — SPF alignment / deliverability (2026-06-04)** — the concrete fix
  for mail landing in Outlook/Hotmail Junk. By default SES uses its own Return-Path
  (`…amazonses.com`), so a message passes DMARC on **DKIM alignment only** — SPF authenticates
  amazonses.com, *not* the sender's domain. Pointing SES at a custom MAIL FROM subdomain
  (`mail.<domain>`) with its own feedback MX + SPF TXT makes **SPF align too** (both DMARC pillars
  pass), which strict providers reward.
  - **Core** (`packages/core/src/mailFrom.ts`): `defaultMailFromDomain` (`mail.<domain>`),
    `mailFromDnsRecords(domain, region)` (region-specific `10 feedback-smtp.<region>.amazonses.com`
    MX + `v=spf1 include:amazonses.com ~all` TXT), `mailFromAlignment`
    (aligned/pending/failed/not-configured). 7 unit tests.
  - **Sidecar** (`provisioning.ts`): `getMailFromStatus` (GetEmailIdentity → MailFromAttributes) and
    `setupMailFrom` (SESv2 `PutEmailIdentityMailFromAttributes` with
    `BehaviorOnMxFailure=USE_DEFAULT_VALUE` so mail still sends if the MX ever fails, then writes the
    MX + TXT to Route53; ledger-logged). Routes `GET /ses/mail-from/:domain` +
    `POST /ses/mail-from`.
  - **Desktop** (`views/MailFromSetup.tsx`, in the wizard's Sending-access section under
    `SendingAccessView`): shows alignment state; when not-configured it previews the exact DNS
    records and offers setup behind an **inline confirm** (it changes DNS); pending state has a
    "Check verification status" button (SES verifies the MX async, minutes). `lib/mailFrom.ts`
    client; injectable for tests (4 desktop tests).
  - **IAM**: `+ses:PutEmailIdentityMailFromAttributes` (Route53 change perms already present);
    re-validated → **no findings**.
  - ✅ **Live-verified 2026-06-04** via the real sidecar route: `GET /ses/mail-from/ollydigital.com`
    → `not-configured` (only `BehaviorOnMxFailure`), `POST` with no domain → 400. The **apply**
    path (writes DNS) was **not** fired — it needs explicit user confirmation. **Measure the fix by
    SPF *alignment* in headers (mail-tester.com / Gmail "Show original"), NOT by Outlook Junk
    placement** — placement is reputation-dominated and won't flip from SPF alone.
  - ✅ **Applied live + verified (2026-06-04)** on ollydigital.com: MAIL FROM = `mail.ollydigital.com`,
    `MailFromDomainStatus=SUCCESS`, MX + SPF TXT present → SPF now aligns to the domain.
- ✅ **Admin mail rules — allow/block lists + per-verdict actions (2026-06-04)** — Phase 5
  policy surface. The inbound-processor *already* routed via `classifyDelivery(sender, verdicts,
  policy)` (block→allow→virus→spam→auth→clean), but `policyFor()` returned a hardcoded
  `DEFAULT_POLICY`, so nothing was configurable. Now there's a **store + admin UI**, and the Lambda
  reads it:
  - **Core** (`packages/core/src/policy.ts`): `policySettingsKey()` (`policy#default`),
    `normalizeSpamPolicy` (coerces untrusted input → valid `SpamPolicy`, defaults per field so a
    malformed doc can never break delivery), `normalizeAddressList` (trim/lowercase/dedupe),
    `isValidListEntry` (address / domain / @domain). 8 unit tests. (Matching logic + precedence
    live in `mailbox.ts::classifyDelivery`/`addressMatchesList`, already tested.)
  - **Lambda** (`inbound-processor.ts`): replaced the hardcoded `policyFor` with async
    `loadSpamPolicy()` — reads `policy#default` from `SETTINGS_TABLE` (already wired for quotas),
    `normalizeSpamPolicy(JSON.parse(...))`, **fail-safe to `DEFAULT_POLICY.spam`** on any
    missing/malformed doc or read error; loaded once per invocation and passed to `classifyDelivery`.
  - **Sidecar** (`provisioning.ts`): `getSpamPolicy`/`setSpamPolicy` read/write the JSON doc to the
    settings table (normalized on write); routes `GET /policy/spam/:stackName` + `POST /policy/spam`.
  - **Desktop** (`views/PolicyEditor.tsx`, in the wizard, gated on a deployed backend): three
    verdict dropdowns (spam → junk/tag/reject, auth-fail → junk/tag/reject/allow, virus →
    quarantine/reject; virus never inboxes) + allow/block list textareas with invalid-entry
    warnings; re-renders the server-normalized lists after save. `lib/policy.ts` client; 3 tests.
  - **IAM/infra**: none — the settings table is covered by the provisioning `StackTables` stmt, and
    the inbound-processor already has `grantReadWriteData` on it (from quotas).
  - ✅ **Live-verified 2026-06-04** on the user's stack (after a sidecar `UpdateStack`, GuardDuty
    preserved): block-list `boxord.com` → a message from `noreply@boxord.com` logged
    `drop … block-list` and **no row stored**; cleared the list → the same sender delivered to
    **inbox**. Test mailbox/objects cleaned up; policy doc deleted (back to no-doc defaults).
  - **UX**: per-verdict actions are tucked behind a collapsed **"Advanced"** disclosure with a
    "leave the defaults" recommendation (safe defaults save unchanged if never opened); allow/block
    lists are the everyday, always-visible control.
- ✅ **Reject mail to non-existent mailboxes (2026-06-04)** — user requirement: mail to an address
  with no mailbox (e.g. `info@` when only `marco@` exists) must be **bounced to the sender and stored
  nowhere** (not S3, not DynamoDB).
  - **Core** (`mailbox.ts::isKnownMailbox`): case-insensitive membership test; unit-tested.
  - **Lambda** (`inbound-processor.ts`): `loadMailboxAddresses()` lists the pool's Cognito users
    (`USER_POOL_ID` env, `cognito-idp:ListUsers`, cached 60s). Recipients are split into known/unknown;
    if a message has **no** known recipient → store nothing, **`DeleteObjectCommand`** the raw `.eml`
    SES wrote to S3, and bounce the sender. **Backscatter guard:** the bounce only fires when the
    sender passed SPF/DKIM/DMARC (`senderAuthenticated`); forged spam is dropped silently.
    **Fail-safe:** if the mailbox list can't be read (empty set), fall back to delivering to all
    hosted recipients — never reject mail because of a transient lookup failure.
  - **Infra** (`mail-stack.ts`): inbound-processor gained `USER_POOL_ID` env + a `cognito-idp:ListUsers`
    statement on the user pool. (`mailBucket.grantReadWrite` already covers `s3:DeleteObject`.)
    `lambdas/package.json` gained `@aws-sdk/client-cognito-identity-provider`.
  - ✅ **Live-verified 2026-06-04** (sidecar redeploy → `UPDATE_COMPLETE`, GuardDuty preserved):
    mail to `info@ollydigital.com` → `reject … no-such-mailbox`, **Count=0 in DynamoDB**, raw `.eml`
    **404 in S3** (deleted), bounce sent with no error; mail to `marco@` still delivered to inbox.
    Test data cleaned up.
  - *(Catch-all was deliberately NOT built — discussed as an anti-pattern/backscatter+legal risk; the
    "reject unknown" behavior above is the chosen handling. Aliases — extra addresses → one mailbox —
    remain a possible later feature.)*
- ✅ **Data-residency region picker + admin privacy guidance (2026-06-04)** — from the
  agency-hosting-for-customers scenario. **Honest threat model first:** in BYO-AWS you *cannot*
  cryptographically lock the account owner out of the mail (plaintext at SES ingestion + admin owns
  KMS + admin controls the Lambda). So we do the achievable, valuable things and are transparent
  about the rest.
  - **Region selection** (`views/RegionPicker.tsx`, `lib/region.ts`): the admin picks which AWS
    region stores their mail (data residency). Sidecar holds a module-level `currentRegion` (env
    default) with `GET`/`POST /config/region` (validated against `SES_INBOUND_REGIONS`); `ctx()` uses
    it. The choice persists in `localStorage` and is **re-applied to the sidecar on launch** (the
    process resets to env otherwise). Locks to the deployed region once a backend exists (can't move
    a stack). **Sidecar/frontend only — no Lambda redeploy.**
  - **Admin privacy notice** (`views/AdminPrivacyNotice.tsx`): a **reassuring, not scary**
    collapsible panel atop the wizard — "you're the data controller, here's how Mailpoppy helps":
    you choose the region, mail belongs to its owner (don't access without authorization), you set
    retention, nothing is hidden (Resources tab). Explicitly "guidance, not legal advice."
  - Desktop tests for RegionPicker + AdminPrivacyNotice. The credentials reassurance is also the
    **header sub-text** (`App.tsx`), visible on every screen.
  - *CloudTrail audit was deliberately NOT built* — it's an account-wide, billable AWS concern the
    admin enables themselves; the privacy notice points them to it.
- ✅ **Configurable retention + Cognito password-reset readiness (2026-06-04..07)** — last of the
  privacy thread.
  - **Retention** (`core/retention.ts`: `RetentionSettings`, `normalizeRetention` fail-safe to
    keep-forever, `retentionSettingsKey`; 6 tests). The **janitor** reads `retention#default` from
    `SETTINGS_TABLE` (env + `grantReadData`): always purges Trash older than `trashPurgeDays`; if a
    `retentionDays` window is set, hard-deletes any message older than it in every folder. Sidecar
    `get/setRetention` + routes `GET /policy/retention/:stack` + `POST`. `views/RetentionEditor.tsx`
    (wizard): 30d Trash purge + keep-indefinitely (default) vs delete-after-N-days with a
    permanent-deletion warning. Default = **keep mail forever** (AWS never auto-deletes; safe).
  - **Password-reset readiness**: user pool gains `accountRecovery: EMAIL_ONLY` → users self-reset by
    email, admin never learns the password. (The forgot-password UI lands with the mail client.)
  - ✅ **Live-verified 2026-06-07** (sidecar redeploy → `UPDATE_COMPLETE`, GuardDuty preserved):
    Cognito `AccountRecoverySetting=verified_email`; retention set/read round-trips; the janitor,
    invoked with a 100-year window against rows seeded at **1900** (so real mail can't be caught),
    purged the ancient trash + inbox rows (rows gone + S3 404) while a *now*-dated row survived and
    **marco@ stayed at 12 messages** (real mail untouched). Test rows + the retention doc cleaned up.

- 🚧 **Paywall migrated onto AgentsPoppy in-app purchase (2026-07-13, code done; live-verify pending)** —
  MailPoppy's per-domain mobile/web access is now sold through **AgentsPoppy's checkout** (the
  first-party `domain-access` product, `target = <domain>`), not MailPoppy's own Stripe. This kills the
  desktop's external-steering paywall (MailPoppy finally obeys the AgentsPoppy anti-steering rule) and
  gives **one checkout to manage** for MailPoppy + future first-party apps. Pieces:
  - **Hub gate** (`apps/web/src/lib/hub/`): `entitlement.ts::isDomainEntitled` gained an
    `agentspoppyEntitled` branch (precedence: manual comp → AgentsPoppy purchase → legacy Stripe
    `mobileActive`+standing, kept as a transition fallback). `agentspoppy.ts` = live entitlement fetch
    (`GET agentspoppy.com/api/entitlement?…&target=<domain>`) + pure `verifyPurchaseSignature` (HMAC,
    unit-tested, mirrors AgentsPoppy's `notify.ts`). `directory.ts::resolveDomain` reads the cached
    `domains/{domain}.agentspoppyEntitled` mirror on the happy path, and on a NEGATIVE gate does ONE
    live AgentsPoppy check that self-heals a missed webhook (persists the mirror + allows).
  - **Purchase webhook** `POST /api/agentspoppy/purchase` (`app/api/agentspoppy/purchase/route.ts`):
    signature-verified (`AGENTSPOPPY_NOTIFY_SECRET`), mirrors `entitled` onto the domain doc (merge,
    idempotent). Inert 503 until the secret is set.
  - **Desktop** (`apps/desktop/src/lib/commerce.ts`): `startDomainCheckout(domain)` POSTs
    `/api/checkout` → opens the hosted Stripe URL via `openExternal` (works standalone + in the
    AgentsPoppy container); `isDomainPurchased`. `MobileAppAccess.tsx`'s "See the pricing →" is now
    "Set up mobile access →" → `startDomainCheckout` (the stale-config "Update mobile settings" path,
    which is re-registration not payment, is unchanged).
  - **Mobile: no change** — it already reads `/api/resolve`, which now honours `agentspoppyEntitled`.
  - Green: `npm --prefix apps/web run typecheck`/`test` (34, +5 signature +4 gate tests); desktop
    `tsc --noEmit` + 227 tests. **The AgentsPoppy side (first-party 0%-on-platform checkout + the
    signed purchase-notification webhook) is built in `agentspoppy-web`** (see its commerce plane).
  - **Pending (user/live steps, NOT done):** (1) in the AgentsPoppy `/admin` → First-party products,
    create `com.mailpoppy.desktop` / `domain-access` (one-time, "pay once per domain") + set the notify
    URL to `https://mailpoppy.com/api/agentspoppy/purchase` (copy the signing secret); (2) set
    `AGENTSPOPPY_NOTIFY_SECRET` in this Hub's env; (3) in Stripe create a **second "Your account"
    webhook** → `agentspoppy.com/api/stripe/webhook` (same event set as the connected one — the
    checkout.session.completed + async_payment_succeeded + customer.subscription.* [incl. paused/
    resumed] + account.updated the handler acts on; or just "all events") and set its secret as
    `STRIPE_PLATFORM_WEBHOOK_SECRET` in agentspoppy-web (first-party charges fire on the platform
    account, not the connected-accounts webhook); (4) deploy both, then live-verify a domain buy →
    resolve 200. **Stage 2 (separate):** retire MailPoppy's own Stripe/`/activate` funnel + fix the
    `/activate` page for AgentsPoppy-entitled domains. The legacy path still works meanwhile.

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
- **🪤 Stale prebuilt sidecar binary masks Lambda/template changes.** The sidecar ships as a
  prebuilt SEA binary that *embeds* the synthesized CFN template + the content-addressed Lambda
  zip (`src/generated/backend-bundle.ts`). If you edit a Lambda, CDK stack, or `core` code a
  Lambda imports but **don't** rerun `npm run build:sidecar`, the running app deploys the **old**
  bundle → `lambdaCodeKey` is unchanged → CloudFormation reports `NO_CHANGE` and the fix never
  reaches AWS. This is exactly what caused the "attachments still fail" reports (2026-06-03).
  **After any change to `lambdas/`, `infra/`, or core code used by a Lambda: `npm run build:sidecar`
  AND fully restart the app** (the Rust shell respawns the sidecar; a hot frontend reload is not
  enough — and the Tauri opener plugin also needs a full Rust restart). Cross-check the deployed vs.
  built `lambdaCodeKey` if a deploy unexpectedly says `NO_CHANGE`. Same failure class as ScrutiBank's
  frozen-PyInstaller-bundle bug.

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
- **Attachment malware scanning** (✅ live-verified 2026-06-03): SES's built-in virus verdict
  (virus → never inbox) + an **optional, recommended** GuardDuty Malware Protection for S3 plan
  that tags stored objects; the access-API download endpoint **403s any `THREATS_FOUND` object**
  (fail-open for un-scanned/clean). Surfaced to the admin via the SecurityInfo panel + 🛡 verdict
  badge. Opt-in because it's cost-bearing in the admin's AWS (see DESIGN §10).
- **Per-mailbox storage quota** (✅ live-verified 2026-06-03): server-side enforcement in the
  inbound-processor — over-quota mail is **bounced to the sender (NDR) and not stored**, so a full
  mailbox can't be used to run up the admin's S3 bill or silently lose mail.
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
- **Subscription per domain** (the AgentsPoppy first-party `domain-access` product,
  `kind=subscription`, cancellable via the built-in billing portal). The old "pay once +
  paid updates" framing is retired (2026-07-15) — don't reintroduce it in copy or docs.
- Lead with **ownership / your-own-AWS / no lock-in**.

## Cross-references

- `DESIGN.md` — full architecture, data model, flows, pricing, risk register, phase detail.
- `phase0-derisk.md` — proven, copy-pasteable AWS sequence + the logged PASS result.
- **`apps/desktop/RELEASE.md` — how to SHIP a desktop update: version-bump (3 files) → `tauri:build`
  → package as `com.mailpoppy.desktop-<v>-darwin-arm64.zip` → commit/tag → `gh release create` →
  AgentsPoppy detects + user audits/installs. Read this before publishing a desktop version.**
- `apps/desktop/node-sidecar/REPRODUCE.md` — the *audit* side (verify/reproduce an update before applying).
- `apps/mobile/store/RUNBOOK.md` — the mobile app release pipeline (EAS / Xcode).
