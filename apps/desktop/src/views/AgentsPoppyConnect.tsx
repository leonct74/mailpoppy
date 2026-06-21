import { useCallback, useEffect, useRef, useState } from "react";
import { ShieldCheck, RefreshCw, AlertTriangle, Check, ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import { Button, Spinner } from "../ui";
import { friendlyError } from "../lib/errors";
import {
  connectAgentsPoppy as defaultConnect,
  agentsPoppyStatus as defaultStatus,
  disconnectAgentsPoppy as defaultDisconnect,
} from "../lib/agentspoppy";

// Third (opt-in) way to connect AWS, alongside the CLI and paste-keys paths:
// let a local AgentsPoppy broker vend MailPoppy's credentials. AgentsPoppy then
// governs and can tear down whatever MailPoppy deploys. Requires the AgentsPoppy
// app to be running with an AWS account linked.

export interface AgentsPoppyApi {
  connect: typeof defaultConnect;
  status: typeof defaultStatus;
  disconnect: typeof defaultDisconnect;
}

export interface AgentsPoppyConnectProps {
  /** Re-run the environment check once credentials start flowing from the broker. */
  onRecheck?: () => void;
  /** Injectable for tests. */
  api?: AgentsPoppyApi;
  /** Poll interval while waiting for approval (ms). */
  pollMs?: number;
}

type Phase = "idle" | "connecting" | "pending" | "active" | "error";

const linkCls = "inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline";

export function AgentsPoppyConnect({ onRecheck, api, pollMs = 2000 }: AgentsPoppyConnectProps) {
  const connect = api?.connect ?? defaultConnect;
  const status = api?.status ?? defaultStatus;
  const disconnect = api?.disconnect ?? defaultDisconnect;

  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [account, setAccount] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const onRecheckRef = useRef(onRecheck);
  onRecheckRef.current = onRecheck;

  // Reflect an already-approved connection (e.g. returning to Setup) on mount.
  useEffect(() => {
    let cancelled = false;
    void status()
      .then((s) => {
        if (cancelled) return;
        if (s.connected) {
          setPhase("active");
          setOpen(true);
        }
      })
      .catch(() => {
        /* AgentsPoppy not running / not reachable — stay idle, no noise */
      });
    return () => {
      cancelled = true;
    };
  }, [status]);

  // While pending, poll until the user approves it in the AgentsPoppy window.
  useEffect(() => {
    if (phase !== "pending") return;
    let stop = false;
    const tick = async () => {
      try {
        const s = await status();
        if (stop) return;
        if (s.connected) {
          setPhase("active");
          onRecheckRef.current?.();
        } else if (s.status === "revoked") {
          setPhase("error");
          setError("The connection was denied or revoked in AgentsPoppy.");
        }
      } catch {
        /* transient — keep polling */
      }
    };
    const id = window.setInterval(() => void tick(), pollMs);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, [phase, status, pollMs]);

  const onConnect = useCallback(async () => {
    setError(null);
    setPhase("connecting");
    try {
      const r = await connect();
      setAccount(r.alias ? `${r.alias} (${r.accountId})` : r.accountId);
      if (r.status === "active") {
        setPhase("active");
        onRecheckRef.current?.();
      } else {
        setPhase("pending");
      }
    } catch (e) {
      setError(friendlyError(e));
      setPhase("error");
    }
  }, [connect]);

  const onDisconnect = useCallback(async () => {
    try {
      await disconnect();
    } catch {
      /* best-effort */
    }
    setPhase("idle");
    setAccount(null);
    setError(null);
    onRecheckRef.current?.();
  }, [disconnect]);

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 rounded-xl border border-outline-variant/30 bg-surface-container-lowest px-4 py-3 text-sm font-medium text-on-surface transition-colors hover:border-primary/40 hover:bg-surface-container-low"
      >
        <span className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-on-surface-variant" />
          Connect through AgentsPoppy
          {phase === "active" && (
            <span className="inline-flex items-center gap-1 rounded-full bg-secondary/15 px-2 py-0.5 text-xs font-semibold text-secondary">
              <Check className="size-3" /> Connected
            </span>
          )}
        </span>
        {open ? (
          <ChevronDown className="size-4 text-on-surface-variant" />
        ) : (
          <ChevronRight className="size-4 text-on-surface-variant" />
        )}
      </button>

      {open && (
        <div className="mt-3 flex flex-col gap-3 rounded-xl border border-secondary/20 bg-secondary/5 p-4">
          <p className="flex items-start gap-1.5 text-sm text-on-surface-variant">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-secondary" />
            <span>
              <b className="text-on-surface">AgentsPoppy</b> is a separate app that brokers short-lived, scoped AWS
              credentials and lets you monitor or tear down what MailPoppy creates — all on this machine. MailPoppy never
              stores your keys in this mode. Make sure AgentsPoppy is running with an AWS account linked, then connect.
            </span>
          </p>

          {phase === "active" ? (
            <>
              <p className="flex items-start gap-1.5 text-sm text-secondary">
                <Check className="mt-0.5 size-4 shrink-0" />
                <span>
                  Connected{account ? ` to ${account}` : ""}. AgentsPoppy is now vending MailPoppy&apos;s credentials —
                  it can pause, revoke, or tear down what you deploy.
                </span>
              </p>
              <div>
                <Button variant="secondary" size="sm" onClick={() => void onDisconnect()}>
                  Disconnect
                </Button>
              </div>
            </>
          ) : phase === "pending" ? (
            <p className="flex items-start gap-1.5 text-sm text-on-surface-variant">
              <Spinner className="mt-0.5 size-4 shrink-0" />
              <span>
                Waiting for you to approve <b className="text-on-surface">MailPoppy</b> in the AgentsPoppy window
                {account ? ` (account ${account})` : ""}… It&apos;ll continue automatically once you approve.
              </span>
            </p>
          ) : (
            <>
              {error && (
                <p className="flex items-start gap-1.5 text-sm text-tertiary">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {error}
                </p>
              )}
              <div className="flex items-center gap-3">
                <Button onClick={() => void onConnect()} disabled={phase === "connecting"}>
                  {phase === "connecting" ? <Spinner /> : <ShieldCheck className="size-4" />} Connect via AgentsPoppy
                </Button>
                {phase === "error" && (
                  <Button variant="secondary" size="sm" onClick={() => void onConnect()}>
                    <RefreshCw className="size-3.5" /> Retry
                  </Button>
                )}
              </div>
              <p className="text-xs text-on-surface-variant/80">
                Don&apos;t have it yet? AgentsPoppy is a free, local companion app —{" "}
                <a className={linkCls} href="https://github.com/leonct74/agentspoppy" target="_blank" rel="noreferrer">
                  learn more <ExternalLink className="size-3" />
                </a>
                .
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
