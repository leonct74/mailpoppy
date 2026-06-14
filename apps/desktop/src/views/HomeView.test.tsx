import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { HomeView } from "./HomeView";

afterEach(() => cleanup());

const ready = {
  listMailboxes: async () => ({
    region: "eu-west-1",
    mailboxes: [
      { email: "support@boxord.com", status: "CONFIRMED" },
      { email: "info@boxord.com", status: "CONFIRMED" },
      { email: "hello@example.org", status: "CONFIRMED" },
    ],
  }),
  listDomains: async () => ({ domains: ["boxord.com", "example.org"] }),
  getAccount: async () => ({
    productionAccessEnabled: false,
    sendingEnabled: true,
    sendQuota: { max24Hour: 200, maxSendRate: 1, sentLast24Hours: 5 },
  }),
  getDomainStatus: async () => ({ verifiedForSending: true, dkim: "SUCCESS" }),
  getMailFrom: async (d: string) => ({ status: "Success", mailFromDomain: `mail.${d}` }),
};

describe("HomeView", () => {
  it("shows account posture and a card per domain with mailbox counts + health badges", async () => {
    render(<HomeView {...ready} />);

    // A card per domain.
    expect(await screen.findByText("boxord.com")).toBeInTheDocument();
    expect(screen.getByText("example.org")).toBeInTheDocument();

    // Per-domain mailbox counts (2 on boxord.com, 1 on example.org).
    expect(screen.getByText(/2 mailboxes/)).toBeInTheDocument();
    expect(screen.getByText(/1 mailbox\b/)).toBeInTheDocument();

    // Account posture: region + SES sandbox.
    expect(screen.getByText("eu-west-1")).toBeInTheDocument();
    expect(screen.getByText("Sandbox")).toBeInTheDocument();

    // Health badges resolve asynchronously (one per domain).
    expect((await screen.findAllByText("DKIM verified")).length).toBe(2);
    expect(screen.getAllByText("MAIL FROM aligned").length).toBe(2);
  });

  it("does NOT offer to remove infrastructure while domains exist", async () => {
    render(<HomeView {...ready} />);
    await screen.findByText("boxord.com");
    expect(screen.queryByText("Remove leftover infrastructure")).not.toBeInTheDocument();
  });

  it("offers a guarded full teardown when the backend is deployed but no domains remain", async () => {
    const teardown = vi.fn(async () => ({
      ok: true as const,
      domain: "",
      domains: [],
      stackName: "MailpoppyMailStack",
      deleted: ["CloudFormation stack MailpoppyMailStack", "S3 bucket mailpoppy-mail-x"],
      warnings: [],
    }));
    render(
      <HomeView
        {...ready}
        listMailboxes={async () => ({ region: "eu-west-1", mailboxes: [] })}
        listDomains={async () => ({ domains: [] })}
        teardown={teardown}
      />,
    );

    // The danger zone appears (backend deployed + zero domains).
    const toggle = await screen.findByText("Remove leftover infrastructure");
    fireEvent.click(toggle);

    // Gated: the button is disabled until "DELETE" is typed.
    const remove = screen.getByRole("button", { name: /Remove infrastructure/i });
    expect(remove).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Type DELETE to confirm/i), { target: { value: "DELETE" } });
    expect(remove).not.toBeDisabled();

    fireEvent.click(remove);
    await waitFor(() => expect(teardown).toHaveBeenCalledWith({ stackName: "MailpoppyMailStack" }));
    // Result summary surfaces what was deleted.
    expect(await screen.findByText(/Infrastructure removed/i)).toBeInTheDocument();
    expect(screen.getByText(/CloudFormation stack MailpoppyMailStack/)).toBeInTheDocument();
  });

  it("hides the teardown when the backend can't be confirmed (e.g. a fresh account)", async () => {
    // The teardown-discover endpoint returns [] even with no stack, while the
    // mailbox read fails for a non-"no backend" reason. The destructive control
    // must NOT appear without positive proof a backend exists.
    render(
      <HomeView
        {...ready}
        listMailboxes={async () => {
          throw new Error('sidecar 500: {"ok":false,"error":"AccessDenied"}');
        }}
        listDomains={async () => ({ domains: [] })}
      />,
    );
    await screen.findByText(/Your domains/i);
    expect(screen.queryByText("Remove leftover infrastructure")).not.toBeInTheDocument();
    // Backend posture is honest about the uncertainty.
    expect(screen.getByText("unavailable")).toBeInTheDocument();
  });

  it("guides to Setup when no backend is deployed yet", async () => {
    const onGoToSetup = vi.fn();
    const noBackend = () =>
      Promise.reject(new Error('sidecar 404: {"ok":false,"error":"No deployed Mailpoppy backend was found yet."}'));
    render(
      <HomeView
        onGoToSetup={onGoToSetup}
        listMailboxes={noBackend}
        listDomains={noBackend}
        getAccount={noBackend}
      />,
    );

    const btn = await screen.findByRole("button", { name: /Set up your first domain/ });
    fireEvent.click(btn);
    expect(onGoToSetup).toHaveBeenCalled();
  });
});
