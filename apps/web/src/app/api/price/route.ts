// GET /api/price — the live per-domain price, read straight from the configured Stripe price so
// the activation page never hard-codes (or drifts from) the real amount. Public, CORS-open.
import { NextResponse } from "next/server";
import { getStripe, stripePriceId } from "@/lib/hub/stripeClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET() {
  const stripe = getStripe();
  const priceId = stripePriceId();
  if (!stripe || !priceId) {
    return NextResponse.json({ error: "not_configured" }, { status: 503, headers: CORS });
  }
  try {
    const price = await stripe.prices.retrieve(priceId);
    return NextResponse.json(
      {
        amount: price.unit_amount, // minor units (e.g. cents)
        currency: price.currency,
        interval: price.recurring?.interval ?? null, // "month" | "year" | null
        intervalCount: price.recurring?.interval_count ?? 1,
      },
      { headers: { ...CORS, "Cache-Control": "public, max-age=300" } },
    );
  } catch (e) {
    console.error("[hub] price lookup failed:", e);
    return NextResponse.json({ error: "price_failed" }, { status: 500, headers: CORS });
  }
}
