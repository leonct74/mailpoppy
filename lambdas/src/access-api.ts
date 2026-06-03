import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  QueryCommand,
  UpdateCommand,
  PutCommand,
  DeleteCommand,
} from "@aws-sdk/lib-dynamodb";
import { SESv2Client, SendEmailCommand, type MessageHeader, type Attachment } from "@aws-sdk/client-sesv2";
import {
  type MessageMeta,
  type Folder,
  type MessageFlags,
  type AttachmentMeta,
  SES_MAX_MESSAGE_BYTES,
  mailboxPk,
  messageSk,
  folderPrefix,
  normalizeAddress,
  attachmentS3Key,
  resolveContentType,
} from "@mailpoppy/core";

/**
 * The Cognito-authorized access API (behind an API Gateway HTTP API with a JWT
 * authorizer). This is the single audited place that enforces "user X can act on
 * ONLY X's mailbox": the set of addresses a request may touch is derived purely
 * from the verified JWT claims — never from the path, query or body. Security-
 * critical multi-tenant isolation (DESIGN §6). Shared by desktop + mobile.
 *
 * Routes: GET /messages · GET /messages/{id}/raw · PATCH /messages/{id}/flags
 *        · POST /messages/{id}/move · POST /send
 */
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
const s3 = new S3Client({});
const ses = new SESv2Client({});

const INDEX_TABLE = process.env.INDEX_TABLE ?? "";
const MAIL_BUCKET = process.env.MAIL_BUCKET ?? "";
const BY_MESSAGE_INDEX = process.env.BY_MESSAGE_INDEX ?? "by-message";
const SENT_PREFIX = process.env.SENT_PREFIX ?? "sent/";

function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

/** Strip the internal DynamoDB key attributes, returning just the public shape. */
function toMeta(item: Record<string, unknown>): MessageMeta {
  const { pk: _pk, sk: _sk, ...rest } = item;
  return rest as unknown as MessageMeta;
}

/**
 * The addresses this request is allowed to touch — derived ONLY from verified
 * JWT claims. `email` is the primary; an optional `custom:aliases` claim (comma-
 * separated) adds any aliases the admin assigned. Returns normalized addresses.
 */
function ownedAddresses(
  claims: Record<string, string | number | boolean | string[]>,
): string[] {
  const out = new Set<string>();
  const email = normalizeAddress(typeof claims.email === "string" ? claims.email : undefined);
  if (email) out.add(email);
  const aliases = claims["custom:aliases"];
  if (typeof aliases === "string") {
    for (const a of aliases.split(",")) {
      const n = normalizeAddress(a);
      if (n) out.add(n);
    }
  }
  return [...out];
}

/** Find a message by id across the caller's owned mailboxes, scoped via the JWT. */
async function findOwnedRow(
  messageId: string,
  owned: string[],
): Promise<Record<string, unknown> | undefined> {
  const ownedPks = new Set(owned.map(mailboxPk));
  const res = await ddb.send(
    new QueryCommand({
      TableName: INDEX_TABLE,
      IndexName: BY_MESSAGE_INDEX,
      KeyConditionExpression: "messageId = :m",
      ExpressionAttributeValues: { ":m": messageId },
    }),
  );
  // Defense in depth: even though the GSI returns rows for every recipient of
  // this messageId, only return one whose partition the caller actually owns.
  return (res.Items ?? []).find((it) => ownedPks.has(String(it.pk)));
}

function encodeCursor(key: Record<string, unknown> | undefined): string | undefined {
  return key ? Buffer.from(JSON.stringify(key)).toString("base64url") : undefined;
}
function decodeCursor(cursor: string | undefined): Record<string, unknown> | undefined {
  if (!cursor) return undefined;
  try {
    return JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    return undefined;
  }
}

// ---- Route handlers ---------------------------------------------------------

async function listMessages(
  owned: string[],
  query: Record<string, string | undefined>,
): Promise<APIGatewayProxyResultV2> {
  const folder = (query.folder ?? "inbox") as Folder;
  const limit = Math.min(Math.max(Number(query.limit ?? 50), 1), 200);

  // Common case: a single owned address → a single partition with a real cursor.
  if (owned.length === 1) {
    const res = await ddb.send(
      new QueryCommand({
        TableName: INDEX_TABLE,
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :pfx)",
        ExpressionAttributeValues: { ":pk": mailboxPk(owned[0]!), ":pfx": folderPrefix(folder) },
        ScanIndexForward: false, // newest first
        Limit: limit,
        ExclusiveStartKey: decodeCursor(query.cursor),
      }),
    );
    return json(200, {
      items: (res.Items ?? []).map(toMeta),
      cursor: encodeCursor(res.LastEvaluatedKey as Record<string, unknown> | undefined),
    });
  }

  // Multiple owned addresses: query each partition, merge, sort, slice.
  const all: MessageMeta[] = [];
  for (const addr of owned) {
    const res = await ddb.send(
      new QueryCommand({
        TableName: INDEX_TABLE,
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :pfx)",
        ExpressionAttributeValues: { ":pk": mailboxPk(addr), ":pfx": folderPrefix(folder) },
        ScanIndexForward: false,
        Limit: limit,
      }),
    );
    all.push(...(res.Items ?? []).map(toMeta));
  }
  all.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return json(200, { items: all.slice(0, limit) });
}

async function getRaw(messageId: string, owned: string[]): Promise<APIGatewayProxyResultV2> {
  const row = await findOwnedRow(messageId, owned);
  if (!row) return json(404, { error: "not found" });
  const obj = await s3.send(
    new GetObjectCommand({ Bucket: MAIL_BUCKET, Key: String(row.s3Key) }),
  );
  const eml = await obj.Body!.transformToString();
  return json(200, { eml });
}

async function getAttachment(
  messageId: string,
  indexStr: string,
  owned: string[],
): Promise<APIGatewayProxyResultV2> {
  const row = await findOwnedRow(messageId, owned);
  if (!row) return json(404, { error: "not found" });
  const attachments = (row.attachments ?? []) as AttachmentMeta[];
  const index = Number(indexStr);
  const att = Number.isInteger(index) && index >= 0 ? attachments[index] : undefined;
  if (!att?.s3Key) return json(404, { error: "attachment not found" });

  // Hand back a short-lived presigned S3 URL — the client downloads directly
  // from S3 (avoids streaming large files through API Gateway / Lambda).
  const url = await getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: MAIL_BUCKET,
      Key: att.s3Key,
      ResponseContentDisposition: `attachment; filename="${att.filename.replace(/"/g, "")}"`,
      ResponseContentType: att.contentType,
    }),
    { expiresIn: 300 },
  );
  return json(200, { url, filename: att.filename, contentType: att.contentType });
}

async function setFlags(
  messageId: string,
  owned: string[],
  body: Partial<MessageFlags>,
): Promise<APIGatewayProxyResultV2> {
  const row = await findOwnedRow(messageId, owned);
  if (!row) return json(404, { error: "not found" });
  const current = (row.flags ?? {}) as MessageFlags;
  const next: MessageFlags = { ...current, ...body };
  const res = await ddb.send(
    new UpdateCommand({
      TableName: INDEX_TABLE,
      Key: { pk: row.pk, sk: row.sk },
      UpdateExpression: "SET flags = :f",
      ExpressionAttributeValues: { ":f": next },
      ReturnValues: "ALL_NEW",
    }),
  );
  return json(200, toMeta(res.Attributes ?? {}));
}

async function moveMessage(
  messageId: string,
  owned: string[],
  toFolder: Folder,
): Promise<APIGatewayProxyResultV2> {
  const row = await findOwnedRow(messageId, owned);
  if (!row) return json(404, { error: "not found" });
  const meta = toMeta(row);
  if (meta.folder === toFolder) return json(200, meta);

  // The folder lives in the sort key, so a move = delete old row + put new row.
  const newItem = { ...row, folder: toFolder, sk: messageSk(toFolder, meta.date, messageId) };
  await ddb.send(new PutCommand({ TableName: INDEX_TABLE, Item: newItem }));
  await ddb.send(new DeleteCommand({ TableName: INDEX_TABLE, Key: { pk: row.pk, sk: row.sk } }));
  return json(200, toMeta(newItem));
}

interface SendAttachmentInput {
  filename: string;
  contentType: string;
  contentBase64: string;
}
interface SendBody {
  to?: string[];
  subject?: string;
  html?: string;
  text?: string;
  from?: string;
  inReplyTo?: string;
  references?: string;
  attachments?: SendAttachmentInput[];
}

async function sendMessage(owned: string[], body: SendBody): Promise<APIGatewayProxyResultV2> {
  const to = (body.to ?? []).map(normalizeAddress).filter(Boolean);
  if (to.length === 0) return json(400, { error: "at least one recipient required" });

  // The From address must be one the caller owns — fall back to the primary.
  const requested = normalizeAddress(body.from);
  const from = requested && owned.includes(requested) ? requested : owned[0];
  if (!from) return json(403, { error: "no sending identity" });

  const subject = body.subject ?? "(no subject)";
  const text = body.text ?? "";
  const html = body.html;

  // Decode attachments once (shared between the SES send and the Sent-copy store).
  // Harden the content type server-side too: a generic/empty type makes Gmail and
  // others refuse to open the file ("Unsupported file type"), so infer it from
  // the filename extension when the client didn't send a specific one.
  const inputAttachments = body.attachments ?? [];
  const decoded = inputAttachments.map((a) => {
    const filename = a.filename || "attachment";
    return {
      filename,
      contentType: resolveContentType(a.contentType, filename),
      bytes: Buffer.from(a.contentBase64 ?? "", "base64"),
    };
  });

  const attachmentBytes = decoded.reduce((n, a) => n + a.bytes.length, 0);
  const approxBytes = Buffer.byteLength(subject + text + (html ?? ""), "utf8") + attachmentBytes;
  if (approxBytes > SES_MAX_MESSAGE_BYTES) {
    return json(413, { error: "message exceeds the 40MB SES limit" });
  }

  const headers: MessageHeader[] = [];
  if (body.inReplyTo) headers.push({ Name: "In-Reply-To", Value: body.inReplyTo });
  if (body.references) headers.push({ Name: "References", Value: body.references });

  const sesAttachments: Attachment[] = decoded.map((a) => ({
    RawContent: a.bytes,
    FileName: a.filename,
    ContentType: a.contentType,
  }));

  const sent = await ses.send(
    new SendEmailCommand({
      FromEmailAddress: from,
      Destination: { ToAddresses: to },
      Content: {
        Simple: {
          Subject: { Data: subject, Charset: "UTF-8" },
          Body: {
            ...(text ? { Text: { Data: text, Charset: "UTF-8" } } : {}),
            ...(html ? { Html: { Data: html, Charset: "UTF-8" } } : {}),
          },
          ...(headers.length ? { Headers: headers } : {}),
          ...(sesAttachments.length ? { Attachments: sesAttachments } : {}),
        },
      },
    }),
  );
  const messageId = sent.MessageId ?? `local-${Date.now()}`;
  const date = new Date().toISOString();

  // Store each attachment to S3 so the Sent copy's attachments are downloadable
  // via the same GET /messages/{id}/attachments/{index} endpoint.
  const sentAttachments: AttachmentMeta[] = [];
  for (let i = 0; i < decoded.length; i++) {
    const a = decoded[i]!;
    const key = attachmentS3Key(messageId, i, a.filename);
    await s3.send(
      new PutObjectCommand({ Bucket: MAIL_BUCKET, Key: key, Body: a.bytes, ContentType: a.contentType }),
    );
    sentAttachments.push({ filename: a.filename, contentType: a.contentType, sizeBytes: a.bytes.length, s3Key: key });
  }

  // SES keeps no Sent copy — manufacture one (DESIGN §9.2): store a raw .eml in
  // S3 and an index row so the Sent folder is readable like any other.
  const rawEml = buildRawEml({ from, to, subject, text, html, messageId, date, inReplyTo: body.inReplyTo });
  const s3Key = `${SENT_PREFIX}${messageId}`;
  await s3.send(
    new PutObjectCommand({ Bucket: MAIL_BUCKET, Key: s3Key, Body: rawEml, ContentType: "message/rfc822" }),
  );

  const meta: MessageMeta = {
    domain: from.slice(from.lastIndexOf("@") + 1),
    mailbox: from,
    messageId,
    threadId: body.references?.split(/\s+/)[0]?.replace(/^<|>$/g, "") || messageId,
    folder: "sent",
    from: { address: from },
    to: to.map((address) => ({ address })),
    subject,
    snippet: (text || html || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 140),
    date,
    flags: { unread: false },
    hasAttachments: sentAttachments.length > 0,
    attachments: sentAttachments.length > 0 ? sentAttachments : undefined,
    s3Key,
    sizeBytes: Buffer.byteLength(rawEml, "utf8") + attachmentBytes,
  };
  await ddb.send(
    new PutCommand({
      TableName: INDEX_TABLE,
      Item: { pk: mailboxPk(from), sk: messageSk("sent", date, messageId), ...meta },
    }),
  );

  return json(200, { messageId });
}

function buildRawEml(m: {
  from: string;
  to: string[];
  subject: string;
  text: string;
  html?: string;
  messageId: string;
  date: string;
  inReplyTo?: string;
}): string {
  const headers = [
    `From: ${m.from}`,
    `To: ${m.to.join(", ")}`,
    `Subject: ${m.subject}`,
    `Date: ${new Date(m.date).toUTCString()}`,
    `Message-ID: <${m.messageId}>`,
    ...(m.inReplyTo ? [`In-Reply-To: ${m.inReplyTo}`] : []),
    "MIME-Version: 1.0",
    `Content-Type: ${m.html ? "text/html" : "text/plain"}; charset=utf-8`,
  ];
  return `${headers.join("\r\n")}\r\n\r\n${m.html ?? m.text}`;
}

// ---- Dispatcher -------------------------------------------------------------

export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> {
  const owned = ownedAddresses(event.requestContext.authorizer.jwt.claims);
  if (owned.length === 0) return json(401, { error: "no mailbox identity in token" });

  const route = event.routeKey; // e.g. "GET /messages/{id}/raw"
  const id = event.pathParameters?.id ? decodeURIComponent(event.pathParameters.id) : undefined;
  const query = (event.queryStringParameters ?? {}) as Record<string, string | undefined>;
  const parseBody = <T,>(): T => {
    if (!event.body) return {} as T;
    const raw = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return {} as T;
    }
  };

  try {
    switch (route) {
      case "GET /messages":
        return await listMessages(owned, query);
      case "GET /messages/{id}/raw":
        return id ? await getRaw(id, owned) : json(400, { error: "missing id" });
      case "GET /messages/{id}/attachments/{index}": {
        const index = event.pathParameters?.index;
        if (!id || index === undefined) return json(400, { error: "missing id/index" });
        return await getAttachment(id, index, owned);
      }
      case "PATCH /messages/{id}/flags":
        return id ? await setFlags(id, owned, parseBody<Partial<MessageFlags>>()) : json(400, { error: "missing id" });
      case "POST /messages/{id}/move": {
        const b = parseBody<{ folder?: Folder }>();
        if (!id) return json(400, { error: "missing id" });
        if (!b.folder) return json(400, { error: "missing folder" });
        return await moveMessage(id, owned, b.folder);
      }
      case "POST /send":
        return await sendMessage(owned, parseBody<SendBody>());
      default:
        return json(404, { error: `no route for ${route}` });
    }
  } catch (err) {
    console.error("access-api error", route, err);
    return json(500, { error: "internal error" });
  }
}
