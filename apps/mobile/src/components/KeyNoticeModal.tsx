// One-time, post-login notice about the mailbox encryption key:
//   • recoveryKey present → first keygen: show the recovery key ONCE (the only way
//     to rescue mail after a forgotten password); dismissal is gated on the user
//     confirming they've saved it.
//   • rekeyed (no recoveryKey) → an admin password reset invalidated the old key,
//     so previously-received encrypted mail can no longer be opened.
//   • error → key setup failed this session; encrypted mail may not open.
import { useState } from "react";
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, fonts } from "../theme";

export interface KeyNotice {
  recoveryKey?: string;
  rekeyed: boolean;
  error?: string;
}

export function KeyNoticeModal({ notice, onDismiss }: { notice: KeyNotice | null; onDismiss: () => void }) {
  const [ack, setAck] = useState(false);
  const showRecovery = !!notice?.recoveryKey;
  // The recovery key must be acknowledged before it can be dismissed; everything
  // else is a plain "OK".
  const canDismiss = !showRecovery || ack;

  function close() {
    setAck(false);
    onDismiss();
  }

  return (
    <Modal visible={!!notice} animationType="slide" transparent onRequestClose={canDismiss ? close : undefined}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <ScrollView contentContainerStyle={styles.content}>
            {notice?.error ? (
              <>
                <Ionicons name="warning-outline" size={32} color={colors.danger} />
                <Text style={styles.title}>Couldn&apos;t set up encryption</Text>
                <Text style={styles.body}>
                  Mailpoppy couldn&apos;t prepare your encryption key this session, so encrypted messages may not open.
                  Check your connection and sign out and in again. ({notice.error})
                </Text>
              </>
            ) : showRecovery ? (
              <>
                <Ionicons name="key-outline" size={32} color={colors.primary} />
                <Text style={styles.title}>Save your recovery key</Text>
                <Text style={styles.body}>
                  Your mailbox is now encrypted. If you ever forget your password, this recovery key is the ONLY way to
                  read your existing mail — we can&apos;t recover it for you. Write it down and keep it somewhere safe.
                </Text>
                <Text selectable style={styles.key}>
                  {notice!.recoveryKey}
                </Text>
                {notice?.rekeyed && (
                  <Text style={styles.warn}>Note: your previous encrypted mail was reset and can no longer be opened.</Text>
                )}
                <TouchableOpacity style={styles.ackRow} onPress={() => setAck((v) => !v)} activeOpacity={0.7}>
                  <Ionicons
                    name={ack ? "checkbox" : "square-outline"}
                    size={22}
                    color={ack ? colors.primary : colors.textMuted}
                  />
                  <Text style={styles.ackText}>I&apos;ve saved my recovery key somewhere safe</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Ionicons name="refresh-outline" size={32} color={colors.danger} />
                <Text style={styles.title}>Mailbox re-keyed</Text>
                <Text style={styles.body}>
                  Your password was reset, so a new encryption key was created. Encrypted mail received before now can no
                  longer be opened — new mail will be readable as usual.
                </Text>
              </>
            )}
          </ScrollView>
          <TouchableOpacity
            style={[styles.btn, !canDismiss && styles.btnDisabled]}
            onPress={close}
            disabled={!canDismiss}
            activeOpacity={0.85}
          >
            <Text style={styles.btnText}>{showRecovery ? "Done" : "OK"}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", padding: 20 },
  card: { backgroundColor: colors.surface, borderRadius: 18, maxHeight: "85%", overflow: "hidden" },
  content: { padding: 22, alignItems: "center", gap: 12 },
  title: { fontFamily: fonts.bold, fontSize: 20, color: colors.heading, textAlign: "center" },
  body: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 21, color: colors.text, textAlign: "center" },
  key: {
    fontFamily: fonts.medium,
    fontSize: 14,
    letterSpacing: 1,
    color: colors.primaryText,
    backgroundColor: colors.surfaceHigh,
    borderRadius: 10,
    padding: 14,
    width: "100%",
    textAlign: "center",
  },
  warn: { fontFamily: fonts.medium, fontSize: 13, color: colors.danger, textAlign: "center" },
  ackRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 4 },
  ackText: { flex: 1, fontFamily: fonts.medium, fontSize: 14, color: colors.text },
  btn: {
    backgroundColor: colors.primary,
    paddingVertical: 15,
    alignItems: "center",
    margin: 16,
    marginTop: 4,
    borderRadius: 14,
  },
  btnDisabled: { opacity: 0.4 },
  btnText: { fontFamily: fonts.semibold, fontSize: 16, color: colors.primaryText },
});
