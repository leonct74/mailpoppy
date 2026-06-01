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
  SendEmailCommand,
} from "@aws-sdk/client-sesv2";
import {
  SESClient,
  CreateReceiptRuleSetCommand,
  CreateReceiptRuleCommand,
  SetActiveReceiptRuleSetCommand,
} from "@aws-sdk/client-ses";
import { S3Client, CreateBucketCommand, PutBucketPolicyCommand } from "@aws-sdk/client-s3";

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
