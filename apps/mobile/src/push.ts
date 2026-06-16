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
import { mail } from "./mailClient";

/** Android notification channel id — must match the inbound-processor's channelId. */
export const MAIL_CHANNEL_ID = "mail";

// How a notification is presented while the app is foregrounded.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

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

/**
 * Request permission, get this device's Expo push token, and register it with the
 * backend. Safe to call repeatedly (re-registering refreshes the token server-side
 * after any pruning). No-ops gracefully when push can't work in this environment.
 */
export async function registerForPush(): Promise<void> {
  try {
    if (!Device.isDevice) return; // simulators/emulators don't get a push token
    await ensureAndroidChannel();
    if (!(await ensurePermission())) return;

    const projectId = resolveProjectId();
    if (!projectId) {
      // Expected until `eas init` writes extra.eas.projectId and a dev/EAS build
      // is installed. Log once so it's discoverable, but never throw.
      console.warn("[push] no EAS projectId — run `eas init`; skipping registration");
      return;
    }

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await mail.registerDevice(token, Platform.OS === "android" ? "android" : "ios");
    registeredToken = token;
  } catch (e) {
    console.warn("[push] registration failed:", e);
  }
}

/**
 * Unregister this device's token (call BEFORE clearing the Cognito session, while
 * the JWT is still valid). Best-effort; a stale token is also pruned server-side
 * the next time Expo reports it as DeviceNotRegistered.
 */
export async function unregisterForPush(): Promise<void> {
  const token = registeredToken;
  registeredToken = null;
  if (!token) return;
  try {
    await mail.unregisterDevice(token);
  } catch (e) {
    console.warn("[push] unregister failed:", e);
  }
}
