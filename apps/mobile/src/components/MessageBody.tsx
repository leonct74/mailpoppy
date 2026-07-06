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

// The email renders on a light "sheet" (HTML mail is authored for a light page).
// Not pure white — a gently cooled off-white that's far less jarring against the deep
// navy app shell (#051424) while still reading as a clean light background for the mail.
const SHEET_BG = "#eef1f5";

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
    // HTML email is authored for a WHITE page, so render it on its own light "sheet"
    // instead of forcing the app's dark theme onto it (which made forwarded mail look
    // broken / half-unstyled). This is how Gmail and Apple Mail show a message too.
    `:root{color-scheme:light;}` +
    `html,body{margin:0;padding:0;background:${SHEET_BG};}` +
    `body{padding:10px 12px;color:#111111;` +
    `font-family:-apple-system,Roboto,system-ui,sans-serif;font-size:16px;line-height:1.5;` +
    `overflow-wrap:break-word;-webkit-text-size-adjust:100%;}` +
    // Stop a lone oversized image from forcing horizontal overflow, but do NOT force
    // max-width on tables or every element — that overrides the email's intended
    // layout and strips its formatting. Wide layouts are shrunk to fit by the injected
    // JS below (the same "fit to width" Gmail does), which preserves the design.
    `img{max-width:100%;height:auto;}` +
    `a{color:#1a73e8;}` +
    `</style></head><body>${html}</body></html>`
  );
}

// Shrink-to-fit + height reporter, injected natively (exempt from the page CSP).
// First: if the email's natural content is wider than the screen (fixed-width
// newsletter tables, etc.), rewrite the viewport so WebKit scales the WHOLE page
// down to fit — the same "fit to width" Gmail/Apple Mail do, which preserves the
// design instead of forcing elements to wrap. Then report the (scaled) content
// height so the WebView sizes to it inside the outer ScrollView. Re-measures a few
// times to catch late layout (e.g. images after "Load images").
const FIT_HEIGHT_JS = `(function(){
  var DEVICE_W = window.innerWidth;
  var mv = document.querySelector('meta[name="viewport"]');
  var fitted = false;
  function run(){
    try{
      var de = document.documentElement, body = document.body;
      if(!fitted && mv && body){
        var contentW = Math.max(body.scrollWidth, de.scrollWidth, body.offsetWidth || 0);
        if(contentW > DEVICE_W + 2){
          fitted = true;
          var scale = DEVICE_W / contentW;
          mv.setAttribute('content','width='+contentW+', initial-scale='+scale+', maximum-scale='+scale+', user-scalable=no');
          setTimeout(run, 80); // re-measure once the page reflows at the new width
          return;
        }
      }
      var layoutW = window.innerWidth || DEVICE_W;
      var h = Math.ceil(de.scrollHeight * (DEVICE_W / layoutW));
      window.ReactNativeWebView.postMessage(String(h));
    }catch(e){}
  }
  run(); setTimeout(run,300); setTimeout(run,1200);
})();true;`;

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
      <View style={styles.webCard}>
      <WebView
        originWhitelist={["*"]}
        source={{ html: buildDoc(html, allowImages) }}
        style={[styles.web, { height }]}
        scrollEnabled={false}
        javaScriptEnabled
        injectedJavaScript={FIT_HEIGHT_JS}
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
    </View>
  );
}

const styles = StyleSheet.create({
  text: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 24, color: colors.text },
  // The email renders on its own light sheet (a rounded card) — faithful to how the
  // message was designed, but a softened off-white with a hairline rim so it reads as a
  // deliberate card against the navy shell instead of a harsh white slab.
  webCard: {
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: SHEET_BG,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.10)",
  },
  web: { backgroundColor: SHEET_BG, width: "100%" },
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
