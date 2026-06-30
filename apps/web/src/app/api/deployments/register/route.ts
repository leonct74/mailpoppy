// POST /api/deployments/register — the desktop app registers a domain → its backend's public
// config with the Hub, bound to the admin's MailPoppy account. This is what makes a domain show
// up on /account so it can be activated for mobile. Firebase-authed (Bearer ID token). A domain
// can be owned by exactly one account; re-registering by the same owner just refreshes the config.
import { NextResponse, type NextRequest } from "next/server";
import { verifyRequest } from "@/lib/hub/firebaseAdmin";
import { getDb } from "@/lib/hub/firestore";
import { normaliseDomain } from "@/lib/hub/directory";
import type { DomainRecord } from "@/lib/hub/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// Same shape as the directory's domain validation.
const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(req: NextRequest) {
  const user = await verifyRequest(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: CORS });

  const db = getDb();
  if (!db) return NextResponse.json({ error: "unavailable" }, { status: 503, headers: CORS });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const domain = normaliseDomain(String(body.domain ?? ""));
  if (!DOMAIN_RE.test(domain)) {
    return NextResponse.json({ error: "invalid_domain" }, { status: 400, headers: CORS });
  }

  const deployment = {
    region: String(body.region ?? "").trim(),
    userPoolId: String(body.userPoolId ?? "").trim(),
    clientId: String(body.clientId ?? "").trim(),
    apiBaseUrl: String(body.apiBaseUrl ?? "").trim().replace(/\/$/, ""),
  };
  if (!deployment.region || !deployment.userPoolId || !deployment.clientId || !deployment.apiBaseUrl) {
    return NextResponse.json({ error: "incomplete_deployment" }, { status: 400, headers: CORS });
  }

  try {
    const ref = db.collection("domains").doc(domain);
    const snap = await ref.get();
    if (snap.exists) {
      const existing = snap.data() as DomainRecord;
      if (existing.accountId && existing.accountId !== user.uid) {
        return NextResponse.json({ error: "owned_by_another_account" }, { status: 403, headers: CORS });
      }
    }
    await ref.set(
      {
        accountId: user.uid,
        deployment,
        verified: true,
        updatedAt: Date.now(),
        // Don't reset an already-activated domain's flag on a config refresh.
        ...(snap.exists ? {} : { mobileActive: false, createdAt: Date.now() }),
      },
      { merge: true },
    );
    return NextResponse.json({ ok: true, domain }, { headers: CORS });
  } catch (e) {
    console.error("[hub] register failed:", e);
    return NextResponse.json(
      { error: "register_failed", detail: e instanceof Error ? e.message : String(e) },
      { status: 500, headers: CORS },
    );
  }
}
