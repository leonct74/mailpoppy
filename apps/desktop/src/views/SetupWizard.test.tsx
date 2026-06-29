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
    // plus the recommended CLI path (the key-paste form is a downranked disclosure).
    // (the progress map also lists "Connect your AWS account" — target the panel heading)
    expect(screen.getByRole("heading", { name: /Connect your AWS account/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /aws\.amazon\.com\/free/i })).toBeInTheDocument();
    expect(screen.getByText(/aws configure --profile mailpoppy/i)).toBeInTheDocument();
    // Domain input is gated until ready.
    expect(screen.getByPlaceholderText("yourdomain.com")).toBeDisabled();
  });

  it("never claims the backend is live from a stale local config when AWS can't confirm it", async () => {
    // Reproduces the torn-down case: everything (incl. the IAM user) was removed,
    // but a deployment config lingers in localStorage. Credentials no longer
    // resolve (not ready), so listMailboxes can't run and live state is unknown.
    // The progress panel must NOT fall back to the stale flag and claim live.
    saveDeploymentConfig({
      apiBaseUrl: "https://old.example.com",
      userPoolId: "eu-west-1_old",
      clientId: "old",
      region: "eu-west-1",
      stackName: "MailpoppyMailStack",
    });
    route({
      readiness: {
        cli: { installed: true, version: "aws-cli/2.x" },
        credentials: { ok: false, error: "Unable to locate credentials" },
        permissions: { route53: "error", ses: "error", sesv2: "error", s3: "error" },
        ready: false,
      },
    });

    render(<SetupWizard />);
    await screen.findByText(/No usable AWS credentials/i);

    // The panel must not show the backend as live...
    expect(screen.queryByText(/Your backend is live/i)).not.toBeInTheDocument();
    // ...the "Create your backend" phase is still shown as to-do.
    expect(screen.getByText(/A one-time setup/i)).toBeInTheDocument();
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
  it("blocks mailbox creation until the domain's SES + DNS verify, then creates + saves config", async () => {
    // Realistic: no backend exists until the user deploys one (so resume-from-reality
    // sees a true fresh start, and "Deploy backend" is the offered action).
    let deployed = false;
    mockSidecar.mockImplementation(async (path: string) => {
      if (path === "/aws/readiness") return READY;
      if (path.startsWith("/mailbox/list")) {
        if (!deployed) throw new Error("sidecar 404: No deployed Mailpoppy backend was found yet.");
        return { ...BACKEND, mailboxes: [] };
      }
      if (path.startsWith("/aws/preflight")) return { accountId: "123456789012", zoneId: "Z123", region: "eu-west-1" };
      if (path === "/deploy/backend") {
        deployed = true;
        return { ok: true, stackName: "MailpoppyMailStack", operation: "CREATE", bucket: "b", region: "eu-west-1" };
      }
      // Provision status (DKIM verified). Checked before the generic deploy /status.
      if (path.includes("/provision/") && path.endsWith("/status")) return { dkim: "SUCCESS", verifiedForSending: true };
      if (path.endsWith("/status")) {
        return {
          status: "CREATE_COMPLETE",
          complete: true,
          failed: false,
          outputs: { ApiBaseUrl: "https://api.example.com", UserPoolId: "eu-west-1_abc123", UserPoolClientId: "client123", DeployRegion: "eu-west-1" },
        };
      }
      if (path.startsWith("/provision/")) return { ok: true, dkimTokens: ["t1", "t2", "t3"] };
      if (path === "/mailbox/create") return { ...BACKEND, mailbox: { email: "you@yourdomain.com", status: "CONFIRMED" } };
      throw new Error(`unexpected sidecar path ${path}`);
    });

    render(<SetupWizard />);
    await screen.findByText(/Environment ready/i);

    // Deploy the backend for a brand-new domain (its SES/DNS isn't verified yet).
    fireEvent.change(screen.getByPlaceholderText("yourdomain.com"), { target: { value: "yourdomain.com" } });
    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
    await screen.findByText(/Hosted zone/i);
    fireEvent.click(screen.getByRole("button", { name: /Deploy backend/i }));
    fireEvent.click(await screen.findByRole("button", { name: /Yes, continue/i }));
    await screen.findByText(/Backend deployed/i);

    // Backend exists but the domain isn't verified → Mailboxes is a locked
    // upcoming step: no form fields and no Create button, so it can't read as a
    // broken dead-end.
    expect(await screen.findByText(/can't send or receive mail yet/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("Mailbox email")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create mailbox" })).not.toBeInTheDocument();

    // Provision + verify the domain → the form UNLOCKS.
    fireEvent.click(screen.getByRole("button", { name: /Set up domain mail/i }));
    fireEvent.click(await screen.findByRole("button", { name: /Yes, continue/i }));
    await screen.findByText(/DKIM verified/i);

    // The real form is now present — fill it and create.
    fireEvent.change(await screen.findByLabelText("Mailbox email"), { target: { value: "You@YourDomain.com" } });
    fireEvent.change(screen.getByLabelText("Mailbox password"), { target: { value: "Mailpoppy-Test-1!" } });
    const createBtn = screen.getByRole("button", { name: "Create mailbox" });
    expect(createBtn).not.toBeDisabled();
    fireEvent.click(createBtn);

    // Success banner + the create call gets a lower-cased email.
    expect(await screen.findByText(/tab is now connected/i)).toBeInTheDocument();
    const createCall = mockSidecar.mock.calls.find((c) => c[0] === "/mailbox/create")!;
    const body = JSON.parse((createCall[1] as RequestInit).body as string);
    expect(body.email).toBe("you@yourdomain.com");

    // Deployment config persisted for the Inbox tab.
    await waitFor(() => expect(localStorage.getItem("mailpoppy.deployment")).toContain("api.example.com"));
  });

  it("deploys the backend in-app (CloudFormation) and saves the client config", async () => {
    let deployed = false;
    mockSidecar.mockImplementation(async (path: string) => {
      if (path === "/aws/readiness") return READY;
      if (path.startsWith("/mailbox/list")) {
        if (!deployed) throw new Error("sidecar 404: No deployed Mailpoppy backend was found yet.");
        return { ...BACKEND, mailboxes: [] };
      }
      if (path.startsWith("/aws/preflight")) return { accountId: "123456789012", zoneId: "Z123", region: "eu-west-1" };
      if (path === "/deploy/backend") {
        deployed = true;
        return { ok: true, stackName: "MailpoppyMailStack", operation: "CREATE", bucket: "b", region: "eu-west-1" };
      }
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
    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
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
      if (path.startsWith("/mailbox/list")) throw new Error("sidecar 404: No deployed Mailpoppy backend was found yet.");
      if (path.startsWith("/aws/preflight")) return { accountId: "123456789012", zoneId: "Z123", region: "eu-west-1" };
      if (path === "/deploy/backend") throw new Error("deploy must not be called after cancel");
      throw new Error(`unexpected sidecar path ${path}`);
    });

    render(<SetupWizard />);
    await screen.findByText(/Environment ready/i);
    fireEvent.change(screen.getByPlaceholderText("yourdomain.com"), { target: { value: "ollydigital.com" } });
    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
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

    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
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
    expect(await screen.findByText(/your mailboxes live\s+there/i)).toBeInTheDocument();
    expect(screen.queryByText(/sidecar 404/i)).not.toBeInTheDocument();
    // Locked upcoming step: no dead form — the Create button isn't rendered at all
    // until the backend exists and the domain verifies.
    expect(screen.queryByRole("button", { name: "Create mailbox" })).not.toBeInTheDocument();
  });
});

describe("SetupWizard · resume from reality", () => {
  it("resumes a deployed + verified domain after a restart — no progress lost", async () => {
    mockSidecar.mockImplementation(async (path: string) => {
      if (path === "/aws/readiness") return READY;
      if (path.startsWith("/mailbox/list")) return { ...BACKEND, mailboxes: [] };
      if (path.startsWith("/teardown/domains")) return { ok: true, domains: ["resumed.com"] };
      if (path.includes("/provision/") && path.endsWith("/status")) return { dkim: "SUCCESS", verifiedForSending: true };
      // Unmocked paths (region config, MAIL FROM status) throw — those components
      // tolerate sidecar failures, and reconcile swallows best-effort lookups.
      throw new Error(`unexpected sidecar path ${path}`);
    });

    render(<SetupWizard />);

    // The domain is restored from AWS, not a blank field…
    await waitFor(() =>
      expect((screen.getByPlaceholderText("yourdomain.com") as HTMLInputElement).value).toBe("resumed.com"),
    );
    // …the persistent progress map is always present…
    expect(screen.getByText(/Your setup progress/i)).toBeInTheDocument();
    // …the domain reads as verified in the map…
    expect(await screen.findByText(/ready to send and receive/i)).toBeInTheDocument();
    // …and the mailbox form is unlocked because we resumed past verification.
    expect(screen.getByLabelText("Mailbox email")).toBeInTheDocument();
  });

  it("surfaces leftover DNS and lands on Deploy backend when a domain exists but no backend is deployed", async () => {
    mockSidecar.mockImplementation(async (path: string) => {
      if (path === "/aws/readiness") return READY;
      if (path.startsWith("/mailbox/list")) throw new Error("sidecar 404: No deployed Mailpoppy backend was found yet.");
      if (path.startsWith("/teardown/domains")) return { ok: true, domains: ["leftover.com"] };
      if (path.startsWith("/aws/preflight")) return { accountId: "123456789012", zoneId: "Z123", region: "eu-west-1" };
      if (path.startsWith("/provision/") && path.endsWith("/status")) throw new Error("sidecar 404: identity not found");
      throw new Error(`unexpected sidecar path ${path}`);
    });

    render(<SetupWizard />);

    expect(await screen.findByText(/leftover mail DNS/i)).toBeInTheDocument();
    expect((screen.getByPlaceholderText("yourdomain.com") as HTMLInputElement).value).toBe("leftover.com");
    // The resume auto-preflights so the user isn't stranded at "Create your backend"
    // with no trigger — the Deploy backend action is reachable, not a bare "Continue".
    expect(await screen.findByRole("button", { name: /Deploy backend/i })).toBeInTheDocument();
  });

  it("resumes a deploy that is still running in the background after a restart", async () => {
    mockSidecar.mockImplementation(async (path: string) => {
      if (path === "/aws/readiness") return READY;
      if (path.startsWith("/mailbox/list")) throw new Error("sidecar 404: No deployed Mailpoppy backend was found yet.");
      // The shared backend stack is mid-create — the deploy the user kicked off before
      // navigating away is still in flight server-side.
      if (path.endsWith("/status")) return { status: "CREATE_IN_PROGRESS", complete: false, failed: false, stackId: "s-inflight" };
      throw new Error(`unexpected sidecar path ${path}`);
    });

    render(<SetupWizard />);

    // We land back on the LIVE deploy progress — not a blank form or a dead spinner.
    // (The "keeps running in the background" line is unique to the active deploy view.)
    expect(await screen.findByText(/keeps running in the background/i)).toBeInTheDocument();
  });
});
