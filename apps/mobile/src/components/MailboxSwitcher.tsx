// The bottom-sheet mailbox switcher: pick which added mailbox is active, add
// another (on any paid domain), or remove one. Each row shows the full address, so
// mailboxes across different domains are unambiguous. Shared by Inbox header + Settings.
import { useState } from "react";
import {

  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { PoppySpinner } from "./PoppySpinner";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../AuthContext";
import { colors, fonts } from "../theme";

export function MailboxSwitcher({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const { accounts, activeEmail, switchTo, addMailbox, removeMailbox } = useAuth();
  const [adding, setAdding] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setAdding(false);
    setEmail("");
    setPassword("");
    setShowPw(false);
    setError(null);
    setBusy(false);
  }
  function close() {
    reset();
    onClose();
  }

  async function pick(addr: string) {
    if (addr !== activeEmail) {
      try {
        await switchTo(addr);
      } catch {
        /* switching reuses a stored session; nothing to surface */
      }
    }
    close();
  }

  async function add() {
    setBusy(true);
    setError(null);
    try {
      const res = await addMailbox(email, password);
      if (res === "new-password-required") {
        setError("This mailbox still needs its first password set. Sign in to it once on the web app, then add it here.");
        return;
      }
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function confirmRemove(addr: string) {
    Alert.alert(
      "Remove mailbox?",
      `${addr} will be removed from this app on this device. Its mail is untouched — you can add it back anytime.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Remove", style: "destructive", onPress: () => void removeMailbox(addr) },
      ],
    );
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <Pressable style={styles.scrim} onPress={close}>
        {/* Lift the bottom sheet above the keyboard, or typing in the add-mailbox form
            happens invisibly underneath it. Android needs this too: the RN Modal gets
            its own window, which does NOT adjustResize like the activity window does. */}
        <KeyboardAvoidingView behavior="padding">
        <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]}>
          <View style={styles.grabber} />
          <Text style={styles.title}>Mailboxes</Text>

          {accounts.map((a) => {
            const active = a.email === activeEmail;
            return (
              <View key={a.email} style={styles.row}>
                <TouchableOpacity style={styles.rowMain} onPress={() => void pick(a.email)} activeOpacity={0.7}>
                  <View style={[styles.dot, active && styles.dotActive]} />
                  <Text style={[styles.rowText, active && styles.rowActive]} numberOfLines={1}>
                    {a.email}
                  </Text>
                  {active && <Ionicons name="checkmark" size={18} color={colors.primary} />}
                </TouchableOpacity>
                {accounts.length > 1 && (
                  <TouchableOpacity
                    onPress={() => confirmRemove(a.email)}
                    hitSlop={8}
                    style={styles.removeBtn}
                    accessibilityLabel={`Remove ${a.email}`}
                  >
                    <Ionicons name="close" size={18} color={colors.textMuted} />
                  </TouchableOpacity>
                )}
              </View>
            );
          })}

          {adding ? (
            <View style={styles.addForm}>
              <TextInput
                style={styles.input}
                placeholder="you@yourdomain.com"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                value={email}
                onChangeText={setEmail}
              />
              <View style={styles.pwWrap}>
                <TextInput
                  style={styles.pwInput}
                  placeholder="Password"
                  placeholderTextColor={colors.textMuted}
                  secureTextEntry={!showPw}
                  value={password}
                  onChangeText={setPassword}
                />
                <TouchableOpacity
                  onPress={() => setShowPw((s) => !s)}
                  hitSlop={8}
                  style={styles.eyeBtn}
                  accessibilityRole="button"
                  accessibilityLabel={showPw ? "Hide password" : "Show password"}
                >
                  <Ionicons name={showPw ? "eye-off-outline" : "eye-outline"} size={20} color={colors.textMuted} />
                </TouchableOpacity>
              </View>
              {error && <Text style={styles.error}>{error}</Text>}
              <View style={styles.addActions}>
                <TouchableOpacity
                  style={styles.cancelBtn}
                  onPress={() => {
                    setAdding(false);
                    setError(null);
                  }}
                  disabled={busy}
                >
                  <Text style={styles.cancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.addBtn, (!email || !password || busy) && styles.addBtnDisabled]}
                  onPress={() => void add()}
                  disabled={!email || !password || busy}
                >
                  {busy ? (
                    <PoppySpinner size="small" color={colors.primaryText} />
                  ) : (
                    <Text style={styles.addText}>Add mailbox</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <TouchableOpacity
              style={styles.addRow}
              onPress={() => {
                setAdding(true);
                setError(null);
              }}
              activeOpacity={0.7}
            >
              <Ionicons name="add" size={20} color={colors.primary} />
              <Text style={styles.addRowText}>Add another mailbox</Text>
            </TouchableOpacity>
          )}
        </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.surfaceContainer,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  grabber: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: colors.surfaceVariant, marginBottom: 12 },
  title: { fontFamily: fonts.bold, fontSize: 18, color: colors.text, marginBottom: 8, marginLeft: 4 },
  row: { flexDirection: "row", alignItems: "center" },
  rowMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14, paddingHorizontal: 4 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.surfaceVariant },
  dotActive: { backgroundColor: colors.primary },
  rowText: { flex: 1, fontFamily: fonts.medium, fontSize: 15, color: colors.text },
  rowActive: { fontFamily: fonts.bold, color: colors.primary },
  removeBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  addRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 14, paddingHorizontal: 4, marginTop: 2 },
  addRowText: { fontFamily: fonts.semibold, fontSize: 15, color: colors.primary },
  addForm: { marginTop: 8, gap: 10 },
  input: {
    backgroundColor: colors.surfaceHigh,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: fonts.regular,
    fontSize: 15,
    color: colors.text,
  },
  pwWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surfaceHigh,
    borderRadius: 12,
    paddingRight: 12,
  },
  pwInput: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: fonts.regular,
    fontSize: 15,
    color: colors.text,
  },
  eyeBtn: { paddingLeft: 8, alignSelf: "stretch", justifyContent: "center" },
  error: { fontFamily: fonts.regular, fontSize: 13, color: colors.danger, lineHeight: 18 },
  addActions: { flexDirection: "row", gap: 10, marginTop: 2 },
  cancelBtn: { flex: 1, height: 46, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  cancelText: { fontFamily: fonts.semibold, fontSize: 15, color: colors.textMuted },
  addBtn: { flex: 2, height: 46, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.primary },
  addBtnDisabled: { opacity: 0.5 },
  addText: { fontFamily: fonts.bold, fontSize: 15, color: colors.primaryText },
});
