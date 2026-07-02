// A conversation: every message in one thread, newest first. Reached by tapping
// a collapsed thread row in the inbox; tapping a message here opens the reader.
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import type { MessageMeta } from "@mailpoppy/core";
import type { RootStackParamList } from "../navigation";
import { colors, fonts, shortDate } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "Thread">;

export function ThreadScreen({ route, navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { subject, folder, messages } = route.params;

  function open(item: MessageMeta) {
    navigation.navigate("Message", {
      messageId: item.messageId,
      subject: item.subject,
      from: item.from.name || item.from.address,
      folder,
      encrypted: !!item.encrypted,
      encWrappedKey: item.encWrappedKey,
    });
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn} hitSlop={8} accessibilityLabel="Back">
          <Ionicons name="arrow-back" size={24} color={colors.textMuted} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {subject || "(no subject)"}
          </Text>
          <Text style={styles.headerMeta}>{messages.length} messages</Text>
        </View>
        <View style={styles.iconBtn} />
      </View>

      <FlatList
        data={messages}
        keyExtractor={(m) => m.messageId}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => {
          const unread = item.flags.unread;
          return (
            <TouchableOpacity style={styles.row} onPress={() => open(item)} activeOpacity={0.7}>
              {unread && <View style={styles.unreadDot} />}
              <View style={styles.rowBody}>
                <View style={styles.rowTop}>
                  <Text style={[styles.sender, unread && styles.senderUnread]} numberOfLines={1}>
                    {item.from.name || item.from.address}
                  </Text>
                  <Text style={styles.date}>{shortDate(item.date)}</Text>
                </View>
                <View style={styles.snippetRow}>
                  {item.encrypted && <Ionicons name="lock-closed" size={13} color={colors.primary} />}
                  {item.hasAttachments && <Ionicons name="attach" size={14} color={colors.textMuted} />}
                  <Text style={styles.snippet} numberOfLines={2}>
                    {item.encrypted && !item.snippet ? "Encrypted message" : item.snippet}
                  </Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingBottom: 10,
    gap: 4,
  },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerText: { flex: 1, minWidth: 0 },
  headerTitle: { fontFamily: fonts.bold, fontSize: 17, color: colors.text },
  headerMeta: { fontFamily: fonts.regular, fontSize: 12, color: colors.textMuted, marginTop: 1 },
  listContent: { paddingHorizontal: 16, paddingBottom: 32, gap: 8 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 14,
  },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary },
  rowBody: { flex: 1, minWidth: 0 },
  rowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginBottom: 3 },
  sender: { flex: 1, marginRight: 8, fontFamily: fonts.regular, fontSize: 15, color: colors.textMuted },
  senderUnread: { fontFamily: fonts.bold, color: colors.text },
  date: { fontFamily: fonts.medium, fontSize: 11, color: colors.textMuted },
  snippetRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  snippet: { flex: 1, fontFamily: fonts.regular, fontSize: 13, color: colors.textMuted, lineHeight: 18 },
});
