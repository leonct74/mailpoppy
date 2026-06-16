// "Crimson Navy Professional" — the dark-mode design system (Google Stitch
// redesign). Deep navy surfaces with vibrant crimson accents; Hanken Grotesk
// type. Depth comes from tonal layering, not heavy shadows.
export const colors = {
  // Surfaces (darkest → lightest tonal layers)
  bg: "#051424", // app background / shell
  bgElevated: "#0d1c2d", // subtle raised sections
  surface: "#1a232e", // cards, list items
  surfaceHigh: "#1c2b3c", // inputs, search bar
  surfaceContainer: "#122131", // bottom nav, login form surface
  surfaceVariant: "#273647", // pressed / hover fills
  border: "rgba(255,255,255,0.06)", // hairline rim-light borders

  // Crimson brand
  primary: "#ff5637", // crimson — buttons, FAB, active nav, wordmark
  primaryBright: "#ff4b2b", // gradient start / ambient glow
  primaryDeep: "#ba1c00", // gradient end
  primaryDim: "#ba1c00",
  primaryText: "#ffffff", // text/icons on crimson
  poppy: "#ff5637", // legacy alias (wordmark accent)

  // Text
  text: "#d4e4fa", // primary text (on-surface)
  heading: "#ffdad3", // warm headings ("Welcome Back")
  textMuted: "#e5bdb6", // secondary text/icons (rose, on-surface-variant)
  textDim: "#94a3b8", // most-muted slate

  danger: "#ffb4ab", // destructive (kept distinct from the crimson primary)
  unread: "#ff5637", // unread indicator
} as const;

// Hanken Grotesk family names (loaded via @expo-google-fonts/hanken-grotesk in
// App.tsx). Use `fontFamily` with these instead of `fontWeight`, since a custom
// font renders weight via the named family. Falls back to the system font until
// the bundle loads.
export const fonts = {
  regular: "HankenGrotesk_400Regular",
  medium: "HankenGrotesk_500Medium",
  semibold: "HankenGrotesk_600SemiBold",
  bold: "HankenGrotesk_700Bold",
} as const;

/** Format an ISO date as a short, human label for the message list / header. */
export function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
