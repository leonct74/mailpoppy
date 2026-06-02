import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { InboxView } from "./InboxView";
import type { MailClient } from "../lib/mailClient";
import type { MessageMeta } from "@mailpoppy/core";

// globals:false → register cleanup manually (matches SetupWizard.test.tsx).
afterEach(() => cleanup());

function msg(over: Partial<MessageMeta> = {}): MessageMeta {
  return {
    domain: "ollydigital.com",
    mailbox: "you@ollydigital.com",
    messageId: "m1",
    threadId: "m1",
    folder: "inbox",
    from: { name: "Tester", address: "tester@ext.example" },
    to: [{ address: "you@ollydigital.com" }],
    subject: "Hello from test",
    snippet: "a short snippet",
    date: "2026-06-02T10:00:00.000Z",
    flags: { unread: true },
    hasAttachments: false,
    s3Key: "inbound/m1",
    sizeBytes: 1024,
    ...over,
  };
}

function mockClient(): MailClient & Record<"list" | "getRaw" | "setFlags" | "move" | "send", ReturnType<typeof vi.fn>> {
  const inbox = [msg()];
  return {
    list: vi.fn(async ({ folder }) => ({ items: folder === "inbox" ? inbox : [] })),
    getRaw: vi.fn(async () => ({ eml: "From: tester@ext.example\r\n\r\nthe full body text" })),
    setFlags: vi.fn(async (_id: string, f) => ({ ...inbox[0]!, flags: { ...inbox[0]!.flags, ...f } })),
    move: vi.fn(async (_id: string, folder) => ({ ...inbox[0]!, folder })),
    send: vi.fn(async () => ({ messageId: "sent-1" })),
  };
}

describe("InboxView", () => {
  it("lists messages from the client and shows the inbox", async () => {
    const client = mockClient();
    render(<InboxView client={client} />);

    expect(await screen.findByRole("button", { name: "Open: Hello from test" })).toBeInTheDocument();
    expect(client.list).toHaveBeenCalledWith({ folder: "inbox", limit: 100 });
  });

  it("opens a message, renders its body and marks it read", async () => {
    const client = mockClient();
    render(<InboxView client={client} />);

    fireEvent.click(await screen.findByRole("button", { name: "Open: Hello from test" }));

    expect(await screen.findByText(/the full body text/)).toBeInTheDocument();
    expect(client.getRaw).toHaveBeenCalledWith("m1");
    // It was unread → opening marks it read (async side effect).
    await waitFor(() => expect(client.setFlags).toHaveBeenCalledWith("m1", { unread: false }));
  });

  it("moves a message to trash and drops it from the list", async () => {
    const client = mockClient();
    render(<InboxView client={client} />);

    fireEvent.click(await screen.findByRole("button", { name: "Open: Hello from test" }));
    fireEvent.click(await screen.findByRole("button", { name: "Move to Trash" }));

    expect(client.move).toHaveBeenCalledWith("m1", "trash");
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Open: Hello from test" })).toBeNull(),
    );
  });

  it("switches folders and queries the selected folder", async () => {
    const client = mockClient();
    render(<InboxView client={client} />);

    fireEvent.click(await screen.findByRole("button", { name: "Sent" }));

    await waitFor(() => expect(client.list).toHaveBeenCalledWith({ folder: "sent", limit: 100 }));
    expect(await screen.findByText(/No messages in Sent/)).toBeInTheDocument();
  });
});
