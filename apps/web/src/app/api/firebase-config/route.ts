// GET /api/firebase-config — the PUBLIC Firebase web config, so the desktop app can sign the
// admin into their MailPoppy account without baking the values into the build. These are public
// client identifiers (not secrets). CORS-open: the desktop calls this cross-origin.
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
  return NextResponse.json(
    {
      apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "",
      authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "",
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "",
      appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? "",
    },
    { headers: { ...CORS, "Cache-Control": "public, max-age=300" } },
  );
}
