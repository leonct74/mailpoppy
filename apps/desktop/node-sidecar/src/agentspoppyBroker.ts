// AgentsPoppy broker integration (opt-in) — lets MailPoppy obtain its AWS
// credentials from a *local* AgentsPoppy broker instead of a ~/.aws profile, so
// AgentsPoppy can govern, monitor, and tear down whatever MailPoppy deploys.
//
// This is a tiny, self-contained mirror of the `@agentspoppy/client` SDK
// (zero-dependency, structural types) so we don't take a cross-repo build
// dependency. It speaks the same local broker HTTP API:
//   GET  /accounts                                  → linked AWS accounts
//   GET  /connections                               → existing connections
//   POST /connections                               → request a connection
//   GET  /connections/:id                            → poll status
//   POST /connections/:id/credentials               → mint scoped creds
//
// DEFAULT OFF. Nothing changes unless MAILPOPPY_AGENTSPOPPY_BROKER is set (or the
// user explicitly connects via POST /agentspoppy/connect). When off, MailPoppy
// keeps resolving credentials from the ~/.aws `mailpoppy` profile exactly as before.

const DEFAULT_BASE_URL = "http://127.0.0.1:8799";
const REFRESH_BUFFER_MS = 300_000; // re-mint 5 min before expiry

/** The stack tag AgentsPoppy attributes + tears down on (must match the broker). */
export const CONNECTION_TAG_KEY = "agentspoppy:connection";

/**
 * AgentsPoppy's sentinel resourceScope meaning "only resources tagged as THIS
 * connection's own" — the broker turns it into an `aws:ResourceTag/agentspoppy:connection`
 * condition on the vended session policy. Value must match @agentspoppy/core's
 * TAGGED_AS_SELF. Used to ensure MailPoppy can only touch resources it created.
 */
const TAGGED_AS_SELF = "tagged-as-self";

/** AWS SDK v3 `AwsCredentialIdentity` shape (structural — no SDK import needed). */
export interface AwsCredentialIdentity {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  expiration?: Date;
}
export type AwsCredentialIdentityProvider = () => Promise<AwsCredentialIdentity>;

interface ScopedCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  expiration: string;
}
type ConnectionStatus = "pending" | "active" | "paused" | "revoked";
interface ConnectionDTO {
  id: string;
  accountId: string;
  status: ConnectionStatus;
  app?: { id: string; name: string };
  /** The scope the broker stored at creation — compared on reconnect to detect drift. */
  permissionSet?: { grants?: unknown[] };
}
interface AccountDTO {
  id: string;
  accountId: string;
  alias?: string;
  regions: string[];
}

/** How MailPoppy introduces itself to AgentsPoppy. */
export const APP = { id: "com.mailpoppy.desktop", name: "MailPoppy" } as const;

/**
 * What MailPoppy asks AgentsPoppy to broker — a faithful mirror of MailPoppy's own
 * least-privilege deploy + provisioning policies (infra/policies/mailpoppy-*.json),
 * NOT a lazy `*`. Every grant is the minimal action set, scoped to MailPoppy's own
 * resources (`MailpoppyMailStack-*` / `mailpoppy*`) wherever AWS supports
 * resource-level permissions. A handful of services genuinely can't be
 * resource-scoped (SES, Route53, Cognito user-pool *creation*, GuardDuty, the
 * read-only capability/identity probes), so those stay account-wide — but always
 * with a specific action list, never `service:*`, and never ANY IAM *user*
 * management. AgentsPoppy enforces these scopes in the session policy it vends
 * (policy.ts writes resourceScope straight into the credential's Resource), so this
 * is a real bound on the credentials, not just a friendlier label.
 *
 * Keep this in sync with infra/policies/mailpoppy-deploy-policy.json +
 * mailpoppy-provisioning-policy.json — those are the tested source of truth.
 *
 * This is ALSO the source the AgentsPoppy extension manifest (`extension.json`) is
 * generated from (see extensionManifest.ts / scripts/build-manifest.mjs), so the
 * container host reconciles the exact same scope and the two can never drift.
 */
export function permissionSet() {
  const grant = (service: string, actions: string[], resourceScope = "*") => ({ service, actions, resourceScope });
  const stack = "arn:aws:cloudformation:*:*:stack/MailpoppyMailStack/*";
  const role = "arn:aws:iam::*:role/MailpoppyMailStack-*";
  const fn = "arn:aws:lambda:*:*:function:MailpoppyMailStack-*";
  const table = "arn:aws:dynamodb:*:*:table/MailpoppyMailStack-*";
  const logs = "arn:aws:logs:*:*:log-group:/aws/lambda/MailpoppyMailStack-*";
  const topic = "arn:aws:sns:*:*:MailpoppyMailStack-*";
  const rule = "arn:aws:events:*:*:rule/MailpoppyMailStack-*";
  const apigwVerbs = ["POST", "GET", "PATCH", "PUT", "DELETE", "TagResource", "UntagResource"];
  const buckets = "arn:aws:s3:::mailpoppy*";
  const objects = "arn:aws:s3:::mailpoppy*/*";
  return {
    id: "mailpoppy-backend",
    name: "MailPoppy backend",
    description: "Deploy & manage the MailPoppy mail backend, scoped to MailpoppyMailStack-* / mailpoppy* resources.",
    grants: [
      // --- CloudFormation: the stack itself, plus account-level read-only validation ---
      grant("cloudformation", [
        "CreateStack", "UpdateStack", "DeleteStack", "DescribeStacks", "DescribeStackEvents",
        "DescribeStackResources", "ListStackResources", "GetTemplate", "CreateChangeSet",
        "DescribeChangeSet", "ExecuteChangeSet", "DeleteChangeSet", "TagResource",
      ], stack),
      grant("cloudformation", ["ValidateTemplate", "GetTemplateSummary"]),
      // --- IAM: only the stack's own Lambda roles (NO user management, NO iam:*) ---
      grant("iam", [
        "CreateRole", "DeleteRole", "GetRole", "TagRole", "UntagRole", "AttachRolePolicy",
        "DetachRolePolicy", "PutRolePolicy", "DeleteRolePolicy", "GetRolePolicy",
        "ListRolePolicies", "ListAttachedRolePolicies", "PassRole",
      ], role),
      grant("iam", ["SimulatePrincipalPolicy"]), // read-only capability probe
      // --- Compute / data, all pinned to MailpoppyMailStack-* ---
      grant("lambda", [
        "CreateFunction", "DeleteFunction", "GetFunction", "GetFunctionConfiguration",
        "UpdateFunctionCode", "UpdateFunctionConfiguration", "AddPermission", "RemovePermission",
        "InvokeFunction", "TagResource", "UntagResource", "ListTags",
      ], fn),
      grant("dynamodb", [
        "CreateTable", "DeleteTable", "DescribeTable", "UpdateTable", "DescribeContinuousBackups",
        "UpdateContinuousBackups", "DescribeTimeToLive", "UpdateTimeToLive", "TagResource",
        "UntagResource", "ListTagsOfResource",
      ], table),
      grant("logs", ["CreateLogGroup", "DeleteLogGroup", "DescribeLogGroups", "PutRetentionPolicy", "TagResource"], logs),
      grant("sns", [
        "CreateTopic", "DeleteTopic", "Subscribe", "Unsubscribe", "GetTopicAttributes",
        "SetTopicAttributes", "GetSubscriptionAttributes", "TagResource", "UntagResource",
      ], topic),
      grant("events", [
        "PutRule", "DeleteRule", "DescribeRule", "PutTargets", "RemoveTargets",
        "ListTargetsByRule", "TagResource", "UntagResource",
      ], rule),
      // API Gateway control-plane ARNs are account-less and the API id is server-assigned, so
      // we can't pin to "our" API at create time — but we DO keep it to the /apis (v1+v2) and
      // /tags paths only (never /domainnames, /account, /vpclinks, /usageplans). Tagging a new
      // API/stage is a POST to the SEPARATE /tags/<arn> path; an /apis-only scope missed it, so
      // the create rolled back (AccessDenied on apigateway:POST /tags/...). AWS's own
      // AmazonAPIGatewayAdministrator just uses the broader /*.
      grant("apigateway", apigwVerbs, "arn:aws:apigateway:*::/apis*"),
      grant("apigateway", apigwVerbs, "arn:aws:apigateway:*::/v2/apis*"),
      grant("apigateway", apigwVerbs, "arn:aws:apigateway:*::/tags*"),
      // --- S3: only mailpoppy* buckets/objects (+ read-only bucket listing) ---
      grant("s3", [
        "CreateBucket", "DeleteBucket", "PutBucketPolicy", "GetBucketPolicy", "DeleteBucketPolicy",
        "PutEncryptionConfiguration", "GetEncryptionConfiguration", "PutBucketPublicAccessBlock",
        "GetBucketPublicAccessBlock", "PutBucketTagging", "PutLifecycleConfiguration",
        "GetLifecycleConfiguration", "PutBucketCORS", "GetBucketCORS", "ListBucket", "HeadBucket",
      ], buckets),
      grant("s3", ["GetObject", "PutObject", "DeleteObject"], objects),
      grant("s3", ["ListAllMyBuckets"]),
      // --- Cognito: creating a pool/client, reading, and tagging can't be tied to a
      //     not-yet-existing resource (and CFN needs TagResource to stamp the propagated
      //     connection tag onto the new pool), so they stay account-wide — harmless.
      //     But every operation that could DAMAGE or read out an existing pool (delete,
      //     reconfigure, or touch its users) is scoped to pools tagged as MailPoppy's
      //     OWN — so MailPoppy can never delete or alter another app's user pool. ---
      grant("cognito-idp", [
        "CreateUserPool", "CreateUserPoolClient", "DescribeUserPool", "DescribeUserPoolClient",
        "GetUserPoolMfaConfig", "TagResource", "UntagResource",
      ]),
      grant("cognito-idp", [
        "DeleteUserPool", "UpdateUserPool", "DeleteUserPoolClient", "UpdateUserPoolClient",
        "SetUserPoolMfaConfig", "AdminCreateUser", "AdminSetUserPassword", "AdminDeleteUser", "ListUsers",
      ], TAGGED_AS_SELF),
      // --- Services with no resource-level IAM support: specific actions, account-wide ---
      grant("ses", [
        "CreateReceiptRuleSet", "CreateReceiptRule", "DeleteReceiptRule", "DeleteReceiptRuleSet",
        "DescribeReceiptRuleSet", "DescribeActiveReceiptRuleSet", "SetActiveReceiptRuleSet",
        "CreateEmailIdentity", "GetEmailIdentity", "DeleteEmailIdentity", "ListEmailIdentities",
        "GetAccount", "GetSendStatistics", "PutAccountDetails", "PutEmailIdentityMailFromAttributes", "SendEmail",
      ]),
      grant("route53", ["ListHostedZonesByName", "ListResourceRecordSets", "ChangeResourceRecordSets"]),
      grant("guardduty", [
        "CreateMalwareProtectionPlan", "GetMalwareProtectionPlan", "UpdateMalwareProtectionPlan",
        "DeleteMalwareProtectionPlan", "ListMalwareProtectionPlans", "TagResource", "UntagResource", "ListTagsForResource",
      ]),
      grant("sts", ["GetCallerIdentity"]),
    ],
    requiredTags: [CONNECTION_TAG_KEY],
    limits: null,
  };
}

/**
 * A canonical signature of a permission set's grants, for detecting whether the scope
 * MailPoppy declares has drifted from what a stored connection was created with. Per
 * grant we take [service, sorted actions, resourceScope]; actions are sorted so a mere
 * ordering difference isn't seen as a change, but grant order (and any added/removed
 * grant) still is. Anything non-array → "" so a malformed/absent set always differs.
 */
function grantsSignature(grants: unknown): string {
  if (!Array.isArray(grants)) return "";
  return JSON.stringify(
    grants.map((g) => {
      const x = (g ?? {}) as { service?: string; actions?: string[]; resourceScope?: string };
      return [x.service ?? "", [...(x.actions ?? [])].sort(), x.resourceScope ?? ""];
    }),
  );
}

// --- module state (the sidecar is a single long-lived process) ---

let baseUrl = process.env.AGENTSPOPPY_BASE_URL ?? DEFAULT_BASE_URL;
let enabled = /^(1|true|yes|on)$/i.test(process.env.MAILPOPPY_AGENTSPOPPY_BROKER ?? "");
let connection: ConnectionDTO | null = null;
let credsProvider: AwsCredentialIdentityProvider | null = null;
/** AWS account number behind the active connection (for display); set on connect. */
let awsAccountId: string | null = null;

export function isBrokerEnabled(): boolean {
  return enabled;
}

/**
 * True when an approved AgentsPoppy connection is the active credential source.
 * Readiness treats this as "environment ready" without probing AWS — AgentsPoppy
 * has already granted a known, scoped permission set, and the actual credential
 * mint (with its supervised approval) happens at deploy time, not form-enable time.
 */
export function brokerConnected(): boolean {
  return enabled && connection?.status === "active";
}

/** The AWS account number behind the active broker connection, if known. */
export function brokerAccountId(): string | undefined {
  return brokerConnected() ? awsAccountId ?? undefined : undefined;
}

/** The stack tag to stamp on deploys, or null if not connected+active. */
export function brokerConnectionTag(): { Key: string; Value: string } | null {
  return connection && connection.status === "active" ? { Key: CONNECTION_TAG_KEY, Value: connection.id } : null;
}

/**
 * The credential provider to use for AWS calls, or undefined when we should fall
 * back to the local profile. Only returns a provider once the connection is
 * `active` (approved) — a pending/paused/revoked connection can't mint.
 */
export function brokerCredentials(): AwsCredentialIdentityProvider | undefined {
  if (!(enabled && connection?.status === "active")) return undefined;
  // Arm the provider lazily so it can never lag behind "connected". Without this,
  // a connection observed as active via a path that didn't run beginBrokerConnect
  // (e.g. status re-sync after a restart) would leave credsProvider null →
  // readiness (brokerConnected) says ready, but AWS calls silently fall back to the
  // local profile and fail. Keyed off connection.id so it always matches.
  if (!credsProvider) credsProvider = makeProvider(connection.id);
  return credsProvider;
}

interface FetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}
function doFetch(path: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<FetchResponse> {
  const f = (globalThis as { fetch?: (u: string, i?: unknown) => Promise<FetchResponse> }).fetch;
  if (!f) throw new Error("global fetch unavailable (Node 18+ required) for AgentsPoppy broker");
  return f(`${baseUrl}${path}`, init);
}

async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await doFetch(path, {
    method: init?.method ?? "GET",
    headers: init?.body !== undefined ? { "content-type": "application/json" } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (!res.ok) {
    let message = `AgentsPoppy broker returned ${res.status}`;
    try {
      const b = (await res.json()) as { message?: string; error?: string };
      if (b?.message) message = b.message;
    } catch {
      /* keep status-based message */
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

function isScopedCredentials(v: unknown): v is ScopedCredentials {
  const c = v as Partial<ScopedCredentials> | null;
  return !!c && !!c.accessKeyId && !!c.secretAccessKey && !!c.sessionToken && !!c.expiration;
}

/** Poll interval while a supervised approval is pending (the user decides in AgentsPoppy). */
const APPROVAL_POLL_MS = 2000;

/**
 * Mint scoped credentials. For a normal connection this returns at once. For a
 * *supervised* connection the broker answers with `202 { approvalRequired, approval }`
 * — the user must approve the operation in the AgentsPoppy window — so we poll
 * (echoing the approval id) until it's approved (→ credentials) or denied (→ error).
 * That's how AgentsPoppy can require a human OK before MailPoppy changes anything.
 */
async function mintCredentials(connectionId: string): Promise<ScopedCredentials> {
  const path = `/connections/${encodeURIComponent(connectionId)}/credentials`;
  const post = (body?: unknown) =>
    doFetch(path, {
      method: "POST",
      headers: body !== undefined ? { "content-type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

  let res = await post();
  for (;;) {
    if (!res.ok) {
      let message = `AgentsPoppy broker returned ${res.status}`;
      try {
        const b = (await res.json()) as { message?: string };
        if (b?.message) message = b.message;
      } catch {
        /* keep status-based message */
      }
      // A pending approval has a 15-min TTL. If it lapses (or was already consumed)
      // while we're still mid-deploy — e.g. the user took a moment to walk over to
      // AgentsPoppy — that's NOT a failure: transparently re-request a fresh approval
      // (which re-notifies them) and keep waiting, instead of surfacing a bare "error".
      // A genuine denial still propagates so the user's "no" is honoured.
      if (/expired|already been used|request again/i.test(message)) {
        await new Promise((r) => setTimeout(r, APPROVAL_POLL_MS));
        res = await post();
        continue;
      }
      throw new Error(message);
    }
    const body = await res.json();
    if (isScopedCredentials(body)) return body;
    const approvalId = (body as { approval?: { id?: string } }).approval?.id;
    if (!approvalId) throw new Error("AgentsPoppy broker returned an unexpected credentials response");
    await new Promise((r) => setTimeout(r, APPROVAL_POLL_MS));
    res = await post({ approvalId });
  }
}

function makeProvider(connectionId: string): AwsCredentialIdentityProvider {
  let cached: ScopedCredentials | null = null;
  let inflight: Promise<ScopedCredentials> | null = null;
  const fresh = (c: ScopedCredentials): boolean => {
    const exp = Date.parse(c.expiration);
    return Number.isFinite(exp) && Date.now() < exp - REFRESH_BUFFER_MS;
  };
  const refresh = (): Promise<ScopedCredentials> => {
    if (!inflight) {
      inflight = mintCredentials(connectionId)
        .then((c) => {
          cached = c;
          return c;
        })
        .finally(() => {
          inflight = null;
        });
    }
    return inflight;
  };
  return async () => {
    const c = cached && fresh(cached) ? cached : await refresh();
    return {
      accessKeyId: c.accessKeyId,
      secretAccessKey: c.secretAccessKey,
      sessionToken: c.sessionToken,
      expiration: new Date(c.expiration),
    };
  };
}

export interface BrokerConnectResult {
  connectionId: string;
  status: ConnectionStatus;
  accountId: string;
  alias?: string;
}

/**
 * Request (or reuse) a MailPoppy connection on the local AgentsPoppy broker, and
 * arm the credential provider. Turning this on implies broker mode. The returned
 * connection is usually `pending` — the user approves it in the AgentsPoppy
 * window, then poll {@link refreshBrokerStatus} until it's `active`.
 */
export async function beginBrokerConnect(opts: { accountId?: string } = {}): Promise<BrokerConnectResult> {
  enabled = true;
  const accounts = await api<AccountDTO[]>("/accounts");
  if (accounts.length === 0) {
    throw new Error("AgentsPoppy has no AWS account linked yet — link one in AgentsPoppy first, then connect.");
  }
  const account = opts.accountId
    ? accounts.find((a) => a.id === opts.accountId || a.accountId === opts.accountId)
    : accounts[0];
  if (!account) throw new Error(`AgentsPoppy account "${opts.accountId}" not found`);

  const desired = permissionSet();
  const existing = (await api<ConnectionDTO[]>("/connections")).find(
    (c) => c.app?.id === APP.id && c.accountId === account.id && c.status !== "revoked",
  );
  // The broker stores a connection's scope at creation and never updates it, so a reused
  // connection keeps vending whatever it was first granted. If MailPoppy's declared scope
  // has since changed (e.g. a broker-grant fix shipped), reusing it would silently deploy
  // with the OLD permissions. Detect that drift and supersede the stale connection with a
  // fresh one — which the user re-approves, the correct behaviour for a scope change.
  const stale = !!existing && grantsSignature(existing.permissionSet?.grants) !== grantsSignature(desired.grants);
  if (existing && stale) {
    try {
      await api(`/connections/${encodeURIComponent(existing.id)}`, { method: "DELETE" }); // revoke
    } catch {
      /* best-effort; worst case the user revokes the old connection manually */
    }
  }
  connection =
    existing && !stale
      ? existing
      : await api<ConnectionDTO>("/connections", {
          method: "POST",
          body: { accountId: account.id, app: APP, permissionSet: desired },
        });
  credsProvider = makeProvider(connection.id);
  awsAccountId = account.accountId;
  return { connectionId: connection.id, status: connection.status, accountId: account.accountId, alias: account.alias };
}

export interface BrokerStatus {
  enabled: boolean;
  connected: boolean;
  connectionId?: string;
  status?: ConnectionStatus;
}

/** Re-read the connection's status from the broker (the UI polls this). */
export async function refreshBrokerStatus(): Promise<BrokerStatus> {
  if (!connection) return { enabled, connected: false };
  connection = await api<ConnectionDTO>(`/connections/${encodeURIComponent(connection.id)}`);
  return { enabled, connected: connection.status === "active", connectionId: connection.id, status: connection.status };
}

/** Forget the connection and stop using broker credentials (back to the profile). */
export function disconnectBroker(): void {
  connection = null;
  credsProvider = null;
  awsAccountId = null;
  enabled = /^(1|true|yes|on)$/i.test(process.env.MAILPOPPY_AGENTSPOPPY_BROKER ?? "");
}

/** Test seam: point the vendored client at a fake broker. */
export function __setBrokerBaseUrlForTests(url: string): void {
  baseUrl = url;
}
