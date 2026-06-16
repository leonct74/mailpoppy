import { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  FlatList,
  LayoutAnimation,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  UIManager,
  View,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import type { MessageMeta, Folder } from "@mailpoppy/core";
import type { RootStackParamList } from "../navigation";
import { FOLDERS, folderLabel } from "../folders";
import { mail } from "../mailClient";
import { Logo } from "../components/Logo";
import { colors, fonts, shortDate } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "Inbox">;
type IconName = React.ComponentProps<typeof Ionicons>["name"];

const PAGE = 50;
// Width of the action revealed when a row is held open (icon + label).
const ACTION_WIDTH = 92;

// Android needs LayoutAnimation explicitly enabled; no-op / unavailable on the
// new architecture, so guard it. iOS animates the list reflow out of the box.
if (Platform.OS === "android") {
  UIManager.setLayoutAnimationEnabledExperimental?.(true);
}

export function InboxScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const [folder, setFolder] = useState<Folder>("inbox");
  const [items, setItems] = useState<MessageMeta[]>([]);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [foldersOpen, setFoldersOpen] = useState(false);
  const [emptying, setEmptying] = useState(false);
  const searchRef = useRef<TextInput>(null);

  const load = useCallback(
    async (mode: "initial" | "refresh" | "more") => {
      if (mode === "refresh") setRefreshing(true);
      else if (mode === "more") setLoadingMore(true);
      else setLoading(true);
      setError(null);
      try {
        const res = await mail.list({
          folder,
          limit: PAGE,
          cursor: mode === "more" ? cursor : undefined,
        });
        setItems((prev) => (mode === "more" ? [...prev, ...res.items] : res.items));
        setCursor(res.cursor);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
        setRefreshing(false);
        setLoadingMore(false);
      }
    },
    [folder, cursor],
  );

  useFocusEffect(
    useCallback(() => {
      void load("initial");
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [folder]),
  );

  function switchFolder(f: Folder) {
    setFoldersOpen(false);
    if (f === folder) return;
    setItems([]);
    setCursor(undefined);
    setQuery("");
    setFolder(f);
  }

  const q = query.trim().toLowerCase();
  const filtered = q
    ? items.filter((m) =>
        [m.subject, m.snippet, m.from.name, m.from.address, ...m.to.map((t) => t.address)]
          .filter(Boolean)
          .some((s) => s!.toLowerCase().includes(q)),
      )
    : items;

  function open(item: MessageMeta) {
    if (folder === "drafts") {
      navigation.navigate("Compose", { draftId: item.messageId });
      return;
    }
    navigation.navigate("Message", {
      messageId: item.messageId,
      subject: item.subject,
      from: item.from.name || item.from.address,
      folder,
    });
  }

  // Swipe action: trash a message (or, in the trash folder, restore it to the
  // inbox). Optimistically drop it from the list, then reconcile — re-insert and
  // warn if the server call fails.
  const removeItem = useCallback(
    async (item: MessageMeta) => {
      const target: Folder = folder === "trash" ? "inbox" : "trash";
      setItems((prev) => prev.filter((m) => m.messageId !== item.messageId));
      try {
        await mail.move(item.messageId, target);
      } catch (e) {
        setItems((prev) =>
          prev.some((m) => m.messageId === item.messageId)
            ? prev
            : [...prev, item].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)),
        );
        Alert.alert(
          target === "trash" ? "Couldn't delete" : "Couldn't restore",
          e instanceof Error ? e.message : String(e),
        );
      }
    },
    [folder],
  );

  // Permanently purge every message in Trash (server-side hard delete). Guarded
  // by a confirm dialog since it can't be undone.
  async function emptyTrash() {
    setEmptying(true);
    try {
      await mail.emptyTrash();
      setItems([]);
      setCursor(undefined);
    } catch (e) {
      Alert.alert("Couldn't empty Trash", e instanceof Error ? e.message : String(e));
    } finally {
      setEmptying(false);
    }
  }

  function confirmEmptyTrash() {
    if (emptying) return;
    Alert.alert(
      "Empty Trash?",
      "This permanently deletes every message in Trash. This can't be undone.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Empty Trash", style: "destructive", onPress: () => void emptyTrash() },
      ],
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Logo size="sm" />
        <TouchableOpacity
          onPress={() => setFoldersOpen(true)}
          style={styles.headerBtn}
          hitSlop={8}
          accessibilityLabel="Folders"
        >
          <Ionicons name="filter" size={22} color={colors.textMuted} />
        </TouchableOpacity>
      </View>

      {/* Search */}
      <View style={styles.searchWrap}>
        <View style={styles.search}>
          <Ionicons name="search" size={20} color={colors.textMuted} />
          <TextInput
            ref={searchRef}
            style={styles.searchInput}
            placeholder={`Search ${folder === "inbox" ? "MailPoppy" : folderLabel(folder)}…`}
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            value={query}
            onChangeText={setQuery}
            clearButtonMode="while-editing"
          />
        </View>
        {folder !== "inbox" && (
          <View style={styles.folderChip}>
            <Text style={styles.folderChipText}>{folderLabel(folder)}</Text>
          </View>
        )}
      </View>

      {/* Empty-trash action — only in the Trash folder, when it has anything. */}
      {folder === "trash" && items.length > 0 && (
        <View style={styles.trashBarWrap}>
          <TouchableOpacity
            style={styles.emptyTrashBtn}
            onPress={confirmEmptyTrash}
            disabled={emptying}
            activeOpacity={0.8}
            accessibilityLabel="Empty Trash"
          >
            {emptying ? (
              <ActivityIndicator size="small" color={colors.danger} />
            ) : (
              <Ionicons name="trash" size={18} color={colors.danger} />
            )}
            <Text style={styles.emptyTrashText}>Empty Trash</Text>
          </TouchableOpacity>
        </View>
      )}

      {loading && items.length === 0 ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          style={styles.list}
          contentContainerStyle={styles.listContent}
          data={filtered}
          keyExtractor={(m) => m.messageId}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => load("refresh")} tintColor={colors.primary} />
          }
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (!q && cursor && !loadingMore && !loading) void load("more");
          }}
          ListFooterComponent={
            loadingMore ? <ActivityIndicator style={styles.footer} color={colors.primary} /> : null
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>{error ? "Couldn't load" : q ? "No matches" : "Nothing here"}</Text>
              <Text style={styles.emptyText}>
                {error ?? (q ? "Try a different search." : "Messages will appear here.")}
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <SwipeableRow item={item} folder={folder} onPress={() => open(item)} onDelete={removeItem} />
          )}
        />
      )}

      {/* Compose FAB — sits above the bottom nav */}
      <TouchableOpacity
        style={[styles.fab, { bottom: insets.bottom + 84 }]}
        onPress={() => navigation.navigate("Compose")}
        activeOpacity={0.85}
        accessibilityLabel="Compose"
      >
        <Ionicons name="create" size={26} color={colors.primaryText} />
      </TouchableOpacity>

      {/* Bottom navigation */}
      <View style={[styles.bottomNav, { paddingBottom: insets.bottom + 8 }]}>
        <NavTab icon="mail" label="Inbox" active={folder === "inbox"} onPress={() => switchFolder("inbox")} />
        <NavTab icon="search" label="Search" onPress={() => searchRef.current?.focus()} />
        <NavTab icon="folder-open" label="Folders" active={folder !== "inbox"} onPress={() => setFoldersOpen(true)} />
        <NavTab icon="settings-outline" label="Settings" onPress={() => navigation.navigate("Settings")} />
      </View>

      {/* Folder picker */}
      <Modal visible={foldersOpen} transparent animationType="fade" onRequestClose={() => setFoldersOpen(false)}>
        <Pressable style={styles.sheetScrim} onPress={() => setFoldersOpen(false)}>
          <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]}>
            <View style={styles.sheetGrabber} />
            <Text style={styles.sheetTitle}>Folders</Text>
            {FOLDERS.map((f) => {
              const active = f.key === folder;
              return (
                <TouchableOpacity
                  key={String(f.key)}
                  style={styles.sheetRow}
                  onPress={() => switchFolder(f.key)}
                  activeOpacity={0.7}
                >
                  <Ionicons name={folderIcon(f.key)} size={20} color={active ? colors.primary : colors.textMuted} />
                  <Text style={[styles.sheetRowText, active && styles.sheetRowActive]}>{f.label}</Text>
                  {active && <Ionicons name="checkmark" size={18} color={colors.primary} />}
                </TouchableOpacity>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function folderIcon(f: Folder): IconName {
  switch (f) {
    case "sent":
      return "send";
    case "drafts":
      return "document-text-outline";
    case "trash":
      return "trash-outline";
    default:
      return "mail";
  }
}

function NavTab({
  icon,
  label,
  active,
  onPress,
}: {
  icon: IconName;
  label: string;
  active?: boolean;
  onPress: () => void;
}) {
  const tint = active ? colors.primary : colors.textMuted;
  return (
    <TouchableOpacity
      style={[styles.navTab, active && styles.navTabActive]}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityLabel={label}
    >
      <Ionicons name={icon} size={22} color={tint} />
      <Text style={[styles.navLabel, { color: tint }]}>{label}</Text>
    </TouchableOpacity>
  );
}

/**
 * Wraps a Row in a horizontal swipe gesture. Swipe left to reveal a Delete
 * action (Restore in the trash folder); a short swipe snaps the action open so
 * it can be tapped, a long swipe commits straight away. Pure Animated +
 * PanResponder — no native gesture library — and it only claims clearly
 * horizontal drags, so vertical list scrolling and pull-to-refresh are unaffected.
 */
function SwipeableRow({
  item,
  folder,
  onPress,
  onDelete,
}: {
  item: MessageMeta;
  folder: Folder;
  onPress: () => void;
  onDelete: (item: MessageMeta) => void;
}) {
  const restore = folder === "trash";
  const translateX = useRef(new Animated.Value(0)).current;
  const offset = useRef(0); // resting position: 0 (closed) or -ACTION_WIDTH (open)
  const width = useRef(Dimensions.get("window").width - 32); // list horizontal padding

  // Latest props for the handlers, which are created once.
  const itemRef = useRef(item);
  itemRef.current = item;
  const onDeleteRef = useRef(onDelete);
  onDeleteRef.current = onDelete;

  const settle = useCallback(
    (to: number) => {
      offset.current = to;
      Animated.spring(translateX, { toValue: to, useNativeDriver: true, speed: 22, bounciness: 0 }).start();
    },
    [translateX],
  );

  const commit = useCallback(() => {
    try {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    } catch {
      /* reflow animation is cosmetic; removal still happens */
    }
    Animated.timing(translateX, { toValue: -width.current, duration: 180, useNativeDriver: true }).start(() =>
      onDeleteRef.current(itemRef.current),
    );
  }, [translateX]);

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.4,
      onPanResponderGrant: () => translateX.stopAnimation(),
      onPanResponderMove: (_e, g) =>
        translateX.setValue(Math.min(0, Math.max(-width.current, offset.current + g.dx))),
      onPanResponderRelease: (_e, g) => {
        const final = offset.current + g.dx;
        if (final <= -width.current * 0.42) commit();
        else if (final <= -ACTION_WIDTH * 0.55) settle(-ACTION_WIDTH);
        else settle(0);
      },
      onPanResponderTerminate: () => settle(offset.current <= -ACTION_WIDTH / 2 ? -ACTION_WIDTH : 0),
    }),
  ).current;

  // Tapping an open row closes it; otherwise it opens the message.
  const handlePress = () => {
    if (offset.current !== 0) settle(0);
    else onPress();
  };

  return (
    <View
      style={styles.swipeWrap}
      onLayout={(e) => {
        width.current = e.nativeEvent.layout.width;
      }}
    >
      <View style={[styles.swipeAction, restore ? styles.swipeRestore : styles.swipeDelete]}>
        <TouchableOpacity
          style={styles.swipeActionBtn}
          onPress={commit}
          activeOpacity={0.8}
          accessibilityLabel={restore ? "Restore message" : "Delete message"}
        >
          <Ionicons
            name={restore ? "mail-outline" : "trash"}
            size={22}
            color={restore ? colors.heading : "#ffffff"}
          />
          <Text style={[styles.swipeActionText, { color: restore ? colors.heading : "#ffffff" }]}>
            {restore ? "Restore" : "Delete"}
          </Text>
        </TouchableOpacity>
      </View>
      <Animated.View style={{ transform: [{ translateX }] }} {...pan.panHandlers}>
        <Row item={item} folder={folder} onPress={handlePress} />
      </Animated.View>
    </View>
  );
}

function Row({ item, folder, onPress }: { item: MessageMeta; folder: Folder; onPress: () => void }) {
  const unread = item.flags.unread;
  const outgoing = folder === "sent" || folder === "drafts";
  const who = outgoing
    ? recipientLabel(item)
    : item.from.name || item.from.address || "(unknown sender)";
  const seed = (outgoing ? item.to[0]?.address : item.from.address) || who;
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      {unread && <View style={styles.unreadBar} />}
      <Avatar label={who} seed={seed} />
      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <Text style={[styles.sender, unread && styles.senderUnread]} numberOfLines={1}>
            {outgoing ? `To: ${who}` : who}
          </Text>
          <Text style={[styles.date, unread && styles.dateUnread]}>{shortDate(item.date)}</Text>
        </View>
        <Text style={[styles.subject, unread && styles.subjectUnread]} numberOfLines={1}>
          {item.subject || "(no subject)"}
        </Text>
        <View style={styles.snippetRow}>
          {item.hasAttachments && (
            <Ionicons name="attach" size={14} color={colors.textMuted} style={styles.clip} />
          )}
          <Text style={styles.snippet} numberOfLines={1}>
            {item.snippet}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

function recipientLabel(item: MessageMeta): string {
  const first = item.to[0];
  if (!first) return "(no recipient)";
  const label = first.name || first.address;
  return item.to.length > 1 ? `${label} +${item.to.length - 1}` : label;
}

// Muted, dark-friendly avatar tints (the same correspondent stays one colour).
const AVATAR_COLORS = ["#3b5a7a", "#7a3b4b", "#3b7a5a", "#7a663b", "#5a3b7a", "#3b6f7a", "#7a3b6a", "#5c6b3b"];
function avatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length]!;
}
function Avatar({ label, seed }: { label: string; seed: string }) {
  const initial = (label.trim()[0] || "?").toUpperCase();
  return (
    <View style={[styles.avatar, { backgroundColor: avatarColor(seed) }]}>
      <Text style={styles.avatarText}>{initial}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  list: { flex: 1 },
  listContent: { paddingHorizontal: 16, paddingBottom: 120, gap: 8 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  headerBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: 20 },
  searchWrap: { paddingHorizontal: 16, paddingBottom: 12, gap: 8 },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.surfaceHigh,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  searchInput: { flex: 1, fontFamily: fonts.regular, fontSize: 15, color: colors.text, padding: 0 },
  folderChip: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(255,86,55,0.12)",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  folderChipText: { fontFamily: fonts.semibold, fontSize: 12, color: colors.primary, letterSpacing: 0.4 },
  trashBarWrap: { paddingHorizontal: 16, paddingBottom: 12 },
  emptyTrashBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: "rgba(255,180,171,0.35)",
  },
  emptyTrashText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.danger },
  swipeWrap: { borderRadius: 14, overflow: "hidden" },
  swipeAction: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "flex-end",
    justifyContent: "center",
  },
  swipeDelete: { backgroundColor: colors.primaryDeep },
  swipeRestore: { backgroundColor: colors.surfaceVariant },
  swipeActionBtn: { width: ACTION_WIDTH, height: "100%", alignItems: "center", justifyContent: "center", gap: 4 },
  swipeActionText: { fontFamily: fonts.semibold, fontSize: 12 },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 14,
    overflow: "hidden",
  },
  unreadBar: {
    position: "absolute",
    left: 0,
    top: "50%",
    marginTop: -16,
    width: 3,
    height: 32,
    backgroundColor: colors.primary,
    borderTopRightRadius: 3,
    borderBottomRightRadius: 3,
  },
  avatar: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#ffffff", fontFamily: fonts.bold, fontSize: 18 },
  rowBody: { flex: 1, minWidth: 0 },
  rowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginBottom: 2 },
  sender: { flex: 1, marginRight: 8, fontFamily: fonts.regular, fontSize: 16, color: colors.textMuted },
  senderUnread: { fontFamily: fonts.bold, color: colors.text },
  date: { fontFamily: fonts.medium, fontSize: 11, color: colors.textMuted },
  dateUnread: { color: colors.primary },
  subject: { fontFamily: fonts.regular, fontSize: 14, color: colors.text, marginBottom: 2 },
  subjectUnread: { fontFamily: fonts.semibold },
  snippetRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  clip: {},
  snippet: { flex: 1, fontFamily: fonts.regular, fontSize: 13, color: colors.textMuted },
  footer: { paddingVertical: 16 },
  empty: { alignItems: "center", paddingTop: 80, paddingHorizontal: 24 },
  emptyTitle: { fontFamily: fonts.bold, fontSize: 17, color: colors.text },
  emptyText: { fontFamily: fonts.regular, fontSize: 14, color: colors.textMuted, marginTop: 6, textAlign: "center", lineHeight: 20 },
  fab: {
    position: "absolute",
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    shadowColor: colors.primaryBright,
    shadowOpacity: 0.5,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  bottomNav: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
    paddingTop: 8,
    paddingHorizontal: 8,
    backgroundColor: colors.surfaceContainer,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  navTab: { alignItems: "center", justifyContent: "center", gap: 3, paddingHorizontal: 14, paddingVertical: 4, borderRadius: 12 },
  navTabActive: { backgroundColor: "rgba(255,86,55,0.12)" },
  navLabel: { fontFamily: fonts.semibold, fontSize: 11 },
  sheetScrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.surfaceContainer,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  sheetGrabber: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: colors.surfaceVariant, marginBottom: 12 },
  sheetTitle: { fontFamily: fonts.bold, fontSize: 18, color: colors.text, marginBottom: 8, marginLeft: 4 },
  sheetRow: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 14, paddingHorizontal: 4 },
  sheetRowText: { flex: 1, fontFamily: fonts.medium, fontSize: 16, color: colors.text },
  sheetRowActive: { fontFamily: fonts.bold, color: colors.primary },
});
