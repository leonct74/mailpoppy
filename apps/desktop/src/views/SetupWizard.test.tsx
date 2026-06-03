import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { SetupWizard } from "./SetupWizard";
import { sidecar } from "../lib/sidecar";

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
    // Guidance should point at the profiles file and how to list profile names.
    expect(screen.getByText("~/.aws/credentials")).toBeInTheDocument();
    expect(screen.getByText("aws configure list-profiles")).toBeInTheDocument();
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

    expect(await screen.findByText(/Action needed before setup/i)).toBeInTheDocument();
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
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
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

    expect(await screen.findByText(/Backend deployed/i)).toBeInTheDocument();
    await waitFor(() => expect(localStorage.getItem("mailpoppy.deployment")).toContain("api.example.com"));
    confirmSpy.mockRestore();
  });

  it("shows a clear message when the backend stack isn't deployed", async () => {
    mockSidecar.mockImplementation(async (path: string) => {
      if (path === "/aws/readiness") return READY;
      if (path.startsWith("/mailbox/list")) throw new Error("sidecar 404: No deployed Mailpoppy backend was found.");
      throw new Error(`unexpected ${path}`);
    });

    render(<SetupWizard />);
    await screen.findByText(/Environment ready/i);

    expect(await screen.findByText(/No deployed Mailpoppy backend/i)).toBeInTheDocument();
  });
});
