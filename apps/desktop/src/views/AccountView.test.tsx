import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { AccountView } from "./AccountView";
import type { Inventory } from "../lib/resources";

// The composed children self-load from the sidecar; stub them so this test
// focuses on AccountView's own job: gating the shared settings on a deployed
// backend and always offering the resource inventory.
vi.mock("./PolicyEditor", () => ({ PolicyEditor: () => <div>MAIL RULES STUB</div> }));
vi.mock("./RetentionEditor", () => ({ RetentionEditor: () => <div>RETENTION STUB</div> }));
vi.mock("./ResourcesView", () => ({ ResourcesView: () => <div>RESOURCES STUB</div> }));

afterEach(() => cleanup());

const inventory = (stackExists: boolean): Inventory => ({
  stackName: "MailpoppyMailStack",
  region: "eu-west-1",
  stackExists,
  resources: [],
  ledger: [],
});

describe("AccountView", () => {
  it("shows shared settings + the resource inventory once a backend is deployed", async () => {
    render(<AccountView loadInventory={async () => inventory(true)} />);

    expect(await screen.findByText("MAIL RULES STUB")).toBeInTheDocument();
    expect(screen.getByText("RETENTION STUB")).toBeInTheDocument();
    expect(screen.getByText("RESOURCES STUB")).toBeInTheDocument();
  });

  it("hides shared settings and points to Setup when no backend exists yet", async () => {
    render(<AccountView loadInventory={async () => inventory(false)} />);

    // The resource inventory is always available (it handles no-backend itself)…
    expect(await screen.findByText("RESOURCES STUB")).toBeInTheDocument();
    // …but mail rules / retention are gated and replaced by a deploy hint.
    expect(screen.getByText(/Deploy one from the/i)).toBeInTheDocument();
    expect(screen.queryByText("MAIL RULES STUB")).not.toBeInTheDocument();
    expect(screen.queryByText("RETENTION STUB")).not.toBeInTheDocument();
  });
});
