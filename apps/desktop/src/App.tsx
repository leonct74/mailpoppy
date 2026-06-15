import { useEffect, useMemo, useState } from "react";
import { LayoutDashboard, Inbox, ArrowLeftRight, HeartPulse, SlidersHorizontal, ShieldCheck, type LucideIcon } from "lucide-react";
import { HomeView } from "./views/HomeView";
import { DomainView } from "./views/DomainView";
import { SetupWizard } from "./views/SetupWizard";
import { InboxView } from "./views/InboxView";
import { AccountView } from "./views/AccountView";
import { SendingHealthView } from "./views/SendingHealthView";
import { MigrationView } from "./views/MigrationView";
import { ConnectView } from "./views/ConnectView";
import { LoginView } from "./views/LoginView";
import { CapabilityLights } from "./views/CapabilityLights";
import { CognitoAuth } from "./lib/auth";
import { makeMailClient } from "./lib/mailClient";
import { cn, Logo } from "./ui";
import {
  loadDeploymentConfig,
  saveDeploymentConfig,
  clearDeploymentConfig,
  type DeploymentConfig,
} from "./lib/deploymentConfig";

// "Setup" is intentionally NOT a sidebar tab — it's a per-domain flow reached
// from "Add domain" (Home) or a domain card's "Domain setup" action, so it's
// never ambiguous which domain you're configuring.
type Tab = "home" | "inbox" | "migrate" | "health" | "account";

const NAV: { id: Tab; label: string; icon: LucideIcon; blurb: string }[] = [
  { id: "home", label: "Home", icon: LayoutDashboard, blurb: "Overview of your domains and mailboxes" },
  { id: "inbox", label: "Inbox", icon: Inbox, blurb: "Read and send mail" },
  { id: "migrate", label: "Migrate", icon: ArrowLeftRight, blurb: "Bring your old mail across via IMAP" },
  { id: "health", label: "Sending health", icon: HeartPulse, blurb: "Is each domain's mail reaching inboxes?" },
  { id: "account", label: "Account", icon: SlidersHorizontal, blurb: "Shared settings & the AWS resources Mailpoppy manages" },
];

/** Setup drill-in target: a new domain ({}) or re-running an existing one. */
type SetupTarget = { domain?: string };

const CREDENTIALS_TOOLTIP =
  "Mailpoppy reads your AWS credentials from your machine's own configuration (~/.aws profile, SSO, or environment) using AWS's official SDK — the same way the AWS CLI does — and uses them only on this computer. They are never copied, uploaded, or stored: not on Mailpoppy's servers, not in any cloud.";

/**
 * Mailbox tab state machine:
 *   no config            → demo inbox (offline) + "Connect a deployment"
 *   config, signed out   → login
 *   config, signed in    → live inbox (Cognito JWT → API Gateway)
 */
function InboxTab({ prefillEmail }: { prefillEmail?: string | null }) {
  const [config, setConfig] = useState<DeploymentConfig | null>(() => loadDeploymentConfig());
  const [editingConfig, setEditingConfig] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [mailboxEmail, setMailboxEmail] = useState<string | null>(null);

  const auth = useMemo(() => (config ? new CognitoAuth(config) : null), [config]);
  const liveClient = useMemo(
    () => (config && auth ? makeMailClient({ apiBaseUrl: config.apiBaseUrl, getToken: () => auth.getToken() }) : null),
    [config, auth],
  );

  // Restore an existing persisted Cognito session when the config/auth changes.
  useEffect(() => {
    setSignedIn(auth?.hasSession() ?? false);
  }, [auth]);

  // Resolve the signed-in mailbox address (from the ID-token claims) for the
  // Inbox header. Async because it reads/refreshes the token.
  useEffect(() => {
    if (!signedIn || !auth) {
      setMailboxEmail(null);
      return;
    }
    let cancelled = false;
    void auth.currentEmail().then((e) => {
      if (!cancelled) setMailboxEmail(e);
    });
    return () => {
      cancelled = true;
    };
  }, [signedIn, auth]);

  if (editingConfig) {
    return (
      <ConnectView
        initial={config}
        onSave={(c) => {
          saveDeploymentConfig(c);
          setConfig(c);
          setSignedIn(false);
          setEditingConfig(false);
        }}
        onCancel={() => setEditingConfig(false)}
      />
    );
  }

  if (!config) {
    return <InboxView demo onConnect={() => setEditingConfig(true)} />;
  }

  if (auth && !signedIn) {
    return (
      <LoginView
        auth={auth}
        prefillEmail={prefillEmail ?? undefined}
        onSignedIn={() => setSignedIn(true)}
        onReconfigure={() => setEditingConfig(true)}
      />
    );
  }

  const linkBtn = "text-primary underline-offset-2 hover:underline";

  return (
    <>
      <div className="mb-4 flex shrink-0 flex-wrap items-center gap-3 rounded-lg border border-secondary/30 bg-secondary/10 px-4 py-2.5 text-sm text-on-surface-variant">
        <span className="text-secondary">
          ✅ Connected to <code className="font-mono text-xs">{config.apiBaseUrl}</code>
        </span>
        <button className={linkBtn} onClick={() => { auth?.signOut(); setSignedIn(false); }}>Sign out</button>
        <button className={linkBtn} onClick={() => setEditingConfig(true)}>Change deployment</button>
        <button
          className={linkBtn}
          onClick={() => { clearDeploymentConfig(); setConfig(null); setSignedIn(false); }}
        >
          Disconnect
        </button>
      </div>
      {liveClient && <InboxView client={liveClient} mailboxEmail={mailboxEmail} />}
    </>
  );
}

export function App() {
  const [tab, setTab] = useState<Tab>("home");
  // Tabs visited so far. Once visited, a view is kept mounted (hidden when
  // inactive) so its form data, scroll position and loaded data survive tab
  // switches — its effects still run just once, on first visit.
  const [visited, setVisited] = useState<Set<Tab>>(() => new Set<Tab>(["home"]));
  // When set, the Home tab shows the per-domain workspace (drill-in) for this
  // domain instead of the overview. Clicking the Home nav (or the in-view back
  // button) clears it to return to the overview.
  const [selectedDomain, setSelectedDomain] = useState<string | null>(null);
  // When set, the Home tab shows the Setup wizard (add a new domain, or re-run
  // setup for an existing one) instead of the overview / domain workspace.
  const [setupTarget, setSetupTarget] = useState<SetupTarget | null>(null);
  // Cross-tab hand-offs from the domain workspace: which domain the Migrate tab
  // should default its destination to, and which mailbox the Inbox login should
  // be pre-filled for.
  const [migrateDomain, setMigrateDomain] = useState<string | null>(null);
  const [inboxEmail, setInboxEmail] = useState<string | null>(null);
  const current = NAV.find((n) => n.id === tab)!;

  function go(id: Tab) {
    setTab(id);
    setVisited((v) => (v.has(id) ? v : new Set(v).add(id)));
  }

  return (
    <div className="flex h-screen overflow-hidden bg-base text-on-surface">
      {/* Sidebar — fixed to the window, never scrolls with content */}
      <aside className="flex h-full w-sidebar-width shrink-0 flex-col border-r border-outline-variant/10 bg-surface-container-low">
        <div className="flex items-center gap-3 px-5 py-6">
          <Logo />
          <span className="ml-auto rounded-full bg-primary-container/15 px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider text-primary">
            Admin
          </span>
        </div>

        <nav className="flex flex-1 flex-col gap-1 px-3">
          {NAV.map(({ id, label, icon: Icon }) => {
            const active = tab === id;
            return (
              <button
                key={id}
                onClick={() => {
                  // The Home nav always lands on the overview, even if a domain
                  // drill-in or the setup wizard is currently open.
                  if (id === "home") {
                    setSelectedDomain(null);
                    setSetupTarget(null);
                  }
                  go(id);
                }}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
                  active
                    ? "bg-primary-container/10 font-semibold text-primary"
                    : "font-medium text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface",
                )}
              >
                <Icon className="size-4 shrink-0" />
                {label}
              </button>
            );
          })}
        </nav>

        {/* Pinned to the bottom of the sidebar so it's visible on every screen:
            live "permissions lights" for the active AWS identity, plus the
            credentials-stay-local reassurance. */}
        <div className="flex flex-col gap-3 px-3 pb-3 pt-2">
          <CapabilityLights />
          <div className="rounded-lg border border-outline-variant/10 bg-surface-container-lowest/60 p-4">
            <div
              className="flex items-start gap-2.5 text-xs leading-relaxed text-on-surface-variant"
              title={CREDENTIALS_TOOLTIP}
            >
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-secondary" />
              <span>
                Your AWS credentials never leave this computer — read locally (like the AWS CLI), never uploaded or stored.
              </span>
            </div>
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Top bar — fixed to the window; only the content below it scrolls */}
        <header className="flex shrink-0 items-center justify-between border-b border-outline-variant/10 bg-surface px-8 py-4">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight text-on-surface">{current.label}</h1>
            <p className="truncate text-sm text-on-surface-variant">{current.blurb}</p>
          </div>
        </header>
        <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {/* Views stay mounted after first visit (only the active one is shown)
              so form data + scroll position survive tab switches. */}
          {visited.has("inbox") && (
            // The mailbox is a full-bleed three-pane layout that fills the
            // viewport (its panes scroll internally — this container does not).
            <div className={cn("min-h-0 flex-1 flex-col px-6 py-6", tab === "inbox" ? "flex" : "hidden")}>
              <InboxTab prefillEmail={inboxEmail} />
            </div>
          )}
          {/* The page content is the only scroll region for these views. */}
          {visited.has("home") && (
            <div className={cn("h-full overflow-y-auto px-8 py-8", tab === "home" ? "block" : "hidden")}>
              <div className="mx-auto max-w-6xl">
                {setupTarget ? (
                  <SetupWizard presetDomain={setupTarget.domain} onExit={() => setSetupTarget(null)} />
                ) : selectedDomain ? (
                  <DomainView
                    domain={selectedDomain}
                    onBack={() => setSelectedDomain(null)}
                    onRunSetup={() => setSetupTarget({ domain: selectedDomain })}
                    onOpenInbox={(email) => {
                      setInboxEmail(email);
                      go("inbox");
                    }}
                    onMigrateInto={(d) => {
                      setMigrateDomain(d);
                      go("migrate");
                    }}
                  />
                ) : (
                  <HomeView onGoToSetup={() => setSetupTarget({})} onOpenDomain={(d) => setSelectedDomain(d)} />
                )}
              </div>
            </div>
          )}
          {visited.has("migrate") && (
            <div className={cn("h-full overflow-y-auto px-8 py-8", tab === "migrate" ? "block" : "hidden")}>
              <div className="mx-auto max-w-6xl">
                <MigrationView preselectDomain={migrateDomain ?? undefined} />
              </div>
            </div>
          )}
          {visited.has("health") && (
            <div className={cn("h-full overflow-y-auto px-8 py-8", tab === "health" ? "block" : "hidden")}>
              <div className="mx-auto max-w-6xl">
                <SendingHealthView />
              </div>
            </div>
          )}
          {visited.has("account") && (
            <div className={cn("h-full overflow-y-auto px-8 py-8", tab === "account" ? "block" : "hidden")}>
              <div className="mx-auto max-w-6xl">
                <AccountView />
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
