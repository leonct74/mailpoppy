// GET /api/mobile-status — is the MailPoppy mobile app actually downloadable yet?
//
// The desktop's "mobile access" panel reads this to decide between the live purchase button and an
// honest "coming soon + notify me" state. It is server-driven ON PURPOSE: AgentsPoppy is live and
// MailPoppy is installed in the wild, so a desktop release can't reach every copy — flipping this one
// flag flips every install at once, the day iOS/Android are live.
//
// Flip it by setting env `MOBILE_APPS_LIVE=true` (and redeploying). Default OFF → coming soon, so we
// never sell a download that doesn't exist. Public, CORS-open (the desktop calls it cross-origin).
import { NextResponse } from "next/server";

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

export function GET() {
  const live = process.env.MOBILE_APPS_LIVE === "true";
  return NextResponse.json(
    { live },
    { headers: { ...CORS, "Cache-Control": "public, max-age=60" } },
  );
}
