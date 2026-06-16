"use client";

import { useCallback, useEffect, useState } from "react";
import { hasSession, currentEmail, signOut } from "@/lib/auth";
import { resetContacts } from "@/lib/contacts";
import { Login } from "./Login";
import { Mailbox } from "./Mailbox";

type Status = "loading" | "signed-out" | "signed-in";

export function Webmail() {
  const [status, setStatus] = useState<Status>("loading");
  const [email, setEmail] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (hasSession()) {
      const e = await currentEmail();
      if (e) {
        setEmail(e);
        setStatus("signed-in");
        return;
      }
      signOut(); // session present but unusable (e.g. refresh expired)
    }
    setEmail(null);
    setStatus("signed-out");
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (status === "loading") {
    return (
      <div className="bg-bg text-muted flex min-h-screen items-center justify-center gap-3 text-sm">
        <span className="border-surface-variant border-t-primary h-5 w-5 animate-spin rounded-full border-2" />
        Loading…
      </div>
    );
  }

  if (status === "signed-out") return <Login onSignedIn={refresh} />;

  return (
    <Mailbox
      email={email}
      onSignOut={() => {
        signOut();
        resetContacts(); // don't leak one mailbox's contacts to the next sign-in
        setEmail(null);
        setStatus("signed-out");
      }}
    />
  );
}
