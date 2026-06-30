// POST /api/account/portal — open the Stripe Billing Portal so the admin can update their card
// or cancel. Returns { url } to redirect to. (Configure the Portal in Stripe to allow card +
// cancel, but NOT per-item quantity edits — per-domain changes go through activate/deactivate so
// our Firestore flags stay authoritative.)
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

  const acct = (await db.collection("accounts").doc(user.uid).get()).data() as AccountRecord | undefined;
  if (!acct?.stripeCustomerId) {
    return NextResponse.json({ error: "no_customer" }, { status: 400 });
  }

  const origin = req.headers.get("origin") ?? "https://mailpoppy.com";
  const session = await stripe.billingPortal.sessions.create({
    customer: acct.stripeCustomerId,
    return_url: `${origin}/account`,
  });
  return NextResponse.json({ url: session.url });
}
