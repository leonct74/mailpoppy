// Safe rendering of a received message body on mobile. The desktop/web sanitize
// with DOMPurify, which needs a DOM and can't run on Hermes — so on RN we render
// the HTML inside a sandboxed WebView whose SECURITY comes from a strict CSP that
// the WebKit/Chromium engine enforces:
//   • script-src 'none'  → the email's scripts AND inline on* handlers never run
//     (CSP treats inline handlers as inline script), so XSS via the body is dead
//     even though we enable JS at the WebView level for the height reporter.
//   • default-src 'none' → nothing loads unless explicitly allowed below.
//   • img/media-src       → 'data:' only by default (blocks tracking pixels /
//     remote beacons); flipped to allow https when the user taps "Load images".
//   • the document is a synthetic about:blank/data doc with no app origin access,
//     and every http(s) navigation (link tap) is opened in the system browser.
// Plain-text messages keep the simple <Text> path.
import { useState } from "react";
import { Linking, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { WebView } from "react-native-webview";
import { Ionicons } from "@expo/vector-icons";
import { colors, fonts } from "../theme";

// Crude "does this HTML reference remote content?" sniff — only drives whether we
// show the "Load images" affordance; the CSP is what actually blocks loading.
const REMOTE_ATTR = /(?:src|srcset|background|poster)\s*=\s*["']?\s*(?:https?:)?\/\//i;
const REMOTE_CSS = /url\s*\(\s*["']?\s*(?:https?:)?\/\//i;

function buildDoc(html: string, allowImages: boolean): string {
  const media = allowImages ? "data: https:" : "data:";
  const csp =
    `default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; ` +
    `img-src ${media}; media-src ${media}; font-src data:;`;
  return (
    `<!DOCTYPE html><html><head>` +
    `<meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<meta http-equiv="Content-Security-Policy" content="${csp}">` +
    `<style>` +
    `:root{color-scheme:dark;}` +
    `html,body{margin:0;padding:0;}` +
    `body{padding:4px 2px;background:${colors.bg};color:${colors.text};` +
    `font-family:-apple-system,Roboto,system-ui,sans-serif;font-size:16px;line-height:1.5;` +
    `word-break:break-word;overflow-wrap:break-word;}` +
    `img,video,table{max-width:100%!important;height:auto;}` +
    `*{max-width:100%;box-sizing:border-box;}` +
    `a{color:${colors.primary};}` +
    `blockquote{border-left:3px solid ${colors.border};margin:0;padding-left:12px;color:${colors.textMuted};}` +
    `</style></head><body>${html}</body></html>`
  );
}

// Reports the content height back so the WebView can size to its content inside
// the outer ScrollView. Runs via native injection (exempt from the page CSP);
// re-measures a couple of times to catch late layout (e.g. images after "Load").
const HEIGHT_JS = `(function(){function r(){try{window.ReactNativeWebView.postMessage(String(document.documentElement.scrollHeight));}catch(e){}}r();setTimeout(r,250);setTimeout(r,1200);})();true;`;

export function MessageBody({ html, text }: { html: string | null; text: string }) {
  const [allowImages, setAllowImages] = useState(false);
  const [height, setHeight] = useState(120);

  if (!html) {
    return (
      <Text style={styles.text} selectable>
        {text || "(no text content)"}
      </Text>
    );
  }

  const hasRemote = REMOTE_ATTR.test(html) || REMOTE_CSS.test(html);

  return (
    <View>
      {hasRemote && !allowImages && (
        <TouchableOpacity style={styles.banner} onPress={() => setAllowImages(true)} activeOpacity={0.7}>
          <Ionicons name="image-outline" size={16} color={colors.primary} />
          <Text style={styles.bannerText}>Remote images blocked — tap to load</Text>
        </TouchableOpacity>
      )}
      <WebView
        originWhitelist={["*"]}
        source={{ html: buildDoc(html, allowImages) }}
        style={[styles.web, { height }]}
        scrollEnabled={false}
        javaScriptEnabled
        injectedJavaScript={HEIGHT_JS}
        onMessage={(e) => {
          const h = Number(e.nativeEvent.data);
          if (h > 0) setHeight(Math.ceil(h));
        }}
        setSupportMultipleWindows={false}
        // Block every remote navigation (link taps) and open it in the OS browser;
        // allow only the synthetic about:blank/data document itself.
        onShouldStartLoadWithRequest={(req) => {
          if (/^https?:\/\//i.test(req.url)) {
            void Linking.openURL(req.url);
            return false;
          }
          return true;
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  text: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 24, color: colors.text },
  web: { backgroundColor: "transparent", width: "100%" },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.surfaceHigh,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 10,
  },
  bannerText: { fontFamily: fonts.medium, fontSize: 13, color: colors.primary },
});
