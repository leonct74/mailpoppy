import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { AgentsPoppyConnect, type AgentsPoppyApi } from "./AgentsPoppyConnect";

afterEach(cleanup);

function makeApi(over: Partial<AgentsPoppyApi> = {}): AgentsPoppyApi {
  return {
    connect: vi.fn().mockResolvedValue({ connectionId: "c1", status: "active", accountId: "123456789012", alias: "Personal" }),
    status: vi.fn().mockResolvedValue({ enabled: false, connected: false }),
    disconnect: vi.fn().mockResolvedValue({ ok: true }),
    ...over,
  };
}

const openPanel = () =>
  fireEvent.click(screen.getByRole("button", { name: /Connect through AgentsPoppy/i }));

describe("AgentsPoppyConnect", () => {
  it("connects and reports once AgentsPoppy is vending credentials", async () => {
    const onRecheck = vi.fn();
    const api = makeApi();
    render(<AgentsPoppyConnect onRecheck={onRecheck} api={api} />);

    openPanel();
    fireEvent.click(screen.getByRole("button", { name: /Connect via AgentsPoppy/i }));

    await waitFor(() => expect(screen.getByText(/AgentsPoppy is now vending/i)).toBeInTheDocument());
    expect(api.connect).toHaveBeenCalled();
    expect(onRecheck).toHaveBeenCalled();
  });

  it("shows a waiting state until the user approves it in AgentsPoppy", async () => {
    const api = makeApi({
      connect: vi.fn().mockResolvedValue({ connectionId: "c1", status: "pending", accountId: "123456789012" }),
    });
    render(<AgentsPoppyConnect onRecheck={vi.fn()} api={api} />);

    openPanel();
    fireEvent.click(screen.getByRole("button", { name: /Connect via AgentsPoppy/i }));

    await waitFor(() => expect(screen.getByText(/Waiting for you to approve/i)).toBeInTheDocument());
  });

  it("surfaces a clear error when the broker can't be reached", async () => {
    const api = makeApi({
      connect: vi.fn().mockRejectedValue(new Error("Couldn't reach Mailpoppy's local helper.")),
    });
    render(<AgentsPoppyConnect onRecheck={vi.fn()} api={api} />);

    openPanel();
    fireEvent.click(screen.getByRole("button", { name: /Connect via AgentsPoppy/i }));

    await waitFor(() => expect(screen.getByRole("button", { name: /Retry/i })).toBeInTheDocument());
  });
});
