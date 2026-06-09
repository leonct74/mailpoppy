import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { DomainView } from "./DomainView";

// MailboxStorageRow fetches each mailbox's storage from the sidecar on mount;
// stub it to a plain <li> so this test stays focused on DomainView's own
// behaviour (the row has its own dedicated test).
vi.mock("./MailboxStorageRow", () => ({
  MailboxStorageRow: ({ email, onOpenInbox }: { email: string; onOpenInbox?: (e: string) => void }) => (
    <li data-testid="mb-row">
      {email}
      {onOpenInbox && <button onClick={() => onOpenInbox(email)}>open {email}</button>}
    </li>
  ),
}));

// Mail rules + retention editors self-load from the sidecar; stub them and echo
// the domain so we can assert they're mounted scoped to THIS domain.
vi.mock("./PolicyEditor", () => ({
  PolicyEditor: ({ domain }: { domain?: string }) => <div>MAIL RULES {domain}</div>,
}));
vi.mock("./RetentionEditor", () => ({
  RetentionEditor: ({ domain }: { domain?: string }) => <div>RETENTION {domain}</div>,
}));

afterEach(() => cleanup());

const BACKEND = {
  ok: true as const,
  region: "eu-west-1",
  userPoolId: "eu-west-1_abc123",
  clientId: "client123",
  apiBaseUrl: "https://api.example.com",
};

function loaders(overrides: Partial<Parameters<typeof DomainView>[0]> = {}) {
  return {
    listMailboxes: vi.fn(async () => ({
      ...BACKEND,
      mailboxes: [
        { email: "support@boxord.com", status: "CONFIRMED" },
        { email: "info@boxord.com", status: "CONFIRMED" },
        { email: "hello@example.org", status: "CONFIRMED" }, // different domain — must be filtered out
      ],
    })),
    createMailbox: vi.fn(async (input: { email: string }) => ({
      ...BACKEND,
      mailbox: { email: input.email, status: "CONFIRMED" },
    })),
    getDomainStatus: vi.fn(async () => ({ verifiedForSending: true, dkim: "SUCCESS" })),
    getMailFrom: vi.fn(async (d: string) => ({ status: "Success", mailFromDomain: `mail.${d}` })),
    ...overrides,
  };
}

describe("DomainView", () => {
  it("shows the domain, its health badges, and only the mailboxes on this domain", async () => {
    render(<DomainView domain="boxord.com" {...loaders()} />);

    // Domain heading.
    expect(await screen.findByRole("heading", { name: "boxord.com" })).toBeInTheDocument();

    // Health badges (resolve asynchronously).
    expect(await screen.findByText("DKIM verified")).toBeInTheDocument();
    expect(screen.getByText("Can send")).toBeInTheDocument();
    expect(screen.getByText("MAIL FROM aligned")).toBeInTheDocument();

    // Only the two boxord.com mailboxes — example.org is excluded.
    expect(screen.getByText("support@boxord.com")).toBeInTheDocument();
    expect(screen.getByText("info@boxord.com")).toBeInTheDocument();
    expect(screen.queryByText("hello@example.org")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("mb-row")).toHaveLength(2);
  });

  it("creates a mailbox on this domain (local part + @domain)", async () => {
    const l = loaders();
    render(<DomainView domain="boxord.com" {...l} />);
    await screen.findByRole("heading", { name: "boxord.com" });

    fireEvent.change(screen.getByLabelText("New mailbox name on boxord.com"), { target: { value: "Sales" } });
    fireEvent.change(screen.getByLabelText("New mailbox password"), { target: { value: "Mailpoppy-Test-1!" } });
    fireEvent.click(screen.getByRole("button", { name: "Create mailbox" }));

    await waitFor(() => expect(l.createMailbox).toHaveBeenCalled());
    expect(l.createMailbox.mock.calls[0][0].email).toBe("sales@boxord.com");
    expect(await screen.findByText(/created/i)).toBeInTheDocument();
  });

  it("calls back and migrate callbacks", async () => {
    const onBack = vi.fn();
    const onMigrateInto = vi.fn();
    render(<DomainView domain="boxord.com" onBack={onBack} onMigrateInto={onMigrateInto} {...loaders()} />);
    await screen.findByRole("heading", { name: "boxord.com" });

    fireEvent.click(screen.getByRole("button", { name: "Back to overview" }));
    expect(onBack).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Open migration/i }));
    expect(onMigrateInto).toHaveBeenCalledWith("boxord.com");
  });

  it("launches per-domain setup via the Domain setup action", async () => {
    const onRunSetup = vi.fn();
    render(<DomainView domain="boxord.com" onRunSetup={onRunSetup} {...loaders()} />);
    await screen.findByRole("heading", { name: "boxord.com" });

    fireEvent.click(screen.getByRole("button", { name: /Domain setup/i }));
    expect(onRunSetup).toHaveBeenCalled();
  });

  it("opens a mailbox's inbox via the per-row action", async () => {
    const onOpenInbox = vi.fn();
    render(<DomainView domain="boxord.com" onOpenInbox={onOpenInbox} {...loaders()} />);
    await screen.findByRole("heading", { name: "boxord.com" });

    fireEvent.click(await screen.findByRole("button", { name: "open support@boxord.com" }));
    expect(onOpenInbox).toHaveBeenCalledWith("support@boxord.com");
  });

  it("hosts this domain's own mail rules + retention, scoped to the domain", async () => {
    render(<DomainView domain="boxord.com" {...loaders()} />);
    await screen.findByRole("heading", { name: "boxord.com" });

    expect(screen.getByText("MAIL RULES boxord.com")).toBeInTheDocument();
    expect(screen.getByText("RETENTION boxord.com")).toBeInTheDocument();
  });

  it("removes just this domain after type-to-confirm", async () => {
    const removeDomain = vi.fn(async (input: { domain: string; stackName?: string }) => ({
      ok: true as const,
      domain: input.domain,
      stackName: "MailpoppyMailStack",
      deletedMailboxes: ["support@boxord.com", "info@boxord.com"],
      deletedMessages: 12,
      deletedObjects: 20,
      freedBytes: 100_000,
      sesIdentityDeleted: true,
      dnsRemoved: ["MX boxord.com", "DKIM CNAME x._domainkey.boxord.com"],
      warnings: [],
    }));
    const onRemoved = vi.fn();
    render(<DomainView domain="boxord.com" onRemoved={onRemoved} removeDomain={removeDomain} {...loaders()} />);
    await screen.findByRole("heading", { name: "boxord.com" });

    // Collapsed by default — expand the danger zone first.
    fireEvent.click(screen.getByRole("button", { name: /Toggle danger zone/i }));

    const removeBtn = screen.getByRole("button", { name: /Remove domain/i });
    expect(removeBtn).toBeDisabled(); // gated until the domain is typed

    fireEvent.change(screen.getByLabelText("Type domain to confirm removal"), { target: { value: "boxord.com" } });
    expect(removeBtn).not.toBeDisabled();
    fireEvent.click(removeBtn);

    await waitFor(() =>
      expect(removeDomain).toHaveBeenCalledWith({ domain: "boxord.com", stackName: "MailpoppyMailStack" }),
    );
    expect(onRemoved).toHaveBeenCalledWith("boxord.com");
    expect(await screen.findByText(/Removed boxord\.com/i)).toBeInTheDocument();
  });

  it("keeps the remove button disabled when the typed domain doesn't match", async () => {
    const removeDomain = vi.fn();
    render(<DomainView domain="boxord.com" removeDomain={removeDomain} {...loaders()} />);
    await screen.findByRole("heading", { name: "boxord.com" });
    fireEvent.click(screen.getByRole("button", { name: /Toggle danger zone/i }));

    fireEvent.change(screen.getByLabelText("Type domain to confirm removal"), { target: { value: "boxor" } });
    fireEvent.click(screen.getByRole("button", { name: /Remove domain/i }));
    expect(removeDomain).not.toHaveBeenCalled();
  });

  it("shows a deploy hint when no backend exists yet", async () => {
    const noBackend = vi.fn(async () => {
      throw new Error('sidecar 404: {"ok":false,"error":"No deployed Mailpoppy backend was found yet."}');
    });
    render(<DomainView domain="boxord.com" {...loaders({ listMailboxes: noBackend })} />);
    expect(await screen.findByText(/No backend is deployed yet/i)).toBeInTheDocument();
  });
});
