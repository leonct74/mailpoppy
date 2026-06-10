import { useState } from "react";
import { KeyRound, ExternalLink, Eye, EyeOff, ShieldCheck, RefreshCw, AlertTriangle } from "lucide-react";
import { setAwsCredentials as defaultSubmit, type AwsCredentialInput, type Readiness } from "../lib/awsCredentials";
import { Button, Spinner, cn } from "../ui";

// Shown on Setup → Step 0 when no AWS credentials resolve. Two jobs:
//  (a) hand-hold a newcomer who has no AWS account yet (what it is, rough cost,
//      how to make an account + an IAM user + keys), and
//  (b) let them paste those keys right here — the sidecar saves them as a local
//      `[mailpoppy]` profile, so setup never requires a terminal.
// We can't create the AWS account for them (AWS needs their own email + card),
// so this is a guided path, not automation. CLI/SSO power users get the same
// flow via the "Advanced" disclosure.

const AWS_SIGNUP = "https://aws.amazon.com/free/";
const IAM_CONSOLE = "https://console.aws.amazon.com/iam/home#/users";
const POLICY_FILE =
  "https://github.com/leonct74/mailpoppy/blob/main/infra/policies/mailpoppy-provisioning-policy.json";

const inputCls =
  "w-full rounded-lg border border-outline-variant/30 bg-surface-container-lowest px-3 py-2 font-mono text-sm text-on-surface focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50";
const linkCls = "inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline";
const noAutoCap = { autoCapitalize: "off", autoCorrect: "off", spellCheck: false } as const;

export interface AwsOnboardingProps {
  /** Apply the readiness returned after saving keys (so the wizard updates). */
  onResult: (r: Readiness) => void;
  /** Re-run the environment check (for the Advanced CLI/SSO path). */
  onRecheck: () => void;
  /** Whether the AWS CLI was detected — tailors the Advanced hint. */
  cliInstalled?: boolean;
  /** Injectable for tests. */
  submit?: (input: AwsCredentialInput) => Promise<Readiness>;
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary-container/20 font-mono text-[11px] font-semibold text-primary">
        {n}
      </span>
      <div className="text-sm text-on-surface-variant">
        <span className="font-medium text-on-surface">{title}</span> {children}
      </div>
    </li>
  );
}

export function AwsOnboarding({ onResult, onRecheck, cliInstalled, submit = defaultSubmit }: AwsOnboardingProps) {
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");
  const [sessionToken, setSessionToken] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = accessKeyId.trim().length > 0 && secretAccessKey.trim().length > 0 && !busy;

  async function onConnect() {
    setBusy(true);
    setError(null);
    try {
      const r = await submit({
        accessKeyId: accessKeyId.trim(),
        secretAccessKey: secretAccessKey.trim(),
        sessionToken: sessionToken.trim() || undefined,
      });
      if (!r.credentials.ok) {
        // Keys were saved but AWS rejected them — keep the form, explain why.
        setError(
          r.credentials.error
            ? `AWS didn't accept those keys: ${r.credentials.error}`
            : "AWS didn't accept those keys. Double-check the Access Key ID and Secret, then try again.",
        );
      }
      onResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-outline-variant/20 bg-surface-container-lowest/60 p-5">
      <h3 className="flex items-center gap-2 text-base font-semibold text-on-surface">
        <KeyRound className="size-4 text-primary" /> Connect your AWS account
      </h3>
      <p className="mt-1 text-sm text-on-surface-variant">
        Mailpoppy runs entirely in <b className="text-on-surface">your own</b> AWS account, so your mail stays your
        property. You only need to do this once. New to AWS? Follow the three steps — it takes a few minutes.
      </p>

      {/* New-to-AWS guidance */}
      <ol className="mt-4 space-y-3">
        <Step n={1} title="Create a free AWS account (if you don't have one).">
          <a className={linkCls} href={AWS_SIGNUP} target="_blank" rel="noreferrer">
            aws.amazon.com/free <ExternalLink className="size-3" />
          </a>
          . It asks for an email and a card for verification, but there's a 12-month free tier — and Mailpoppy's own
          usage (storage + sending) is typically just cents per month. <b className="text-on-surface">You pay AWS
          directly; never us.</b>
        </Step>
        <Step n={2} title="Create an access key.">
          In the{" "}
          <a className={linkCls} href={IAM_CONSOLE} target="_blank" rel="noreferrer">
            AWS console → IAM → Users <ExternalLink className="size-3" />
          </a>
          , add a user, give it permissions (easiest: <b className="text-on-surface">AdministratorAccess</b>; recommended
          tighter option: the{" "}
          <a className={linkCls} href={POLICY_FILE} target="_blank" rel="noreferrer">
            Mailpoppy provisioning policy <ExternalLink className="size-3" />
          </a>
          ), then create an access key and copy the two values.
        </Step>
        <Step n={3} title="Paste the two values below and connect.">
          That's it — no terminal needed.
        </Step>
      </ol>

      {/* Key entry */}
      <div className="mt-5 flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm text-on-surface-variant">
          Access Key ID
          <input
            value={accessKeyId}
            onChange={(e) => setAccessKeyId(e.target.value.trim())}
            placeholder="AKIA…"
            className={inputCls}
            disabled={busy}
            {...noAutoCap}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-on-surface-variant">
          Secret Access Key
          <div className="relative">
            <input
              value={secretAccessKey}
              onChange={(e) => setSecretAccessKey(e.target.value.trim())}
              type={showSecret ? "text" : "password"}
              placeholder="••••••••••••••••••••••••••••••••"
              className={cn(inputCls, "pr-10")}
              disabled={busy}
              {...noAutoCap}
            />
            <button
              type="button"
              onClick={() => setShowSecret((s) => !s)}
              aria-label={showSecret ? "Hide secret" : "Show secret"}
              className="absolute inset-y-0 right-2 flex items-center text-on-surface-variant hover:text-on-surface"
            >
              {showSecret ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </label>

        {/* Temporary credentials (optional) */}
        <button
          type="button"
          onClick={() => setShowAdvanced((s) => !s)}
          className="self-start text-xs text-on-surface-variant underline-offset-2 hover:underline"
        >
          {showAdvanced ? "Hide" : "Using temporary credentials?"}
        </button>
        {showAdvanced && (
          <>
            <label className="flex flex-col gap-1 text-sm text-on-surface-variant">
              Session token <span className="text-xs text-on-surface-variant/70">(only for temporary STS keys)</span>
              <input
                value={sessionToken}
                onChange={(e) => setSessionToken(e.target.value.trim())}
                placeholder="optional"
                className={inputCls}
                disabled={busy}
                {...noAutoCap}
              />
            </label>
            <div className="rounded-lg border border-outline-variant/20 bg-surface-container-lowest p-3 text-xs text-on-surface-variant">
              <b className="text-on-surface">Prefer the command line / SSO?</b> Mailpoppy also reads your existing AWS
              profiles in <code className="font-mono">~/.aws</code>. Set one up with{" "}
              <code className="font-mono">aws configure</code>
              {cliInstalled ? "" : " (after installing the AWS CLI)"} or <code className="font-mono">aws sso login</code>,
              then{" "}
              <button onClick={onRecheck} className="text-primary underline-offset-2 hover:underline">
                re-check
              </button>
              .
            </div>
          </>
        )}

        {error && (
          <p className="flex items-start gap-1.5 text-sm text-tertiary">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {error}
          </p>
        )}

        <div className="flex items-center gap-3">
          <Button onClick={() => void onConnect()} disabled={!canSubmit}>
            {busy ? <Spinner /> : <KeyRound className="size-4" />} Connect
          </Button>
          <Button variant="secondary" size="sm" onClick={onRecheck} disabled={busy}>
            <RefreshCw className="size-3.5" /> Re-check
          </Button>
        </div>

        <p className="flex items-start gap-1.5 text-xs text-on-surface-variant">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-secondary" />
          Saved only on this computer, in the standard AWS location (<code className="font-mono">~/.aws/credentials</code>,
          owner-only permissions) — exactly where the AWS CLI keeps them. Never uploaded or sent to Mailpoppy.
        </p>
      </div>
    </div>
  );
}
