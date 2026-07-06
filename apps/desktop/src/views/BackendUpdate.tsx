import { useEffect, useRef, useState } from "react";
import { Server, RefreshCw, CheckCircle2 } from "lucide-react";
import { Card, Button, Spinner } from "../ui";
import { backendVersion, updateBackendCode, deployStatus, type BackendVersion } from "../lib/deploy";

// The email engine runs in the USER's own AWS. When a new app build ships an improved
// backend (any Lambda change bumps the content-addressed code key), the deployed stack
// is now behind — and there is no other channel to push it: it lives in their account,
// not ours. This panel detects that (bundled code key ≠ deployed LambdaCodeKey) and
// lets the user apply it in one click. The update changes ONLY the code (server-side
// UsePreviousValue keeps every setting), so it never interrupts mail or re-keys anything.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function BackendUpdate() {
  const [ver, setVer] = useState<BackendVersion | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Stop the poll loop from touching state after the panel unmounts (navigating away
  // mid-update). Cleared on unmount.
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  async function refresh() {
    setLoading(true);
    setErr(null);
    try {
      const v = await backendVersion();
      if (aliveRef.current) setVer(v);
    } catch (e) {
      if (aliveRef.current) setErr(e instanceof Error ? e.message : String(e));
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, []);

  async function onUpdate() {
    setBusy(true);
    setErr(null);
    setDone(null);
    setProgress("Starting the update…");
    try {
      const started = await updateBackendCode();
      if (started.operation === "NO_CHANGE") {
        setProgress(null);
        setDone("Your backend was already up to date.");
        await refresh();
        return;
      }
      setProgress("Updating your backend on AWS — this won't interrupt your mail…");
      // Poll to completion (CloudFormation update of a few Lambdas is usually 1–2 min).
      for (let i = 0; i < 90; i++) {
        await sleep(4000);
        if (!aliveRef.current) return; // panel unmounted mid-update — stop touching state
        const s = await deployStatus(started.stackName);
        if (s.failed) {
          setProgress(null);
          setErr(s.reason || `The update didn't complete (${s.status}).`);
          return;
        }
        if (s.complete) {
          setProgress(null);
          setDone("Backend updated. New mail now runs the latest code.");
          await refresh();
          return;
        }
      }
      setProgress(null);
      setErr("The update is taking longer than usual — check again in a minute.");
    } catch (e) {
      setProgress(null);
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  // No deployed backend yet → nothing to update (the setup wizard handles first deploy).
  if (!loading && (!ver || !ver.stackExists)) return null;

  // The stack is mid-operation (a deploy/update/rollback is running) — the deployed
  // code-key parameter can already read the new value while resources haven't settled,
  // so don't claim "up to date"; show the in-flight state and let them re-check.
  const inFlight = !busy && !!ver?.stackStatus && /_IN_PROGRESS$/.test(ver.stackStatus);

  return (
    <Card>
      <h2 className="flex items-center gap-2 text-lg font-semibold text-on-surface">
        <Server className="size-4 text-primary" />
        Backend
      </h2>
      <p className="mt-1 max-w-2xl text-sm text-on-surface-variant">
        The email engine running in your own AWS account. When a MailPoppy update improves the backend, apply it here —
        it changes the code only, keeping every setting, mailbox and message intact.
      </p>

      {loading && <p className="mt-3 text-sm text-on-surface-variant">Checking…</p>}

      {!loading && inFlight && (
        <div className="mt-4 flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-sm text-on-surface-variant">
            <Spinner className="size-4" /> A backend operation is in progress…
          </span>
          <Button variant="ghost" size="sm" onClick={() => void refresh()} disabled={loading}>
            Check again
          </Button>
        </div>
      )}

      {!loading && !inFlight && ver?.updateAvailable && (
        <div className="mt-4 rounded-lg border border-primary/30 bg-primary/5 p-3">
          <div className="flex items-center gap-2 text-sm font-medium text-on-surface">
            <RefreshCw className="size-4 text-primary" />
            A backend update is available
          </div>
          <p className="mt-1 text-sm text-on-surface-variant">
            Your app was updated with backend improvements that aren't live in your account yet. Applying takes a minute
            or two and doesn't interrupt sending or receiving.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button onClick={() => void onUpdate()} disabled={busy}>
              {busy ? "Updating…" : "Update backend"}
            </Button>
            {busy && <Spinner className="size-4" />}
            {progress && <span className="text-sm text-on-surface-variant">{progress}</span>}
          </div>
        </div>
      )}

      {!loading && !inFlight && ver && !ver.updateAvailable && !done && (
        <div className="mt-4 flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-sm text-secondary">
            <CheckCircle2 className="size-4" /> Your backend is up to date.
          </span>
          <Button variant="ghost" size="sm" onClick={() => void refresh()} disabled={loading || busy}>
            Check again
          </Button>
        </div>
      )}

      {done && (
        <p className="mt-3 flex items-center gap-2 text-sm text-secondary">
          <CheckCircle2 className="size-4" />
          {done}
        </p>
      )}
      {err && <p className="mt-2 text-sm text-tertiary">{err}</p>}
    </Card>
  );
}
