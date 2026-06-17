// Vendored from the desktop monorepo's @mailpoppy/core (packages/core/src/types.ts).
// App Hosting builds in the cloud and won't fetch git submodules, so the small,
// stable mailbox-plane types are copied here. Keep in sync with core if it changes.

export type Folder = "inbox" | "sent" | "drafts" | "trash" | "junk" | (string & {});

export interface MessageFlags {
  unread: boolean;
  starred?: boolean;
  answered?: boolean;
}

export type Verdict = "PASS" | "FAIL" | "GRAY" | "PROCESSING_FAILED";

export interface AuthVerdicts {
  spam: Verdict;
  virus: Verdict;
  spf?: Verdict;
  dkim?: Verdict;
  dmarc?: Verdict;
}

export interface EmailAddress {
  name?: string;
  address: string;
}

export interface AttachmentMeta {
  filename: string;
  contentType: string;
  sizeBytes: number;
  s3Key?: string;
}

export interface MessageMeta {
  domain: string;
  mailbox: string;
  messageId: string;
  threadId: string;
  folder: Folder;
  from: EmailAddress;
  to: EmailAddress[];
  subject: string;
  snippet: string;
  date: string; // ISO 8601
  flags: MessageFlags;
  hasAttachments: boolean;
  attachments?: AttachmentMeta[];
  verdicts?: AuthVerdicts;
  s3Key: string;
  sizeBytes: number;
  /** Mailbox encryption: when true, the body (.eml at s3Key) + attachments are
   *  sealed; encWrappedKey is the per-message content key sealed to THIS mailbox's
   *  pubkey. The client decrypts with its private key. Subject/metadata stay clear;
   *  snippet is blank. See mailboxCrypto.ts + docs/mailbox-encryption-design.md. */
  encrypted?: boolean;
  encWrappedKey?: string;
}
