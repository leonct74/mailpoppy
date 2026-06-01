import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { SetupWizard } from "./SetupWizard";
import { sidecar } from "../lib/sidecar";

// Mock the local sidecar client so we can drive the readiness states an admin
// with valid credentials can't otherwise reproduce (missing creds / denied perms).
vi.mock("../lib/sidecar", () => ({ sidecar: vi.fn() }));
const mockSidecar = vi.mocked(sidecar);

beforeEach(() => {
  mockSidecar.mockReset();
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

describe("SetupWizard · Step 0 readiness gate", () => {
  it("blocks setup and guides the user when credentials are missing", async () => {
    mockSidecar.mockResolvedValue({
      cli: { installed: false },
      credentials: { ok: false, error: "Unable to locate credentials" },
      permissions: { route53: "error", ses: "error", sesv2: "error", s3: "error" },
      ready: false,
    });

    render(<SetupWizard />);

    expect(await screen.findByText(/No usable AWS credentials/i)).toBeInTheDocument();
    // CLI absent → guidance should tell them to install it.
    expect(screen.getByText(/install the AWS CLI/i)).toBeInTheDocument();
    // Domain input is gated until ready.
    expect(screen.getByPlaceholderText("ollydigital.com")).toBeDisabled();
  });

  it("flags a denied service and points at the identity to fix", async () => {
    mockSidecar.mockResolvedValue({
      ...READY,
      permissions: { route53: "denied", ses: "ok", sesv2: "ok", s3: "ok" },
      ready: false,
    });

    render(<SetupWizard />);

    expect(await screen.findByText(/Action needed before setup/i)).toBeInTheDocument();
    expect(screen.getByText(/access denied/i)).toBeInTheDocument();
    expect(screen.getByText(/AdministratorAccess/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText("ollydigital.com")).toBeDisabled();
  });

  it("enables setup when the environment is ready", async () => {
    mockSidecar.mockResolvedValue(READY);

    render(<SetupWizard />);

    expect(await screen.findByText(/Environment ready/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText("ollydigital.com")).not.toBeDisabled();
  });
});
