/**
 * Local provisioning sidecar. Exposes the (desktop-admin-only) provisioning
 * engine to the React frontend over localhost HTTP. Uses the admin's AWS
 * credential chain (AWS_PROFILE / SSO). Never bundled into the mobile app.
 */
import Fastify from "fastify";
import * as prov from "./provisioning";
import * as migration from "./migration";
import { readLedger } from "./ledger";

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

const ctx = (): prov.AwsContext => ({
  region: process.env.AWS_REGION ?? "eu-west-1",
  profile: process.env.AWS_PROFILE,
});

app.get("/health", async () => ({ ok: true }));

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
    return reply.code(502).send({ ok: false, error: (err as Error).message });
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
    return reply.code(502).send({ ok: false, error: (err as Error).message });
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

// ---- Teardown: remove everything Mailpoppy deployed for a domain ----

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

const port = Number(process.env.PORT ?? 8787);
app
  .listen({ port, host: "127.0.0.1" })
  .then(() => app.log.info(`mailpoppy provisioning sidecar on http://127.0.0.1:${port}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
