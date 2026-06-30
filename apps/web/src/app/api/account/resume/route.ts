// POST /api/account/resume — undo a scheduled cancellation (the admin changed their mind before
// the period end). Clears cancel_at_period_end so the subscription renews normally again.
import { NextResponse, type NextRequest } from "next/server";
import { verifyRequest } from "@/lib/hub/firebaseAdmin";
import { getDb } from "@/lib/hub/firestore";
import { getStripe } from "@/lib/hub/stripeClient";
import type { AccountRecord } from "@/lib/hub/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const user = await verifyRequest(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const stripe = getStripe();
  if (!stripe) return NextResponse.json({ error: "stripe_not_configured" }, { status: 503 });
  const db = getDb();
  if (!db) return NextResponse.json({ error: "unavailable" }, { status: 503 });

  const acctRef = db.collection("accounts").doc(user.uid);
  const acct = (await acctRef.get()).data() as AccountRecord | undefined;
  const subId = acct?.stripeSubscriptionId ?? null;
  if (!subId) return NextResponse.json({ error: "no_subscription" }, { status: 400 });

  try {
    await stripe.subscriptions.update(subId, { cancel_at_period_end: false });
    await acctRef.set({ cancelAt: null, updatedAt: Date.now() }, { merge: true });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[hub] resume failed:", e);
    return NextResponse.json(
      { error: "resume_failed", detail: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
