import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { DeliverabilityView } from "./DeliverabilityView";
import type { DeliverabilityStatus } from "@mailpoppy/core";

afterEach(() => cleanup());

function status(p: Partial<DeliverabilityStatus> = {}): DeliverabilityStatus {
  return {
    totals: { deliveryAttempts: 500, bounces: 2, complaints: 0, rejects: 0 },
    bounceRate: 2 / 500,
    complaintRate: 0,
    windowDays: 14,
    sendingPaused: false,
    enforcementStatus: "HEALTHY",
    dailyUsed: 30,
    dailyLimit: 50000,
    suppressed: [],
    ...p,
  };
}

describe("DeliverabilityView", () => {
  it("shows a healthy headline in plain language when rates are low", async () => {
    render(<DeliverabilityView load={vi.fn(async () => status())} />);
    expect(await screen.findByText("Your email is in good shape")).toBeInTheDocument();
    // plain-language metric titles, not AWS jargon
    expect(screen.getByText("Bounced back")).toBeInTheDocument();
    expect(screen.getByText("Marked as spam")).toBeInTheDocument();
    expect(screen.getByText("Sent today")).toBeInTheDocument();
    // sent-today shows used / limit
    expect(screen.getByText(/50,000/)).toBeInTheDocument();
  });

  it("escalates to 'needs attention' when the bounce rate is high", async () => {
    const high = status({ totals: { deliveryAttempts: 100, bounces: 8, complaints: 0, rejects: 0 }, bounceRate: 0.08 });
    render(<DeliverabilityView load={vi.fn(async () => high)} />);
    expect(await screen.findByText("This needs your attention")).toBeInTheDocument();
    expect(screen.getByText(/8\.0%/)).toBeInTheDocument();
  });

  it("calls out a paused account loudly", async () => {
    render(<DeliverabilityView load={vi.fn(async () => status({ sendingPaused: true }))} />);
    expect(await screen.findByText("Your sending is paused")).toBeInTheDocument();
  });

  it("shows a friendly empty state when nothing has been sent", async () => {
    const fresh = status({ totals: { deliveryAttempts: 0, bounces: 0, complaints: 0, rejects: 0 }, bounceRate: 0, dailyUsed: 0 });
    render(<DeliverabilityView load={vi.fn(async () => fresh)} />);
    expect(await screen.findByText("Nothing to report yet")).toBeInTheDocument();
  });

  it("lists do-not-send addresses with a plain-language reason, or says none", async () => {
    const withSuppression = status({
      suppressed: [
        { address: "bad@nowhere.test", reason: "bounce", detail: "Permanent", suppressedAt: "2026-06-01T00:00:00.000Z" },
        { address: "angry@example.test", reason: "complaint", suppressedAt: "2026-06-02T00:00:00.000Z" },
      ],
    });
    const { unmount } = render(<DeliverabilityView load={vi.fn(async () => withSuppression)} />);
    expect(await screen.findByText("bad@nowhere.test")).toBeInTheDocument();
    expect(screen.getByText(/kept bouncing/)).toBeInTheDocument();
    expect(screen.getByText(/marked your email as spam/)).toBeInTheDocument();
    unmount();

    render(<DeliverabilityView load={vi.fn(async () => status())} />);
    expect(await screen.findByText(/haven't had to stop sending to anyone/)).toBeInTheDocument();
  });

  it("surfaces a load error with a friendly message", async () => {
    render(
      <DeliverabilityView
        load={vi.fn(async () => {
          throw new Error("sidecar 502: boom");
        })}
      />,
    );
    await waitFor(() => expect(screen.getByText(/Couldn't check your sending health/)).toBeInTheDocument());
  });
});
