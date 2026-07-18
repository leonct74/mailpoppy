// POST /api/mobile-notify — "tell me when the MailPoppy mobile app is out."
//
// While the native apps aren't downloadable yet, the desktop's mobile panel shows a "coming soon"
// state with an email capture instead of a purchase button (see /api/mobile-status). This stores that
// interest so nobody who wanted it is lost when the apps ship. Idempotent per email+domain; best-effort
// (a storage hiccup returns ok:false but never throws). Public, CORS-open (desktop posts cross-origin).
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/lib/hub/firestore";
import { normaliseDomain } from "@/lib/hub/directory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

// Deliberately liberal: enough to reject obvious junk, not to police valid addresses.
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// A safe Firestore doc id from an email (no "/", bounded length).
function waitlistId(email: string): string {
  return email.toLowerCase().replace(/[^a-z0-9._-]+/g, "_").slice(0, 200);
}

export async function POST(req: NextRequest) {
  let body: { email?: string; domain?: string };
  try {
    body = (await req.json()) as { email?: string; domain?: string };
  } catch {
    return NextResponse.json({ ok: false, error: "bad_json" }, { status: 400, headers: CORS });
  }

  const email = (body.email ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ ok: false, error: "bad_email" }, { status: 400, headers: CORS });
  }
  const domain = body.domain ? normaliseDomain(body.domain) : "";

  const db = getDb();
  // No DB configured (local/un-provisioned) → acknowledge so the UI still says "we'll let you know".
  // The capture is best-effort; we never surface a storage failure as a user-facing error.
  if (!db) return NextResponse.json({ ok: true, stored: false }, { headers: CORS });

  try {
    await db
      .collection("mobileWaitlist")
      .doc(waitlistId(email))
      .set({ email, domain: domain || null, updatedAt: new Date().toISOString() }, { merge: true });
    return NextResponse.json({ ok: true, stored: true }, { headers: CORS });
  } catch (e) {
    console.error("[hub] mobile-notify write failed:", e);
    return NextResponse.json({ ok: true, stored: false }, { headers: CORS });
  }
}
