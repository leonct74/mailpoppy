/**
 * Local provisioning sidecar. Exposes the (desktop-admin-only) provisioning
 * engine to the React frontend over localhost HTTP. Uses the admin's AWS
 * credential chain (AWS_PROFILE / SSO). Never bundled into the mobile app.
 */
import Fastify from "fastify";
import * as prov from "./provisioning";
import * as migration from "./migration";
import { readLedger } from "./ledger";
import { SES_INBOUND_REGIONS } from "@mailpoppy/core";

const app = Fastify({ logger: true });

// CORS allowlist. The sidecar binds 127.0.0.1 only, but we still scope CORS to
// known origins rather than reflecting any origin — a random web page must not be
// able to drive AWS provisioning via the user's browser.
//   - http://localhost:1420 / 127.0.0.1:1420 → Vite dev server
//   - tauri://localhost                       → packaged macOS/Linux webview
//   - https://tauri.localhost                 → packaged Windows (WebView2) webview
const ALLOWED_ORIGINS = new Set([
  "http://localhost:1420",
  "http://127.0.0.1:1420",
  "tauri://localhost",
  "https://tauri.localhost",
]);
app.addHook("onRequest", async (req, reply) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    reply.header("access-control-allow-origin", origin);
    reply.header("vary", "Origin");
    reply.header("access-control-allow-methods", "GET, POST, PATCH, OPTIONS");
    reply.header("access-control-allow-headers", "content-type, authorization");
  }
  // Answer CORS preflight (the POST /provision call triggers one).
  if (req.method === "OPTIONS") {
    return reply.code(204).send();
  }
});

// Map low-level connectivity failures bubbling up from the AWS SDK (machine
// offline / DNS unavailable) to a clear, actionable 503 instead of a raw 500
// with a cryptic "getaddrinfo ENOTFOUND route53.amazonaws.com". Everything else
// keeps Fastify's default shape (statusCode + message) so existing error
// handling on the client is unchanged.
const NETWORK_ERROR_CODES = new Set([
  "ENOTFOUND", // DNS lookup failed (offline / DNS down)
  "EAI_AGAIN", // DNS temporary failure
  "ETIMEDOUT", // connection timed out
  "ECONNREFUSED",
  "ECONNRESET",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "EHOSTDOWN",
]);
function networkErrorCode(err: unknown): string | undefined {
  // The SDK may surface the system error directly or wrap it under `cause`.
  const e = err as { code?: string; cause?: { code?: string } };
  if (e?.code && NETWORK_ERROR_CODES.has(e.code)) return e.code;
  if (e?.cause?.code && NETWORK_ERROR_CODES.has(e.cause.code)) return e.cause.code;
  return undefined;
}

// Turn an opaque error into something the user can act on. The most common one
// is a failed credential subprocess — the AWS SDK runs your profile's
// `credential_process` / SSO helper, and when that session has expired the
// child exits non-zero with the cryptic message "Command failed".
function describeError(err: unknown): string {
  const e = err as { name?: string; message?: string };
  const msg = e?.message ?? String(err);
  const credLike =
    e?.name === "CredentialsProviderError" ||
    /\bCommand failed\b/i.test(msg) ||
    /could not load credentials|credential[_ -]?process|\bSSO\b|ExpiredToken|security token.*(expired|invalid)/i.test(msg);
  if (credLike) {
    return "Couldn't get your AWS credentials — your session has probably expired. Re-authenticate (e.g. `aws sso login`, or refresh whatever your profile's credential_process uses), then restart Mailpoppy and try again.";
  }
  return msg;
}
app.setErrorHandler((err, _req, reply) => {
  const netCode = networkErrorCode(err);
  if (netCode) {
    app.log.warn({ err, code: netCode }, "network failure reaching AWS");
    return reply.code(503).send({
      ok: false,
      code: netCode,
      error: "Network",
      message: "Couldn't reach AWS — check your internet connection and try again.",
    });
  }
  const statusCode = (err as { statusCode?: number }).statusCode ?? 500;
  app.log.error({ err }, "request failed");
  return reply.code(statusCode).send({
    ok: false,
    code: (err as { code?: string }).code,
    error: err.name ?? "Internal Server Error",
    message: describeError(err),
  });
});

// The active AWS region for provisioning. Starts from the env, but the admin can
// change it from the wizard (data-residency) BEFORE deploying — the frontend
// re-applies its saved choice on launch. Route53 stays global (pinned in clients()).
let currentRegion = process.env.AWS_REGION ?? "eu-west-1";

const ctx = (): prov.AwsContext => ({
  region: currentRegion,
  profile: process.env.AWS_PROFILE,
});

app.get("/health", async () => ({ ok: true }));

// The active region + the regions where SES inbound is supported (the choices).
app.get("/config/region", async () => ({ region: currentRegion, available: SES_INBOUND_REGIONS }));

// Set the active region (must be an SES-inbound region). Applies to subsequent
// provisioning/deploy calls; can't move an already-deployed stack.
app.post("/config/region", async (req, reply) => {
  const b = (req.body ?? {}) as { region?: string };
  if (!b.region || !(SES_INBOUND_REGIONS as readonly string[]).includes(b.region)) {
    return reply.code(400).send({ ok: false, error: `region must be one of: ${SES_INBOUND_REGIONS.join(", ")}` });
  }
  currentRegion = b.region;
  return { ok: true, region: currentRegion };
});

// Step 0: is this environment able to provision at all? (credentials + per-service
// permission probes + optional CLI detection). Run before anything mutating.
app.get("/aws/readiness", async () => prov.checkReadiness(ctx()));

// Read-only: confirm credentials + that the domain's zone exists (wizard step 1).
app.get("/aws/preflight/:domain", async (req) => {
  const domain = (req.params as { domain: string }).domain;
  const c = ctx();
  const [accountId, zoneId] = await Promise.all([
    prov.getAccountId(c),
    prov.findHostedZoneId(c, domain),
  ]);
  return { accountId, zoneId, region: c.region };
});

// Mutating: set up the domain's MAIL identity + DNS only. The S3 bucket and the
// SES receipt rule set now belong to the deployed backend stack (POST
// /deploy/backend), which avoids two parallel buckets/rule-sets fighting over the
// single active receipt rule set. So this just: verify-domain DKIM + publish the
// DKIM CNAMEs / MX / DMARC records. The UI must confirm before calling this.
app.post("/provision/:domain", async (req) => {
  const domain = (req.params as { domain: string }).domain;
  const c = ctx();
  const zoneId = await prov.findHostedZoneId(c, domain);
  const dkimTokens = await prov.createIdentityGetDkimTokens(c, domain);
  const changeId = await prov.applyDnsRecords(c, {
    zoneId,
    domain,
    dkimTokens,
    dmarcRua: `postmaster@${domain}`,
  });
  return { ok: true, domain, zoneId, dkimTokens, changeId };
});

// Read-only: the resource transparency inventory (DESIGN §14.1) — the deployed
// stack's resources straight from CloudFormation, plus the local provisioning
// ledger of out-of-stack mutations (Route53/SES identity/rule-set activation).
app.get("/aws/inventory/:stackName", async (req) => {
  const stackName = (req.params as { stackName: string }).stackName;
  const c = ctx();
  const [stack, ledger] = await Promise.all([prov.listStackResources(c, stackName), readLedger()]);
  return { stackName, region: c.region, stackExists: stack.stackExists, resources: stack.resources, ledger };
});

app.get("/provision/:domain/status", async (req) => {
  const domain = (req.params as { domain: string }).domain;
  return prov.getIdentityStatus(ctx(), domain);
});

// Send the in-app deliverability self-test (mirrors Phase 0 step 7). Requires the
// domain's DKIM to be verified first (the UI gates this behind the status poll).
app.post("/provision/:domain/test", async (req, reply) => {
  const domain = (req.params as { domain: string }).domain;
  const to = (req.body as { to?: string } | undefined)?.to;
  if (!to) return reply.code(400).send({ ok: false, error: "missing 'to' recipient" });
  const messageId = await prov.sendTest(ctx(), {
    from: `hello@${domain}`,
    to,
    subject: "Mailpoppy deliverability test",
    text: "If you can read this in your inbox (not spam), Mailpoppy sending works. Check 'Show original' for SPF/DKIM/DMARC = PASS.",
    html: "<p>If you can read this in your <b>inbox</b> (not spam), Mailpoppy sending works.</p><p>Open <b>Show original</b> and confirm <b>SPF=PASS, DKIM=PASS, DMARC=PASS</b>.</p>",
  });
  return { ok: true, messageId };
});

// ---- Phase 4: migrate existing mail (WorkMail / any IMAP) -------------------

// Read-only: verify the IMAP credentials and enumerate folders + message counts
// (with the Mailpoppy folder each maps to) so the UI can preview the import.
app.post("/migrate/imap/test", async (req, reply) => {
  const b = (req.body ?? {}) as Partial<migration.ImapSource>;
  if (!b.host || !b.user || !b.password) {
    return reply.code(400).send({ ok: false, error: "host, user and password are required" });
  }
  try {
    return await migration.testImap({
      host: b.host,
      port: b.port,
      secure: b.secure,
      user: b.user,
      password: b.password,
    });
  } catch (err) {
    return reply.code(502).send({ ok: false, error: describeError(err) });
  }
});

// Mutating: pull mail from IMAP into the deployed backend's S3 + DynamoDB. The
// UI confirms before calling this. Bucket/table are resolved from the stack
// Outputs unless explicitly provided.
app.post("/migrate/imap/run", async (req, reply) => {
  const b = (req.body ?? {}) as {
    source?: migration.ImapSource;
    mailbox?: string;
    stackName?: string;
    bucket?: string;
    indexTable?: string;
    folders?: string[];
    maxMessages?: number;
    dryRun?: boolean;
  };
  if (!b.source?.host || !b.source?.user || !b.source?.password) {
    return reply.code(400).send({ ok: false, error: "source.host, source.user, source.password required" });
  }
  if (!b.mailbox) return reply.code(400).send({ ok: false, error: "mailbox (destination) is required" });

  const c = ctx();
  let bucket = b.bucket;
  let indexTable = b.indexTable;
  if (!bucket || !indexTable) {
    const outputs = await prov.getStackOutputs(c, b.stackName ?? "MailpoppyMailStack");
    bucket = bucket ?? outputs.MailBucketName;
    indexTable = indexTable ?? outputs.IndexTableName;
  }
  if (!bucket || !indexTable) {
    return reply.code(400).send({ ok: false, error: "could not resolve MailBucketName / IndexTableName from the stack" });
  }

  try {
    const summary = await migration.migrate(c, {
      source: b.source,
      target: { mailbox: b.mailbox, bucket, indexTable },
      folders: b.folders,
      maxMessages: b.maxMessages,
      dryRun: b.dryRun,
    });
    return { ok: true, ...summary };
  } catch (err) {
    return reply.code(502).send({ ok: false, error: describeError(err) });
  }
});

// ---- Mailboxes (Cognito users in the deployed backend's user pool) ----

const NO_BACKEND =
  'No deployed Mailpoppy backend was found yet. Set up a domain and use the in-app "Deploy backend" step to create it, then add mailboxes.';

async function resolveBackend(stackName: string) {
  const c = ctx();
  let outputs: Record<string, string>;
  try {
    outputs = await prov.getStackOutputs(c, stackName);
  } catch (e) {
    if (/does not exist|ValidationError/i.test((e as Error).message ?? "")) return null;
    throw e;
  }
  if (!outputs.UserPoolId) return null;
  return {
    region: c.region,
    userPoolId: outputs.UserPoolId,
    clientId: outputs.UserPoolClientId,
    apiBaseUrl: outputs.ApiBaseUrl,
  };
}

// List existing mailboxes in the backend's user pool.
app.get("/mailbox/list/:stackName", async (req, reply) => {
  const stackName = (req.params as { stackName: string }).stackName;
  const backend = await resolveBackend(stackName);
  if (!backend) return reply.code(404).send({ ok: false, error: NO_BACKEND });
  const mailboxes = await prov.listMailboxes(ctx(), backend.userPoolId);
  return { ok: true, ...backend, mailboxes };
});

// Create a mailbox (Cognito user + permanent password). The UI confirms first.
app.post("/mailbox/create", async (req, reply) => {
  const b = (req.body ?? {}) as { stackName?: string; email?: string; password?: string };
  if (!b.email || !b.password) {
    return reply.code(400).send({ ok: false, error: "email and password are required" });
  }
  const backend = await resolveBackend(b.stackName ?? "MailpoppyMailStack");
  if (!backend) return reply.code(404).send({ ok: false, error: NO_BACKEND });
  try {
    const mailbox = await prov.createMailbox(ctx(), {
      userPoolId: backend.userPoolId,
      email: b.email,
      password: b.password,
    });
    return { ok: true, mailbox, ...backend };
  } catch (err) {
    return reply.code(400).send({ ok: false, error: (err as Error).message });
  }
});

// Delete a mailbox: its Cognito sign-in user AND all of its stored mail
// (S3 + DynamoDB). Irreversible — the UI gates this behind a typed confirmation.
app.post("/mailbox/delete", async (req, reply) => {
  const b = (req.body ?? {}) as { stackName?: string; email?: string };
  if (!b.email) return reply.code(400).send({ ok: false, error: "email is required" });
  const stackName = b.stackName ?? "MailpoppyMailStack";
  const backend = await resolveBackend(stackName);
  if (!backend) return reply.code(404).send({ ok: false, error: NO_BACKEND });
  try {
    const result = await prov.deleteMailbox(ctx(), { stackName, email: b.email });
    return { ok: true, ...result };
  } catch (err) {
    return reply.code(502).send({ ok: false, error: (err as Error).message });
  }
});

// Admin-reset a mailbox's sign-in password (e.g. recover a departed employee's
// mailbox). The password is taken from the request body and never logged.
app.post("/mailbox/reset-password", async (req, reply) => {
  const b = (req.body ?? {}) as { stackName?: string; email?: string; password?: string };
  if (!b.email || !b.password) {
    return reply.code(400).send({ ok: false, error: "email and password are required" });
  }
  const backend = await resolveBackend(b.stackName ?? "MailpoppyMailStack");
  if (!backend) return reply.code(404).send({ ok: false, error: NO_BACKEND });
  try {
    return await prov.resetMailboxPassword(ctx(), {
      userPoolId: backend.userPoolId,
      email: b.email,
      password: b.password,
    });
  } catch (err) {
    return reply.code(400).send({ ok: false, error: (err as Error).message });
  }
});

// ---- Mailbox storage quotas (admin) ----

// Read a mailbox's current storage usage + quota (for "X% of Y used").
app.get("/mailbox/storage/:stackName/:email", async (req, reply) => {
  const p = req.params as { stackName: string; email: string };
  try {
    return await prov.getMailboxStorage(ctx(), { stackName: p.stackName, email: decodeURIComponent(p.email) });
  } catch (err) {
    return reply.code(502).send({ ok: false, error: (err as Error).message });
  }
});

// Set or clear (quotaBytes: null) a mailbox's storage quota.
app.post("/mailbox/quota", async (req, reply) => {
  const b = (req.body ?? {}) as { stackName?: string; email?: string; quotaBytes?: number | null };
  if (!b.email) return reply.code(400).send({ ok: false, error: "email is required" });
  try {
    return await prov.setMailboxQuota(ctx(), {
      stackName: b.stackName,
      email: b.email,
      quotaBytes: b.quotaBytes ?? null,
    });
  } catch (err) {
    return reply.code(502).send({ ok: false, error: (err as Error).message });
  }
});

// ---- One-click backend deploy (CloudFormation, no terminal/cdk for the user) ----

// Mutating: upload the embedded template + Lambda code and Create/UpdateStack.
// The UI confirms first. Returns immediately; poll the status route.
app.post("/deploy/backend", async (req, reply) => {
  const b = (req.body ?? {}) as { domain?: string; stackName?: string; enableMalwareProtection?: boolean };
  if (!b.domain) return reply.code(400).send({ ok: false, error: "domain is required" });
  try {
    return await prov.deployBackend(ctx(), {
      domain: b.domain,
      stackName: b.stackName,
      enableMalwareProtection: b.enableMalwareProtection,
    });
  } catch (err) {
    return reply.code(502).send({ ok: false, error: (err as Error).message });
  }
});

// Poll deploy progress; activates the SES rule set once complete.
app.get("/deploy/backend/:stackName/status", async (req) => {
  const stackName = (req.params as { stackName: string }).stackName;
  return prov.getDeployStatus(ctx(), stackName);
});

// ---- SES sandbox / production access (DESIGN §13) ----

// Read-only: sandbox vs production, review status of any in-flight request, send quota.
app.get("/ses/account", async (_req, reply) => {
  try {
    return await prov.getSesAccount(ctx());
  } catch (err) {
    return reply.code(502).send({ ok: false, error: (err as Error).message });
  }
});

// Read-only: "sending health" — bounce/complaint rates + sending quota from SES,
// and the do-not-send (suppression) list from the deployed stack's settings table.
app.get("/ses/deliverability/:stackName", async (req, reply) => {
  const { stackName } = req.params as { stackName: string };
  try {
    return await prov.getDeliverability(ctx(), { stackName });
  } catch (err) {
    return reply.code(502).send({ ok: false, error: (err as Error).message });
  }
});

// Mutating: submit a production-access (sandbox-exit) request to AWS (opens a
// Support case AWS reviews, ~24h). The UI confirms first. 400 on a bad request
// (validated in core) so the user gets a clear message, not a raw SES error.
app.post("/ses/production-access", async (req, reply) => {
  const b = (req.body ?? {}) as Record<string, unknown>;
  try {
    return await prov.requestProductionAccess(ctx(), b as unknown as Parameters<typeof prov.requestProductionAccess>[1]);
  } catch (err) {
    return reply.code(400).send({ ok: false, error: (err as Error).message });
  }
});

// Read-only: the domain's custom MAIL FROM configuration + verification status.
app.get("/ses/mail-from/:domain", async (req, reply) => {
  const domain = (req.params as { domain: string }).domain;
  try {
    return await prov.getMailFromStatus(ctx(), domain);
  } catch (err) {
    return reply.code(502).send({ ok: false, error: (err as Error).message });
  }
});

// Mutating: configure a custom MAIL FROM subdomain (SPF alignment) — points the
// SES identity at it and writes the feedback MX + SPF TXT to Route53. The UI
// confirms first (it changes DNS).
app.post("/ses/mail-from", async (req, reply) => {
  const b = (req.body ?? {}) as { domain?: string; subdomain?: string };
  if (!b.domain) return reply.code(400).send({ ok: false, error: "domain is required" });
  try {
    return await prov.setupMailFrom(ctx(), { domain: b.domain, subdomain: b.subdomain });
  } catch (err) {
    return reply.code(502).send({ ok: false, error: (err as Error).message });
  }
});

// ---- Spam / auth policy (allow-block lists + per-verdict actions) ----

// Read a mail-filtering policy (defaults if never set). `?domain=` reads a
// per-domain override; omitted reads the deployment-wide default.
app.get("/policy/spam/:stackName", async (req, reply) => {
  const stackName = (req.params as { stackName: string }).stackName;
  const scope = (req.query as { domain?: string }).domain;
  try {
    return await prov.getSpamPolicy(ctx(), { stackName, scope });
  } catch (err) {
    return reply.code(502).send({ ok: false, error: (err as Error).message });
  }
});

// Update a mail-filtering policy (normalized server-side). `domain` in the body
// writes a per-domain override; omitted writes the deployment-wide default.
app.post("/policy/spam", async (req, reply) => {
  const b = (req.body ?? {}) as { stackName?: string; policy?: unknown; domain?: string };
  if (!b.policy || typeof b.policy !== "object") {
    return reply.code(400).send({ ok: false, error: "policy is required" });
  }
  try {
    return await prov.setSpamPolicy(ctx(), {
      stackName: b.stackName,
      scope: b.domain,
      policy: b.policy as Parameters<typeof prov.setSpamPolicy>[1]["policy"],
    });
  } catch (err) {
    return reply.code(502).send({ ok: false, error: (err as Error).message });
  }
});

// ---- Retention (how long mail is kept) ----

app.get("/policy/retention/:stackName", async (req, reply) => {
  const stackName = (req.params as { stackName: string }).stackName;
  const scope = (req.query as { domain?: string }).domain;
  try {
    return await prov.getRetention(ctx(), { stackName, scope });
  } catch (err) {
    return reply.code(502).send({ ok: false, error: (err as Error).message });
  }
});

app.post("/policy/retention", async (req, reply) => {
  const b = (req.body ?? {}) as { stackName?: string; retention?: unknown; domain?: string };
  if (!b.retention || typeof b.retention !== "object") {
    return reply.code(400).send({ ok: false, error: "retention is required" });
  }
  try {
    return await prov.setRetention(ctx(), {
      stackName: b.stackName,
      scope: b.domain,
      retention: b.retention as Parameters<typeof prov.setRetention>[1]["retention"],
    });
  } catch (err) {
    return reply.code(502).send({ ok: false, error: (err as Error).message });
  }
});

// ---- Teardown: remove everything Mailpoppy deployed for a domain ----

// Read-only: every domain this backend was provisioned for (so the teardown
// confirmation can list them all — DNS/SES is removed for each).
app.get("/teardown/domains/:stackName", async (req, reply) => {
  const stackName = (req.params as { stackName: string }).stackName;
  try {
    const domains = await prov.discoverProvisionedDomains(ctx(), stackName);
    return { ok: true, domains };
  } catch (err) {
    return reply.code(502).send({ ok: false, error: (err as Error).message });
  }
});

// Mutating + DESTRUCTIVE: deletes the stack, its RETAINed data (mail bucket,
// DynamoDB tables, Cognito pool), the deploy bucket, the SES identity and the
// DNS records. The UI requires the user to type the domain to confirm. This is a
// long-running request (it waits for CloudFormation DeleteStack to finish).
app.post("/teardown", async (req, reply) => {
  const b = (req.body ?? {}) as { domain?: string; stackName?: string; deleteDeployBucket?: boolean };
  if (!b.domain) return reply.code(400).send({ ok: false, error: "domain is required" });
  try {
    return await prov.teardownAll(ctx(), {
      domain: b.domain,
      stackName: b.stackName,
      deleteDeployBucket: b.deleteDeployBucket,
    });
  } catch (err) {
    return reply.code(502).send({ ok: false, error: (err as Error).message });
  }
});

// Mutating + DESTRUCTIVE, but scoped to ONE domain: deletes the domain's
// mailboxes (+ their stored mail), its per-domain mail-rules/retention, its SES
// identity and its DNS records — leaving the shared backend stack and every other
// domain intact. The UI requires the user to type the domain to confirm.
app.post("/domain/remove", async (req, reply) => {
  const b = (req.body ?? {}) as { domain?: string; stackName?: string };
  if (!b.domain) return reply.code(400).send({ ok: false, error: "domain is required" });
  try {
    return await prov.removeDomain(ctx(), { domain: b.domain, stackName: b.stackName });
  } catch (err) {
    return reply.code(502).send({ ok: false, error: (err as Error).message });
  }
});

const port = Number(process.env.PORT ?? 8787);
app
  .listen({ port, host: "127.0.0.1" })
  .then(() => app.log.info(`mailpoppy provisioning sidecar on http://127.0.0.1:${port}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
