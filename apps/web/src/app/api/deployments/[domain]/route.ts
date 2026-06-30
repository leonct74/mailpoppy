// DELETE /api/deployments/:domain — the desktop deregisters a domain (e.g. on per-domain
// teardown) so it disappears from the directory + the dashboard. Firebase-authed; only the
// owning account may remove it. Idempotent: removing a non-existent mapping is a success.
import { NextResponse, type NextRequest } from "next/server";
import { verifyRequest } from "@/lib/hub/firebaseAdmin";
import { getDb } from "@/lib/hub/firestore";
import { normaliseDomain } from "@/lib/hub/directory";
import type { DomainRecord } from "@/lib/hub/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ domain: string }> }) {
  const user = await verifyRequest(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: CORS });

  const db = getDb();
  if (!db) return NextResponse.json({ error: "unavailable" }, { status: 503, headers: CORS });

  const { domain: raw } = await ctx.params;
  const domain = normaliseDomain(raw);

  try {
    const ref = db.collection("domains").doc(domain);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ ok: true }, { headers: CORS });
    if ((snap.data() as DomainRecord).accountId !== user.uid) {
      return NextResponse.json({ error: "owned_by_another_account" }, { status: 403, headers: CORS });
    }
    await ref.delete();
    return NextResponse.json({ ok: true }, { headers: CORS });
  } catch (e) {
    console.error("[hub] deregister failed:", e);
    return NextResponse.json(
      { error: "deregister_failed", detail: e instanceof Error ? e.message : String(e) },
      { status: 500, headers: CORS },
    );
  }
}
