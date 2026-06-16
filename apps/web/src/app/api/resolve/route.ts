// GET /api/resolve?domain=acme.com   (or ?email=you@acme.com — domain is derived, the
// full address is never used). Returns the PUBLIC deployment config for the domain, so a
// client knows which backend to sign in against. The heart of multi-tenant login.
//
// Native apps (React Native) aren't subject to browser CORS, but the webmail and any
// browser integration are — so we send permissive CORS on this read-only, public endpoint.
import { NextResponse, type NextRequest } from "next/server";
import { resolveDomain } from "@/lib/hub/directory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function domainFrom(req: NextRequest): string | null {
  const params = req.nextUrl.searchParams;
  const domain = params.get("domain");
  if (domain) return domain;
  const email = params.get("email");
  if (email && email.includes("@")) return email.split("@").pop() ?? null;
  return null;
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(req: NextRequest) {
  const input = domainFrom(req);
  if (!input) {
    return NextResponse.json({ error: "missing_domain" }, { status: 400, headers: CORS });
  }
  const result = await resolveDomain(input);
  if (!result.ok) {
    const status = result.reason === "inactive_subscription" ? 403 : 404;
    return NextResponse.json({ error: result.reason }, { status, headers: CORS });
  }
  return NextResponse.json(result.deployment, {
    status: 200,
    headers: { ...CORS, "Cache-Control": "public, max-age=60" },
  });
}
