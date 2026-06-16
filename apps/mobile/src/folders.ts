import type { Folder } from "@mailpoppy/core";

// The folders the mobile client exposes, in tab order. The backend stores a
// message's folder on its index row; `list({ folder })` and `move(id, folder)`
// operate on these.
export const FOLDERS: { key: Folder; label: string }[] = [
  { key: "inbox", label: "Inbox" },
  { key: "sent", label: "Sent" },
  { key: "drafts", label: "Drafts" },
  { key: "junk", label: "Junk" },
  { key: "trash", label: "Trash" },
];

export function folderLabel(folder: Folder): string {
  return FOLDERS.find((f) => f.key === folder)?.label ?? String(folder);
}
