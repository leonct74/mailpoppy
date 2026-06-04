import { useEffect, useState } from "react";
import {
  getRegion as defaultGet,
  setRegion as defaultSet,
  savedRegion,
  persistRegion,
  type RegionConfig,
} from "../lib/region";

// Lets the admin choose which AWS region hosts the mail infrastructure (and all
// stored mail) — data-residency is a legal requirement in some jurisdictions.
// Applies to a NEW deployment; an existing stack can't be moved, so when a backend
// is already deployed we show its region locked. load/save injectable for tests.

const mono: React.CSSProperties = { fontFamily: "ui-monospace, monospace" };
const sel: React.CSSProperties = { padding: 6, border: "1px solid #ccc", borderRadius: 6, font: "inherit" };

// Friendly labels for the SES-inbound regions (the only ones where receiving works).
const REGION_LABELS: Record<string, string> = {
  "eu-west-1": "EU (Ireland) — eu-west-1",
  "us-east-1": "US East (N. Virginia) — us-east-1",
  "us-west-2": "US West (Oregon) — us-west-2",
};
const label = (r: string) => REGION_LABELS[r] ?? r;

export interface RegionPickerProps {
  /** If a backend is already deployed, its region — the picker locks to it. */
  lockedRegion?: string;
  load?: () => Promise<RegionConfig>;
  save?: (region: string) => Promise<{ ok: true; region: string }>;
}

export function RegionPicker({ lockedRegion, load, save }: RegionPickerProps) {
  const loadRegion = load ?? defaultGet;
  const saveRegion = save ?? defaultSet;

  const [region, setRegionState] = useState<string>("");
  const [available, setAvailable] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const cfg = await loadRegion();
        setAvailable(cfg.available);
        // Re-apply the admin's saved choice on launch (sidecar resets to its env default).
        const want = savedRegion();
        if (want && want !== cfg.region && cfg.available.includes(want)) {
          const r = await saveRegion(want);
          setRegionState(r.region);
        } else {
          setRegionState(cfg.region);
        }
      } catch (e) {
        setErr(String(e));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onChange(next: string) {
    setBusy(true);
    setErr(null);
    try {
      const r = await saveRegion(next);
      persistRegion(r.region);
      setRegionState(r.region);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <label style={{ fontSize: 14, fontWeight: 600 }}>
        AWS region (where your mail is stored)
        <br />
        {lockedRegion ? (
          <span style={{ fontSize: 14, fontWeight: 400 }}>
            <code style={mono}>{label(lockedRegion)}</code>{" "}
            <span style={{ color: "#999", fontSize: 12 }}>· locked — already deployed here</span>
          </span>
        ) : (
          <select
            aria-label="AWS region"
            value={region}
            onChange={(e) => void onChange(e.target.value)}
            disabled={busy || available.length === 0}
            style={sel}
          >
            {available.map((r) => (
              <option key={r} value={r}>
                {label(r)}
              </option>
            ))}
          </select>
        )}
      </label>
      <p style={{ fontSize: 12, color: "#666", margin: "6px 0 0", maxWidth: 560 }}>
        Choose this <b>before deploying</b>. All received mail and attachments are stored in this region — pick the one
        your data-residency rules require (e.g. an EU region for EU personal data). A deployment can't be moved later;
        you'd tear down and redeploy elsewhere.
      </p>
      {err && <p style={{ color: "crimson", fontSize: 12 }}>{err}</p>}
    </div>
  );
}
