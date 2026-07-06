// Desktop client for the sidecar's one-click backend deploy (CloudFormation).
// The sidecar ships the synthesized template + Lambda code, uploads them to the
// admin's account, and Create/UpdateStacks — the user never touches a terminal.
import { sidecar } from "./sidecar";

export interface DeployStarted {
  ok: true;
  stackName: string;
  operation: "CREATE" | "UPDATE" | "NO_CHANGE" | "RECREATE";
  bucket: string;
  region: string;
}

export interface DeployStatus {
  status: string; // CloudFormation StackStatus, or "NOT_FOUND"
  complete: boolean;
  failed: boolean;
  reason?: string;
  outputs?: Record<string, string>;
  /** The stack's ARN — lets the wizard distinguish a freshly-created stack from a
   *  leftover one with the same name (a prior failed deploy being replaced). */
  stackId?: string;
}

export function deployBackend(input: {
  domain: string;
  stackName?: string;
  enableMalwareProtection?: boolean;
  enableEncryption?: boolean;
}): Promise<DeployStarted> {
  return sidecar("/deploy/backend", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function deployStatus(stackName: string): Promise<DeployStatus> {
  return sidecar(`/deploy/backend/${encodeURIComponent(stackName)}/status`);
}

export interface BackendVersion {
  stackExists: boolean;
  /** LambdaCodeKey currently deployed on the stack. */
  deployedKey?: string;
  /** The code key bundled in THIS app build. */
  currentKey: string;
  updateAvailable: boolean;
  /** CloudFormation StackStatus — non-`*_COMPLETE` means an operation is in flight. */
  stackStatus?: string;
  stackName: string;
  region: string;
}

/** Is this app build carrying newer backend code than what's deployed? (read-only) */
export function backendVersion(): Promise<BackendVersion> {
  return sidecar("/deploy/backend/version");
}

/** Update the deployed backend to this build's Lambda code — code only, every other
 *  setting preserved. Returns immediately; poll deployStatus for completion. */
export function updateBackendCode(): Promise<DeployStarted> {
  return sidecar("/deploy/backend/update", { method: "POST" });
}
