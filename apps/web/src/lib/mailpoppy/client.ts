// Vendored from the desktop monorepo's @mailpoppy/api-client. Identical surface,
// copied here because App Hosting's cloud build won't fetch git submodules. This is
// the ONLY thing that talks to the deployment's access API (API Gateway). The mail
// path NEVER uses AWS credentials — only a Cognito JWT.
import type { MessageMeta, Folder, MessageFlags } from "./types";

export interface MailpoppyClientConfig {
  apiBaseUrl: string;
  getToken: () => Promise<string>;
}

export interface ListOptions {
  folder: Folder;
  limit?: number;
  cursor?: string;
}
export interface ListResult {
  items: MessageMeta[];
  cursor?: string;
}
export interface SendAttachment {
  filename: string;
  contentType: string;
  contentBase64: string;
}
export interface SendInput {
  to: string[];
  /** Visible carbon-copy recipients. */
  cc?: string[];
  /** Blind carbon-copy recipients — delivered, but never shown in the message headers. */
  bcc?: string[];
  subject: string;
  html?: string;
  text?: string;
  inReplyTo?: string;
  references?: string;
  attachments?: SendAttachment[];
  /** When sending a saved draft, its id — the server removes it after sending. */
  draftId?: string;
}
export interface SaveDraftInput {
  /** Omit to create a new draft; pass to update an existing one in place. */
  draftId?: string;
  to?: string[];
  subject?: string;
  html?: string;
  text?: string;
  inReplyTo?: string;
  references?: string;
}
export interface MailboxUsage {
  email: string;
  usedBytes: number;
  messageCount: number;
  quotaBytes: number | null;
}

export class MailpoppyClient {
  constructor(private readonly cfg: MailpoppyClientConfig) {}

  private async req<T>(path: string, init?: RequestInit): Promise<T> {
    const token = await this.cfg.getToken();
    const res = await fetch(`${this.cfg.apiBaseUrl}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) throw new Error(`Mailpoppy API ${res.status}: ${await res.text()}`);
    return (await res.json()) as T;
  }

  list(opts: ListOptions): Promise<ListResult> {
    const q = new URLSearchParams({ folder: String(opts.folder) });
    if (opts.limit) q.set("limit", String(opts.limit));
    if (opts.cursor) q.set("cursor", opts.cursor);
    return this.req<ListResult>(`/messages?${q.toString()}`);
  }
  getRaw(messageId: string): Promise<{ eml: string }> {
    return this.req(`/messages/${encodeURIComponent(messageId)}/raw`);
  }
  getAttachmentUrl(
    messageId: string,
    index: number,
  ): Promise<{ url: string; filename?: string; contentType?: string }> {
    return this.req(`/messages/${encodeURIComponent(messageId)}/attachments/${index}`);
  }
  setFlags(messageId: string, flags: Partial<MessageFlags>): Promise<MessageMeta> {
    return this.req(`/messages/${encodeURIComponent(messageId)}/flags`, {
      method: "PATCH",
      body: JSON.stringify(flags),
    });
  }
  move(messageId: string, folder: Folder): Promise<MessageMeta> {
    return this.req(`/messages/${encodeURIComponent(messageId)}/move`, {
      method: "POST",
      body: JSON.stringify({ folder }),
    });
  }
  /** Permanently delete every message in the Trash folder. Irreversible. */
  emptyTrash(): Promise<{ ok: boolean; deleted: number }> {
    return this.req(`/trash/empty`, { method: "POST" });
  }
  send(input: SendInput): Promise<{ messageId: string }> {
    return this.req(`/send`, { method: "POST", body: JSON.stringify(input) });
  }
  /** Create or update a draft. Returns the (possibly newly minted) draft id. */
  saveDraft(input: SaveDraftInput): Promise<{ draftId: string } & MessageMeta> {
    return this.req(`/drafts`, { method: "POST", body: JSON.stringify(input) });
  }
  deleteDraft(draftId: string): Promise<{ ok: true }> {
    return this.req(`/drafts/${encodeURIComponent(draftId)}`, { method: "DELETE" });
  }
  getUsage(): Promise<MailboxUsage> {
    return this.req(`/usage`);
  }
}
