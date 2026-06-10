import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { SetupWizard } from "./SetupWizard";
import { sidecar } from "../lib/sidecar";
import { saveDeploymentConfig } from "../lib/deploymentConfig";

// Mock the local sidecar client so we can drive the readiness states an admin
// with valid credentials can't otherwise reproduce (missing creds / denied perms).
vi.mock("../lib/sidecar", () => ({ sidecar: vi.fn() }));
const mockSidecar = vi.mocked(sidecar);

beforeEach(() => {
  mockSidecar.mockReset();
  localStorage.clear();
});

// globals:false → Testing Library's auto-cleanup isn't registered, so unmount manually.
afterEach(() => {
  cleanup();
});

const READY = {
  cli: { installed: true, version: "aws-cli/2.x" },
  credentials: { ok: true, arn: "arn:aws:iam::123456789012:user/admin", account: "123456789012" },
  permissions: { route53: "ok", ses: "ok", sesv2: "ok", s3: "ok" },
  ready: true,
};

const BACKEND = {
  ok: true,
  region: "eu-west-1",
  userPoolId: "eu-west-1_abc123",
  clientId: "client123",
  apiBaseUrl: "https://api.example.com",
};

// Route sidecar calls by path so the readiness check and the mailbox endpoints
// each return their own shape.
function route(handlers: Record<string, unknown>) {
  mockSidecar.mockImplementation(async (path: string) => {
    if (path === "/aws/readiness") return handlers.readiness;
    if (path.startsWith("/mailbox/list")) return handlers.list ?? { ...BACKEND, mailboxes: [] };
    if (path === "/mailbox/create") return handlers.create;
    throw new Error(`unexpected sidecar path ${path}`);
  });
}

describe("SetupWizard · Step 0 readiness gate", () => {
  it("blocks setup and guides the user when credentials are missing", async () => {
    route({
      readiness: {
        cli: { installed: false },
        credentials: { ok: false, error: "Unable to locate credentials" },
        permissions: { route53: "error", ses: "error", sesv2: "error", s3: "error" },
        ready: false,
      },
    });

    render(<SetupWizard />);

    expect(await screen.findByText(/No usable AWS credentials/i)).toBeInTheDocument();
    // The guided "connect your AWS account" panel appears — account sign-up help
    // plus an in-app key-entry form, so a newcomer never needs a terminal.
    expect(screen.getByText(/Connect your AWS account/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /aws\.amazon\.com\/free/i })).toBeInTheDocument();
    expect(screen.getByLabelText("Access Key ID")).toBeInTheDocument();
    // Domain input is gated until ready.
    expect(screen.getByPlaceholderText("yourdomain.com")).toBeDisabled();
  });

  it("flags a denied service and points at the identity to fix", async () => {
    route({
      readiness: {
        ...READY,
        permissions: { route53: "denied", ses: "ok", sesv2: "ok", s3: "ok" },
        ready: false,
      },
    });

    render(<SetupWizard />);

    expect(await screen.findByText(/permission is missing/i)).toBeInTheDocument();
    expect(screen.getByText(/access denied/i)).toBeInTheDocument();
    expect(screen.getByText(/AdministratorAccess/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText("yourdomain.com")).toBeDisabled();
  });

  it("enables setup when the environment is ready", async () => {
    route({ readiness: READY });

    render(<SetupWizard />);

    expect(await screen.findByText(/Environment ready/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText("yourdomain.com")).not.toBeDisabled();
  });

  it("lower-cases the domain input so DNS lookups don't fail on capitalization", async () => {
    route({ readiness: READY });
    render(<SetupWizard />);
    await screen.findByText(/Environment ready/i);

    const input = screen.getByPlaceholderText("yourdomain.com") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Ollydigital.com" } });
    expect(input.value).toBe("ollydigital.com");
  });
});

describe("SetupWizard · Mailboxes", () => {
  it("creates a mailbox and saves the backend config so the Inbox can connect", async () => {
    route({
      readiness: READY,
      list: { ...BACKEND, mailboxes: [] },
      create: { ...BACKEND, mailbox: { email: "you@yourdomain.com", status: "CONFIRMED" } },
    });

    render(<SetupWizard />);
    await screen.findByText(/Environment ready/i);

    fireEvent.change(await screen.findByLabelText("Mailbox email"), { target: { value: "You@YourDomain.com" } });
    fireEvent.change(screen.getByLabelText("Mailbox password"), { target: { value: "Mailpoppy-Test-1!" } });
    fireEvent.click(screen.getByRole("button", { name: "Create mailbox" }));

    // Success banner + the create call gets a lower-cased email.
    expect(await screen.findByText(/tab is now connected/i)).toBeInTheDocument();
    await waitFor(() => expect(mockSidecar).toHaveBeenCalledWith("/mailbox/create", expect.anything()));
    const createCall = mockSidecar.mock.calls.find((c) => c[0] === "/mailbox/create")!;
    const body = JSON.parse((createCall[1] as RequestInit).body as string);
    expect(body.email).toBe("you@yourdomain.com");

    // Deployment config persisted for the Inbox tab.
    await waitFor(() => expect(localStorage.getItem("mailpoppy.deployment")).toContain("api.example.com"));
  });

  it("deploys the backend in-app (CloudFormation) and saves the client config", async () => {
    mockSidecar.mockImplementation(async (path: string) => {
      if (path === "/aws/readiness") return READY;
      if (path.startsWith("/mailbox/list")) return { ...BACKEND, mailboxes: [] };
      if (path.startsWith("/aws/preflight")) return { accountId: "123456789012", zoneId: "Z123", region: "eu-west-1" };
      if (path === "/deploy/backend") return { ok: true, stackName: "MailpoppyMailStack", operation: "CREATE", bucket: "b", region: "eu-west-1" };
      if (path.endsWith("/status")) {
        return {
          status: "CREATE_COMPLETE",
          complete: true,
          failed: false,
          outputs: {
            ApiBaseUrl: "https://api.example.com",
            UserPoolId: "eu-west-1_abc123",
            UserPoolClientId: "client123",
            DeployRegion: "eu-west-1",
          },
        };
      }
      throw new Error(`unexpected sidecar path ${path}`);
    });

    render(<SetupWizard />);
    await screen.findByText(/Environment ready/i);

    fireEvent.change(screen.getByPlaceholderText("yourdomain.com"), { target: { value: "ollydigital.com" } });
    fireEvent.click(screen.getByRole("button", { name: /Check AWS/i }));
    await screen.findByText(/Hosted zone/i);

    fireEvent.click(screen.getByRole("button", { name: /Deploy backend/i }));
    // Confirm via the in-app dialog (native window.confirm is unreliable in the
    // Tauri webview, so we render our own).
    fireEvent.click(await screen.findByRole("button", { name: /Yes, continue/i }));

    expect(await screen.findByText(/Backend deployed/i)).toBeInTheDocument();
    await waitFor(() => expect(localStorage.getItem("mailpoppy.deployment")).toContain("api.example.com"));
  });

  it("confirms deploy via an in-app dialog, and cancelling does not deploy", async () => {
    mockSidecar.mockImplementation(async (path: string) => {
      if (path === "/aws/readiness") return READY;
      if (path.startsWith("/mailbox/list")) return { ...BACKEND, mailboxes: [] };
      if (path.startsWith("/aws/preflight")) return { accountId: "123456789012", zoneId: "Z123", region: "eu-west-1" };
      if (path === "/deploy/backend") throw new Error("deploy must not be called after cancel");
      throw new Error(`unexpected sidecar path ${path}`);
    });

    render(<SetupWizard />);
    await screen.findByText(/Environment ready/i);
    fireEvent.change(screen.getByPlaceholderText("yourdomain.com"), { target: { value: "ollydigital.com" } });
    fireEvent.click(screen.getByRole("button", { name: /Check AWS/i }));
    await screen.findByText(/Hosted zone/i);

    fireEvent.click(screen.getByRole("button", { name: /Deploy backend/i }));
    // The dialog is our own element, not a native prompt.
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Cancel/i }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // No deploy was attempted (the /deploy/backend handler would have thrown).
    expect(mockSidecar.mock.calls.find((c) => c[0] === "/deploy/backend")).toBeUndefined();
  });

  it("re-running for an existing domain locks the domain and skips deploy", async () => {
    // A backend already exists in this install…
    saveDeploymentConfig({
      apiBaseUrl: "https://api.example.com",
      userPoolId: "eu-west-1_abc123",
      clientId: "client123",
      region: "eu-west-1",
      stackName: "MailpoppyMailStack",
    });
    mockSidecar.mockImplementation(async (path: string) => {
      if (path === "/aws/readiness") return READY;
      if (path.startsWith("/mailbox/list")) return { ...BACKEND, mailboxes: [] };
      if (path.startsWith("/aws/preflight")) return { accountId: "123456789012", zoneId: "Z123", region: "eu-west-1" };
      throw new Error(`unexpected sidecar path ${path}`);
    });

    render(<SetupWizard presetDomain="second.com" />);
    await screen.findByText(/Environment ready/i);

    // The domain is preset and locked (can't be edited for a re-run).
    const input = screen.getByPlaceholderText("yourdomain.com") as HTMLInputElement;
    expect(input.value).toBe("second.com");
    expect(input).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /Check AWS/i }));
    await screen.findByText(/Hosted zone/i);

    // No deploy step — the backend exists — so the SES/DNS provision button is shown instead.
    expect(screen.queryByRole("button", { name: /Deploy backend/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Set up domain mail/i })).toBeInTheDocument();
  });

  it("treats a not-yet-deployed backend as the expected first-run state, not a red error", async () => {
    mockSidecar.mockImplementation(async (path: string) => {
      if (path === "/aws/readiness") return READY;
      if (path.startsWith("/mailbox/list")) throw new Error("sidecar 404: No deployed Mailpoppy backend was found yet.");
      throw new Error(`unexpected ${path}`);
    });

    render(<SetupWizard />);
    await screen.findByText(/Environment ready/i);

    // Friendly deploy hint, not the raw sidecar error.
    expect(await screen.findByText(/No backend deployed yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/sidecar 404/i)).not.toBeInTheDocument();
    // Create is gated until the backend exists.
    expect(screen.getByRole("button", { name: "Create mailbox" })).toBeDisabled();
  });
});
