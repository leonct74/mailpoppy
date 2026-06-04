import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { PolicyEditor } from "./PolicyEditor";
import type { SpamPolicy } from "@mailpoppy/core";

afterEach(() => cleanup());

const policy: SpamPolicy = {
  onVirus: "quarantine",
  onSpam: "junk",
  onAuthFail: "junk",
  allowList: ["boss@partner.com"],
  blockList: ["bad.com"],
};

describe("PolicyEditor", () => {
  it("loads and shows the current policy", async () => {
    render(<PolicyEditor stackName="MailpoppyMailStack" load={async () => policy} />);

    expect(await screen.findByLabelText("Spam action")).toHaveValue("junk");
    expect(screen.getByLabelText("Virus action")).toHaveValue("quarantine");
    expect(screen.getByLabelText("Allow list")).toHaveValue("boss@partner.com");
    expect(screen.getByLabelText("Block list")).toHaveValue("bad.com");
  });

  it("saves edited actions and lists", async () => {
    const save = vi.fn(async (input: { stackName: string; policy: SpamPolicy }) => ({ ok: true as const, policy: input.policy }));
    render(<PolicyEditor stackName="MailpoppyMailStack" load={async () => policy} save={save} />);

    fireEvent.change(await screen.findByLabelText("Spam action"), { target: { value: "reject" } });
    fireEvent.change(screen.getByLabelText("Block list"), { target: { value: "bad.com\nspammer@evil.com" } });
    fireEvent.click(screen.getByRole("button", { name: /Save mail rules/i }));

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    const arg = save.mock.calls[0]![0];
    expect(arg.stackName).toBe("MailpoppyMailStack");
    expect(arg.policy.onSpam).toBe("reject");
    expect(arg.policy.blockList).toEqual(["bad.com", "spammer@evil.com"]);
    expect(arg.policy.allowList).toEqual(["boss@partner.com"]);
    expect(await screen.findByText(/Saved/i)).toBeInTheDocument();
  });

  it("warns about entries that aren't a valid address or domain", async () => {
    render(<PolicyEditor stackName="MailpoppyMailStack" load={async () => policy} />);

    fireEvent.change(await screen.findByLabelText("Allow list"), { target: { value: "not-an-address" } });
    expect(await screen.findByText(/don't look like an address or domain/i)).toBeInTheDocument();
  });
});
