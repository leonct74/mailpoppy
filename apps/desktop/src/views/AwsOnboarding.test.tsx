import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { AwsOnboarding } from "./AwsOnboarding";
import type { Readiness } from "../lib/awsCredentials";

afterEach(() => cleanup());

const readiness = (p: Partial<Readiness["credentials"]> = {}): Readiness => ({
  cli: { installed: true },
  credentials: { ok: true, arn: "arn:aws:iam::1:user/x", account: "1", ...p },
  permissions: { route53: "ok", ses: "ok", sesv2: "ok", s3: "ok" },
  ready: true,
});

describe("AwsOnboarding", () => {
  it("guides a newcomer (account sign-up + IAM keys) with working links", () => {
    render(<AwsOnboarding onResult={vi.fn()} onRecheck={vi.fn()} />);
    expect(screen.getByText(/Connect your AWS account/i)).toBeInTheDocument();
    expect(screen.getByText(/your own/i)).toBeInTheDocument();
    const signup = screen.getByRole("link", { name: /aws\.amazon\.com\/free/i });
    expect(signup).toHaveAttribute("href", "https://aws.amazon.com/free/");
    expect(screen.getByRole("link", { name: /IAM/i })).toBeInTheDocument();
  });

  it("disables Connect until both keys are entered, then submits trimmed values", async () => {
    const submit = vi.fn(async () => readiness());
    const onResult = vi.fn();
    render(<AwsOnboarding onResult={onResult} onRecheck={vi.fn()} submit={submit} />);

    const connect = screen.getByRole("button", { name: /^connect/i });
    expect(connect).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Access Key ID"), { target: { value: "AKIAEXAMPLE" } });
    fireEvent.change(screen.getByLabelText("Secret Access Key"), { target: { value: "secretvalue" } });
    expect(connect).not.toBeDisabled();

    fireEvent.click(connect);
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(submit).toHaveBeenCalledWith({
      accessKeyId: "AKIAEXAMPLE",
      secretAccessKey: "secretvalue",
      sessionToken: undefined,
    });
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(readiness()));
  });

  it("surfaces AWS rejecting the keys (but still reports the result up)", async () => {
    const bad = readiness({ ok: false, error: "InvalidClientTokenId" });
    const onResult = vi.fn();
    render(<AwsOnboarding onResult={onResult} onRecheck={vi.fn()} submit={vi.fn(async () => bad)} />);
    fireEvent.change(screen.getByLabelText("Access Key ID"), { target: { value: "AKIA" } });
    fireEvent.change(screen.getByLabelText("Secret Access Key"), { target: { value: "nope" } });
    fireEvent.click(screen.getByRole("button", { name: /^connect/i }));
    await waitFor(() => expect(screen.getByText(/didn't accept those keys/i)).toBeInTheDocument());
    expect(screen.getByText(/InvalidClientTokenId/)).toBeInTheDocument();
    expect(onResult).toHaveBeenCalledWith(bad);
  });

  it("re-checks the environment (for the CLI/SSO path)", () => {
    const onRecheck = vi.fn();
    render(<AwsOnboarding onResult={vi.fn()} onRecheck={onRecheck} />);
    fireEvent.click(screen.getByRole("button", { name: /re-check/i }));
    expect(onRecheck).toHaveBeenCalledTimes(1);
  });

  it("reveals the session-token field and CLI hint on demand", () => {
    render(<AwsOnboarding onResult={vi.fn()} onRecheck={vi.fn()} cliInstalled={false} />);
    expect(screen.queryByLabelText(/Session token/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /temporary credentials/i }));
    expect(screen.getByLabelText(/Session token/i)).toBeInTheDocument();
    // CLI not installed → the hint mentions installing it
    expect(screen.getByText(/installing the AWS CLI/i)).toBeInTheDocument();
  });
});
