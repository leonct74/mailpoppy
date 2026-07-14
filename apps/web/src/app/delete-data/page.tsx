import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/webmail/Logo";

export const metadata: Metadata = {
  title: "Data Deletion — MailPoppy",
  description: "How to request deletion of your MailPoppy mailbox and app data.",
};

// Referenced from the Google Play Data-safety form ("Delete data URL") and the
// privacy policy. Keep the steps + what-is-deleted/kept structure — Play requires
// both to be stated explicitly.
export default function DeleteDataPage() {
  return (
    <div className="bg-bg min-h-screen px-5 py-10">
      <div className="mx-auto max-w-2xl">
        <div className="mb-8 flex items-center justify-between">
          <Logo size="sm" />
          <Link
            href="/privacy"
            className="text-muted hover:bg-surface-variant rounded-lg px-3 py-1.5 text-sm transition-colors"
          >
            Privacy policy
          </Link>
        </div>

        <h1 className="text-heading text-3xl font-bold">Delete your data</h1>
        <p className="text-text mt-6 text-[15px] leading-relaxed">
          MailPoppy (the mobile and desktop mail apps) is the client for an email service that your
          organisation hosts in its own cloud account. MailPoppy the company does not hold your
          mail, your password, or your account — your organisation&apos;s administrator does. That
          shapes how deletion works:
        </p>

        <section className="mt-8">
          <h2 className="text-heading text-lg font-bold">Delete this device&apos;s data</h2>
          <p className="text-text mt-3 text-sm leading-relaxed">
            Sign out in the app (Settings → Sign out, or remove the mailbox from the mailbox list).
            This deletes the app&apos;s local data on your device and unregisters the device&apos;s
            push-notification token from your organisation&apos;s backend — the only per-device
            identifier the app registers anywhere.
          </p>
        </section>

        <section className="mt-8">
          <h2 className="text-heading text-lg font-bold">Delete your mailbox and its mail</h2>
          <p className="text-text mt-3 text-sm leading-relaxed">
            Ask your organisation&apos;s administrator — the person who created your mailbox — to
            remove it. Deleting a mailbox removes the account and all of its stored mail from your
            organisation&apos;s cloud storage. Administrators can also configure automatic retention
            periods, in which case mail older than the configured window is deleted automatically.
          </p>
          <p className="text-text mt-3 text-sm leading-relaxed">
            If you don&apos;t know who your administrator is, or you need help with a deletion
            request, contact{" "}
            <a href="mailto:support@mailpoppy.com" className="text-primary underline">
              support@mailpoppy.com
            </a>{" "}
            and we&apos;ll help you route the request.
          </p>
        </section>

        <section className="mt-8">
          <h2 className="text-heading text-lg font-bold">What is deleted, and what is kept</h2>
          <ul className="text-text mt-3 space-y-2 text-sm leading-relaxed">
            <li className="flex gap-2.5">
              <span className="text-primary mt-px font-bold">•</span>
              <span>
                <b>Deleted on sign-out:</b> all app data on the device, and the device&apos;s push
                token in your organisation&apos;s backend (immediately).
              </span>
            </li>
            <li className="flex gap-2.5">
              <span className="text-primary mt-px font-bold">•</span>
              <span>
                <b>Deleted when the administrator removes a mailbox:</b> the account and its stored
                messages and attachments, from your organisation&apos;s own cloud storage.
              </span>
            </li>
            <li className="flex gap-2.5">
              <span className="text-primary mt-px font-bold">•</span>
              <span>
                <b>Kept:</b> MailPoppy the company keeps nothing — mail, credentials, and account
                data never pass through MailPoppy&apos;s own systems, so there is nothing for us to
                retain or delete. Any additional retention is controlled by your organisation&apos;s
                administrator in their own cloud account.
              </span>
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}
