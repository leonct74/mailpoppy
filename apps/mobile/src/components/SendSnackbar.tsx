// The undo-send snackbar, rendered once at the app root so it overlays whatever
// screen the user returns to after Compose closes. Shows the countdown with an
// Undo button, then the send progress/result; a failed send says it was recovered
// into Drafts.
import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { onOutboxChange, undoSend, dismissOutbox, type OutboxState, type OutboxJob } from "../outbox";
import { colors, fonts } from "../theme";

export function SendSnackbar({ onUndo }: { onUndo: (job: OutboxJob) => void }) {
  const [state, setState] = useState<OutboxState | null>(null);
  useEffect(() => onOutboxChange(setState), []);
  const insets = useSafeAreaInsets();

  if (!state) return null;

  const seconds = Math.max(1, Math.ceil(state.remainingMs / 1000));
  return (
    <View style={[styles.wrap, { bottom: insets.bottom + 24 }]} pointerEvents="box-none">
      <View style={styles.bar}>
        {state.phase === "waiting" && (
          <>
            <Ionicons name="paper-plane-outline" size={18} color={colors.text} />
            <Text style={styles.text}>Sending in {seconds}s</Text>
            <TouchableOpacity
              onPress={() => {
                const job = undoSend();
                if (job) onUndo(job);
              }}
              hitSlop={10}
              accessibilityLabel="Undo send"
            >
              <Text style={styles.undo}>UNDO</Text>
            </TouchableOpacity>
          </>
        )}
        {state.phase === "sending" && (
          <>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={styles.text}>Sending…</Text>
          </>
        )}
        {state.phase === "sent" && (
          <>
            <Ionicons name="checkmark-circle" size={18} color="#7fd48a" />
            <Text style={styles.text}>Sent</Text>
          </>
        )}
        {state.phase === "failed" && (
          <>
            <Ionicons name="alert-circle" size={18} color={colors.danger} />
            <Text style={styles.text} numberOfLines={2}>
              Couldn't send{state.savedAsDraft ? " — saved to Drafts" : `: ${state.error ?? "unknown error"}`}
            </Text>
            <TouchableOpacity onPress={dismissOutbox} hitSlop={10} accessibilityLabel="Dismiss">
              <Ionicons name="close" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 16, right: 16, alignItems: "center" },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    maxWidth: 480,
    alignSelf: "stretch",
    backgroundColor: colors.surfaceContainer,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 13,
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  text: { flex: 1, fontFamily: fonts.medium, fontSize: 14, color: colors.text },
  undo: { fontFamily: fonts.bold, fontSize: 13, color: colors.primary, letterSpacing: 0.6 },
});
