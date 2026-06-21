import { sidecar } from "./sidecar";

// Client for the sidecar's AgentsPoppy broker endpoints. Opt-in: when MailPoppy
// connects through a local AgentsPoppy, AWS credentials are vended (and governed)
// by AgentsPoppy instead of being read from the ~/.aws `mailpoppy` profile.

export type AgentsPoppyConnectionStatus = "pending" | "active" | "paused" | "revoked";

export interface AgentsPoppyConnectResult {
  connectionId: string;
  status: AgentsPoppyConnectionStatus;
  accountId: string;
  alias?: string;
}

export interface AgentsPoppyStatus {
  enabled: boolean;
  connected: boolean;
  connectionId?: string;
  status?: AgentsPoppyConnectionStatus;
}

/** Request (or reuse) MailPoppy's connection on the local AgentsPoppy broker. */
export function connectAgentsPoppy(accountId?: string): Promise<AgentsPoppyConnectResult> {
  return sidecar<AgentsPoppyConnectResult>("/agentspoppy/connect", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(accountId ? { accountId } : {}),
  });
}

/** Poll the connection's approval status (the user approves it in AgentsPoppy). */
export function agentsPoppyStatus(): Promise<AgentsPoppyStatus> {
  return sidecar<AgentsPoppyStatus>("/agentspoppy/status");
}

/** Stop using broker credentials (back to the local profile). */
export function disconnectAgentsPoppy(): Promise<{ ok: boolean }> {
  return sidecar<{ ok: boolean }>("/agentspoppy/disconnect", { method: "POST" });
}
