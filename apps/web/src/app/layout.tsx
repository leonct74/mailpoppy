import type { Metadata } from "next";
import { Hanken_Grotesk } from "next/font/google";
import { SITE_URL, SITE_DESCRIPTION } from "@/lib/site";
import "./globals.css";

// Hanken Grotesk — the shared brand typeface (the mobile client loads the same
// family). Exposed as --font-hanken and wired to Tailwind's font-sans in globals.css.
const hanken = Hanken_Grotesk({
  variable: "--font-hanken",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "MailPoppy — Email you own, in your own AWS",
    template: "%s · MailPoppy",
  },
  description: SITE_DESCRIPTION,
  applicationName: "MailPoppy",
  robots: { index: true, follow: true },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${hanken.variable} h-full antialiased`}>
      <head>
        {/* TrafficPoppy analytics — served from our own AWS (eu-west-1 Lambda URL). */}
        <script
          defer
          src="https://cxmoxlb5izqlu33g6tbwjnwbau0ovgus.lambda-url.eu-west-1.on.aws/t.js"
          data-site="mO8ZDEOdoI4x"
        />
      </head>
      <body className="bg-bg text-text flex min-h-full flex-col">{children}</body>
    </html>
  );
}
