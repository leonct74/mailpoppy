/**
 * Local provisioning sidecar. Exposes the (desktop-admin-only) provisioning
 * engine to the React frontend over localhost HTTP. Uses the admin's AWS
 * credential chain (AWS_PROFILE / SSO). Never bundled into the mobile app.
 */
import Fastify from "fastify";
import * as prov from "./provisioning";

const app = Fastify({ logger: true });

// CORS for browser dev (Vite on :1420). The sidecar binds 127.0.0.1 only, but we
// still scope CORS to known dev origins rather than reflecting any origin — a random
// web page must not be able to drive AWS provisioning via the user's browser.
// Add the Tauri origin here once the shell is wired (e.g. "tauri://localhost").
const ALLOWED_ORIGINS = new Set(["http://localhost:1420", "http://127.0.0.1:1420"]);
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

app.get("/provision/:domain/status", async (req) => {
  const domain = (req.params as { domain: string }).domain;
  return prov.getIdentityStatus(ctx(), domain);
});

const port = Number(process.env.PORT ?? 8787);
app
  .listen({ port, host: "127.0.0.1" })
  .then(() => app.log.info(`mailpoppy provisioning sidecar on http://127.0.0.1:${port}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
