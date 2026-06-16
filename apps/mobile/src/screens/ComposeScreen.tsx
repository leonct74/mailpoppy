import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import { DEFAULT_MAX_ATTACHMENT_BYTES, formatBytes } from "@mailpoppy/core";
import type { RootStackParamList } from "../navigation";
import { mail } from "../mailClient";
import { parseEml } from "../eml";
import { useAuth } from "../AuthContext";
import { loadContacts, suggestContacts, type Contact } from "../contacts";
import {
  pickFileAttachment,
  pickPhotoAttachment,
  uploadAttachmentToS3,
  type PickedAttachment,
} from "../attachments";
import { colors, fonts } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "Compose">;

export function ComposeScreen({ route, navigation }: Props) {
  const params = route.params;
  const insets = useSafeAreaInsets();
  const { email: selfEmail } = useAuth();
  const [to, setTo] = useState(params?.to ?? "");
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [subject, setSubject] = useState(params?.subject ?? "");
  const [body, setBody] = useState(params?.body ?? "");
  const [draftId, setDraftId] = useState<string | undefined>(params?.draftId);
  const [attachments, setAttachments] = useState<PickedAttachment[]>([]);
  const [maxAttachBytes, setMaxAttachBytes] = useState(DEFAULT_MAX_ATTACHMENT_BYTES);
  const [picking, setPicking] = useState(false);
  const [sending, setSending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingDraft, setLoadingDraft] = useState(Boolean(params?.draftId));
  const [error, setError] = useState<string | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [toFocused, setToFocused] = useState(false);

  // Derived address book for the "To" autocomplete (recent senders + recipients).
  useEffect(() => {
    let alive = true;
    void loadContacts(selfEmail ?? undefined).then((c) => {
      if (alive) setContacts(c);
    });
    return () => {
      alive = false;
    };
  }, [selfEmail]);

  // The admin-configured max attachment size for this backend (falls back to the
  // default if the call fails — the server enforces the real cap regardless).
  useEffect(() => {
    let alive = true;
    void mail
      .getSendConfig()
      .then((c) => {
        if (alive && c.maxAttachmentBytes > 0) setMaxAttachBytes(c.maxAttachmentBytes);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // Opened from the Drafts folder → load the saved content into the editor.
  useEffect(() => {
    if (!params?.draftId) return;
    let alive = true;
    void (async () => {
      try {
        const { eml } = await mail.getRaw(params.draftId!);
        const parsed = await parseEml(eml);
        if (!alive) return;
        setTo(parsed.to);
        setSubject(parsed.subject === "(no subject)" ? "" : parsed.subject);
        setBody(parsed.text);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setLoadingDraft(false);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const parseList = (s: string) =>
    s
      .split(/[,;\s]+/)
      .map((r) => r.trim())
      .filter(Boolean);
  const recipients = parseList(to);
  const ccList = parseList(cc);
  const bccList = parseList(bcc);
  const busy = sending || saving || picking;
  const attachTotal = attachments.reduce((n, a) => n + a.sizeBytes, 0);
  const canSend = recipients.length + ccList.length + bccList.length > 0 && !busy;
  const canSave =
    !busy &&
    (recipients.length > 0 ||
      ccList.length > 0 ||
      bccList.length > 0 ||
      subject.trim().length > 0 ||
      body.trim().length > 0);

  const token = to.match(/[^,;\s]*$/)?.[0] ?? "";
  const chosen = new Set(recipients.map((r) => r.toLowerCase()));
  const suggestions = toFocused && !busy ? suggestContacts(contacts, token, chosen) : [];
  function chooseContact(address: string) {
    const prefix = to.slice(0, to.length - token.length);
    setTo(`${prefix}${address}, `);
  }

  async function addAttachment(source: "photo" | "file") {
    setPicking(true);
    setError(null);
    try {
      const picked = source === "photo" ? await pickPhotoAttachment() : await pickFileAttachment();
      if (!picked) return; // cancelled
      if (attachTotal + picked.sizeBytes > maxAttachBytes) {
        Alert.alert("Attachment too large", `Total attachments must stay under ${formatBytes(maxAttachBytes)}.`);
        return;
      }
      setAttachments((prev) => [...prev, picked]);
    } catch (e) {
      Alert.alert("Couldn't attach", e instanceof Error ? e.message : String(e));
    } finally {
      setPicking(false);
    }
  }

  function promptAttach() {
    Alert.alert("Attach", undefined, [
      { text: "Photo", onPress: () => void addAttachment("photo") },
      { text: "File", onPress: () => void addAttachment("file") },
      { text: "Cancel", style: "cancel" },
    ]);
  }

  function removeAttachment(i: number) {
    setAttachments((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function send() {
    if (!canSend) return;
    setSending(true);
    setError(null);
    try {
      // Upload each attachment straight to S3 (presigned PUT), then reference it
      // by key — large files never go through the API.
      let sendAttachments: { filename: string; contentType: string; s3Key: string }[] | undefined;
      if (attachments.length) {
        sendAttachments = [];
        for (const a of attachments) {
          const { uploadUrl, key } = await mail.presignAttachment({
            filename: a.filename,
            contentType: a.contentType,
            sizeBytes: a.sizeBytes,
          });
          await uploadAttachmentToS3(uploadUrl, a.uri, a.contentType);
          sendAttachments.push({ filename: a.filename, contentType: a.contentType, s3Key: key });
        }
      }
      await mail.send({
        to: recipients,
        ...(ccList.length ? { cc: ccList } : {}),
        ...(bccList.length ? { bcc: bccList } : {}),
        subject: subject.trim(),
        text: body,
        ...(sendAttachments ? { attachments: sendAttachments } : {}),
        inReplyTo: params?.inReplyTo,
        references: params?.references,
        draftId,
      });
      navigation.goBack();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSending(false);
    }
  }

  async function saveDraft() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const res = await mail.saveDraft({
        draftId,
        to: recipients,
        subject: subject.trim(),
        text: body,
        inReplyTo: params?.inReplyTo,
        references: params?.references,
      });
      setDraftId(res.draftId);
      navigation.goBack();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  }

  function discard() {
    if (!draftId) return;
    Alert.alert("Discard draft?", "This permanently deletes the draft.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Discard",
        style: "destructive",
        onPress: async () => {
          setSaving(true);
          try {
            await mail.deleteDraft(draftId);
            navigation.goBack();
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
            setSaving(false);
          }
        },
      },
    ]);
  }

  function cancel() {
    const hasContent = recipients.length > 0 || subject.trim().length > 0 || body.trim().length > 0;
    if (!hasContent) {
      navigation.goBack();
      return;
    }
    Alert.alert(draftId ? "Discard changes?" : "Discard this message?", undefined, [
      { text: "Keep editing", style: "cancel" },
      { text: "Save draft", onPress: () => void saveDraft() },
      { text: "Discard", style: "destructive", onPress: () => navigation.goBack() },
    ]);
  }

  if (loadingDraft) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <TouchableOpacity onPress={cancel} disabled={busy} style={styles.iconBtn} hitSlop={8} accessibilityLabel="Close">
          <Ionicons name="close" size={26} color={busy ? colors.textMuted : colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{params?.draftId ? "Edit Message" : "New Message"}</Text>
        <TouchableOpacity onPress={saveDraft} disabled={!canSave} style={styles.iconBtn} hitSlop={8} accessibilityLabel="Save draft">
          {saving ? (
            <ActivityIndicator color={colors.textMuted} />
          ) : (
            <Ionicons name="save-outline" size={22} color={canSave ? colors.text : colors.textMuted} />
          )}
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.flex} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* To */}
        <View style={styles.fieldRow}>
          <Text style={styles.fieldLabel}>To</Text>
          <TextInput
            style={styles.input}
            placeholder="Name or email address"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            value={to}
            onChangeText={setTo}
            onFocus={() => setToFocused(true)}
            onBlur={() => setToFocused(false)}
            editable={!busy}
          />
          {!showCcBcc && (
            <TouchableOpacity onPress={() => setShowCcBcc(true)} hitSlop={8} accessibilityLabel="Add Cc/Bcc">
              <Ionicons name="add-circle-outline" size={22} color={colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>
        {suggestions.length > 0 && (
          <View style={styles.suggestBox}>
            {suggestions.map((c) => (
              <TouchableOpacity key={c.address} style={styles.suggestRow} onPress={() => chooseContact(c.address)} activeOpacity={0.6}>
                <Text style={styles.suggestAddr} numberOfLines={1}>
                  {c.address}
                </Text>
                {c.name ? (
                  <Text style={styles.suggestName} numberOfLines={1}>
                    {c.name}
                  </Text>
                ) : null}
              </TouchableOpacity>
            ))}
          </View>
        )}

        {showCcBcc && (
          <>
            <View style={styles.fieldRow}>
              <Text style={styles.fieldLabel}>Cc</Text>
              <TextInput
                style={styles.input}
                placeholder="Carbon copy"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                value={cc}
                onChangeText={setCc}
                editable={!busy}
              />
            </View>
            <View style={styles.fieldRow}>
              <Text style={styles.fieldLabel}>Bcc</Text>
              <TextInput
                style={styles.input}
                placeholder="Blind carbon copy"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                value={bcc}
                onChangeText={setBcc}
                editable={!busy}
              />
            </View>
          </>
        )}

        {/* Subject */}
        <View style={styles.fieldRow}>
          <Text style={styles.fieldLabel}>Subject</Text>
          <TextInput
            style={styles.input}
            placeholder="What's this about?"
            placeholderTextColor={colors.textMuted}
            value={subject}
            onChangeText={setSubject}
            editable={!busy}
          />
        </View>

        {/* Body */}
        <TextInput
          style={styles.bodyInput}
          placeholder="Compose email"
          placeholderTextColor={colors.textMuted}
          multiline
          textAlignVertical="top"
          value={body}
          onChangeText={setBody}
          editable={!busy}
        />

        {attachments.length > 0 && (
          <View style={styles.attachList}>
            {attachments.map((a, i) => (
              <View key={`${a.filename}-${i}`} style={styles.attachChip}>
                <Ionicons
                  name={a.contentType.startsWith("image/") ? "image-outline" : "document-outline"}
                  size={18}
                  color={colors.primary}
                />
                <View style={styles.attachInfo}>
                  <Text style={styles.attachName} numberOfLines={1}>
                    {a.filename}
                  </Text>
                  <Text style={styles.attachSize}>{formatBytes(a.sizeBytes)}</Text>
                </View>
                <TouchableOpacity onPress={() => removeAttachment(i)} disabled={busy} hitSlop={8} accessibilityLabel="Remove attachment">
                  <Ionicons name="close-circle" size={20} color={colors.textMuted} />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        {error && <Text style={styles.error}>{error}</Text>}
        {draftId && (
          <TouchableOpacity onPress={discard} disabled={busy} style={styles.discardBtn} activeOpacity={0.7}>
            <Ionicons name="trash-outline" size={16} color={colors.danger} />
            <Text style={styles.discardText}>Discard draft</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      {/* Bottom action bar */}
      <View style={[styles.actionBar, { paddingBottom: insets.bottom + 10 }]}>
        <TouchableOpacity onPress={promptAttach} disabled={busy} style={styles.attachBtn} hitSlop={8} accessibilityLabel="Attach">
          {picking ? (
            <ActivityIndicator color={colors.textMuted} />
          ) : (
            <Ionicons name="attach" size={24} color={colors.textMuted} />
          )}
        </TouchableOpacity>
        <TouchableOpacity
          onPress={send}
          disabled={!canSend}
          style={[styles.sendBtn, !canSend && styles.sendBtnDisabled]}
          activeOpacity={0.85}
          accessibilityLabel="Send"
        >
          {sending ? (
            <ActivityIndicator color={colors.primaryText} />
          ) : (
            <>
              <Text style={[styles.sendText, !canSend && styles.sendTextDisabled]}>Send</Text>
              <Ionicons name="send" size={16} color={canSend ? colors.primaryText : colors.textMuted} />
            </>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 10,
    paddingBottom: 8,
  },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontFamily: fonts.bold, fontSize: 18, color: colors.primary },
  content: { paddingHorizontal: 16, paddingBottom: 24 },
  fieldRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  fieldLabel: { fontFamily: fonts.semibold, fontSize: 15, color: colors.text, width: 60 },
  input: { flex: 1, fontFamily: fonts.regular, fontSize: 15, color: colors.text, padding: 0 },
  bodyInput: {
    fontFamily: fonts.regular,
    fontSize: 16,
    lineHeight: 24,
    color: colors.text,
    minHeight: 220,
    paddingTop: 16,
  },
  attachList: { marginTop: 12, gap: 8 },
  attachChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: colors.surface,
  },
  attachInfo: { flex: 1, minWidth: 0 },
  attachName: { fontFamily: fonts.medium, fontSize: 14, color: colors.text },
  attachSize: { fontFamily: fonts.regular, fontSize: 12, color: colors.textMuted, marginTop: 1 },
  error: { fontFamily: fonts.regular, color: colors.danger, marginTop: 14, lineHeight: 20 },
  discardBtn: { marginTop: 24, alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 8 },
  discardText: { fontFamily: fonts.semibold, color: colors.danger, fontSize: 15 },
  suggestBox: {
    marginTop: -2,
    borderRadius: 12,
    backgroundColor: colors.surface,
    overflow: "hidden",
  },
  suggestRow: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  suggestAddr: { fontFamily: fonts.regular, fontSize: 14, color: colors.text },
  suggestName: { fontFamily: fonts.regular, fontSize: 12, color: colors.textMuted, marginTop: 1 },
  actionBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 10,
    backgroundColor: colors.surfaceContainer,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  attachBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 22 },
  sendBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    height: 46,
    paddingHorizontal: 22,
    borderRadius: 23,
    backgroundColor: colors.primary,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  sendBtnDisabled: { backgroundColor: colors.surface, borderColor: colors.border },
  sendText: { fontFamily: fonts.bold, fontSize: 15, color: colors.primaryText, letterSpacing: 0.3 },
  sendTextDisabled: { color: colors.textMuted },
});
