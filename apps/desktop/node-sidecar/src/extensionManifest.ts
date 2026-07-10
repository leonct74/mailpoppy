// The AgentsPoppy extension manifest for MailPoppy.
//
// In the AgentsPoppy "container of apps" model, MailPoppy ships as an extension:
// AgentsPoppy reads this manifest, reconciles a connection to its declared
// `permissionSet`, renders the frontend in a sandboxed tab, and (for the backend)
// spawns the sidecar with host-injected scoped credentials. The manifest is the
// SINGLE SOURCE OF TRUTH for the declared AWS scope — the host re-reads it on every
// load, so a connection's scope can never silently drift from what MailPoppy
// actually declares (the failure mode that plagued the old two-app broker model).
//
// To avoid a third copy of the scope, the `permissionSet` here is the SAME object
// returned by agentspoppyBroker.permissionSet() — the maintained, tested source
// that mirrors infra/policies/mailpoppy-*.json. `scripts/build-manifest.mjs` writes
// the JSON form to apps/desktop/extension.json on every sidecar build.
//
// Mirror of @agentspoppy/extension-sdk's ExtensionManifest (kept as a structural
// type so MailPoppy takes no cross-repo build dependency, exactly like the broker
// client mirror in agentspoppyBroker.ts).

import { APP, permissionSet } from "./agentspoppyBroker";

/** Host-bridge capabilities (must match @agentspoppy/extension-sdk's Capability ids). */
export type Capability =
  | "aws:credentials"
  | "connection:read"
  | "backend:invoke"
  | "host:openExternal"
  | "host:notify";

export interface ExtensionManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  icon?: string;
  permissionSet: ReturnType<typeof permissionSet>;
  frontend: { entry: string };
  backend?: { entry: string; transport?: "http" | "stdio" };
  /** Cleanup hook the host POSTs at teardown for resources the stack delete leaves behind. */
  teardown?: { endpoint: string };
  capabilities: Capability[];
}

/** The Tauri/extension version — must match src-tauri/tauri.conf.json. */
const VERSION = "0.1.4";

/**
 * The host-spawned backend binary name. The sidecar is built per Rust target triple
 * (see node-sidecar/scripts/build-sidecar.mjs) and laid out under the installed
 * extension root as backend/<binary>. For the current dev/build host that's the
 * aarch64 macOS slice; cross-arch packaging is handled at install-layout time.
 */
const BACKEND_BINARY = "mailpoppy-sidecar-aarch64-apple-darwin";

/**
 * Build MailPoppy's extension manifest from its real declared scope.
 *
 * Capabilities MailPoppy needs from the host bridge:
 *  - aws:credentials   → mint scoped creds for deploys/provisioning
 *  - connection:read   → render its own permissions / activity view
 *  - backend:invoke    → the frontend calls its own sidecar routes
 *  - host:openExternal → open AWS console deep-links
 *  - host:notify       → deploy progress / approval prompts
 *
 * Paths are relative to the installed extension root:
 *   <root>/extension.json
 *   <root>/frontend/index.html  (+ assets/)   ← Vite build of apps/desktop
 *   <root>/backend/<binary>                    ← the SEA sidecar
 */
export function buildExtensionManifest(): ExtensionManifest {
  return {
    id: APP.id,
    name: APP.name,
    version: VERSION,
    description: "Run your own private mail backend on your AWS account — deploy, manage, and tear it down.",
    icon: "frontend/mailpoppy-icon.png",
    permissionSet: permissionSet(),
    frontend: { entry: "frontend/index.html" },
    backend: { entry: `backend/${BACKEND_BINARY}`, transport: "http" },
    // Leave no trace: the host POSTs /teardown before deleting our stack, so teardownAll
    // removes the resources the stack RETAINs on delete (mail bucket, DynamoDB tables,
    // Cognito user pool) plus the SES identity + DNS records — nothing survives a teardown.
    teardown: { endpoint: "/teardown" },
    capabilities: ["aws:credentials", "connection:read", "backend:invoke", "host:openExternal", "host:notify"],
  };
}
