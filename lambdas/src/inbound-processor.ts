import type { SESEvent, SESReceipt } from "aws-lambda";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { simpleParser, type AddressObject } from "mailparser";
import {
  type MessageMeta,
  type AuthVerdicts,
  type EmailAddress,
  type AttachmentMeta,
  type DeploymentPolicy,
  DEFAULT_POLICY,
  mailboxPk,
  messageSk,
  deriveThreadId,
  mapVerdict,
  classifyDelivery,
  normalizeAddress,
  addressDomain,
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
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const INDEX_TABLE = process.env.INDEX_TABLE ?? "";
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

// TODO(Phase 2+): load per-deployment / per-domain policy from the settings table.
function policyFor(_domain: string): DeploymentPolicy {
  return DEFAULT_POLICY;
}

export async function handler(event: SESEvent): Promise<void> {
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

    const attachments: AttachmentMeta[] = (parsed.attachments ?? []).map((a) => ({
      filename: a.filename ?? "attachment",
      contentType: a.contentType ?? "application/octet-stream",
      sizeBytes: a.size ?? 0,
    }));

    const date = (parsed.date ?? new Date()).toISOString();
    const subject = parsed.subject ?? "(no subject)";
    const snippet = (parsed.text ?? "").replace(/\s+/g, " ").trim().slice(0, 140);

    // Fan out: one row per recipient that this deployment actually hosts.
    const recipients = (receipt.recipients ?? []).map(normalizeAddress).filter(isHosted);
    for (const recipient of recipients) {
      const decision = classifyDelivery(from.address, verdicts, policyFor(addressDomain(recipient)));
      if (decision.folder === null) {
        // Rejected by policy (virus/spam/block-list). Raw object is left in S3
        // for audit; the janitor sweeps unindexed inbound objects later.
        console.log(`drop ${messageId} -> ${recipient}: ${decision.reason}`);
        continue;
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
