import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
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
