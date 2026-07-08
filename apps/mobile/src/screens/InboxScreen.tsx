import { useCallback, useEffect, useRef, useState } from "react";
import {

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
import { PoppySpinner } from "../components/PoppySpinner";
import { useFocusEffect } from "@react-navigation/native";
import * as Notifications from "expo-notifications";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import type { MessageMeta, Folder } from "@mailpoppy/core";
import type { RootStackParamList } from "../navigation";
import { FOLDERS, folderLabel } from "../folders";
import { mail } from "../mailClient";
import { loadInboxCache, saveInboxCache, onNewMail } from "../inboxCache";
import { hapticDelete } from "../haptics";
import { groupByThread, ungrouped, type ThreadGroup } from "../threads";
import { MailboxSwitcher } from "../components/MailboxSwitcher";
import { useAuth } from "../AuthContext";
import { colors, fonts, shortDate } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "Inbox">;
type IconName = React.ComponentProps<typeof Ionicons>["name"];

/** One revealed swipe action (Delete / Restore / Junk). */
type SwipeAction = {
  key: string;
  label: string;
  icon: IconName;
  bg: string;
  fg: string;
  run: (item: MessageMeta) => void;
};

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
  const { activeEmail } = useAuth();
  const [switcherOpen, setSwitcherOpen] = useState(false);
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

  // Latest values for async callbacks (avoids stale closures in cache hydration
  // and drops responses that land after a mailbox switch).
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const activeEmailRef = useRef(activeEmail);
  activeEmailRef.current = activeEmail;
  const folderRef = useRef(folder);
  folderRef.current = folder;

  const load = useCallback(
    async (mode: "initial" | "refresh" | "more" | "silent") => {
      if (mode === "refresh") setRefreshing(true);
      else if (mode === "more") setLoadingMore(true);
      else if (mode === "initial") setLoading(true);
      if (mode !== "silent") setError(null);
      const requestedFor = activeEmailRef.current;
      try {
        const res = await mail.list({
          folder,
          limit: PAGE,
          cursor: mode === "more" ? cursor : undefined,
        });
        // The user switched mailbox or folder while this was in flight — the
        // response belongs to the previous view, so it must not touch state or cache.
        if (activeEmailRef.current !== requestedFor || folderRef.current !== folder) return;
        if (mode === "silent") {
          try {
            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
          } catch {
            /* cosmetic */
          }
        }
        setItems((prev) => (mode === "more" ? [...prev, ...res.items] : res.items));
        setCursor(res.cursor);
        if (mode !== "more" && requestedFor) saveInboxCache(requestedFor, folder, res.items);
        // Keep the app-icon badge in sync with the inbox's unread count whenever
        // the inbox (re)loads — open app / pull-to-refresh / focus. (Closed-app
        // badge updates would need the push to carry a badge count; see follow-up.)
        if (folder === "inbox" && mode !== "more") {
          void Notifications.setBadgeCountAsync(res.items.filter((m) => m.flags.unread).length).catch(() => {});
        }
      } catch (e) {
        // A failed background refresh keeps showing the cached list quietly.
        if (mode !== "silent" && activeEmailRef.current === requestedFor) {
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        setLoading(false);
        setRefreshing(false);
        setLoadingMore(false);
      }
    },
    [folder, cursor],
  );

  // Show the last-known listing INSTANTLY (from the per-mailbox cache), then
  // revalidate in the background — no spinner when we have anything to show.
  useFocusEffect(
    useCallback(() => {
      void (async () => {
        const email = activeEmailRef.current;
        if (itemsRef.current.length === 0 && email) {
          const cached = await loadInboxCache(email, folder);
          if (cached?.length && activeEmailRef.current === email && itemsRef.current.length === 0) {
            setItems(cached);
            setLoading(false);
          }
        }
        void load(itemsRef.current.length > 0 ? "silent" : "initial");
      })();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [folder, activeEmail]),
  );

  // A push arriving while the app is open = new mail in some mailbox. If it's the
  // one on screen, reload quietly so the message just appears in the list.
  useEffect(() => {
    return onNewMail((mailbox) => {
      if (mailbox === activeEmailRef.current && folder === "inbox") void load("silent");
    });
  }, [folder, load]);

  // Switching the active mailbox resets to a fresh inbox for it; the focus effect
  // above (keyed on activeEmail) then loads that mailbox's messages.
  useEffect(() => {
    setQuery("");
    setCursor(undefined);
    setItems([]);
    setFolder("inbox");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeEmail]);

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

  // The inbox collapses a conversation into one row (newest message + count).
  // Other folders and search results stay flat — there a specific message is
  // usually the target, not a conversation.
  const groups = folder === "inbox" && !q ? groupByThread(filtered) : ungrouped(filtered);

  function openThread(group: ThreadGroup) {
    navigation.navigate("Thread", {
      subject: group.latest.subject,
      folder,
      messages: group.messages,
    });
  }

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
      // Definite boolean (never undefined) so the reader knows the meta is known
      // and skips the notification-tap meta lookup.
      encrypted: !!item.encrypted,
      encWrappedKey: item.encWrappedKey,
    });
  }

  // Move a message to another folder from a swipe: optimistically drop it from the
  // list, then reconcile — re-insert and warn if the server call fails. Used for
  // Delete (→trash), Restore (→inbox), and Report spam (→junk).
  const moveItem = useCallback(async (item: MessageMeta, target: Folder, failVerb: string) => {
    try {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    } catch {
      /* the reflow is cosmetic; the removal still happens */
    }
    setItems((prev) => prev.filter((m) => m.messageId !== item.messageId));
    try {
      await mail.move(item.messageId, target);
    } catch (e) {
      setItems((prev) =>
        prev.some((m) => m.messageId === item.messageId)
          ? prev
          : [...prev, item].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)),
      );
      Alert.alert(`Couldn't ${failVerb}`, e instanceof Error ? e.message : String(e));
    }
  }, []);

  // Move an ENTIRE conversation (every message in a collapsed thread row) at once, so a
  // thread can be deleted / reported / restored from the inbox — not just one message.
  // mail.move is a metadata op keyed by messageId, so it works even for a message whose
  // body won't load (e.g. mail encrypted with a since-replaced key, or a fetch failure) —
  // which is exactly what would otherwise leave a conversation impossible to clear.
  const moveGroup = useCallback(async (group: ThreadGroup, target: Folder, failVerb: string) => {
    try {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    } catch {
      /* the reflow is cosmetic; the removal still happens */
    }
    const msgs = group.messages;
    const ids = new Set(msgs.map((m) => m.messageId));
    setItems((prev) => prev.filter((m) => !ids.has(m.messageId)));
    const results = await Promise.allSettled(msgs.map((m) => mail.move(m.messageId, target)));
    const failed = msgs.filter((_, i) => results[i]?.status === "rejected");
    if (failed.length > 0) {
      setItems((prev) => {
        const present = new Set(prev.map((m) => m.messageId));
        const missing = failed.filter((m) => !present.has(m.messageId));
        return missing.length
          ? [...prev, ...missing].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
          : prev;
      });
      Alert.alert(
        `Couldn't ${failVerb}`,
        `${failed.length} of ${msgs.length} message${msgs.length === 1 ? "" : "s"} couldn't be moved. Please try again.`,
      );
    }
  }, []);

  // The swipe actions for the current folder. The last one is what a full ("long")
  // swipe commits; the rest are tap-only once the row snaps open. The inbox gets a
  // "Junk" (report spam) action alongside Delete — a visible way to flag unwanted
  // incoming mail (App Store Guideline 1.2, user-generated content).
  const swipeActions: SwipeAction[] =
    folder === "trash"
      ? [{ key: "restore", label: "Restore", icon: "mail-outline", bg: colors.surfaceVariant, fg: colors.heading, run: (i) => moveItem(i, "inbox", "restore") }]
      : folder === "inbox"
        ? [
            { key: "junk", label: "Junk", icon: "alert-circle", bg: colors.surfaceVariant, fg: colors.heading, run: (i) => moveItem(i, "junk", "report") },
            { key: "delete", label: "Delete", icon: "trash", bg: colors.primaryDeep, fg: "#ffffff", run: (i) => moveItem(i, "trash", "delete") },
          ]
        : [{ key: "delete", label: "Delete", icon: "trash", bg: colors.primaryDeep, fg: "#ffffff", run: (i) => moveItem(i, "trash", "delete") }];

  // The same actions for a collapsed CONVERSATION row: each runs over every message in
  // the thread (ignoring the single item the swipe would otherwise pass).
  const threadActionsFor = (group: ThreadGroup): SwipeAction[] =>
    folder === "trash"
      ? [{ key: "restore", label: "Restore", icon: "mail-outline", bg: colors.surfaceVariant, fg: colors.heading, run: () => moveGroup(group, "inbox", "restore") }]
      : folder === "inbox"
        ? [
            { key: "junk", label: "Junk", icon: "alert-circle", bg: colors.surfaceVariant, fg: colors.heading, run: () => moveGroup(group, "junk", "report") },
            { key: "delete", label: "Delete", icon: "trash", bg: colors.primaryDeep, fg: "#ffffff", run: () => moveGroup(group, "trash", "delete") },
          ]
        : [{ key: "delete", label: "Delete", icon: "trash", bg: colors.primaryDeep, fg: "#ffffff", run: () => moveGroup(group, "trash", "delete") }];

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
      {/* Header — the active mailbox (tap to switch) + folders */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          onPress={() => setSwitcherOpen(true)}
          style={styles.mailboxChip}
          hitSlop={8}
          activeOpacity={0.7}
          accessibilityLabel="Switch mailbox"
        >
          <Ionicons name="mail" size={16} color={colors.primary} />
          <Text style={styles.mailboxChipText} numberOfLines={1}>
            {activeEmail ?? "Mailbox"}
          </Text>
          <Ionicons name="chevron-down" size={16} color={colors.textMuted} />
        </TouchableOpacity>
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
              <PoppySpinner size="small" color={colors.danger} />
            ) : (
              <Ionicons name="trash" size={18} color={colors.danger} />
            )}
            <Text style={styles.emptyTrashText}>Empty Trash</Text>
          </TouchableOpacity>
        </View>
      )}

      {loading && items.length === 0 ? (
        <View style={styles.centered}>
          <PoppySpinner color={colors.primary} />
        </View>
      ) : (
        <FlatList
          style={styles.list}
          contentContainerStyle={styles.listContent}
          data={groups}
          keyExtractor={(g) => g.latest.messageId}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => load("refresh")} tintColor={colors.primary} />
          }
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (!q && cursor && !loadingMore && !loading) void load("more");
          }}
          ListFooterComponent={
            loadingMore ? <PoppySpinner style={styles.footer} color={colors.primary} /> : null
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>{error ? "Couldn't load" : q ? "No matches" : "Nothing here"}</Text>
              <Text style={styles.emptyText}>
                {error ?? (q ? "Try a different search." : "Messages will appear here.")}
              </Text>
            </View>
          }
          renderItem={({ item: group }) =>
            group.count === 1 ? (
              <SwipeableRow
                item={group.latest}
                folder={folder}
                onPress={() => open(group.latest)}
                actions={swipeActions}
              />
            ) : (
              // A conversation row: swipe deletes / reports / restores EVERY message in the
              // thread at once — so a thread can be cleared from the inbox even if one of its
              // messages won't open; tap opens the thread.
              <SwipeableRow
                item={group.latest}
                folder={folder}
                onPress={() => openThread(group)}
                actions={threadActionsFor(group)}
                count={group.count}
                unreadOverride={group.unread}
              />
            )
          }
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

      {/* Mailbox switcher */}
      <MailboxSwitcher visible={switcherOpen} onClose={() => setSwitcherOpen(false)} />
    </View>
  );
}

function folderIcon(f: Folder): IconName {
  switch (f) {
    case "sent":
      return "send";
    case "drafts":
      return "document-text-outline";
    case "junk":
      return "alert-circle-outline";
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
 * Wraps a Row in a horizontal swipe gesture. Swipe left to reveal one or more
 * actions (e.g. Junk + Delete on the inbox, Restore in trash); a short swipe snaps
 * the tray open so a button can be tapped, a long swipe commits the LAST (primary)
 * action straight away. Pure Animated + PanResponder — no native gesture library —
 * and it only claims clearly horizontal drags, so vertical list scrolling and
 * pull-to-refresh are unaffected.
 */
function SwipeableRow({
  item,
  folder,
  onPress,
  actions,
  count,
  unreadOverride,
}: {
  item: MessageMeta;
  folder: Folder;
  onPress: () => void;
  actions: SwipeAction[];
  /** >1 marks a collapsed conversation (shows the message count on the row). */
  count?: number;
  unreadOverride?: boolean;
}) {
  const trayWidth = actions.length * ACTION_WIDTH;
  const translateX = useRef(new Animated.Value(0)).current;
  const offset = useRef(0); // resting position: 0 (closed) or -trayWidth (open)
  const width = useRef(Dimensions.get("window").width - 32); // list horizontal padding

  // Latest props for the handlers, which are created once.
  const itemRef = useRef(item);
  itemRef.current = item;
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  const settle = useCallback(
    (to: number, velocity?: number) => {
      offset.current = to;
      Animated.spring(translateX, {
        toValue: to,
        useNativeDriver: true,
        speed: 22,
        bounciness: 0,
        // Carry the finger's velocity into the spring so a flick keeps its momentum
        // instead of visibly re-accelerating from a standstill.
        ...(velocity != null ? { velocity } : {}),
      }).start();
    },
    [translateX],
  );

  // A full swipe commits the primary action (the last one — Delete, or Restore in trash).
  const commit = useCallback(() => {
    hapticDelete();
    try {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    } catch {
      /* reflow animation is cosmetic; removal still happens */
    }
    Animated.timing(translateX, { toValue: -width.current, duration: 180, useNativeDriver: true }).start(() => {
      const acts = actionsRef.current;
      acts[acts.length - 1]?.run(itemRef.current);
    });
  }, [translateX]);

  const pan = useRef(
    PanResponder.create({
      // Never claim on touch-start — a tap must still open the message. Claim on MOVE
      // as soon as the drag is more horizontal than vertical (a LOW bar, so an ordinary
      // swipe from anywhere on the row works — not just a dead-straight one grabbed at
      // the far right). Also claim in the CAPTURE phase: inside a vertical FlatList the
      // scroll view grabs the gesture first, and capturing a clearly-horizontal drag is
      // the only reliable way to win it back.
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 6 && Math.abs(g.dx) >= Math.abs(g.dy),
      onMoveShouldSetPanResponderCapture: (_e, g) => Math.abs(g.dx) > 9 && Math.abs(g.dx) > Math.abs(g.dy) * 1.3,
      // Once we own the swipe, don't let the FlatList reclaim it mid-drag — that steal
      // is what made a swipe "reset immediately" unless it was perfectly horizontal.
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => translateX.stopAnimation(),
      onPanResponderMove: (_e, g) => {
        // A single-action row tracks the finger across the whole row (a full swipe
        // commits, so it should follow all the way); a multi-action row stops at the
        // open tray so both buttons stay put to be tapped.
        const dragMax = actionsRef.current.length === 1 ? width.current : trayWidth;
        translateX.setValue(Math.min(0, Math.max(-dragMax, offset.current + g.dx)));
      },
      onPanResponderRelease: (_e, g) => {
        const final = offset.current + g.dx;
        // Decide from BOTH distance AND velocity, with LOW bars so an ordinary swipe
        // opens instead of snapping shut. vx is px/ms; ~0.2 ≈ a gentle flick.
        const flungOpen = g.vx <= -0.2;
        const flungShut = g.vx >= 0.2;
        if (actionsRef.current.length === 1) {
          // Single action (Delete / Restore): a moderate drag OR a leftward flick commits;
          // a rightward flick always cancels.
          if (!flungShut && (final <= -width.current * 0.35 || (flungOpen && final <= -20))) commit();
          else settle(0, g.vx);
        } else {
          // Multi-action inbox row: reveal the tray on even a short drag (~30% of it) OR a
          // flick — never auto-commit Delete here. A rightward flick snaps it shut.
          if (!flungShut && (flungOpen || final <= -trayWidth * 0.3)) settle(-trayWidth, g.vx);
          else settle(0, g.vx);
        }
      },
      onPanResponderTerminate: () => settle(offset.current <= -trayWidth / 2 ? -trayWidth : 0),
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
      <View style={styles.swipeTray}>
        {actions.map((a) => (
          <TouchableOpacity
            key={a.key}
            style={[styles.swipeActionBtn, { backgroundColor: a.bg }]}
            onPress={() => {
              settle(0);
              a.run(itemRef.current);
            }}
            activeOpacity={0.8}
            accessibilityLabel={`${a.label} message`}
          >
            <Ionicons name={a.icon} size={22} color={a.fg} />
            <Text style={[styles.swipeActionText, { color: a.fg }]}>{a.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <Animated.View style={{ transform: [{ translateX }] }} {...pan.panHandlers}>
        <Row item={item} folder={folder} onPress={handlePress} count={count} unreadOverride={unreadOverride} />
      </Animated.View>
    </View>
  );
}

function Row({
  item,
  folder,
  onPress,
  count,
  unreadOverride,
}: {
  item: MessageMeta;
  folder: Folder;
  onPress: () => void;
  /** >1 marks a collapsed conversation and shows the message count. */
  count?: number;
  /** Thread rows are unread when ANY of their messages is. */
  unreadOverride?: boolean;
}) {
  const unread = unreadOverride ?? item.flags.unread;
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
          {count != null && count > 1 && (
            <View style={styles.threadCount}>
              <Text style={styles.threadCountText}>{count}</Text>
            </View>
          )}
          <Text style={[styles.date, unread && styles.dateUnread]}>{shortDate(item.date)}</Text>
        </View>
        <Text style={[styles.subject, unread && styles.subjectUnread]} numberOfLines={1}>
          {item.subject || "(no subject)"}
        </Text>
        <View style={styles.snippetRow}>
          {item.encrypted && (
            <Ionicons name="lock-closed" size={13} color={colors.primary} style={styles.clip} />
          )}
          {item.hasAttachments && (
            <Ionicons name="attach" size={14} color={colors.textMuted} style={styles.clip} />
          )}
          <Text style={styles.snippet} numberOfLines={1}>
            {item.encrypted && !item.snippet ? "Encrypted message" : item.snippet}
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
  mailboxChip: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    marginRight: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: colors.surfaceHigh,
  },
  mailboxChipText: { flex: 1, fontFamily: fonts.semibold, fontSize: 14, color: colors.text },
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
  swipeTray: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    justifyContent: "flex-end",
  },
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
  threadCount: {
    minWidth: 22,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 6,
    marginRight: 6,
    backgroundColor: colors.surfaceVariant,
    alignItems: "center",
    justifyContent: "center",
  },
  threadCountText: { fontFamily: fonts.bold, fontSize: 11, color: colors.text },
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
