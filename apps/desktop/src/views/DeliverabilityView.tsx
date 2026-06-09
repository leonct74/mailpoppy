import { useEffect, useState, type ReactNode } from "react";
import { HeartPulse, RefreshCw, CheckCircle2, AlertTriangle, OctagonAlert, PauseCircle, Ban } from "lucide-react";
import {
  overallHealth,
  bounceHealth,
  complaintHealth,
  hasSendHistory,
  type DeliverabilityStatus,
  type HealthLevel,
} from "@mailpoppy/core";
import { getDeliverability as defaultLoad } from "../lib/deliverability";
import { resolveStackName } from "../lib/deploymentConfig";
import { Card, Button, Spinner, cn } from "../ui";

// "Sending health" — the plain-English view of whether the mail you send is
// actually getting through (DESIGN §13/§18 Phase 5). Email from a brand-new
// domain has to earn its reputation; if too much of it bounces or gets marked as
// spam, the big providers (Gmail, Outlook) start sending it to the spam folder —
// and AWS can even pause your sending. This panel surfaces those few numbers in
// everyday language, with no AWS jargon, so a non-technical admin can tell at a
// glance whether things are fine or need attention.

type Tone = "good" | "watch" | "action" | "neutral";

const toneText: Record<Tone, string> = {
  good: "text-secondary",
  watch: "text-amber-200",
  action: "text-tertiary",
  neutral: "text-on-surface-variant",
};
const toneBanner: Record<Tone, string> = {
  good: "border-secondary/30 bg-secondary/10 text-secondary",
  watch: "border-amber-400/30 bg-amber-400/10 text-amber-100",
  action: "border-tertiary/30 bg-tertiary-container/15 text-tertiary",
  neutral: "border-outline-variant/20 bg-surface-container-lowest text-on-surface-variant",
};
const toneDot: Record<Tone, string> = {
  good: "bg-secondary",
  watch: "bg-amber-300",
  action: "bg-tertiary",
  neutral: "bg-outline-variant",
};

const healthTone = (h: HealthLevel): Tone => h;
const healthLabel: Record<HealthLevel, string> = {
  good: "Looking good",
  watch: "Worth watching",
  action: "Needs attention",
};

/** Format a 0..1 rate as a friendly percentage ("0.3%", "12%"). */
function pct(r: number): string {
  if (r <= 0) return "0%";
  const p = r * 100;
  return `${p < 1 ? p.toFixed(2) : p < 10 ? p.toFixed(1) : Math.round(p)}%`;
}

function HealthChip({ level }: { level: HealthLevel }) {
  const tone = healthTone(level);
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium", toneText[tone])}>
      <span className={cn("size-2 rounded-full", toneDot[tone])} />
      {healthLabel[level]}
    </span>
  );
}

/** One plain-language metric tile. */
function MetricCard({
  title,
  headline,
  help,
  level,
}: {
  title: string;
  headline: ReactNode;
  help: string;
  level?: HealthLevel;
}) {
  return (
    <div className="rounded-xl border border-outline-variant/10 bg-surface-container-highest/40 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="text-sm font-medium text-on-surface">{title}</div>
        {level && <HealthChip level={level} />}
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight text-on-surface">{headline}</div>
      <p className="mt-1.5 text-xs leading-relaxed text-on-surface-variant">{help}</p>
    </div>
  );
}

export interface DeliverabilityViewProps {
  stackName?: string;
  load?: (stackName: string) => Promise<DeliverabilityStatus>;
}

export function DeliverabilityView({ stackName = resolveStackName(), load = defaultLoad }: DeliverabilityViewProps) {
  const [data, setData] = useState<DeliverabilityStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setErr(null);
    try {
      setData(await load(stackName));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stackName]);

  const overall = data ? overallHealth(data) : "good";
  const sent = data?.totals.deliveryAttempts ?? 0;

  // The headline banner — paused sending is the loudest case, then no-history,
  // then the overall good/watch/action level.
  const banner = (() => {
    if (!data) return null;
    if (data.sendingPaused) {
      return {
        tone: "action" as Tone,
        icon: <PauseCircle className="size-5 shrink-0" />,
        title: "Your sending is paused",
        body: "Amazon has temporarily stopped this account from sending email — usually because too many messages bounced or were marked as spam. New email won't go out until this is resolved. Reach out and we can help you get it lifted.",
      };
    }
    if (!hasSendHistory(data)) {
      return {
        tone: "neutral" as Tone,
        icon: <HeartPulse className="size-5 shrink-0" />,
        title: "Nothing to report yet",
        body: "You haven't sent any email from this account in the last couple of weeks, so there's nothing to measure. Once you start sending, this page will show how your mail is doing.",
      };
    }
    if (overall === "good") {
      return {
        tone: "good" as Tone,
        icon: <CheckCircle2 className="size-5 shrink-0" />,
        title: "Your email is in good shape",
        body: "The mail you send is being accepted normally. Keep sending to people who expect to hear from you and you'll stay in good standing.",
      };
    }
    if (overall === "watch") {
      return {
        tone: "watch" as Tone,
        icon: <AlertTriangle className="size-5 shrink-0" />,
        title: "Worth keeping an eye on",
        body: "A higher-than-usual share of your email is bouncing or being marked as spam. It's not urgent yet, but it's worth checking who you're emailing — only send to people who expect it, and remove old or wrong addresses.",
      };
    }
    return {
      tone: "action" as Tone,
      icon: <OctagonAlert className="size-5 shrink-0" />,
      title: "This needs your attention",
      body: "Too much of your email is bouncing or being reported as spam. If this continues, your messages will start landing in spam folders and your sending could be paused. Stop emailing addresses that bounce, and only send to people who expect to hear from you.",
    };
  })();

  return (
    <Card>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-on-surface">
            <HeartPulse className="size-5 text-primary" />
            Sending health
          </h2>
          <p className="mt-1 max-w-2xl text-on-surface-variant">
            A simple read on whether the email you send is actually reaching people — or starting to land in spam.
            Checked across all your domains on this account.
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => void refresh()} disabled={loading}>
          {loading ? <Spinner /> : <RefreshCw className="size-4" />}
          Refresh
        </Button>
      </div>

      {loading && !data ? (
        <div className="mt-5 flex items-center gap-2 text-sm text-on-surface-variant">
          <Spinner /> Checking your sending health…
        </div>
      ) : err ? (
        <div className="mt-5 rounded-lg border border-tertiary/30 bg-tertiary-container/10 p-4">
          <div className="text-tertiary">Couldn't check your sending health: {err}</div>
          <p className="mt-1.5 text-sm text-on-surface-variant">
            Make sure the app's helper is running and your AWS access is set up, then try Refresh.
          </p>
        </div>
      ) : data ? (
        <div className="mt-5 flex flex-col gap-5">
          {banner && (
            <div className={cn("flex items-start gap-3 rounded-xl border px-4 py-3", toneBanner[banner.tone])}>
              {banner.icon}
              <div>
                <div className="font-semibold">{banner.title}</div>
                <p className="mt-0.5 text-sm opacity-90">{banner.body}</p>
              </div>
            </div>
          )}

          {/* The three numbers that matter, in plain language. */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <MetricCard
              title="Bounced back"
              level={hasSendHistory(data) ? bounceHealth(data.bounceRate) : undefined}
              headline={
                <span>
                  {data.totals.bounces}
                  {sent > 0 && <span className="ml-1.5 text-base font-normal text-on-surface-variant">({pct(data.bounceRate)})</span>}
                </span>
              }
              help={
                sent > 0
                  ? `Of the ${sent.toLocaleString()} emails you sent recently, this many couldn't be delivered. A few is normal; a lot can hurt whether your email reaches inboxes.`
                  : "Emails that couldn't be delivered (e.g. the address doesn't exist). None yet."
              }
            />
            <MetricCard
              title="Marked as spam"
              level={hasSendHistory(data) ? complaintHealth(data.complaintRate) : undefined}
              headline={
                <span>
                  {data.totals.complaints}
                  {sent > 0 && <span className="ml-1.5 text-base font-normal text-on-surface-variant">({pct(data.complaintRate)})</span>}
                </span>
              }
              help="People who clicked 'mark as spam' on your email. Keep this very low — lots of spam reports can get your sending blocked."
            />
            <MetricCard
              title="Sent today"
              headline={
                data.dailyLimit < 0 ? (
                  <span>{data.dailyUsed.toLocaleString()}</span>
                ) : (
                  <span>
                    {data.dailyUsed.toLocaleString()}
                    <span className="text-base font-normal text-on-surface-variant"> / {data.dailyLimit.toLocaleString()}</span>
                  </span>
                )
              }
              help={
                data.dailyLimit < 0
                  ? "How many emails you've sent in the last 24 hours. You have no daily limit."
                  : `How many emails you've sent in the last 24 hours, out of the most your account can send per day.`
              }
            />
          </div>

          {/* Do-not-send list */}
          <div className="rounded-xl border border-outline-variant/10 bg-surface-container-highest/40 p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-on-surface">
              <Ban className="size-4 text-on-surface-variant" />
              Addresses we've stopped emailing
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-on-surface-variant">
              When an address keeps bouncing or marks your email as spam, Mailpoppy automatically stops sending to it.
              This is normal and healthy — it protects your reputation so your other email keeps getting through.
            </p>
            {data.suppressed.length === 0 ? (
              <p className="mt-3 text-sm text-on-surface-variant">
                None — we haven't had to stop sending to anyone. 👍
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-outline-variant/10">
                {data.suppressed.map((s) => (
                  <li key={s.address} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span className="break-all font-mono text-xs text-on-surface">{s.address}</span>
                    <span className="shrink-0 text-xs text-on-surface-variant">
                      {s.reason === "complaint" ? "marked your email as spam" : "kept bouncing"}
                      {s.suppressedAt ? ` · ${new Date(s.suppressedAt).toLocaleDateString()}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <p className="text-xs text-on-surface-variant">
            Based on your sending over roughly the last {data.windowDays} day{data.windowDays === 1 ? "" : "s"}.
          </p>
        </div>
      ) : null}
    </Card>
  );
}
