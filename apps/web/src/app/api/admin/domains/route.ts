// Admin comp control — for MailPoppy's OWN operators to grant/revoke a domain's client
// access WITHOUT going through Stripe (testing, comps, partners). Guarded by a shared
// secret in `HUB_ADMIN_TOKEN` (set on the hosting env); if that's unset the endpoint is
// disabled (503), so it's never an open door.
//
//   GET  /api/admin/domains?domain=acme.com     → inspect the domain's current state
//   POST /api/admin/domains { domain, active }   → set manualEntitlement (the comp flag)
//        optional `deployment:{region,userPoolId,clientId,apiBaseUrl}` creates the doc if
//        the domain isn't registered yet.
//
// Auth: `Authorization: Bearer <HUB_ADMIN_TOKEN>`.
import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getDb } from "@/lib/hub/firestore";
import { normaliseDomain } from "@/lib/hub/directory";
import type { DeploymentConfig, DomainRecord } from "@/lib/hub/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

/** Constant-time bearer check against HUB_ADMIN_TOKEN. Returns a Response on failure, else null.
 *  Both sides are trimmed: secret stores + CLIs love to append a trailing newline, and that
 *  invisible byte shouldn't lock the operator out. */
function authFail(req: NextRequest): NextResponse | null {
  const expected = process.env.HUB_ADMIN_TOKEN?.trim();
  if (!expected) {
    return NextResponse.json({ error: "admin_disabled" }, { status: 503 });
  }
  const m = (req.headers.get("authorization") ?? "").match(/^Bearer\s+(.+)$/i);
  const provided = (m?.[1] ?? "").trim();
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}

function validDeployment(d: unknown): d is DeploymentConfig {
  const x = d as Partial<DeploymentConfig> | null;
  return !!(x && x.region && x.userPoolId && x.clientId && x.apiBaseUrl);
}

export async function GET(req: NextRequest) {
  const denied = authFail(req);
  if (denied) return denied;

  const domain = normaliseDomain(req.nextUrl.searchParams.get("domain") ?? "");
  if (!DOMAIN_RE.test(domain)) return NextResponse.json({ error: "invalid_domain" }, { status: 400 });

  const db = getDb();
  if (!db) return NextResponse.json({ error: "firestore_unavailable" }, { status: 503 });

  const snap = await db.collection("domains").doc(domain).get();
  if (!snap.exists) return NextResponse.json({ domain, exists: false }, { status: 200 });
  const rec = snap.data() as DomainRecord;
  return NextResponse.json(
    {
      domain,
      exists: true,
      manualEntitlement: rec.manualEntitlement ?? false,
      mobileActive: rec.mobileActive ?? false,
      accountId: rec.accountId ?? null,
      verified: rec.verified ?? false,
      hasDeployment: !!rec.deployment?.apiBaseUrl,
    },
    { status: 200 },
  );
}

export async function POST(req: NextRequest) {
  const denied = authFail(req);
  if (denied) return denied;

  let body: { domain?: string; active?: boolean; deployment?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const domain = normaliseDomain(body.domain ?? "");
  if (!DOMAIN_RE.test(domain)) return NextResponse.json({ error: "invalid_domain" }, { status: 400 });
  if (typeof body.active !== "boolean") {
    return NextResponse.json({ error: "missing_active", detail: "body.active must be true or false" }, { status: 400 });
  }

  const db = getDb();
  if (!db) return NextResponse.json({ error: "firestore_unavailable" }, { status: 503 });

  const ref = db.collection("domains").doc(domain);
  const snap = await ref.get();
  const now = Date.now();

  if (!snap.exists) {
    // The domain isn't registered yet — we can only comp it if we're given the backend to
    // point at (normally the desktop app registers this on deploy).
    if (!validDeployment(body.deployment)) {
      return NextResponse.json(
        {
          error: "unknown_domain",
          detail:
            "This domain isn't registered. Deploy it from the desktop app first, or include a `deployment` {region,userPoolId,clientId,apiBaseUrl} to create the entry.",
        },
        { status: 404 },
      );
    }
    const rec: DomainRecord = {
      domain,
      accountId: null,
      deployment: body.deployment,
      verified: true,
      manualEntitlement: body.active,
    };
    await ref.set({ ...rec, updatedAt: now });
    return NextResponse.json({ domain, manualEntitlement: body.active, created: true }, { status: 200 });
  }

  await ref.set({ manualEntitlement: body.active, updatedAt: now }, { merge: true });
  return NextResponse.json({ domain, manualEntitlement: body.active, created: false }, { status: 200 });
}
