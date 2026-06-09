import type { SESEvent, SESReceipt } from "aws-lambda";
import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, QueryCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { CognitoIdentityProviderClient, ListUsersCommand } from "@aws-sdk/client-cognito-identity-provider";
import { simpleParser, type AddressObject } from "mailparser";
import {
  type MessageMeta,
  type AuthVerdicts,
  type EmailAddress,
  type AttachmentMeta,
  type DeploymentPolicy,
  type SpamPolicy,
  DEFAULT_POLICY,
  mailboxPk,
  messageSk,
  deriveThreadId,
  mapVerdict,
  classifyDelivery,
  normalizeAddress,
  addressDomain,
  attachmentS3Key,
  resolveContentType,
  quotaSettingsKey,
  wouldExceedQuota,
  policySettingsKey,
  normalizeSpamPolicy,
  isKnownMailbox,
} from "@mailpoppy/core";

/**
 * Triggered by an SES receipt rule (Lambda action) AFTER the S3 action has
 * written the raw .eml to the mail bucket under `inbound/<messageId>`. This is
 * where raw S3 objects become an inbox: we read SES's verdicts + recipients from
 * the event, parse the MIME body for display metadata, apply the spam/auth
 * policy, and write one "mailbox state" row per local recipient to DynamoDB.
 * See DESIGN §8 / §9.1.
 */
const s3 = new S3Client({});
const ses = new SESv2Client({});
const cognito = new CognitoIdentityProviderClient({});
// removeUndefinedValues: optional MessageMeta fields (from.name, attachments, …)
// are often undefined; without this the DocumentClient throws on marshalling.
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

const INDEX_TABLE = process.env.INDEX_TABLE ?? "";
const SETTINGS_TABLE = process.env.SETTINGS_TABLE ?? "";
const MAIL_BUCKET = process.env.MAIL_BUCKET ?? "";
const USER_POOL_ID = process.env.USER_POOL_ID ?? "";
const INBOUND_PREFIX = process.env.INBOUND_PREFIX ?? "inbound/";
/** Domains this deployment hosts; mail to other recipients is ignored. Empty = accept all. */
const HOSTED_DOMAINS = (process.env.HOSTED_DOMAINS ?? "")
  .split(",")
  .map((d) => d.trim().toLowerCase())
  .filter(Boolean);

function verdictsFrom(receipt: SESReceipt): AuthVerdicts {
  return {
    spam: mapVerdict(receipt.spamVerdict?.status),
    virus: mapVerdict(receipt.virusVerdict?.status),
    spf: mapVerdict(receipt.spfVerdict?.status),
    dkim: mapVerdict(receipt.dkimVerdict?.status),
    dmarc: mapVerdict(receipt.dmarcVerdict?.status),
  };
}

function firstFrom(parsedFrom: AddressObject | AddressObject[] | undefined): EmailAddress {
  const obj = Array.isArray(parsedFrom) ? parsedFrom[0] : parsedFrom;
  const v = obj?.value?.[0];
  return { name: v?.name || undefined, address: normalizeAddress(v?.address) };
}

function toList(to: AddressObject | AddressObject[] | undefined): EmailAddress[] {
  if (!to) return [];
  const objs = Array.isArray(to) ? to : [to];
  return objs.flatMap((o) =>
    (o.value ?? []).map((v) => ({ name: v.name || undefined, address: normalizeAddress(v.address) })),
  );
}

function isHosted(recipient: string): boolean {
  if (HOSTED_DOMAINS.length === 0) return true;
  return HOSTED_DOMAINS.includes(addressDomain(recipient));
}

/**
 * Load the admin's spam/auth policy (allow/block lists + per-verdict actions)
 * for a given scope (a recipient domain, or "default" for the deployment-wide
 * policy). Returns null if there's no doc for that scope. Fail-safe: any
 * malformed doc or read error is treated as "no doc" so the caller can fall back.
 */
async function loadSpamPolicyScoped(scope: string): Promise<SpamPolicy | null> {
  if (!SETTINGS_TABLE) return null;
  try {
    const out = await ddb.send(new GetCommand({ TableName: SETTINGS_TABLE, Key: { pk: policySettingsKey(scope) } }));
    const json = out.Item?.json;
    if (typeof json !== "string") return null;
    return normalizeSpamPolicy(JSON.parse(json) as Partial<SpamPolicy>);
  } catch {
    return null;
  }
}

/** A mailbox's storage quota in bytes, or null if none is set. */
async function quotaFor(address: string): Promise<number | null> {
  if (!SETTINGS_TABLE) return null;
  try {
    const out = await ddb.send(new GetCommand({ TableName: SETTINGS_TABLE, Key: { pk: quotaSettingsKey(address) } }));
    const v = out.Item?.quotaBytes;
    return typeof v === "number" && v > 0 ? v : null;
  } catch {
    return null; // never block delivery on a settings read error
  }
}

/** Current storage used by a mailbox = sum of sizeBytes across its rows. */
async function mailboxUsage(pk: string): Promise<number> {
  let used = 0;
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const out = await ddb.send(
      new QueryCommand({
        TableName: INDEX_TABLE,
        KeyConditionExpression: "pk = :pk",
        ExpressionAttributeValues: { ":pk": pk },
        ProjectionExpression: "sizeBytes",
        ExclusiveStartKey,
      }),
    );
    for (const item of out.Items ?? []) used += Number(item.sizeBytes ?? 0);
    ExclusiveStartKey = out.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (ExclusiveStartKey);
  return used;
}

/** A bounce shouldn't itself trigger a bounce — skip system/empty senders. */
function isSystemSender(address: string): boolean {
  if (!address) return true;
  const local = address.split("@")[0] ?? "";
  return /^(mailer-daemon|postmaster|no-?reply|bounce|abuse)$/i.test(local);
}

/** Notify the original sender that the mailbox is full (a simple NDR). */
async function sendQuotaBounce(recipient: string, sender: string, subject: string): Promise<void> {
  if (isSystemSender(sender)) return;
  const from = `mailer-daemon@${addressDomain(recipient)}`;
  try {
    await ses.send(
      new SendEmailCommand({
        FromEmailAddress: from,
        Destination: { ToAddresses: [sender] },
        Content: {
          Simple: {
            Subject: { Data: `Undeliverable: ${subject}`, Charset: "UTF-8" },
            Body: {
              Text: {
                Data: `Your message to ${recipient} could not be delivered because the mailbox is full and has reached its storage limit. Please try again later, or contact the recipient by another means.`,
                Charset: "UTF-8",
              },
            },
          },
        },
      }),
    );
  } catch (e) {
    console.error(`failed to send quota bounce to ${sender}:`, e);
  }
}

// Cache the mailbox set briefly across warm invocations (a freshly-created
// mailbox becomes deliverable within this TTL).
let mailboxCache: { at: number; set: Set<string> } | null = null;
const MAILBOX_TTL_MS = 60_000;

/** The set of real mailbox addresses (Cognito users). Empty set if it can't be read. */
async function loadMailboxAddresses(): Promise<Set<string>> {
  if (!USER_POOL_ID) return new Set();
  if (mailboxCache && Date.now() - mailboxCache.at < MAILBOX_TTL_MS) return mailboxCache.set;
  const set = new Set<string>();
  try {
    let PaginationToken: string | undefined;
    do {
      const out = await cognito.send(new ListUsersCommand({ UserPoolId: USER_POOL_ID, Limit: 60, PaginationToken }));
      for (const u of out.Users ?? []) {
        const email = u.Attributes?.find((a) => a.Name === "email")?.Value ?? u.Username;
        if (email) set.add(normalizeAddress(email));
      }
      PaginationToken = out.PaginationToken;
    } while (PaginationToken);
    mailboxCache = { at: Date.now(), set };
  } catch (e) {
    console.error("failed to list mailboxes (treating none as known):", e);
  }
  return set;
}

/**
 * Only bounce to a sender we can trust (passed SPF, DKIM, or DMARC). Spam to
 * random addresses usually has a forged From; bouncing it would send backscatter
 * to an innocent third party and harm our domain's reputation, so we drop it
 * silently instead.
 */
function senderAuthenticated(v: AuthVerdicts): boolean {
  return v.spf === "PASS" || v.dkim === "PASS" || v.dmarc === "PASS";
}

/** Notify the sender that the recipient address doesn't exist (a simple NDR). */
async function sendUnknownRecipientBounce(recipient: string, sender: string, subject: string): Promise<void> {
  if (isSystemSender(sender)) return;
  const from = `mailer-daemon@${addressDomain(recipient)}`;
  try {
    await ses.send(
      new SendEmailCommand({
        FromEmailAddress: from,
        Destination: { ToAddresses: [sender] },
        Content: {
          Simple: {
            Subject: { Data: `Undeliverable: ${subject}`, Charset: "UTF-8" },
            Body: {
              Text: {
                Data: `Your message to ${recipient} could not be delivered because that mailbox does not exist. Please check the address and try again.`,
                Charset: "UTF-8",
              },
            },
          },
        },
      }),
    );
  } catch (e) {
    console.error(`failed to send unknown-recipient bounce to ${sender}:`, e);
  }
}

export async function handler(event: SESEvent): Promise<void> {
  // Per-domain spam/auth policy, resolved on demand with a fallback chain:
  //   policy#<recipientDomain> → policy#default → built-in safe default.
  // Cached per invocation so each domain's doc is read at most once.
  const defaultSpamPolicy = (await loadSpamPolicyScoped("default")) ?? DEFAULT_POLICY.spam;
  const policyByDomain = new Map<string, DeploymentPolicy>([
    ["default", { ...DEFAULT_POLICY, spam: defaultSpamPolicy }],
  ]);
  async function policyForDomain(domain: string): Promise<DeploymentPolicy> {
    const key = (domain || "default").toLowerCase();
    const hit = policyByDomain.get(key);
    if (hit) return hit;
    const spam = (await loadSpamPolicyScoped(key)) ?? defaultSpamPolicy;
    const resolved: DeploymentPolicy = { ...DEFAULT_POLICY, spam };
    policyByDomain.set(key, resolved);
    return resolved;
  }
  // The real mailboxes (Cognito users). Mail to anything else is rejected.
  const knownMailboxes = await loadMailboxAddresses();

  for (const rec of event.Records) {
    const { mail, receipt } = rec.ses;
    const messageId = mail.messageId;
    const key = `${INBOUND_PREFIX}${messageId}`;

    const obj = await s3.send(new GetObjectCommand({ Bucket: MAIL_BUCKET, Key: key }));
    const raw = await obj.Body!.transformToString();
    const sizeBytes = obj.ContentLength ?? Buffer.byteLength(raw);
    const parsed = await simpleParser(raw);

    const verdicts = verdictsFrom(receipt);
    const from = firstFrom(parsed.from);
    const to = toList(parsed.to);
    const threadId =
      deriveThreadId({
        references: parsed.references ?? null,
        inReplyTo: parsed.inReplyTo ?? null,
        messageId: parsed.messageId ?? messageId,
      }) || messageId;

    const date = (parsed.date ?? new Date()).toISOString();
    const subject = parsed.subject ?? "(no subject)";
    const snippet = (parsed.text ?? "").replace(/\s+/g, " ").trim().slice(0, 140);

    // Which hosted recipients are real mailboxes? If the mailbox list couldn't be
    // read (empty set), fall back to delivering to all hosted recipients — never
    // reject mail because of a transient lookup failure.
    const hosted = (receipt.recipients ?? []).map(normalizeAddress).filter(isHosted);
    const enforceKnown = knownMailboxes.size > 0;
    const known = enforceKnown ? hosted.filter((r) => isKnownMailbox(r, knownMailboxes)) : hosted;
    const unknown = enforceKnown ? hosted.filter((r) => !isKnownMailbox(r, knownMailboxes)) : [];

    // Mail addressed only to non-existent mailboxes: store nothing (no DynamoDB
    // row), DELETE the raw object SES wrote to S3, and bounce a genuine sender.
    // Forged spam (failed auth) is dropped silently to avoid backscatter.
    if (known.length === 0) {
      for (const r of unknown) {
        console.log(`reject ${messageId} -> ${r}: no-such-mailbox`);
        if (senderAuthenticated(verdicts)) await sendUnknownRecipientBounce(r, from.address, subject);
      }
      await s3
        .send(new DeleteObjectCommand({ Bucket: MAIL_BUCKET, Key: key }))
        .catch((e) => console.error(`failed to delete unstored inbound object ${key}:`, e));
      continue;
    }

    // Extract each attachment to its own S3 object so the client can download it
    // on demand (one copy per message, shared across recipients).
    const attachments: AttachmentMeta[] = [];
    const parsedAttachments = parsed.attachments ?? [];
    for (let i = 0; i < parsedAttachments.length; i++) {
      const a = parsedAttachments[i]!;
      const filename = a.filename ?? `attachment-${i}`;
      // Some senders attach files as application/octet-stream; infer a real type
      // from the extension so the client can preview/open it.
      const contentType = resolveContentType(a.contentType, filename);
      const aKey = attachmentS3Key(messageId, i, filename);
      await s3.send(
        new PutObjectCommand({ Bucket: MAIL_BUCKET, Key: aKey, Body: a.content, ContentType: contentType }),
      );
      attachments.push({ filename, contentType, sizeBytes: a.size ?? a.content?.length ?? 0, s3Key: aKey });
    }

    // Deliver to each real recipient (apply spam/auth policy + storage quota).
    for (const recipient of known) {
      // Use this recipient's domain policy (falls back to the deployment default).
      const policy = await policyForDomain(addressDomain(recipient));
      const decision = classifyDelivery(from.address, verdicts, policy);
      if (decision.folder === null) {
        // Rejected by policy (virus/spam/block-list). Raw object is left in S3
        // for audit; the janitor sweeps unindexed inbound objects later.
        console.log(`drop ${messageId} -> ${recipient}: ${decision.reason}`);
        continue;
      }

      // Enforce the mailbox storage quota: if this message would push the mailbox
      // over its limit, don't store it and bounce a "mailbox full" notice to the
      // sender (skipped when no quota is set).
      const quota = await quotaFor(recipient);
      if (quota !== null) {
        const used = await mailboxUsage(mailboxPk(recipient));
        if (wouldExceedQuota(used, sizeBytes, quota)) {
          console.log(`quota-full ${messageId} -> ${recipient}: used=${used} +${sizeBytes} > ${quota}`);
          await sendQuotaBounce(recipient, from.address, subject);
          continue;
        }
      }

      const meta: MessageMeta = {
        domain: addressDomain(recipient),
        mailbox: recipient,
        messageId,
        threadId,
        folder: decision.folder,
        from,
        to,
        subject,
        snippet,
        date,
        flags: { unread: true },
        hasAttachments: attachments.length > 0,
        attachments: attachments.length > 0 ? attachments : undefined,
        verdicts,
        s3Key: key,
        sizeBytes,
      };

      await ddb.send(
        new PutCommand({
          TableName: INDEX_TABLE,
          Item: { pk: mailboxPk(recipient), sk: messageSk(decision.folder, date, messageId), ...meta },
        }),
      );
    }
  }
}
