import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import type { RootStackParamList } from "../navigation";
import { mail } from "../mailClient";
import { parseEml, type ParsedEmail } from "../eml";
import { saveOrShareAttachment, saveOrShareEncryptedAttachment } from "../attachments";
import { decryptEml } from "../mailboxKeys";
import { folderLabel } from "../folders";
import { colors, fonts } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "Message">;
type IconName = React.ComponentProps<typeof Ionicons>["name"];

export function MessageScreen({ route, navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { messageId, folder, encrypted, encWrappedKey } = route.params;
  const [email, setEmail] = useState<ParsedEmail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState<number | null>(null);
  const [moving, setMoving] = useState(false);

  useEffect(() => {
    let alive = true;
    void mail.setFlags(messageId, { unread: false }).catch(() => {});
    void (async () => {
      try {
        const { eml } = await mail.getRaw(messageId);
        // A notification tap carries only messageId (the encryption fields can't
        // travel through the push service), so `encrypted === undefined` means we
        // were opened from a notification — look up this message's metadata before
        // decrypting. From the inbox, the fields are passed in and no lookup runs.
        let enc: { encrypted?: boolean; encWrappedKey?: string } = { encrypted, encWrappedKey };
        if (encrypted === undefined) {
          try {
            const { items } = await mail.list({ folder, limit: 100 });
            const m = items.find((x) => x.messageId === messageId);
            if (m) enc = { encrypted: m.encrypted, encWrappedKey: m.encWrappedKey };
          } catch {
            /* leave as-is; a sealed body simply won't parse and shows as empty */
          }
        }
        // Decrypt before parsing — a no-op for mail stored in clear.
        const plain = await decryptEml(enc, eml);
        const parsed = await parseEml(plain);
        if (alive) setEmail(parsed);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [messageId, encrypted, encWrappedKey, folder]);

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
      const name = filename ?? local?.filename ?? `attachment-${index}`;
      const type = contentType ?? local?.mimeType;
      if (encrypted && encWrappedKey) {
        // Ciphertext on S3 — fetch, decrypt on-device, then share the plaintext.
        await saveOrShareEncryptedAttachment(url, { encrypted, encWrappedKey }, name, type);
      } else {
        await saveOrShareAttachment(url, name, type);
      }
    } catch (e) {
      Alert.alert("Couldn't open attachment", e instanceof Error ? e.message : String(e));
    } finally {
      setOpening(null);
    }
  }

  async function moveTo(target: "trash" | "inbox") {
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
        <TouchableOpacity
          onPress={() => moveTo(inTrash ? "inbox" : "trash")}
          style={styles.iconBtn}
          hitSlop={8}
          disabled={moving}
          accessibilityLabel={inTrash ? "Restore" : "Delete"}
        >
          {moving ? (
            <ActivityIndicator color={colors.textMuted} />
          ) : (
            <Ionicons name={inTrash ? "mail-outline" : "trash-outline"} size={22} color={colors.textMuted} />
          )}
        </TouchableOpacity>
      </View>

      {error ? (
        <View style={styles.centered}>
          <Text style={styles.errorTitle}>Couldn't open this message</Text>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : !email ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} />
        </View>
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

            <Text style={styles.body} selectable>
              {email.text || "(no text content)"}
            </Text>

            {email.attachments.length > 0 && (
              <View style={styles.attachments}>
                <Text style={styles.attachLabel}>
                  {email.attachments.length} attachment{email.attachments.length === 1 ? "" : "s"}
                </Text>
                {email.attachments.map((a, i) => (
                  <TouchableOpacity key={i} style={styles.attachChip} onPress={() => openAttachment(i)} activeOpacity={0.7}>
                    <Ionicons name="document-attach-outline" size={20} color={colors.primary} />
                    <Text style={styles.attachName} numberOfLines={1}>
                      {a.filename}
                    </Text>
                    {opening === i ? (
                      <ActivityIndicator size="small" color={colors.primary} />
                    ) : (
                      <Ionicons name="download-outline" size={18} color={colors.textMuted} />
                    )}
                  </TouchableOpacity>
                ))}
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
    </View>
  );
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
