// Mobile push notifications via the Expo Push Service. On sign-in we ask for
// permission, obtain this device's ExponentPushToken, and register it with the
// backend (`POST /devices`); the inbound-processor Lambda then pushes a "new mail"
// notification when a message lands in the inbox. Everything here is best-effort:
// a missing EAS projectId, a simulator (no token), or a denied permission simply
// means no push — never a crash or a blocked sign-in.
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { MailpoppyClient } from "@mailpoppy/api-client";
import { mail } from "./mailClient";
import { getConfig } from "./config";
import { auth } from "./auth";

/** Android notification channel id — must match the inbound-processor's channelId. */
export const MAIL_CHANNEL_ID = "mail";
/** Notification category — must match the inbound-processor's categoryId. */
export const MAIL_CATEGORY_ID = "mail";
/** Action identifier for "Mark as read" on a new-mail notification. */
export const MARK_READ_ACTION = "mark-read";

// How a notification is presented while the app is foregrounded. The push itself
// carries the badge count (computed server-side), so let it apply.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

// Register the "mail" category so its actions appear on new-mail notifications
// (long-press / pull-down). Mark-as-read runs WITHOUT opening the app to the
// foreground. Fire-and-forget at module load; harmless to re-register.
void Notifications.setNotificationCategoryAsync(MAIL_CATEGORY_ID, [
  {
    identifier: MARK_READ_ACTION,
    buttonTitle: "Mark as read",
    options: { opensAppToForeground: false },
  },
]).catch(() => {});

/**
 * Handle a "Mark as read" tap on a notification: flag the message read in the
 * mailbox it belongs to (throwaway client bound to that mailbox's token — never
 * disturbs the active session) and drop the app-icon badge by one. Best-effort.
 */
export async function markReadFromNotification(messageId: string, username: string): Promise<void> {
  try {
    const client = new MailpoppyClient({
      // Route to the mailbox's OWN backend (it may be on a different domain than the
      // one currently in the foreground), falling back to the active one.
      apiBaseUrl: (auth.configFor(username) ?? getConfig()).apiBaseUrl,
      getToken: () => auth.getTokenFor(username),
    });
    await client.setFlags(messageId, { unread: false });
    const badge = await Notifications.getBadgeCountAsync();
    if (badge > 0) await Notifications.setBadgeCountAsync(badge - 1);
  } catch (e) {
    console.warn("[push] mark-read from notification failed:", e);
  }
}

// The token we last registered, so we can unregister exactly it on sign-out.
let registeredToken: string | null = null;

/** The EAS project id is required to mint an Expo push token. */
function resolveProjectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? undefined;
}

async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync(MAIL_CHANNEL_ID, {
    name: "New mail",
    importance: Notifications.AndroidImportance.DEFAULT,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
    sound: "default",
  });
}

async function ensurePermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted || current.status === "granted") return true;
  if (!current.canAskAgain) return false;
  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted || requested.status === "granted";
}

const platform = (): "android" | "ios" => (Platform.OS === "android" ? "android" : "ios");

/** Permission + this device's Expo push token, or null when push can't work here
 *  (simulator, denied permission, or no EAS projectId). Never throws. */
async function acquireToken(): Promise<string | null> {
  if (!Device.isDevice) return null; // simulators/emulators don't get a push token
  await ensureAndroidChannel();
  if (!(await ensurePermission())) return null;
  const projectId = resolveProjectId();
  if (!projectId) {
    // Expected until `eas init` writes extra.eas.projectId and a dev/EAS build is
    // installed. Log once so it's discoverable, but never throw.
    console.warn("[push] no EAS projectId — run `eas init`; skipping registration");
    return null;
  }
  const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
  return data;
}

/**
 * Register this device with the backend for the ACTIVE mailbox. Safe to call
 * repeatedly (re-registering refreshes the token server-side after any pruning).
 * No-ops gracefully when push can't work in this environment.
 */
export async function registerForPush(): Promise<void> {
  try {
    const token = await acquireToken();
    if (!token) return;
    await mail.registerDevice(token, platform());
    registeredToken = token;
  } catch (e) {
    console.warn("[push] registration failed:", e);
  }
}

/**
 * Register this device for EVERY added mailbox, so notifications arrive for all of
 * them — not only the active one. The backend keeps a device registry per mailbox,
 * so we register the one device token under each. Each call uses a throwaway client
 * bound to THAT mailbox's token (via getTokenFor) rather than flipping the global
 * active session — so this never races the inbox the user is currently viewing.
 * Best-effort throughout.
 */
export async function registerForPushAllMailboxes(usernames: string[]): Promise<void> {
  if (usernames.length === 0) return;
  try {
    const token = await acquireToken();
    if (!token) return;
    registeredToken = token;
    for (const username of usernames) {
      try {
        // Register the one device token with EACH mailbox's OWN backend — mailboxes
        // may span several domains (deployments), each of which pushes independently.
        const apiBaseUrl = (auth.configFor(username) ?? getConfig()).apiBaseUrl;
        const client = new MailpoppyClient({ apiBaseUrl, getToken: () => auth.getTokenFor(username) });
        await client.registerDevice(token, platform());
      } catch (e) {
        console.warn("[push] register for a mailbox failed:", e);
      }
    }
  } catch (e) {
    console.warn("[push] multi registration failed:", e);
  }
}

/** Forget the last-registered device token (after a full sign-out sweep has
 *  unregistered it from every backend), so it isn't left dangling. */
export function forgetRegisteredToken(): void {
  registeredToken = null;
}

/** Unregister this device from ONE mailbox (its own backend — mailboxes can span
 *  domains), leaving the others registered. Uses a throwaway client bound to that
 *  mailbox's token, so it never disturbs the active session. */
export async function unregisterForMailbox(username: string): Promise<void> {
  const token = registeredToken;
  if (!token) return;
  try {
    const apiBaseUrl = (auth.configFor(username) ?? getConfig()).apiBaseUrl;
    const client = new MailpoppyClient({ apiBaseUrl, getToken: () => auth.getTokenFor(username) });
    await client.unregisterDevice(token);
  } catch (e) {
    console.warn("[push] unregister mailbox failed:", e);
  }
}
