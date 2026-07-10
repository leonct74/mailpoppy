import { useEffect, useRef, useState } from "react";
import {

  Alert,
  BackHandler,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { PoppySpinner } from "../components/PoppySpinner";
import Pdf from "react-native-pdf";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import type { RootStackParamList } from "../navigation";
import { mail } from "../mailClient";
import { useAuth } from "../AuthContext";
import { refreshConfigForEmail } from "../config";
import { parseEml, type ParsedEmail } from "../eml";
import {
  saveOrShareAttachment,
  saveOrShareEncryptedAttachment,
  fetchAttachmentToCache,
  fetchEncryptedAttachmentToCache,
  shareLocalFile,
  openInAndroidViewer,
  looksLikePdf,
  looksLikeImage,
  bustCachedFile,
  explainUnreadableFile,
} from "../attachments";
import { decryptEml, MailboxLockedError } from "../mailboxKeys";
import { loadCachedMessage, saveCachedMessage, removeCachedMessage } from "../messageCache";
import { MessageBody } from "../components/MessageBody";
import { ZoomableImage } from "../components/ZoomableImage";
import { folderLabel } from "../folders";
import { colors, fonts } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "Message">;
type IconName = React.ComponentProps<typeof Ionicons>["name"];

export function MessageScreen({ route, navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { messageId, folder, encrypted, encWrappedKey } = route.params;
  // The RESOLVED encryption meta. Navigation params carry it from the inbox, but a
  // NOTIFICATION tap can't (push payloads don't include it) — the load effect below
  // resolves it from the message cache or a list lookup. Attachments MUST use this
  // resolved value: treating an encrypted attachment as plain downloads ciphertext
  // as if it were the file — the black-preview poison that started this whole saga.
  const [encMeta, setEncMeta] = useState<{ encrypted?: boolean; encWrappedKey?: string }>({
    encrypted,
    encWrappedKey,
  });
  const { activeEmail, signIn } = useAuth();
  const [email, setEmail] = useState<ParsedEmail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState<number | null>(null);
  const [moving, setMoving] = useState(false);
  // The mailbox's encryption key isn't on this device (e.g. first read after an
  // app update) → offer an in-place unlock instead of a dead-end error.
  const [locked, setLocked] = useState(false);
  const [pw, setPw] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0); // bump to refetch after an unlock
  const healedRef = useRef(false); // self-heal a stale backend config at most once per open
  // An attachment being viewed full-screen (already downloaded/decrypted to cache).
  // kind "image" → ZoomableImage; "pdf" → react-native-pdf (native PDFKit view).
  const [preview, setPreview] = useState<{
    uri: string;
    name: string;
    type?: string;
    kind: "image" | "pdf";
    /** The attachment index — lets "Try again" re-download this exact attachment. */
    index: number;
  } | null>(null);
  // Preview failures are shown INLINE (with "Try again" + "open elsewhere" buttons)
  // rather than silently dismissing — a blank auto-close hides the real cause.
  // `message` is written for the USER (what happened + what to do); `detail` is the
  // one-line technical fact (file size/head or the native error), rendered small so a
  // screenshot still carries everything support needs. `pdfBox` is the measured size
  // of the viewer's container: react-native-pdf must mount at a real, non-zero size
  // or PDFKit renders nothing, so we wait for onLayout to mount it.
  const [previewError, setPreviewError] = useState<{ message: string; detail?: string } | null>(null);
  const [pdfBox, setPdfBox] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    let alive = true;
    void mail.setFlags(messageId, { unread: false }).catch(() => {});
    void (async () => {
      // Fetch the raw EML and — crucially — its encryption meta, then decrypt+parse.
      // `fromCache` lets us self-heal: if a CACHED copy fails to open (e.g. a pre-fix
      // build cached a sealed body with blank meta and poisoned it), we drop that
      // entry and retry once from the network instead of failing forever.
      const load = async (allowCache: boolean): Promise<{ enc: { encrypted?: boolean; encWrappedKey?: string }; parsed: ParsedEmail; fromCache: boolean }> => {
        let enc: { encrypted?: boolean; encWrappedKey?: string } = { encrypted, encWrappedKey };
        const cached = allowCache ? await loadCachedMessage(messageId) : null;
        if (cached) {
          const plain = await decryptEml({ encrypted: cached.encrypted, encWrappedKey: cached.encWrappedKey }, cached.eml);
          return { enc: { encrypted: cached.encrypted, encWrappedKey: cached.encWrappedKey }, parsed: await parseEml(plain), fromCache: true };
        }
        // The raw endpoint now returns the encryption meta WITH the bytes, so a
        // notification tap (which can't carry the wrapped key) no longer needs a
        // metadata lookup. From the inbox the route params are authoritative; if
        // neither is available (an old backend + notification tap) we fall back to a
        // best-effort list scan, but we NEVER persist a copy whose meta we couldn't
        // resolve — that mislabels ciphertext as plaintext and poisons re-opens.
        const raw = await mail.getRaw(messageId);
        let metaKnown = false;
        if (encrypted !== undefined) {
          enc = { encrypted, encWrappedKey };
          metaKnown = true;
        } else if (typeof raw.encrypted === "boolean") {
          enc = { encrypted: raw.encrypted || undefined, encWrappedKey: raw.encWrappedKey };
          metaKnown = true;
        } else {
          try {
            const { items } = await mail.list({ folder, limit: 100 });
            const m = items.find((x) => x.messageId === messageId);
            if (m) {
              enc = { encrypted: m.encrypted, encWrappedKey: m.encWrappedKey };
              metaKnown = true;
            }
          } catch {
            /* leave unknown; handled below */
          }
        }
        const plain = await decryptEml(enc, raw.eml);
        const parsed = await parseEml(plain);
        // Only cache once we're confident about the meta AND the parse succeeded, so
        // a cache entry can never be a sealed body labelled as clear.
        if (metaKnown) void saveCachedMessage(messageId, { eml: raw.eml, encrypted: enc.encrypted, encWrappedKey: enc.encWrappedKey });
        return { enc, parsed, fromCache: false };
      };

      try {
        let result;
        try {
          result = await load(true);
        } catch (e) {
          // A cached copy that won't open is likely poisoned — evict it and retry fresh.
          if (e instanceof MailboxLockedError) throw e;
          await removeCachedMessage(messageId);
          result = await load(false);
        }
        if (alive) {
          setEncMeta(result.enc); // attachments must decrypt with the same resolved meta as the body
          setEmail(result.parsed);
          setLocked(false);
        }
      } catch (e) {
        if (!alive) return;
        if (e instanceof MailboxLockedError) {
          setLocked(true);
          return;
        }
        // A rebuilt backend (teardown+redeploy → new Cognito pool/API) leaves this
        // mailbox's stored config pointing at dead coordinates, so the fetch fails
        // cryptically. Self-heal the config ONCE and refetch before surfacing an error —
        // a redeploy must not silently strand the reader. If it still fails (e.g. the
        // domain is no longer active in MailPoppy), show a plain-language, actionable
        // message rather than a raw HTTP/Cognito error.
        if (activeEmail && !healedRef.current) {
          healedRef.current = true;
          const healed = await refreshConfigForEmail(activeEmail).catch(() => ({ changed: false }));
          if (!alive) return;
          if (healed.changed) {
            setAttempt((n) => n + 1); // refetch against the refreshed backend
            return;
          }
        }
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [messageId, encrypted, encWrappedKey, folder, attempt]);

  // The full-screen preview is an in-tree overlay (not a Modal), so wire the
  // Android hardware back button to close it instead of leaving the screen —
  // this is the behaviour the Modal's onRequestClose used to give for free.
  useEffect(() => {
    if (!preview || Platform.OS !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      setPreview(null);
      return true;
    });
    return () => sub.remove();
  }, [preview]);

  // Re-signing in validates the password with the server FIRST (never guessing at
  // the key wrap), then re-establishes and keychain-persists this mailbox's key.
  async function unlock() {
    if (!activeEmail || !pw) return;
    setUnlocking(true);
    setUnlockError(null);
    try {
      const res = await signIn(activeEmail, pw);
      if (res !== "signed-in") {
        setUnlockError("This mailbox needs its first password set — sign in to it from the login screen.");
        return;
      }
      setPw("");
      setAttempt((n) => n + 1); // refetch; the key is in place now
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setUnlockError(
        /NotAuthorized|Incorrect username or password/i.test(msg)
          ? "That password isn't right. Please try again."
          : msg,
      );
    } finally {
      setUnlocking(false);
    }
  }

  function reply() {
    if (!email) return;
    const to = bareAddress(email.from);
    const subject = /^re:/i.test(email.subject) ? email.subject : `Re: ${email.subject}`;
    const references = [email.references, email.messageId].filter(Boolean).join(" ") || undefined;
    navigation.navigate("Compose", {
      to,
      subject,
      inReplyTo: email.messageId ?? undefined,
      references,
    });
  }

  function forward() {
    if (!email) return;
    const subject = /^fwd?:/i.test(email.subject) ? email.subject : `Fwd: ${email.subject}`;
    const body =
      `\n\n---------- Forwarded message ----------\n` +
      `From: ${email.from}\n` +
      (email.date ? `Date: ${new Date(email.date).toLocaleString()}\n` : "") +
      `Subject: ${email.subject}\n` +
      (email.to ? `To: ${email.to}\n` : "") +
      `\n${email.text}`;
    navigation.navigate("Compose", { subject, body });
  }

  async function openAttachment(index: number) {
    setOpening(index);
    try {
      const { url, filename, contentType } = await mail.getAttachmentUrl(messageId, index);
      const local = email?.attachments[index];
      // Detect the kind from BOTH the access-API metadata AND the raw-email parse. The access API
      // returns the STORED metadata, which can be a generic octet-stream with an extension-less name
      // (so a real PDF/image looks like a plain download); the eml parse usually carries the true
      // Content-Type + filename. Checking both stops a PDF from falling through to the share sheet.
      const img = isImage(contentType, filename) || isImage(local?.mimeType, local?.filename);
      const pdf = !img && (isPdf(contentType, filename) || isPdf(local?.mimeType, local?.filename));
      // Give the viewer/share sheet a correct type, and name the cached file with a
      // matching extension so the system viewer and share sheet identify it as a PDF.
      const type = pdf ? "application/pdf" : (contentType ?? local?.mimeType);
      let name = filename ?? local?.filename ?? `attachment-${index}`;
      if (pdf && !/\.pdf$/i.test(name)) name = `${name}.pdf`;
      if (img || pdf) {
        // Images and PDFs get previewed in-app (encrypted ones are decrypted to the
        // cache first); saving/sharing is a button inside the preview. On Android, PDFs
        // open straight in the system PDF viewer instead of the in-app PDFKit view.
        // Use the RESOLVED encryption meta (not the raw navigation params): a
        // notification tap arrives without it, and downloading an encrypted
        // attachment down the "plain" path caches ciphertext as the file — the
        // permanently-poisoned black preview. If meta is somehow still unknown,
        // refuse with a clear message instead of guessing.
        if (encMeta.encrypted === undefined) {
          throw new Error(
            "This message's details are still loading. Wait for the email to finish opening, then try the attachment again.",
          );
        }
        const cacheKey = `${messageId}-${index}`;
        const fetchToCache = () =>
          encMeta.encrypted && encMeta.encWrappedKey
            ? fetchEncryptedAttachmentToCache(
                url,
                { encrypted: encMeta.encrypted, encWrappedKey: encMeta.encWrappedKey },
                name,
                cacheKey,
              )
            : fetchAttachmentToCache(url, name, cacheKey);
        let uri = await fetchToCache();
        if (pdf && Platform.OS === "android") {
          await openInAndroidViewer(uri, name, type);
        } else {
          // The cached file must actually LOOK like what we're about to show —
          // "%PDF-" for PDFs, a real image magic for images. If it doesn't, it may be
          // a corrupt file written by an EARLIER build — the cache is keyed by
          // message+index and survives app updates, so a bad file (e.g. from the
          // re-key/teardown churn) would be served forever. (Images used to skip this
          // check, so a stale corrupt file rendered as a silent black screen while
          // PDFs self-healed.) Bust it and refetch once.
          const looksRight = () => (pdf ? looksLikePdf(uri) : looksLikeImage(uri));
          let bad = !(await looksRight());
          if (bad) {
            await bustCachedFile(uri);
            uri = await fetchToCache();
            bad = !(await looksRight());
          }
          // If it's STILL wrong, explain it in the user's language (what happened +
          // what to do) with the technical file-head fact kept as a small detail line.
          setPreviewError(bad ? await explainUnreadableFile(uri, pdf ? "PDF" : "image") : null);
          setPreview({ uri, name, type, kind: img ? "image" : "pdf", index });
        }
      } else if (encMeta.encrypted && encMeta.encWrappedKey) {
        // Ciphertext on S3 — fetch, decrypt on-device, then share the plaintext.
        await saveOrShareEncryptedAttachment(
          url,
          { encrypted: encMeta.encrypted, encWrappedKey: encMeta.encWrappedKey },
          name,
          type,
        );
      } else if (encMeta.encrypted === undefined) {
        throw new Error(
          "This message's details are still loading. Wait for the email to finish opening, then try the attachment again.",
        );
      } else {
        await saveOrShareAttachment(url, name, type);
      }
    } catch (e) {
      Alert.alert("Couldn't open attachment", e instanceof Error ? e.message : String(e));
    } finally {
      setOpening(null);
    }
  }

  async function sharePreview() {
    if (!preview) return;
    try {
      await shareLocalFile(preview.uri, preview.name, preview.type);
    } catch (e) {
      Alert.alert("Couldn't share image", e instanceof Error ? e.message : String(e));
    }
  }

  /** "Try again" on a failed preview: throw away the cached copy and re-download
   *  this exact attachment from scratch. Most preview failures (expired download
   *  link, interrupted download, stale corrupt cache) are fixed by exactly this. */
  async function retryPreview() {
    if (!preview) return;
    const { uri, index } = preview;
    setPreview(null);
    setPreviewError(null);
    await bustCachedFile(uri);
    await openAttachment(index);
  }

  async function moveTo(target: "trash" | "inbox" | "junk") {
    setMoving(true);
    try {
      await mail.move(messageId, target);
      navigation.goBack();
    } catch (e) {
      setMoving(false);
      Alert.alert("Couldn't move message", e instanceof Error ? e.message : String(e));
    }
  }

  const inTrash = folder === "trash";

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn} hitSlop={8} accessibilityLabel="Back">
          <Ionicons name="arrow-back" size={24} color={colors.textMuted} />
        </TouchableOpacity>
        <View style={styles.headerActions}>
          {/* Report spam / move to Junk — a visible way to flag unwanted incoming mail
              (App Store Guideline 1.2, user-generated content). Reversible: junk mail
              lands in the Junk folder, and reading it there offers "Not spam". */}
          {folder === "inbox" && (
            <TouchableOpacity
              onPress={() => moveTo("junk")}
              style={styles.iconBtn}
              hitSlop={8}
              disabled={moving}
              accessibilityLabel="Report spam"
            >
              <Ionicons name="alert-circle-outline" size={22} color={colors.textMuted} />
            </TouchableOpacity>
          )}
          {folder === "junk" && (
            <TouchableOpacity
              onPress={() => moveTo("inbox")}
              style={styles.iconBtn}
              hitSlop={8}
              disabled={moving}
              accessibilityLabel="Not spam — move to Inbox"
            >
              <Ionicons name="checkmark-circle-outline" size={22} color={colors.textMuted} />
            </TouchableOpacity>
          )}
          <TouchableOpacity
            onPress={() => moveTo(inTrash ? "inbox" : "trash")}
            style={styles.iconBtn}
            hitSlop={8}
            disabled={moving}
            accessibilityLabel={inTrash ? "Restore" : "Delete"}
          >
            {moving ? (
              <PoppySpinner color={colors.textMuted} />
            ) : (
              <Ionicons name={inTrash ? "mail-outline" : "trash-outline"} size={22} color={colors.textMuted} />
            )}
          </TouchableOpacity>
        </View>
      </View>

      {locked && !email ? (
        <View style={styles.centered}>
          <View style={styles.lockBadge}>
            <Ionicons name="lock-closed" size={26} color={colors.primary} />
          </View>
          <Text style={styles.errorTitle}>This message is encrypted</Text>
          <Text style={styles.errorText}>
            Enter the password for {activeEmail ?? "this mailbox"} to unlock it on this device. You'll
            only need to do this once.
          </Text>
          <View style={styles.unlockWrap}>
            <TextInput
              style={styles.unlockInput}
              placeholder="Password"
              placeholderTextColor={colors.textMuted}
              secureTextEntry={!showPw}
              autoCapitalize="none"
              autoCorrect={false}
              value={pw}
              onChangeText={setPw}
              editable={!unlocking}
              onSubmitEditing={() => void unlock()}
            />
            <TouchableOpacity
              onPress={() => setShowPw((s) => !s)}
              hitSlop={8}
              style={styles.unlockEye}
              accessibilityRole="button"
              accessibilityLabel={showPw ? "Hide password" : "Show password"}
            >
              <Ionicons name={showPw ? "eye-off-outline" : "eye-outline"} size={20} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
          {unlockError && <Text style={styles.unlockError}>{unlockError}</Text>}
          <TouchableOpacity
            style={[styles.unlockBtn, (!pw || unlocking) && styles.unlockBtnDisabled]}
            onPress={() => void unlock()}
            disabled={!pw || unlocking}
            activeOpacity={0.85}
          >
            {unlocking ? (
              <PoppySpinner color={colors.primaryText} />
            ) : (
              <Text style={styles.unlockBtnText}>Unlock mailbox</Text>
            )}
          </TouchableOpacity>
        </View>
      ) : error ? (
        <View style={styles.centered}>
          <Text style={styles.errorTitle}>Couldn't open this message</Text>
          <Text style={styles.errorText}>
            This mailbox may be temporarily unreachable, or its email domain isn&apos;t active in
            MailPoppy right now. If this keeps happening, ask whoever manages your email.
          </Text>
          <Text style={[styles.errorText, { fontSize: 12, opacity: 0.7 }]}>{error}</Text>
          <TouchableOpacity
            style={[styles.unlockBtn, { marginTop: 20 }]}
            onPress={() => {
              healedRef.current = false; // allow another self-heal attempt
              setError(null);
              setAttempt((n) => n + 1);
            }}
            activeOpacity={0.85}
          >
            <Text style={styles.unlockBtnText}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : !email ? (
        // Progressive render: show the header (subject + sender, already known from the
        // list) INSTANTLY, with a spinner where the body will land — so opening feels
        // immediate even while the message is fetched/decrypted/parsed, instead of a
        // blank spinner. The layout matches the loaded view so there's no visual jump.
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
          <Text style={styles.subject}>{route.params.subject || "(no subject)"}</Text>
          <View style={styles.badgeRow}>
            <View style={styles.chip}>
              <Text style={styles.chipText}>{folderLabel(folder).toUpperCase()}</Text>
            </View>
            {encrypted && (
              <View style={styles.encBadge}>
                <Ionicons name="lock-closed" size={12} color={colors.primary} />
                <Text style={styles.encBadgeText}>ENCRYPTED</Text>
              </View>
            )}
          </View>
          <View style={styles.senderCard}>
            <Avatar label={route.params.from || "?"} />
            <View style={styles.senderInfo}>
              <Text style={styles.senderName} numberOfLines={1}>
                {displayName(route.params.from || "")}
              </Text>
              <Text style={styles.senderMeta}>Loading message…</Text>
            </View>
          </View>
          <View style={styles.bodyLoading}>
            <PoppySpinner color={colors.primary} />
          </View>
        </ScrollView>
      ) : (
        <>
          <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
            <Text style={styles.subject}>{email.subject || "(no subject)"}</Text>
            <View style={styles.badgeRow}>
              <View style={styles.chip}>
                <Text style={styles.chipText}>{folderLabel(folder).toUpperCase()}</Text>
              </View>
              {encrypted && (
                <View style={styles.encBadge}>
                  <Ionicons name="lock-closed" size={12} color={colors.primary} />
                  <Text style={styles.encBadgeText}>ENCRYPTED</Text>
                </View>
              )}
            </View>

            {/* Sender card */}
            <View style={styles.senderCard}>
              <Avatar label={email.from} />
              <View style={styles.senderInfo}>
                <Text style={styles.senderName} numberOfLines={1}>
                  {displayName(email.from)}
                </Text>
                <Text style={styles.senderMeta} numberOfLines={1}>
                  {bareAddress(email.from)}
                  {email.date ? ` • ${new Date(email.date).toLocaleString()}` : ""}
                </Text>
                {email.to ? (
                  <Text style={styles.senderMeta} numberOfLines={1}>
                    To: {email.to}
                  </Text>
                ) : null}
              </View>
            </View>

            <MessageBody html={email.html} text={email.text} />

            {email.attachments.length > 0 && (
              <View style={styles.attachments}>
                <Text style={styles.attachLabel}>
                  {email.attachments.length} attachment{email.attachments.length === 1 ? "" : "s"}
                </Text>
                {email.attachments.map((a, i) => {
                  const img = isImage(a.mimeType, a.filename);
                  const pdf = isPdf(a.mimeType, a.filename);
                  const viewable = img || pdf;
                  return (
                    <TouchableOpacity key={i} style={styles.attachChip} onPress={() => openAttachment(i)} activeOpacity={0.7}>
                      <Ionicons
                        name={img ? "image-outline" : pdf ? "document-text-outline" : "document-attach-outline"}
                        size={20}
                        color={colors.primary}
                      />
                      <Text style={styles.attachName} numberOfLines={1}>
                        {a.filename}
                      </Text>
                      {opening === i ? (
                        <PoppySpinner size="small" color={colors.primary} />
                      ) : (
                        <Ionicons name={viewable ? "eye-outline" : "download-outline"} size={18} color={colors.textMuted} />
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </ScrollView>

          {/* Bottom action bar */}
          <View style={[styles.actionBar, { paddingBottom: insets.bottom + 10 }]}>
            <ActionButton icon="arrow-undo" label="Reply" onPress={reply} primary />
            <ActionButton icon="arrow-redo" label="Forward" onPress={forward} />
          </View>
        </>
      )}

      {/* Full-screen attachment preview: images zoom in-app; PDFs render in a native
          PDFKit view (Android PDFs never reach here — they open in the system viewer).
          Share/save lives in the top bar.

          This is an absolute-fill overlay in the normal view tree, NOT a <Modal>.
          A PDF previously "opened black then closed": react-native-pdf's Fabric
          native view (RNPDFPdfView) fired onError on mount and our handler dismissed
          it. Three defences here, since the exact trigger couldn't be confirmed off a
          device: (1) render outside <Modal>, which on iOS hosts children in a separate
          window where a Fabric child can get a zero first layout; (2) mount the <Pdf>
          only after onLayout reports a real size, with EXPLICIT width/height (never a
          zero-frame flex); (3) on any error, show the real message inline instead of
          auto-dismissing, so a residual failure is diagnosable, not silent. Images
          (pure-JS) were never affected. */}
      {preview && (
        <View style={styles.previewOverlay} pointerEvents="auto">
          <View style={[styles.previewBar, { paddingTop: insets.top + 6 }]}>
            <TouchableOpacity onPress={() => setPreview(null)} style={styles.iconBtn} hitSlop={8} accessibilityLabel="Close preview">
              <Ionicons name="close" size={26} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.previewName} numberOfLines={1}>
              {preview.name}
            </Text>
            <TouchableOpacity onPress={() => void sharePreview()} style={styles.iconBtn} hitSlop={8} accessibilityLabel="Share or save attachment">
              <Ionicons name="share-outline" size={24} color="#fff" />
            </TouchableOpacity>
          </View>
          {previewError ? (
            // Show the failure in the USER's language instead of vanishing (or, for
            // images, a silent black screen): what happened, what to do, a Try-again
            // that actually re-downloads, and the technical fact in small print so a
            // screenshot still tells support/debugging everything.
            <View style={styles.previewPdf}>
              <View style={styles.previewErrorBox}>
                <Ionicons
                  name={preview.kind === "image" ? "image-outline" : "document-outline"}
                  size={40}
                  color="rgba(255,255,255,0.5)"
                />
                <Text style={styles.previewErrorTitle}>
                  Can't show this {preview.kind === "image" ? "picture" : "PDF"}
                </Text>
                <Text style={styles.previewErrorMsg}>{previewError.message}</Text>
                <TouchableOpacity style={styles.previewErrorBtn} onPress={() => void retryPreview()} activeOpacity={0.85}>
                  <Ionicons name="refresh-outline" size={18} color="#fff" />
                  <Text style={styles.previewErrorBtnText}>Try again</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.previewErrorBtn} onPress={() => void sharePreview()} activeOpacity={0.85}>
                  <Ionicons name="share-outline" size={18} color="#fff" />
                  <Text style={styles.previewErrorBtnText}>Open in another app</Text>
                </TouchableOpacity>
                {previewError.detail ? <Text style={styles.previewErrorDetail}>{previewError.detail}</Text> : null}
              </View>
            </View>
          ) : preview.kind === "image" ? (
            <ZoomableImage
              uri={preview.uri}
              onError={(msg) =>
                setPreviewError({
                  message:
                    "This picture couldn't be shown — it may use a format this phone doesn't support, or the download was damaged. Tap “Try again”, or open it in another app.",
                  detail: `Technical detail: ${msg}`,
                })
              }
            />
          ) : (
            <View
              style={styles.previewPdf}
              onLayout={(e) => {
                const { width, height } = e.nativeEvent.layout;
                // Mount the PDF only once the container has a real size — a zero-size
                // first layout makes PDFKit render nothing (blank/black). Measure once.
                if (width > 0 && height > 0 && !pdfBox) setPdfBox({ w: width, h: height });
              }}
            >
              {pdfBox ? (
                <Pdf
                  // Explicit measured size (never flex/zero) + a fresh instance per file.
                  key={preview.uri}
                  style={{ width: pdfBox.w, height: pdfBox.h, backgroundColor: "transparent" }}
                  // The file is already local (decrypted to cache for sealed mail) and
                  // was sanity-checked as a real PDF, so PDFKit renders it directly.
                  source={{ uri: preview.uri }}
                  fitPolicy={0}
                  spacing={8}
                  trustAllCerts={false}
                  renderActivityIndicator={() => <PoppySpinner color="#fff" />}
                  onLoadComplete={() => setPreviewError(null)}
                  onError={(err) => {
                    const m =
                      err && typeof err === "object" && "message" in err
                        ? String((err as { message?: unknown }).message ?? "")
                        : String(err ?? "");
                    setPreviewError({
                      message:
                        "This PDF couldn't be opened — it may be damaged, password-protected, or the download was interrupted. Tap “Try again”, or open it in another app.",
                      detail: m ? `Technical detail: ${m}` : undefined,
                    });
                  }}
                />
              ) : (
                <View style={styles.previewErrorBox}>
                  <PoppySpinner color="#fff" />
                </View>
              )}
            </View>
          )}
        </View>
      )}
    </View>
  );
}

/** Is this attachment an image we can preview in-app? Checks the content type
 *  first, then the filename extension (some senders label images octet-stream). */
function isImage(contentType?: string, filename?: string): boolean {
  if (contentType?.toLowerCase().startsWith("image/")) return true;
  return /\.(png|jpe?g|gif|webp|heic|heif|bmp)$/i.test(filename ?? "");
}

/** Is this attachment a PDF? (previewed in-app on iOS; system viewer on Android) */
function isPdf(contentType?: string, filename?: string): boolean {
  if (contentType?.toLowerCase().includes("application/pdf")) return true;
  return /\.pdf$/i.test(filename ?? "");
}

function ActionButton({
  icon,
  label,
  onPress,
  primary,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  primary?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[styles.action, primary ? styles.actionPrimary : styles.actionSecondary]}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <Ionicons name={icon} size={18} color={primary ? colors.primaryText : colors.text} />
      <Text style={[styles.actionText, { color: primary ? colors.primaryText : colors.text }]}>{label}</Text>
    </TouchableOpacity>
  );
}

/** Pull the bare address out of a "Name <addr@x>" or "addr@x" string. */
function bareAddress(addr: string): string {
  const m = addr.match(/<([^>]+)>/);
  return (m ? m[1] : addr).trim();
}
/** The display name part, or the bare address if there's no name. */
function displayName(addr: string): string {
  const m = addr.match(/^\s*"?([^"<]+?)"?\s*</);
  return (m ? m[1] : bareAddress(addr)).trim() || addr;
}

function Avatar({ label }: { label: string }) {
  const initial = (displayName(label).trim()[0] || "?").toUpperCase();
  return (
    <View style={styles.avatar}>
      <Text style={styles.avatarText}>{initial}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 10,
    paddingBottom: 6,
  },
  headerActions: { flexDirection: "row", alignItems: "center" },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: 20 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 24 },
  subject: { fontFamily: fonts.bold, fontSize: 24, lineHeight: 30, color: colors.text, marginBottom: 10 },
  badgeRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 16 },
  chip: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(255,86,55,0.12)",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  chipText: { fontFamily: fonts.semibold, fontSize: 11, color: colors.primary, letterSpacing: 0.6 },
  encBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(255,86,55,0.12)",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  encBadgeText: { fontFamily: fonts.semibold, fontSize: 11, color: colors.primary, letterSpacing: 0.6 },
  senderCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 14,
    marginBottom: 18,
  },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surfaceVariant, alignItems: "center", justifyContent: "center" },
  avatarText: { color: colors.heading, fontFamily: fonts.bold, fontSize: 17 },
  senderInfo: { flex: 1, minWidth: 0 },
  senderName: { fontFamily: fonts.semibold, fontSize: 16, color: colors.text },
  senderMeta: { fontFamily: fonts.regular, fontSize: 12, color: colors.textMuted, marginTop: 1 },
  body: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 24, color: colors.text },
  bodyLoading: { paddingTop: 48, alignItems: "center" },
  attachments: { marginTop: 22, gap: 8 },
  attachLabel: { fontFamily: fonts.semibold, fontSize: 12, color: colors.textMuted, letterSpacing: 0.4, marginBottom: 2 },
  attachChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.surfaceHigh,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  attachName: { flex: 1, fontFamily: fonts.medium, fontSize: 14, color: colors.text },
  errorTitle: { fontFamily: fonts.bold, fontSize: 17, color: colors.text },
  errorText: { fontFamily: fonts.regular, fontSize: 14, color: colors.textMuted, marginTop: 8, textAlign: "center" },
  lockBadge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.surfaceContainer,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  unlockWrap: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "stretch",
    backgroundColor: colors.surfaceHigh,
    borderRadius: 12,
    paddingRight: 12,
    marginTop: 20,
  },
  unlockInput: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontFamily: fonts.regular,
    fontSize: 15,
    color: colors.text,
  },
  unlockEye: { paddingLeft: 8, alignSelf: "stretch", justifyContent: "center" },
  unlockError: { fontFamily: fonts.regular, fontSize: 13, color: colors.danger, marginTop: 10, textAlign: "center" },
  unlockBtn: {
    alignSelf: "stretch",
    height: 50,
    borderRadius: 12,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 12,
  },
  unlockBtnDisabled: { opacity: 0.5 },
  unlockBtnText: { fontFamily: fonts.bold, fontSize: 15, color: colors.primaryText },
  // Absolute-fill so the in-tree overlay covers the entire screen (header included),
  // matching what the old full-window Modal did. Opaque black backdrop.
  previewOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.96)",
    zIndex: 10,
    elevation: 10,
  },
  previewBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 10,
    paddingBottom: 6,
    gap: 8,
  },
  previewName: { flex: 1, fontFamily: fonts.semibold, fontSize: 14, color: "#fff", textAlign: "center" },
  previewPdf: { flex: 1, backgroundColor: "transparent" },
  previewErrorBox: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28, gap: 12 },
  previewErrorTitle: { fontFamily: fonts.bold, fontSize: 16, color: "#fff", marginTop: 4 },
  previewErrorMsg: { fontFamily: fonts.regular, fontSize: 13, color: "rgba(255,255,255,0.6)", textAlign: "center", lineHeight: 19 },
  // The one-line technical fact under the buttons — small and dim: it's for a support
  // screenshot, not for the user to parse.
  previewErrorDetail: {
    fontFamily: fonts.regular,
    fontSize: 11,
    color: "rgba(255,255,255,0.35)",
    textAlign: "center",
    marginTop: 6,
  },
  previewErrorBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 10,
    height: 46,
    paddingHorizontal: 18,
    borderRadius: 12,
    backgroundColor: colors.primary,
  },
  previewErrorBtnText: { fontFamily: fonts.semibold, fontSize: 14, color: "#fff" },
  actionBar: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 10,
    backgroundColor: colors.surfaceContainer,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  action: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 48,
    borderRadius: 14,
  },
  actionPrimary: { backgroundColor: colors.primary },
  actionSecondary: { backgroundColor: colors.surfaceHigh },
  actionText: { fontFamily: fonts.semibold, fontSize: 15 },
});
