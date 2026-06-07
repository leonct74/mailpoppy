import { useEffect, useState } from "react";
import {
  loadInventory as defaultLoad,
  groupByService,
  awsConsoleUrl,
  ledgerConsoleUrl,
  type Inventory,
} from "../lib/resources";
import {
  teardownEverything as defaultTeardown,
  listProvisionedDomains as defaultListDomains,
  type TeardownResult,
} from "../lib/teardown";
import { listMailboxes as defaultListMailboxes, type Mailbox } from "../lib/mailbox";
import { resolveStackName } from "../lib/deploymentConfig";

// "What Mailpoppy did to your account" (DESIGN §14.1). Shows the authoritative
// CloudFormation inventory of the deployed stack — grouped by service, every
// resource name with a console deep-link — plus the local provisioning ledger of
// out-of-stack mutations (Route53 / SES identity / rule-set activation) as a
// created/deleted timeline. The whole point is trust: no surprise resources.

const box: React.CSSProperties = { border: "1px solid #ddd", borderRadius: 12, padding: 16, marginTop: 16 };
const mono: React.CSSProperties = { fontFamily: "ui-monospace, monospace", fontSize: 12, wordBreak: "break-all" };
const th: React.CSSProperties = { textAlign: "left", fontSize: 12, color: "#666", padding: "4px 8px", borderBottom: "1px solid #eee" };
const td: React.CSSProperties = { padding: "6px 8px", borderBottom: "1px solid #f3f3f3", verticalAlign: "top" };
const link: React.CSSProperties = { color: "#7c3aed", textDecoration: "none" };

function actionBadge(action: "created" | "deleted" | "updated"): React.CSSProperties {
  const palette =
    action === "created"
      ? { bg: "#f0fdf4", fg: "#15803d", border: "#bbf7d0" }
      : action === "updated"
        ? { bg: "#eff6ff", fg: "#1d4ed8", border: "#bfdbfe" }
        : { bg: "#fef2f2", fg: "#b91c1c", border: "#fecaca" };
  return {
    fontSize: 11,
    fontWeight: 600,
    padding: "1px 8px",
    borderRadius: 999,
    background: palette.bg,
    color: palette.fg,
    border: `1px solid ${palette.border}`,
  };
}

export function ResourcesView({
  stackName = resolveStackName(),
  load = defaultLoad,
  teardown = defaultTeardown,
  listMailboxes = defaultListMailboxes,
  listDomains = defaultListDomains,
}: {
  stackName?: string;
  load?: (stackName: string) => Promise<Inventory>;
  teardown?: typeof defaultTeardown;
  listMailboxes?: (stackName: string) => Promise<{ mailboxes: Mailbox[] }>;
  listDomains?: (stackName: string) => Promise<{ domains: string[] }>;
}) {
  const [inv, setInv] = useState<Inventory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Danger zone (remove everything). Collapsed by default + pinned near the top
  // so it's discoverable without scrolling past a long resource list, but can't
  // be triggered by an accidental click.
  const [dangerOpen, setDangerOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [tearingDown, setTearingDown] = useState(false);
  const [tdResult, setTdResult] = useState<TeardownResult | null>(null);
  const [tdError, setTdError] = useState<string | null>(null);
  // Mailboxes that teardown will destroy — fetched live so the admin sees every
  // address (across ALL domains, e.g. imported ones), not just the provisioned
  // domain named in the confirm prompt. Loaded lazily when the zone is expanded.
  const [mailboxes, setMailboxes] = useState<Mailbox[] | null>(null);
  const [mbLoading, setMbLoading] = useState(false);
  const [mbError, setMbError] = useState<string | null>(null);
  // Provisioned domains whose SES identity + DNS teardown will remove (may be
  // more than the "primary" one — e.g. a second domain set up on this backend).
  const [provDomains, setProvDomains] = useState<string[] | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      setInv(await load(stackName));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stackName]);

  // Lazily load the mailbox list the first time the danger zone is opened (only
  // if a backend is actually deployed). Keeps the Cognito call off the common path.
  useEffect(() => {
    if (!dangerOpen || !inv?.stackExists || mailboxes !== null || mbLoading) return;
    let cancelled = false;
    (async () => {
      setMbLoading(true);
      setMbError(null);
      // Mailboxes and provisioned domains, in parallel — neither blocks the confirm UI.
      const [mb, dom] = await Promise.allSettled([listMailboxes(stackName), listDomains(stackName)]);
      if (cancelled) return;
      if (mb.status === "fulfilled") setMailboxes(mb.value.mailboxes);
      else setMbError(mb.reason instanceof Error ? mb.reason.message : String(mb.reason));
      if (dom.status === "fulfilled") setProvDomains(dom.value.domains);
      setMbLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dangerOpen, inv?.stackExists, stackName]);

  const grouped = inv ? groupByService(inv.resources) : [];
  const ledger = inv ? [...inv.ledger].sort((a, b) => (a.ts < b.ts ? 1 : -1)) : [];

  // The domain to tear down: the SES identity Mailpoppy created (its ledger name
  // is exactly the domain). If we can't infer it (e.g. a fresh machine), the user
  // types it freely below.
  const knownDomain = inv?.ledger.find((e) => e.service === "SES" && e.resourceType === "EmailIdentity")?.name;
  const somethingDeployed = !!inv && (inv.stackExists || ledger.length > 0);
  const typed = confirmText.trim().toLowerCase();
  const canTearDown =
    !tearingDown && typed.length > 0 && (knownDomain ? typed === knownDomain.toLowerCase() : /\./.test(typed));

  async function onTeardown() {
    setTdError(null);
    setTdResult(null);
    setTearingDown(true);
    try {
      const res = await teardown({ domain: typed, stackName });
      setTdResult(res);
      setConfirmText("");
      await refresh();
    } catch (e) {
      setTdError(e instanceof Error ? e.message : String(e));
    } finally {
      setTearingDown(false);
    }
  }

  // Danger zone — pinned near the top, collapsed by default (see state comment).
  const dangerZone = somethingDeployed ? (
    <div style={{ ...box, borderColor: "#fecaca", background: "#fff5f5" }}>
      <button
        type="button"
        aria-label="Toggle danger zone"
        aria-expanded={dangerOpen}
        onClick={() => setDangerOpen((o) => !o)}
        style={{
          all: "unset",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          width: "100%",
        }}
      >
        <strong style={{ color: "#b91c1c" }}>⚠️ Danger zone — remove everything</strong>
        <span style={{ color: "#b91c1c", fontSize: 13, fontWeight: 600 }}>{dangerOpen ? "Hide ▲" : "Show ▼"}</span>
      </button>

      {!dangerOpen ? (
        <p style={{ fontSize: 12, color: "#7f1d1d", margin: "6px 0 0" }}>
          Permanently delete the entire backend{knownDomain ? <> for <code style={mono}>{knownDomain}</code></> : null} —
          stack, all stored mail &amp; mailboxes, the SES identity and DNS. Click <b>Show</b> to reveal.
        </p>
      ) : (
        <>
          <p style={{ fontSize: 13, color: "#7f1d1d", marginTop: 6 }}>
            Permanently delete the <b>entire backend</b>: the CloudFormation stack, <b>all stored mail and mailboxes</b>{" "}
            (S3, DynamoDB, Cognito), the deploy bucket, and the SES identity + DNS records (MX/DKIM/DMARC/SPF) for{" "}
            {provDomains && provDomains.length > 0 ? (
              <b>
                every provisioned domain:{" "}
                {provDomains.map((d, i) => (
                  <span key={d}>
                    {i > 0 ? ", " : ""}
                    <code style={mono}>{d}</code>
                  </span>
                ))}
              </b>
            ) : knownDomain ? (
              <code style={mono}>{knownDomain}</code>
            ) : (
              "every provisioned domain"
            )}
            . <b>This cannot be undone.</b>
          </p>

          {/* The mailboxes that will be destroyed — across EVERY domain, not just
              the one named in the confirm prompt. */}
          <div style={{ fontSize: 13, color: "#7f1d1d", marginBottom: 8 }}>
            {mbLoading ? (
              "Checking which mailboxes will be deleted…"
            ) : mbError ? (
              <span style={{ color: "#b45309" }}>Couldn’t list mailboxes ({mbError}) — they will still be deleted.</span>
            ) : mailboxes && mailboxes.length > 0 ? (
              <>
                <b>
                  This deletes all {mailboxes.length} mailbox{mailboxes.length === 1 ? "" : "es"} and their mail — across
                  every domain{knownDomain ? <>, not just <code style={mono}>{knownDomain}</code></> : null}:
                </b>
                <ul style={{ margin: "4px 0 0 18px" }}>
                  {mailboxes.map((m) => (
                    <li key={m.email} style={mono}>{m.email}</li>
                  ))}
                </ul>
              </>
            ) : mailboxes && mailboxes.length === 0 ? (
              "No mailboxes remain in this backend."
            ) : null}
          </div>

          {tdResult ? (
            <div style={{ ...box, marginTop: 8, borderColor: "#bbf7d0", background: "#f0fdf4" }}>
              <strong style={{ color: "#15803d" }}>Removed {tdResult.deleted.length} item(s).</strong>
              <ul style={{ margin: "6px 0 0 18px", fontSize: 13 }}>
                {tdResult.deleted.map((d, i) => (
                  <li key={i} style={mono}>{d}</li>
                ))}
              </ul>
              {tdResult.warnings.length > 0 && (
                <div style={{ marginTop: 8, fontSize: 13, color: "#b45309" }}>
                  <b>Warnings:</b>
                  <ul style={{ margin: "4px 0 0 18px" }}>
                    {tdResult.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : tearingDown ? (
            <div style={{ fontSize: 14, color: "#7f1d1d", marginTop: 8 }}>
              Removing everything… this can take a few minutes (waiting for CloudFormation to delete the stack). Please
              keep the app open.
            </div>
          ) : (
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
              <label style={{ fontSize: 13, color: "#7f1d1d" }}>
                Type {knownDomain ? <code style={mono}>{knownDomain}</code> : "the domain name"} to confirm{" "}
                <input
                  aria-label="Type domain to confirm teardown"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder={knownDomain ?? "yourdomain.com"}
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  style={{ padding: 6, minWidth: 220, marginLeft: 6 }}
                />
              </label>
              <button
                onClick={() => void onTeardown()}
                disabled={!canTearDown}
                style={{
                  padding: "10px 18px",
                  fontSize: 14,
                  fontWeight: 600,
                  color: "#fff",
                  background: "#dc2626",
                  border: "none",
                  borderRadius: 8,
                  opacity: canTearDown ? 1 : 0.5,
                  cursor: canTearDown ? "pointer" : "default",
                }}
              >
                Remove everything
              </button>
            </div>
          )}

          {tdError && <div style={{ marginTop: 8, fontSize: 13, color: "#b91c1c" }}>Teardown failed: {tdError}</div>}
        </>
      )}
    </div>
  ) : null;

  return (
    <section>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h2 style={{ margin: 0 }}>What Mailpoppy did to your account</h2>
          <p style={{ color: "#666", margin: "4px 0 0", fontSize: 13 }}>
            Everything Mailpoppy created in your own AWS account — read live from CloudFormation, plus a
            local log of DNS/SES changes. Verify any of it in your console.
          </p>
        </div>
        <button onClick={() => void refresh()} disabled={loading} style={{ cursor: "pointer", padding: "8px 14px" }}>
          {loading ? "…" : "Refresh"}
        </button>
      </div>

      {/* Danger zone, pinned at the top so it's findable in a long list. */}
      {dangerZone}

      {error && (
        <div style={{ ...box, borderColor: "#fecaca", background: "#fef2f2", color: "#b91c1c" }}>
          Couldn’t read your account: {error}
          <div style={{ color: "#7f1d1d", fontSize: 13, marginTop: 6 }}>
            Make sure the provisioning helper is running and your AWS credentials are set.
          </div>
        </div>
      )}

      {inv && !inv.stackExists && (
        <div style={{ ...box, background: "#f8fafc" }}>
          <strong>No Mailpoppy backend is deployed</strong> in <code>{inv.region}</code> (stack{" "}
          <code>{inv.stackName}</code> not found). Nothing is running in your account from the backend stack.
          {ledger.length === 0 && " The change log below is empty too."}
        </div>
      )}

      {inv && inv.stackExists && (
        <div style={box}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <strong>Deployed stack: {inv.stackName}</strong>
            <span style={{ color: "#666", fontSize: 13 }}>
              {inv.resources.length} resources · {inv.region}
            </span>
          </div>
          {grouped.map((g) => (
            <div key={g.service} style={{ marginTop: 14 }}>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>
                {g.service} <span style={{ color: "#999", fontWeight: 400 }}>({g.items.length})</span>
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={th}>Name</th>
                    <th style={th}>Type</th>
                    <th style={th}>Status</th>
                    <th style={th}>Console</th>
                  </tr>
                </thead>
                <tbody>
                  {g.items.map((r) => {
                    const url = awsConsoleUrl(r.type, r.physicalId, inv.region);
                    return (
                      <tr key={r.logicalId}>
                        <td style={{ ...td, ...mono }}>{r.physicalId || r.logicalId}</td>
                        <td style={{ ...td, fontSize: 12, color: "#555" }}>{r.type}</td>
                        <td style={{ ...td, fontSize: 12 }}>{r.status}</td>
                        <td style={td}>
                          {url ? (
                            <a href={url} target="_blank" rel="noreferrer" style={link}>
                              Open ↗
                            </a>
                          ) : (
                            <span style={{ color: "#bbb", fontSize: 12 }}>—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {/* Out-of-stack change log (created/deleted) */}
      <div style={box}>
        <strong>Change log (DNS / SES — outside the stack)</strong>
        {ledger.length === 0 ? (
          <p style={{ color: "#666", fontSize: 13, marginTop: 8 }}>No direct DNS/SES changes recorded yet.</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
            <thead>
              <tr>
                <th style={th}>When</th>
                <th style={th}>Action</th>
                <th style={th}>Service</th>
                <th style={th}>Resource</th>
                <th style={th}>Name</th>
              </tr>
            </thead>
            <tbody>
              {ledger.map((e, i) => {
                const url = ledgerConsoleUrl(e);
                return (
                  <tr key={`${e.ts}-${i}`}>
                    <td style={{ ...td, fontSize: 12, color: "#555", whiteSpace: "nowrap" }}>
                      {new Date(e.ts).toLocaleString()}
                    </td>
                    <td style={td}>
                      <span style={actionBadge(e.action)}>{e.action}</span>
                    </td>
                    <td style={{ ...td, fontSize: 12 }}>{e.service}</td>
                    <td style={{ ...td, fontSize: 12, color: "#555" }}>{e.resourceType}</td>
                    <td style={{ ...td, ...mono }}>
                      {url ? (
                        <a href={url} target="_blank" rel="noreferrer" style={link}>
                          {e.name} ↗
                        </a>
                      ) : (
                        e.name
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

    </section>
  );
}
