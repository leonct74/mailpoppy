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
}
interface AccountDTO {
  id: string;
  accountId: string;
  alias?: string;
  regions: string[];
}

/** How MailPoppy introduces itself to AgentsPoppy. */
const APP = { id: "com.mailpoppy.desktop", name: "MailPoppy" } as const;

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
 */
function permissionSet() {
  const grant = (service: string, actions: string[], resourceScope = "*") => ({ service, actions, resourceScope });
  const stack = "arn:aws:cloudformation:*:*:stack/MailpoppyMailStack/*";
  const role = "arn:aws:iam::*:role/MailpoppyMailStack-*";
  const fn = "arn:aws:lambda:*:*:function:MailpoppyMailStack-*";
  const table = "arn:aws:dynamodb:*:*:table/MailpoppyMailStack-*";
  const logs = "arn:aws:logs:*:*:log-group:/aws/lambda/MailpoppyMailStack-*";
  const topic = "arn:aws:sns:*:*:MailpoppyMailStack-*";
  const rule = "arn:aws:events:*:*:rule/MailpoppyMailStack-*";
  const apis = "arn:aws:apigateway:*::/apis*";
  const buckets = "arn:aws:s3:::mailpoppy*";
  const objects = "arn:aws:s3:::mailpoppy*/*";
  const userPool = "arn:aws:cognito-idp:*:*:userpool/*";
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
      grant("apigateway", ["POST", "GET", "PATCH", "PUT", "DELETE", "TagResource", "UntagResource"], apis),
      // --- S3: only mailpoppy* buckets/objects (+ read-only bucket listing) ---
      grant("s3", [
        "CreateBucket", "DeleteBucket", "PutBucketPolicy", "GetBucketPolicy", "DeleteBucketPolicy",
        "PutEncryptionConfiguration", "GetEncryptionConfiguration", "PutBucketPublicAccessBlock",
        "GetBucketPublicAccessBlock", "PutBucketTagging", "PutLifecycleConfiguration",
        "GetLifecycleConfiguration", "PutBucketCORS", "GetBucketCORS", "ListBucket", "HeadBucket",
      ], buckets),
      grant("s3", ["GetObject", "PutObject", "DeleteObject"], objects),
      grant("s3", ["ListAllMyBuckets"]),
      // --- Cognito: pool lifecycle is account-wide (CreateUserPool can't be scoped);
      //     per-user mailbox admin is pinned to user pools ---
      grant("cognito-idp", [
        "CreateUserPool", "DeleteUserPool", "UpdateUserPool", "DescribeUserPool", "CreateUserPoolClient",
        "DeleteUserPoolClient", "UpdateUserPoolClient", "DescribeUserPoolClient", "SetUserPoolMfaConfig",
        "GetUserPoolMfaConfig", "TagResource", "UntagResource",
      ]),
      grant("cognito-idp", ["AdminCreateUser", "AdminSetUserPassword", "AdminDeleteUser", "ListUsers"], userPool),
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

// --- module state (the sidecar is a single long-lived process) ---

let baseUrl = process.env.AGENTSPOPPY_BASE_URL ?? DEFAULT_BASE_URL;
let enabled = /^(1|true|yes|on)$/i.test(process.env.MAILPOPPY_AGENTSPOPPY_BROKER ?? "");
let connection: ConnectionDTO | null = null;
let credsProvider: AwsCredentialIdentityProvider | null = null;

export function isBrokerEnabled(): boolean {
  return enabled;
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
  return enabled && connection?.status === "active" && credsProvider ? credsProvider : undefined;
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

function makeProvider(connectionId: string): AwsCredentialIdentityProvider {
  let cached: ScopedCredentials | null = null;
  let inflight: Promise<ScopedCredentials> | null = null;
  const fresh = (c: ScopedCredentials): boolean => {
    const exp = Date.parse(c.expiration);
    return Number.isFinite(exp) && Date.now() < exp - REFRESH_BUFFER_MS;
  };
  const refresh = (): Promise<ScopedCredentials> => {
    if (!inflight) {
      inflight = api<ScopedCredentials>(`/connections/${encodeURIComponent(connectionId)}/credentials`, { method: "POST" })
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

  const existing = (await api<ConnectionDTO[]>("/connections")).find(
    (c) => c.app?.id === APP.id && c.accountId === account.id && c.status !== "revoked",
  );
  connection =
    existing ??
    (await api<ConnectionDTO>("/connections", {
      method: "POST",
      body: { accountId: account.id, app: APP, permissionSet: permissionSet() },
    }));
  credsProvider = makeProvider(connection.id);
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
  enabled = /^(1|true|yes|on)$/i.test(process.env.MAILPOPPY_AGENTSPOPPY_BROKER ?? "");
}

/** Test seam: point the vendored client at a fake broker. */
export function __setBrokerBaseUrlForTests(url: string): void {
  baseUrl = url;
}
