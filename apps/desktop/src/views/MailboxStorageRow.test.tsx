import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { MailboxStorageRow } from "./MailboxStorageRow";
import type { MailboxStorageInfo } from "../lib/mailboxStorage";
import type { MailboxDeletion } from "../lib/mailbox";

afterEach(() => cleanup());

const storage: MailboxStorageInfo = { email: "old@acme.com", usedBytes: 1024, messageCount: 3, quotaBytes: null };
const loadStorage = async () => storage;

describe("MailboxStorageRow — delete", () => {
  it("only arms the delete button once 'delete' is typed", async () => {
    const del = vi.fn(async (): Promise<MailboxDeletion> => ({
      ok: true,
      email: "old@acme.com",
      userDeleted: true,
      deletedMessages: 3,
      deletedObjects: 3,
      freedBytes: 1024,
    }));
    render(<MailboxStorageRow email="old@acme.com" stackName="MailpoppyMailStack" loadStorage={loadStorage} del={del} />);

    // Open the confirm.
    fireEvent.click(await screen.findByRole("button", { name: "Delete mailbox" }));
    // Warning + message count shown.
    expect(screen.getByText(/cannot be undone/i)).toBeInTheDocument();
    expect(screen.getByText(/3 messages/)).toBeInTheDocument();

    // The armed "Delete mailbox" (red) button is disabled until "delete" is typed.
    const confirmBtn = screen.getAllByRole("button", { name: "Delete mailbox" }).at(-1)!;
    expect(confirmBtn).toBeDisabled();

    const input = screen.getByLabelText(/Type delete to confirm/i);
    fireEvent.change(input, { target: { value: "nope" } });
    expect(confirmBtn).toBeDisabled();

    fireEvent.change(input, { target: { value: "delete" } });
    expect(confirmBtn).toBeEnabled();
  });

  it("calls del + onDeleted when confirmed", async () => {
    const del = vi.fn(async (): Promise<MailboxDeletion> => ({
      ok: true,
      email: "old@acme.com",
      userDeleted: true,
      deletedMessages: 3,
      deletedObjects: 3,
      freedBytes: 1024,
    }));
    const onDeleted = vi.fn();
    render(
      <MailboxStorageRow email="old@acme.com" stackName="MailpoppyMailStack" loadStorage={loadStorage} del={del} onDeleted={onDeleted} />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Delete mailbox" }));
    fireEvent.change(screen.getByLabelText(/Type delete to confirm/i), { target: { value: "DELETE" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Delete mailbox" }).at(-1)!);

    await waitFor(() => expect(del).toHaveBeenCalledTimes(1));
    expect(del).toHaveBeenCalledWith({ stackName: "MailpoppyMailStack", email: "old@acme.com" });
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith("old@acme.com"));
  });

  it("surfaces a delete error and does not call onDeleted", async () => {
    const del = vi.fn(async () => {
      throw new Error("AccessDenied");
    });
    const onDeleted = vi.fn();
    render(
      <MailboxStorageRow email="old@acme.com" stackName="MailpoppyMailStack" loadStorage={loadStorage} del={del} onDeleted={onDeleted} />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Delete mailbox" }));
    fireEvent.change(screen.getByLabelText(/Type delete to confirm/i), { target: { value: "delete" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Delete mailbox" }).at(-1)!);

    expect(await screen.findByText(/AccessDenied/)).toBeInTheDocument();
    expect(onDeleted).not.toHaveBeenCalled();
  });
});
