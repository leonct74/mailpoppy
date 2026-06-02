/**
 * Local provisioning sidecar. Exposes the (desktop-admin-only) provisioning
 * engine to the React frontend over localhost HTTP. Uses the admin's AWS
 * credential chain (AWS_PROFILE / SSO). Never bundled into the mobile app.
 */
import Fastify from "fastify";
import * as prov from "./provisioning";
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

// Mutating: run the proven Phase 0 sequence. The UI must confirm before calling this.
app.post("/provision/:domain", async (req) => {
  const domain = (req.params as { domain: string }).domain;
  const c = ctx();
  const accountId = await prov.getAccountId(c);
  const zoneId = await prov.findHostedZoneId(c, domain);
  const dkimTokens = await prov.createIdentityGetDkimTokens(c, domain);
  const changeId = await prov.applyDnsRecords(c, {
    zoneId,
    domain,
    dkimTokens,
    dmarcRua: `postmaster@${domain}`,
  });
  const bucket = `mailpoppy-${domain.replace(/\./g, "-")}`;
  await prov.createMailBucket(c, { bucket, accountId });
  await prov.createReceiptPipeline(c, { ruleSet: "mailpoppy", domain, bucket });
  return { ok: true, domain, bucket, zoneId, dkimTokens, changeId };
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

const port = Number(process.env.PORT ?? 8787);
app
  .listen({ port, host: "127.0.0.1" })
  .then(() => app.log.info(`mailpoppy provisioning sidecar on http://127.0.0.1:${port}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
