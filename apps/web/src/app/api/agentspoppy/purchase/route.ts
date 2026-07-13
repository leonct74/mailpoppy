// POST /api/agentspoppy/purchase — AgentsPoppy → MailPoppy push. When someone buys the
// `domain-access` product through AgentsPoppy's in-app checkout (target = their email domain),
// AgentsPoppy POSTs a SIGNED notification here so the Hub can flip that domain on immediately (no
// polling). We mirror the entitlement onto `domains/{domain}.agentspoppyEntitled`, which the resolve
// gate reads. Signature-verified with the shared secret; inert (503) until AGENTSPOPPY_NOTIFY_SECRET
// is set. Writes are idempotent (a plain merge), so retries are safe.
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/lib/hub/firestore";
import { normaliseDomain } from "@/lib/hub/directory";
import {
  agentsPoppyNotifySecret,
  verifyPurchaseSignature,
  AGENTSPOPPY_POPPY_ID,
  DOMAIN_ACCESS_PRODUCT,
} from "@/lib/hub/agentspoppy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PurchaseBody {
  poppyId?: string;
  productId?: string;
  target?: string | null;
  entitled?: boolean;
}

export async function POST(req: NextRequest) {
  const secret = agentsPoppyNotifySecret();
  if (!secret) return NextResponse.json({ error: "not_configured" }, { status: 503 });

  const raw = await req.text(); // raw body required for signature verification
  const sig = req.headers.get("x-agentspoppy-signature");
  if (!verifyPurchaseSignature(sig, raw, secret, Math.floor(Date.now() / 1000))) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  }

  let body: PurchaseBody;
  try {
    body = JSON.parse(raw) as PurchaseBody;
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  // Only act on OUR poppy's domain-access product; acknowledge anything else so AgentsPoppy doesn't retry.
  if (body.poppyId !== AGENTSPOPPY_POPPY_ID || body.productId !== DOMAIN_ACCESS_PRODUCT) {
    return NextResponse.json({ received: true, note: "ignored" });
  }
  const domain = body.target ? normaliseDomain(body.target) : "";
  if (!domain) return NextResponse.json({ received: true, note: "no_target" });

  const db = getDb();
  if (!db) return NextResponse.json({ received: true, note: "no_db" });

  try {
    // Mirror the entitlement. Merge so we never clobber the domain's deployment/registration fields;
    // if the doc doesn't exist yet (bought before the backend was registered), it's created with just
    // the flag and completed later by /api/deployments/register.
    await db.collection("domains").doc(domain).set({ agentspoppyEntitled: body.entitled === true }, { merge: true });
  } catch (e) {
    console.error("[hub] agentspoppy purchase mirror write failed:", e);
    return NextResponse.json({ error: "write_failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
