import type { SESEvent, SESReceipt } from "aws-lambda";
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, QueryCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
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
// removeUndefinedValues: optional MessageMeta fields (from.name, attachments, …)
// are often undefined; without this the DocumentClient throws on marshalling.
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

const INDEX_TABLE = process.env.INDEX_TABLE ?? "";
const SETTINGS_TABLE = process.env.SETTINGS_TABLE ?? "";
const MAIL_BUCKET = process.env.MAIL_BUCKET ?? "";
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
 * from the settings table. Deployment-wide for now (per-domain override later).
 * Fail-safe: any missing/malformed doc or read error falls back to safe defaults
 * so delivery is never blocked by a settings problem.
 */
async function loadSpamPolicy(): Promise<SpamPolicy> {
  if (!SETTINGS_TABLE) return DEFAULT_POLICY.spam;
  try {
    const out = await ddb.send(new GetCommand({ TableName: SETTINGS_TABLE, Key: { pk: policySettingsKey() } }));
    const json = out.Item?.json;
    if (typeof json !== "string") return DEFAULT_POLICY.spam;
    return normalizeSpamPolicy(JSON.parse(json) as Partial<SpamPolicy>);
  } catch {
    return DEFAULT_POLICY.spam;
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

export async function handler(event: SESEvent): Promise<void> {
  // One deployment-wide policy per invocation (allow/block + verdict actions).
  const policy: DeploymentPolicy = { ...DEFAULT_POLICY, spam: await loadSpamPolicy() };

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
      const key = attachmentS3Key(messageId, i, filename);
      await s3.send(
        new PutObjectCommand({ Bucket: MAIL_BUCKET, Key: key, Body: a.content, ContentType: contentType }),
      );
      attachments.push({ filename, contentType, sizeBytes: a.size ?? a.content?.length ?? 0, s3Key: key });
    }

    const date = (parsed.date ?? new Date()).toISOString();
    const subject = parsed.subject ?? "(no subject)";
    const snippet = (parsed.text ?? "").replace(/\s+/g, " ").trim().slice(0, 140);

    // Fan out: one row per recipient that this deployment actually hosts.
    const recipients = (receipt.recipients ?? []).map(normalizeAddress).filter(isHosted);
    for (const recipient of recipients) {
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
