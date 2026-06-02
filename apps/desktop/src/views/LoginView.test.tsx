import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { LoginView } from "./LoginView";
import type { Authenticator, SignInResult } from "../lib/auth";

afterEach(() => cleanup());

function mockAuth(over: Partial<Authenticator> = {}): Authenticator & Record<string, ReturnType<typeof vi.fn>> {
  return {
    signIn: vi.fn(async (): Promise<SignInResult> => ({ status: "signed-in", email: "you@x.com" })),
    completeNewPassword: vi.fn(async (): Promise<SignInResult> => ({ status: "signed-in", email: "you@x.com" })),
    getToken: vi.fn(async () => "jwt"),
    signOut: vi.fn(),
    hasSession: vi.fn(() => false),
    ...over,
  } as Authenticator & Record<string, ReturnType<typeof vi.fn>>;
}

describe("LoginView", () => {
  it("signs in with the entered credentials", async () => {
    const auth = mockAuth();
    const onSignedIn = vi.fn();
    render(<LoginView auth={auth} onSignedIn={onSignedIn} />);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "you@x.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "hunter2" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(onSignedIn).toHaveBeenCalled());
    expect(auth.signIn).toHaveBeenCalledWith("you@x.com", "hunter2");
  });

  it("prompts for a new password when the account requires it", async () => {
    const auth = mockAuth({
      signIn: vi.fn(async () => ({ status: "new-password-required", email: "you@x.com" })),
    });
    const onSignedIn = vi.fn();
    render(<LoginView auth={auth} onSignedIn={onSignedIn} />);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "you@x.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "Temp123!" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    // Now a new-password field appears; first sign-in did not complete.
    expect(await screen.findByLabelText("New password")).toBeInTheDocument();
    expect(onSignedIn).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "Permanent123!" } });
    fireEvent.click(screen.getByRole("button", { name: /Set password/ }));

    await waitFor(() => expect(onSignedIn).toHaveBeenCalled());
    expect(auth.completeNewPassword).toHaveBeenCalledWith("Permanent123!");
  });

  it("shows an error when authentication fails", async () => {
    const auth = mockAuth({
      signIn: vi.fn(async () => {
        throw new Error("Incorrect username or password.");
      }),
    });
    render(<LoginView auth={auth} onSignedIn={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "you@x.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText(/Incorrect username or password/)).toBeInTheDocument();
  });
});
