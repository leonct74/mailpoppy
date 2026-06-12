import type { SESEvent, SESReceipt } from "aws-lambda";
import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, QueryCommand, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { CognitoIdentityProviderClient, ListUsersCommand } from "@aws-sdk/client-cognito-identity-provider";
import { simpleParser, type AddressObject, type Attachment } from "mailparser";
import { gunzipSync, unzipSync, strFromU8 } from "fflate";
import {
  type MessageMeta,
  type AuthVerdicts,
  type EmailAddress,
  type AttachmentMeta,
  type DeploymentPolicy,
  type SpamPolicy,
  type DmarcAttachmentKind,
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
  parseDmarcAggregate,
  summarizeAggregate,
  dmarcAttachmentKind,
  devicesSettingsKey,
  buildExpoPushMessages,
  removeDeviceTokens,
  pruneDeviceTokens,
  type DeviceRegistry,
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
/**
 * Fallback allowlist of hosted domains, used ONLY when the live Cognito mailbox
 * lookup fails (so we don't drop mail on a transient blip). In normal operation
 * the mailbox set is authoritative and spans every provisioned domain. Empty =
 * accept all recipients the catch-all receipt rule delivered.
 */
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

// ---- DMARC aggregate-report ingestion --------------------------------------
// The role addresses our published `rua=` may point at. We absorb report mail
// to any of these (postmaster@ is what provisioning publishes today).
const DMARC_ROLE_LOCALPARTS = new Set(["postmaster", "dmarc", "dmarc-reports", "dmarcreports"]);

/** A hosted role address that DMARC aggregate reports are sent to. */
function isDmarcRoleRecipient(addr: string): boolean {
  const local = addr.split("@")[0] ?? "";
  return DMARC_ROLE_LOCALPARTS.has(local) && isHosted(addr);
}

/** True if any attachment looks like a (compressed) DMARC report file. */
function hasReportCandidate(attachments: Attachment[]): boolean {
  return attachments.some((a) => dmarcAttachmentKind(a.filename, a.contentType) !== null);
}

/** Decompress a report attachment to its XML text (gzip/zip/plain), or null. */
function decompressReportXml(kind: DmarcAttachmentKind, content: Buffer): string | null {
  try {
    if (kind === "xml") return content.toString("utf8");
    if (kind === "gzip") return strFromU8(gunzipSync(content));
    if (kind === "zip") {
      const files = unzipSync(content);
      const names = Object.keys(files);
      const xmlName = names.find((n) => n.toLowerCase().endsWith(".xml")) ?? names[0];
      return xmlName ? strFromU8(files[xmlName]!) : null;
    }
  } catch (e) {
    console.error("dmarc decompress failed", e);
  }
  return null;
}

/** Accumulate a domain's daily DMARC pass/fail counters (SETTINGS table). */
async function recordDmarcStats(
  domain: string,
  s: { volume: number; pass: number; fail: number },
): Promise<void> {
  if (!domain || !SETTINGS_TABLE || s.volume <= 0) return;
  const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  await ddb.send(
    new UpdateCommand({
      TableName: SETTINGS_TABLE,
      Key: { pk: `DMARC#${domain}#${day}` },
      UpdateExpression:
        "SET #domain = if_not_exists(#domain, :domain), #day = if_not_exists(#day, :day) ADD #v :v, #p :p, #f :f, #r :one",
      ExpressionAttributeNames: { "#domain": "domain", "#day": "day", "#v": "volume", "#p": "pass", "#f": "fail", "#r": "reports" },
      ExpressionAttributeValues: { ":domain": domain, ":day": day, ":v": s.volume, ":p": s.pass, ":f": s.fail, ":one": 1 },
    }),
  );
}

/**
 * Parse + tally every DMARC report attachment on a message (best-effort).
 * Returns true if at least one real aggregate report was recognised — the caller
 * only absorbs the message when that's true, so a non-report message that merely
 * happens to carry a compressed attachment still falls through to normal mail
 * handling (never silently dropped).
 */
async function ingestDmarcReports(hintDomain: string | undefined, attachments: Attachment[]): Promise<boolean> {
  let ingested = false;
  for (const a of attachments) {
    const kind = dmarcAttachmentKind(a.filename, a.contentType);
    if (!kind) continue;
    const xml = decompressReportXml(kind, a.content);
    if (!xml) continue;
    const report = parseDmarcAggregate(xml);
    if (!report) continue;
    const domain = report.domain || hintDomain;
    if (!domain) continue;
    const summary = summarizeAggregate(report);
    await recordDmarcStats(domain, summary);
    ingested = true;
    console.log(
      `dmarc report: ${domain} vol=${summary.volume} pass=${summary.pass} fail=${summary.fail} (${report.orgName ?? "?"})`,
    );
  }
  return ingested;
}

// ---- New-mail push notifications (Expo) -------------------------------------
// When a message lands in a real inbox, notify that mailbox's registered mobile
// devices via the Expo Push Service. Entirely best-effort: any failure is logged
// and NEVER blocks delivery. Tokens Expo reports as DeviceNotRegistered (the app
// was uninstalled / token rotated) are pruned from the registry.
const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const PUSH_CHANNEL_ID = "mail"; // Android notification channel (created on device)

async function loadDeviceRegistry(address: string): Promise<DeviceRegistry> {
  if (!SETTINGS_TABLE) return { tokens: [] };
  try {
    const out = await ddb.send(
      new GetCommand({ TableName: SETTINGS_TABLE, Key: { pk: devicesSettingsKey(address) } }),
    );
    const raw = out.Item?.json;
    if (typeof raw !== "string") return { tokens: [] };
    return pruneDeviceTokens(JSON.parse(raw) as DeviceRegistry);
  } catch (e) {
    console.error(`failed to read device tokens for ${address}:`, e);
    return { tokens: [] };
  }
}

/** POST Expo push messages (chunked ≤100); return the tokens Expo says are dead. */
async function sendExpoPush(messages: ReturnType<typeof buildExpoPushMessages>): Promise<string[]> {
  const dead: string[] = [];
  for (let i = 0; i < messages.length; i += 100) {
    const batch = messages.slice(i, i + 100);
    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(batch),
      });
      if (!res.ok) {
        console.error(`expo push HTTP ${res.status}: ${await res.text().catch(() => "")}`);
        continue;
      }
      const out = (await res.json()) as {
        data?: Array<{ status?: string; details?: { error?: string } }>;
      };
      (out.data ?? []).forEach((ticket, idx) => {
        if (ticket?.status === "error" && ticket.details?.error === "DeviceNotRegistered") {
          const to = batch[idx]?.to;
          if (to) dead.push(to);
        }
      });
    } catch (e) {
      console.error("expo push request failed:", e);
    }
  }
  return dead;
}

/** Notify one mailbox's devices about a new inbox message (best-effort). */
async function notifyNewMail(
  recipient: string,
  title: string,
  body: string,
  data: Record<string, unknown>,
): Promise<void> {
  try {
    const reg = await loadDeviceRegistry(recipient);
    if (reg.tokens.length === 0) return;
    const messages = buildExpoPushMessages(reg.tokens, { title, body, data, channelId: PUSH_CHANNEL_ID });
    if (messages.length === 0) return;
    const dead = await sendExpoPush(messages);
    if (dead.length > 0 && SETTINGS_TABLE) {
      const pruned = removeDeviceTokens(reg, dead);
      await ddb
        .send(
          new PutCommand({
            TableName: SETTINGS_TABLE,
            Item: { pk: devicesSettingsKey(recipient), json: JSON.stringify(pruned) },
          }),
        )
        .catch((e) => console.error(`failed to prune dead tokens for ${recipient}:`, e));
    }
  } catch (e) {
    console.error(`push notify failed for ${recipient}:`, e);
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

  // New-mail push notifications, queued during delivery and flushed at the end so
  // they never sit on the critical path of writing the inbox row.
  const pushJobs: Promise<void>[] = [];

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

    // Who do we accept this message for? The LIVE Cognito mailbox set is the
    // authority — across EVERY hosted domain — so a mailbox on a newly-added
    // domain (e.g. marco@ollydigital.com) is delivered without re-deploying.
    // Only if that list can't be read (transient failure → empty set) do we fall
    // back to the static HOSTED_DOMAINS allowlist, so we never drop mail on a
    // lookup blip. (Only our own domains' MX point at SES, so the catch-all
    // receipt rule means `receipt.recipients` are already all ours.)
    const recipients = (receipt.recipients ?? []).map(normalizeAddress);

    // DMARC aggregate reports arrive as ordinary mail to the rua target we
    // publish (postmaster@<domain>). They're machine reports, not inbox mail:
    // tally their per-domain authentication counters, then ABSORB the message
    // (delete the raw S3 object, no inbox row, no bounce). Detection is gated to
    // these role addresses carrying a report-shaped attachment, so it never
    // touches normal mail; and it's fully fail-safe — any parse/IO error just
    // logs and the report is dropped, never blocking delivery. This is also why
    // postmaster@ needn't be a real mailbox: reports are consumed here directly.
    const reportRecipient = recipients.find(isDmarcRoleRecipient);
    const inboundAttachments = parsed.attachments ?? [];
    if (reportRecipient && hasReportCandidate(inboundAttachments)) {
      let ingested = false;
      try {
        ingested = await ingestDmarcReports(addressDomain(reportRecipient), inboundAttachments);
      } catch (e) {
        console.error(`dmarc ingest failed for ${messageId}:`, e);
      }
      // Only absorb (delete + skip) genuine reports; otherwise fall through so a
      // real message to a role address is still handled normally, not dropped.
      if (ingested) {
        await s3
          .send(new DeleteObjectCommand({ Bucket: MAIL_BUCKET, Key: key }))
          .catch((e) => console.error(`failed to delete dmarc report object ${key}:`, e));
        continue;
      }
    }

    const enforceKnown = knownMailboxes.size > 0;
    const known = enforceKnown
      ? recipients.filter((r) => isKnownMailbox(r, knownMailboxes))
      : recipients.filter(isHosted);
    const unknown = enforceKnown ? recipients.filter((r) => !isKnownMailbox(r, knownMailboxes)) : [];

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

      // Fan out a new-mail push to this mailbox's mobile devices — inbox only, so
      // spam/quarantined mail never buzzes the phone. Queued; flushed below.
      if (decision.folder === "inbox") {
        pushJobs.push(
          notifyNewMail(recipient, from.name || from.address, subject, {
            messageId,
            mailbox: recipient,
            folder: decision.folder,
            threadId,
          }),
        );
      }
    }
  }

  // Flush queued pushes concurrently. Each is already failure-isolated, so a bad
  // token or Expo outage can never affect mail that's already safely stored.
  if (pushJobs.length > 0) await Promise.allSettled(pushJobs);
}
