import { useState } from "react";

// A reassuring (not scary) panel that makes the admin aware of their
// responsibilities and shows how Mailpoppy helps them meet them. The admin runs
// everything in their own AWS account, so they're the data controller — we frame
// that as empowering and point them in the right direction. Collapsible; the
// open/closed choice is remembered.

const KEY = "mailpoppy.privacyNoticeOpen";

function initialOpen(): boolean {
  try {
    return localStorage.getItem(KEY) !== "false";
  } catch {
    return true;
  }
}

const panel: React.CSSProperties = {
  border: "1px solid #bfdbfe",
  background: "#eff6ff",
  borderRadius: 12,
  padding: "14px 18px",
  marginTop: 16,
  color: "#1e3a5f",
};

export function AdminPrivacyNotice() {
  const [open, setOpen] = useState(initialOpen);

  function toggle() {
    const next = !open;
    setOpen(next);
    try {
      localStorage.setItem(KEY, String(next));
    } catch {
      /* ignore */
    }
  }

  return (
    <section style={panel} aria-label="Privacy and responsibilities">
      <button
        onClick={toggle}
        aria-expanded={open}
        style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "#1e40af", fontWeight: 700, fontSize: 15 }}
      >
        {open ? "▾" : "▸"} 🛡️ Running this the right way — what Mailpoppy handles for you
      </button>

      {open && (
        <div style={{ marginTop: 10, fontSize: 14, lineHeight: 1.55 }}>
          <p style={{ margin: "0 0 10px" }}>
            Mailpoppy runs entirely inside <b>your own AWS account</b>, so you stay in full control of your users'
            email. That control also makes you its <b>data controller</b> — and Mailpoppy is built to help you handle
            that responsibly:
          </p>
          <ul style={{ margin: "0 0 10px", paddingLeft: 22 }}>
            <li>
              <b>You choose where data lives.</b> Pick the AWS region below to match any data-residency rules that apply
              to your users (for example, an EU region for EU personal data).
            </li>
            <li>
              <b>Mail belongs to its owner.</b> Each mailbox is opened with the user's own password. Mailpoppy never
              asks you to read someone's mail, and you shouldn't access it without their authorization.
            </li>
            <li>
              <b>You decide how long mail is kept.</b> Some rules set a minimum retention, others a maximum — Mailpoppy
              lets you set a policy that fits (by default, mail is kept until you delete it).
            </li>
            <li>
              <b>Nothing is hidden.</b> The <b>AWS Resources</b> tab shows exactly what Mailpoppy created in your
              account, and everything runs in your account where you can review it.
            </li>
          </ul>
          <p style={{ margin: 0, fontSize: 13, color: "#475569" }}>
            This is guidance to help you set things up correctly — not legal advice. When in doubt, check the rules that
            apply to your users.
          </p>
        </div>
      )}
    </section>
  );
}
