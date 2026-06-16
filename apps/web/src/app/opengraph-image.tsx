import { ImageResponse } from "next/og";

// Branded social-share card (used for Open Graph + Twitter). Composed with plain
// divs only — no external font or image fetch — so it generates reliably at build.
export const alt = "MailPoppy — Email you own, in your own AWS";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          background: "#051424",
          backgroundImage:
            "radial-gradient(900px 500px at 78% -10%, rgba(255,75,43,0.22), transparent)",
          color: "#d4e4fa",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 96,
              height: 96,
              borderRadius: 24,
              background: "#ff5637",
              color: "#ffffff",
              fontSize: 60,
              fontWeight: 700,
            }}
          >
            M
          </div>
          <div style={{ fontSize: 44, fontWeight: 700, color: "#ff5637" }}>MailPoppy</div>
        </div>

        <div style={{ marginTop: 56, fontSize: 76, fontWeight: 700, lineHeight: 1.05, color: "#ffdad3", letterSpacing: -1 }}>
          Email you own,
        </div>
        <div style={{ fontSize: 76, fontWeight: 700, lineHeight: 1.05, color: "#ffdad3", letterSpacing: -1 }}>
          in your own AWS.
        </div>

        <div style={{ marginTop: 40, fontSize: 30, color: "#e5bdb6" }}>
          A desktop app · Unlimited mailboxes in seconds · No per-seat fees
        </div>
      </div>
    ),
    { ...size },
  );
}
