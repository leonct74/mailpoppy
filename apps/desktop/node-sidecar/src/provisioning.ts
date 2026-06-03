/**
 * Mailpoppy provisioning engine — the TypeScript translation of the validated
 * Phase 0 sequence (see ../../../../phase0-derisk.md, which PASSED live on
 * ollydigital.com / eu-west-1). Runs in the desktop Node sidecar using the
 * admin's AWS credential chain (named profile / SSO). DESKTOP-ADMIN-ONLY —
 * mobile never runs this (DESIGN §6).
 *
 * The eventual production path deploys the *full* backend via a CloudFormation
 * template (cdk synth → cloudformation:CreateStack). These direct calls cover
 * the core mail wiring and the health/verification UX of the Phase 1 wizard.
 */
import { spawnSync } from "node:child_process";
import { fromIni } from "@aws-sdk/credential-providers";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import {
  Route53Client,
  ListHostedZonesByNameCommand,
  ListResourceRecordSetsCommand,
  ChangeResourceRecordSetsCommand,
  type Change,
  type ResourceRecord,
} from "@aws-sdk/client-route-53";
import {
  SESv2Client,
  CreateEmailIdentityCommand,
  GetEmailIdentityCommand,
  ListEmailIdentitiesCommand,
  SendEmailCommand,
} from "@aws-sdk/client-sesv2";
import {
  SESClient,
  CreateReceiptRuleSetCommand,
  CreateReceiptRuleCommand,
  SetActiveReceiptRuleSetCommand,
  DescribeActiveReceiptRuleSetCommand,
} from "@aws-sdk/client-ses";
import {
  S3Client,
  CreateBucketCommand,
  PutBucketPolicyCommand,
  ListBucketsCommand,
  PutObjectCommand,
  HeadBucketCommand,
  type BucketLocationConstraint,
} from "@aws-sdk/client-s3";
import {
  CloudFormationClient,
  DescribeStackResourcesCommand,
  DescribeStacksCommand,
  CreateStackCommand,
  UpdateStackCommand,
  DeleteStackCommand,
  type Capability,
} from "@aws-sdk/client-cloudformation";
import { templateJson, lambdaZipBase64, lambdaCodeKey } from "./generated/backend-bundle";
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  ListUsersCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { record } from "./ledger";

export interface AwsContext {
  region: string;
  profile?: string;
}

function clients(ctx: AwsContext) {
  const credentials = ctx.profile ? fromIni({ profile: ctx.profile }) : undefined;
  const base = { region: ctx.region, credentials };
  return {
    sts: new STSClient(base),
    // Route53 is a global service; pin to us-east-1.
    route53: new Route53Client({ ...base, region: "us-east-1" }),
    sesv2: new SESv2Client(base),
    ses: new SESClient(base),
    s3: new S3Client(base),
    cloudformation: new CloudFormationClient(base),
    cognito: new CognitoIdentityProviderClient(base),
  };
}

/** Read-only: who am I? (phase0 §1) */
export async function getAccountId(ctx: AwsContext): Promise<string> {
  const { sts } = clients(ctx);
  const out = await sts.send(new GetCallerIdentityCommand({}));
  if (!out.Account) throw new Error("Could not resolve AWS account id");
  return out.Account;
}

/** Read-only: find the hosted zone for an apex domain. (phase0 §1) */
export async function findHostedZoneId(ctx: AwsContext, domain: string): Promise<string> {
  const { route53 } = clients(ctx);
  const out = await route53.send(new ListHostedZonesByNameCommand({ DNSName: domain }));
  const zone = out.HostedZones?.find((z) => z.Name === `${domain}.`);
  if (!zone?.Id) throw new Error(`No Route53 hosted zone found for ${domain}`);
  return zone.Id.replace("/hostedzone/", "");
}

/** Step 2: create the SES domain identity; return its 3 DKIM CNAME tokens. */
export async function createIdentityGetDkimTokens(ctx: AwsContext, domain: string): Promise<string[]> {
  const { sesv2 } = clients(ctx);
  try {
    const out = await sesv2.send(new CreateEmailIdentityCommand({ EmailIdentity: domain }));
    await record([
      { action: "created", service: "SES", resourceType: "EmailIdentity", name: domain, region: ctx.region },
    ]);
    return out.DkimAttributes?.Tokens ?? [];
  } catch (e) {
    if ((e as { name?: string }).name === "AlreadyExistsException") {
      const out = await sesv2.send(new GetEmailIdentityCommand({ EmailIdentity: domain }));
      return out.DkimAttributes?.Tokens ?? [];
    }
    throw e;
  }
}

/**
 * Read existing apex TXT values so we MERGE rather than clobber when adding SPF.
 * (Phase 0 gotcha: Route53 UPSERT replaces the whole record set for a name+type.)
 */
async function existingApexTxt(ctx: AwsContext, zoneId: string, domain: string): Promise<string[]> {
  const { route53 } = clients(ctx);
  const out = await route53.send(new ListResourceRecordSetsCommand({ HostedZoneId: zoneId }));
  const set = out.ResourceRecordSets?.find((r) => r.Name === `${domain}.` && r.Type === "TXT");
  return (set?.ResourceRecords ?? []).map((r) => r.Value).filter((v): v is string => !!v);
}

/** Steps 2–6 (DNS): DKIM CNAMEs + MX + SPF (merged) + DMARC. Returns the change id. */
export async function applyDnsRecords(
  ctx: AwsContext,
  opts: { zoneId: string; domain: string; dkimTokens: string[]; dmarcRua: string },
): Promise<string> {
  const { route53 } = clients(ctx);
  const { zoneId, domain, dkimTokens, dmarcRua } = opts;

  const dkim: Change[] = dkimTokens.map((t) => ({
    Action: "UPSERT",
    ResourceRecordSet: {
      Name: `${t}._domainkey.${domain}`,
      Type: "CNAME",
      TTL: 300,
      ResourceRecords: [{ Value: `${t}.dkim.amazonses.com` }],
    },
  }));

  const existing = await existingApexTxt(ctx, zoneId, domain);
  const txtRecords: ResourceRecord[] = [
    ...existing.filter((v) => !v.includes("v=spf1")).map((Value) => ({ Value })),
    { Value: `"v=spf1 include:amazonses.com ~all"` },
  ];

  const changes: Change[] = [
    ...dkim,
    {
      Action: "UPSERT",
      ResourceRecordSet: {
        Name: domain,
        Type: "MX",
        TTL: 300,
        ResourceRecords: [{ Value: `10 inbound-smtp.${ctx.region}.amazonaws.com` }],
      },
    },
    {
      Action: "UPSERT",
      ResourceRecordSet: { Name: domain, Type: "TXT", TTL: 300, ResourceRecords: txtRecords },
    },
    {
      Action: "UPSERT",
      ResourceRecordSet: {
        Name: `_dmarc.${domain}`,
        Type: "TXT",
        TTL: 300,
        ResourceRecords: [{ Value: `"v=DMARC1; p=none; rua=mailto:${dmarcRua}"` }],
      },
    },
  ];

  const out = await route53.send(
    new ChangeResourceRecordSetsCommand({
      HostedZoneId: zoneId,
      ChangeBatch: { Comment: "Mailpoppy provisioning", Changes: changes },
    }),
  );

  // Record each DNS record we wrote (these live outside the CloudFormation stack).
  await record(
    changes.map((ch) => ({
      action: "created" as const,
      service: "Route53",
      resourceType: `${ch.ResourceRecordSet?.Type} record`,
      name: ch.ResourceRecordSet?.Name ?? domain,
      region: ctx.region,
      detail: `zone ${zoneId}`,
    })),
  );
  return out.ChangeInfo?.Id ?? "";
}

/** Step 3: S3 bucket + policy that lets SES write received mail. */
export async function createMailBucket(
  ctx: AwsContext,
  opts: { bucket: string; accountId: string },
): Promise<void> {
  const { s3 } = clients(ctx);
  const { bucket, accountId } = opts;
  await s3.send(
    new CreateBucketCommand({
      Bucket: bucket,
      ...(ctx.region === "us-east-1"
        ? {}
        : { CreateBucketConfiguration: { LocationConstraint: ctx.region as never } }),
    }),
  );
  const policy = {
    Version: "2012-10-17",
    Statement: [
      {
        Sid: "AllowSESPuts",
        Effect: "Allow",
        Principal: { Service: "ses.amazonaws.com" },
        Action: "s3:PutObject",
        Resource: `arn:aws:s3:::${bucket}/*`,
        Condition: {
          StringEquals: { "aws:SourceAccount": accountId },
          StringLike: { "aws:SourceArn": `arn:aws:ses:${ctx.region}:${accountId}:receipt-rule-set/*` },
        },
      },
    ],
  };
  await s3.send(new PutBucketPolicyCommand({ Bucket: bucket, Policy: JSON.stringify(policy) }));
  await record([
    { action: "created", service: "S3", resourceType: "Bucket", name: bucket, region: ctx.region },
  ]);
}

/** Step 4: receipt rule set + rule (store to S3) + activate. */
export async function createReceiptPipeline(
  ctx: AwsContext,
  opts: { ruleSet: string; domain: string; bucket: string; prefix?: string },
): Promise<void> {
  const { ses } = clients(ctx);
  const { ruleSet, domain, bucket, prefix = "inbound/" } = opts;
  await ses.send(new CreateReceiptRuleSetCommand({ RuleSetName: ruleSet }));
  await ses.send(
    new CreateReceiptRuleCommand({
      RuleSetName: ruleSet,
      Rule: {
        Name: "store-to-s3",
        Enabled: true,
        Recipients: [domain],
        ScanEnabled: true,
        Actions: [{ S3Action: { BucketName: bucket, ObjectKeyPrefix: prefix } }],
      },
    }),
  );
  await ses.send(new SetActiveReceiptRuleSetCommand({ RuleSetName: ruleSet }));
  await record([
    { action: "created", service: "SES", resourceType: "ReceiptRuleSet", name: ruleSet, region: ctx.region },
    { action: "created", service: "SES", resourceType: "ActiveReceiptRuleSet", name: ruleSet, region: ctx.region, detail: "set active" },
  ]);
}

// ---- Resource inventory (DESIGN §14.1 — transparency) ----

export interface StackResource {
  logicalId: string;
  physicalId: string;
  type: string; // CloudFormation type, e.g. "AWS::Lambda::Function"
  status: string;
}

/**
 * The authoritative inventory of everything in the deployed backend stack, read
 * straight from CloudFormation (no drift — the app cannot hide a stack resource).
 * Returns stackExists=false (not an error) when the stack hasn't been deployed.
 */
export async function listStackResources(
  ctx: AwsContext,
  stackName: string,
): Promise<{ stackExists: boolean; resources: StackResource[] }> {
  const { cloudformation } = clients(ctx);
  try {
    const out = await cloudformation.send(new DescribeStackResourcesCommand({ StackName: stackName }));
    const resources = (out.StackResources ?? []).map((r) => ({
      logicalId: r.LogicalResourceId ?? "",
      physicalId: r.PhysicalResourceId ?? "",
      type: r.ResourceType ?? "",
      status: r.ResourceStatus ?? "",
    }));
    return { stackExists: true, resources };
  } catch (e) {
    if (/does not exist|ValidationError/i.test((e as Error).message ?? "")) {
      return { stackExists: false, resources: [] };
    }
    throw e;
  }
}

/**
 * Read the deployed stack's CloudFormation Outputs as a key→value map (e.g.
 * `MailBucketName`, `IndexTableName`, `ApiBaseUrl`). Used to resolve the data
 * resources a migration needs to write into, without the desktop having to
 * persist them separately.
 */
export async function getStackOutputs(
  ctx: AwsContext,
  stackName: string,
): Promise<Record<string, string>> {
  const { cloudformation } = clients(ctx);
  const out = await cloudformation.send(new DescribeStacksCommand({ StackName: stackName }));
  const outputs = out.Stacks?.[0]?.Outputs ?? [];
  const map: Record<string, string> = {};
  for (const o of outputs) {
    if (o.OutputKey) map[o.OutputKey] = o.OutputValue ?? "";
  }
  return map;
}

// ---- One-click backend deploy (CloudFormation, no cdk/bootstrap at runtime) ----

/** Current stack status, or null if the stack doesn't exist. */
async function stackStatus(ctx: AwsContext, stackName: string): Promise<string | null> {
  const { cloudformation } = clients(ctx);
  try {
    const out = await cloudformation.send(new DescribeStacksCommand({ StackName: stackName }));
    return out.Stacks?.[0]?.StackStatus ?? null;
  } catch (e) {
    if (/does not exist|ValidationError/i.test((e as Error).message ?? "")) return null;
    throw e;
  }
}

export interface DeployResult {
  ok: true;
  stackName: string;
  operation: "CREATE" | "UPDATE" | "NO_CHANGE" | "RECREATE";
  bucket: string;
  region: string;
}

/**
 * Deploy (or update) the backend stack into the admin's account WITHOUT cdk: we
 * upload the embedded asset-free template + prebuilt Lambda zip to a per-account
 * deploy bucket, then CloudFormation Create/UpdateStack referencing them. The
 * receipt rule set is activated separately (see getDeployStatus) once the stack
 * is up. Returns immediately; poll getDeployStatus for completion.
 */
export async function deployBackend(
  ctx: AwsContext,
  args: { domain: string; stackName?: string },
): Promise<DeployResult> {
  const { s3, cloudformation } = clients(ctx);
  const region = ctx.region;
  const stackName = args.stackName ?? "MailpoppyMailStack";
  const domain = args.domain.trim().toLowerCase();
  const accountId = await getAccountId(ctx);
  const bucket = `mailpoppy-deploy-${accountId}-${region}`;

  // Ensure the deploy bucket exists (holds the template + Lambda code).
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    await s3.send(
      new CreateBucketCommand({
        Bucket: bucket,
        ...(region !== "us-east-1"
          ? { CreateBucketConfiguration: { LocationConstraint: region as BucketLocationConstraint } }
          : {}),
      }),
    );
  }

  // Upload artifacts (code key is content-addressed → idempotent).
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: lambdaCodeKey, Body: Buffer.from(lambdaZipBase64, "base64") }));
  const templateKey = `templates/${stackName}.template.json`;
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: templateKey, Body: templateJson, ContentType: "application/json" }));
  const templateUrl = `https://${bucket}.s3.${region}.amazonaws.com/${templateKey}`;

  const Parameters = [
    { ParameterKey: "MailDomain", ParameterValue: domain },
    { ParameterKey: "LambdaCodeBucket", ParameterValue: bucket },
    { ParameterKey: "LambdaCodeKey", ParameterValue: lambdaCodeKey },
  ];
  const Capabilities: Capability[] = ["CAPABILITY_IAM", "CAPABILITY_NAMED_IAM", "CAPABILITY_AUTO_EXPAND"];

  let status = await stackStatus(ctx, stackName);
  let operation: DeployResult["operation"];

  // A previous failed create leaves ROLLBACK_COMPLETE — it can't be updated, so
  // delete it first, then create fresh.
  if (status === "ROLLBACK_COMPLETE" || status === "REVIEW_IN_PROGRESS") {
    await cloudformation.send(new DeleteStackCommand({ StackName: stackName }));
    status = null;
    operation = "RECREATE";
    await cloudformation.send(
      new CreateStackCommand({ StackName: stackName, TemplateURL: templateUrl, Parameters, Capabilities }),
    );
  } else if (status) {
    try {
      await cloudformation.send(
        new UpdateStackCommand({ StackName: stackName, TemplateURL: templateUrl, Parameters, Capabilities }),
      );
      operation = "UPDATE";
    } catch (e) {
      if (/No updates are to be performed/i.test((e as Error).message ?? "")) operation = "NO_CHANGE";
      else throw e;
    }
  } else {
    await cloudformation.send(
      new CreateStackCommand({ StackName: stackName, TemplateURL: templateUrl, Parameters, Capabilities }),
    );
    operation = "CREATE";
  }

  await record([
    {
      action: "created",
      service: "CloudFormation",
      resourceType: "Stack",
      name: stackName,
      region,
      detail: `backend ${operation} for ${domain}`,
    },
  ]);

  return { ok: true, stackName, operation, bucket, region };
}

export interface DeployStatus {
  status: string; // CloudFormation StackStatus, or "NOT_FOUND"
  complete: boolean;
  failed: boolean;
  reason?: string;
  outputs?: Record<string, string>;
}

/**
 * Poll the deploy. When the stack reaches a *_COMPLETE state we also activate its
 * SES receipt rule set (idempotent) so inbound mail starts flowing — this is the
 * step that replaces the in-stack custom resource.
 */
export async function getDeployStatus(ctx: AwsContext, stackName: string): Promise<DeployStatus> {
  const { cloudformation, ses } = clients(ctx);
  let stack;
  try {
    const out = await cloudformation.send(new DescribeStacksCommand({ StackName: stackName }));
    stack = out.Stacks?.[0];
  } catch (e) {
    if (/does not exist|ValidationError/i.test((e as Error).message ?? "")) {
      return { status: "NOT_FOUND", complete: false, failed: false };
    }
    throw e;
  }

  const status = stack?.StackStatus ?? "UNKNOWN";
  const outputs: Record<string, string> = {};
  for (const o of stack?.Outputs ?? []) if (o.OutputKey) outputs[o.OutputKey] = o.OutputValue ?? "";

  const complete = /_COMPLETE$/.test(status) && !status.startsWith("DELETE") && !status.includes("ROLLBACK");
  const failed = /FAILED/.test(status) || status === "ROLLBACK_COMPLETE";

  if (complete && outputs.RuleSetName) {
    // Only one receipt rule set can be active per account/region — make ours it.
    try {
      await ses.send(new SetActiveReceiptRuleSetCommand({ RuleSetName: outputs.RuleSetName }));
    } catch {
      // best-effort; the wizard's domain step also confirms inbound works
    }
  }

  return { status, complete, failed, reason: stack?.StackStatusReason, outputs };
}

// ---- Mailboxes (Cognito users in the deployed backend's user pool) ----

export interface MailboxInfo {
  email: string;
  status: string;
  createdAt?: string;
}

/**
 * Create a mailbox = a confirmed Cognito user in the backend's user pool, with a
 * permanent password (no forced reset) so the desktop/mobile client can sign in
 * immediately. Idempotent-ish: re-creating an existing user just resets the
 * password. `email` is normalized to lowercase.
 */
export async function createMailbox(
  ctx: AwsContext,
  args: { userPoolId: string; email: string; password: string },
): Promise<MailboxInfo> {
  const { cognito } = clients(ctx);
  const email = args.email.trim().toLowerCase();
  try {
    await cognito.send(
      new AdminCreateUserCommand({
        UserPoolId: args.userPoolId,
        Username: email,
        MessageAction: "SUPPRESS", // no invite email; the admin sets the password here
        UserAttributes: [
          { Name: "email", Value: email },
          { Name: "email_verified", Value: "true" },
        ],
      }),
    );
  } catch (e) {
    // If the user already exists we still (re)set the password below.
    if (!/UsernameExistsException/i.test((e as Error).name ?? "")) throw e;
  }
  await cognito.send(
    new AdminSetUserPasswordCommand({
      UserPoolId: args.userPoolId,
      Username: email,
      Password: args.password,
      Permanent: true,
    }),
  );
  return { email, status: "CONFIRMED" };
}

/** List the mailboxes (users) in the backend's user pool. */
export async function listMailboxes(ctx: AwsContext, userPoolId: string): Promise<MailboxInfo[]> {
  const { cognito } = clients(ctx);
  const out = await cognito.send(new ListUsersCommand({ UserPoolId: userPoolId, Limit: 60 }));
  return (out.Users ?? []).map((u) => ({
    email: u.Attributes?.find((a) => a.Name === "email")?.Value ?? u.Username ?? "",
    status: u.UserStatus ?? "",
    createdAt: u.UserCreateDate?.toISOString(),
  }));
}

/** Poll DKIM/identity verification (the gate before sending). */
export async function getIdentityStatus(
  ctx: AwsContext,
  domain: string,
): Promise<{ verifiedForSending: boolean; dkim: string }> {
  const { sesv2 } = clients(ctx);
  const out = await sesv2.send(new GetEmailIdentityCommand({ EmailIdentity: domain }));
  return {
    verifiedForSending: !!out.VerifiedForSendingStatus,
    dkim: out.DkimAttributes?.Status ?? "UNKNOWN",
  };
}

/** Step 7: send a deliverability test (used by the wizard's "verify" step). */
export async function sendTest(
  ctx: AwsContext,
  opts: { from: string; to: string; subject: string; html: string; text: string },
): Promise<string> {
  const { sesv2 } = clients(ctx);
  const out = await sesv2.send(
    new SendEmailCommand({
      FromEmailAddress: opts.from,
      Destination: { ToAddresses: [opts.to] },
      Content: { Simple: { Subject: { Data: opts.subject }, Body: { Text: { Data: opts.text }, Html: { Data: opts.html } } } },
    }),
  );
  return out.MessageId ?? "";
}

// ---- Environment readiness (run BEFORE provisioning, so setup never fails midway) ----

export interface Readiness {
  cli: { installed: boolean; version?: string };
  credentials: { ok: boolean; arn?: string; account?: string; error?: string };
  permissions: Record<"route53" | "ses" | "sesv2" | "s3", "ok" | "denied" | "error">;
  ready: boolean;
}

/** Detect the AWS CLI. Optional — the SDK reads ~/.aws directly — but it sharpens guidance. */
function detectCli(): { installed: boolean; version?: string } {
  try {
    const r = spawnSync("aws", ["--version"], { encoding: "utf8" });
    if (r.error) return { installed: false };
    const line = (r.stdout || r.stderr || "").trim().split("\n")[0] ?? "";
    return { installed: true, version: line || undefined };
  } catch {
    return { installed: false };
  }
}

function classifyError(e: unknown): "denied" | "error" {
  const name = (e as { name?: string }).name ?? "";
  return /AccessDenied|UnauthorizedOperation|NotAuthorized/i.test(name) ? "denied" : "error";
}

async function probe(send: Promise<unknown>): Promise<"ok" | "denied" | "error"> {
  try {
    await send;
    return "ok";
  } catch (e) {
    return classifyError(e);
  }
}

/**
 * Confirms the admin's environment can actually provision: credentials resolve and the
 * identity can reach each required service. Surfaces a clear "what to fix" instead of
 * failing partway through provisioning. (Read probes are a strong proxy; a full
 * write-permission check via iam:SimulatePrincipalPolicy is a later enhancement.)
 */
export async function checkReadiness(ctx: AwsContext): Promise<Readiness> {
  const cli = detectCli();
  const c = clients(ctx);

  const credentials: Readiness["credentials"] = { ok: false };
  try {
    const id = await c.sts.send(new GetCallerIdentityCommand({}));
    credentials.ok = true;
    credentials.arn = id.Arn;
    credentials.account = id.Account;
  } catch (e) {
    credentials.error = (e as Error).message ?? String(e);
  }

  const permissions: Readiness["permissions"] = credentials.ok
    ? {
        route53: await probe(c.route53.send(new ListHostedZonesByNameCommand({ MaxItems: 1 }))),
        ses: await probe(c.ses.send(new DescribeActiveReceiptRuleSetCommand({}))),
        sesv2: await probe(c.sesv2.send(new ListEmailIdentitiesCommand({ PageSize: 1 }))),
        s3: await probe(c.s3.send(new ListBucketsCommand({}))),
      }
    : { route53: "error", ses: "error", sesv2: "error", s3: "error" };

  const ready = credentials.ok && Object.values(permissions).every((v) => v === "ok");
  return { cli, credentials, permissions, ready };
}
