import type { Metadata } from "next";
import { Webmail } from "@/components/webmail/Webmail";

export const metadata: Metadata = {
  title: "MailPoppy Mail",
};

// The webmail is fully client-rendered (Cognito auth + per-user mailbox), so there
// is nothing to statically prerender.
export const dynamic = "force-dynamic";

export default function AppPage() {
  return <Webmail />;
}
