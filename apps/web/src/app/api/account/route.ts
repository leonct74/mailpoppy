// GET /api/account — the admin dashboard's data. Authed with a Firebase ID token
// (Authorization: Bearer …). Returns the account's billing standing + the domains it owns,
// each with whether mobile access is active. Bootstraps the account doc on first sight so a
// freshly-signed-up admin has a record before they've subscribed to anything.
import { NextResponse, type NextRequest } from "next/server";
import { verifyRequest } from "@/lib/hub/firebaseAdmin";
import { getDb } from "@/lib/hub/firestore";
import type { AccountRecord, DomainRecord } from "@/lib/hub/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await verifyRequest(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const db = getDb();
  if (!db) return NextResponse.json({ error: "unavailable" }, { status: 503 });

  // Bootstrap the account doc on first sign-in (no subscription yet).
  const ref = db.collection("accounts").doc(user.uid);
  const snap = await ref.get();
  let account: AccountRecord;
  if (!snap.exists) {
    account = {
      email: user.email ?? "",
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      subscriptionStatus: "none",
      currentPeriodEnd: null,
    };
    await ref.set({ ...account, createdAt: Date.now(), updatedAt: Date.now() });
  } else {
    account = snap.data() as AccountRecord;
  }

  const ownedSnap = await db.collection("domains").where("accountId", "==", user.uid).get();
  const domains = ownedSnap.docs.map((d) => {
    const r = d.data() as DomainRecord;
    return { domain: d.id, mobileActive: !!r.mobileActive, verified: !!r.verified };
  });

  return NextResponse.json({
    email: account.email || user.email,
    subscriptionStatus: account.subscriptionStatus ?? "none",
    currentPeriodEnd: account.currentPeriodEnd ?? null,
    domains,
  });
}
