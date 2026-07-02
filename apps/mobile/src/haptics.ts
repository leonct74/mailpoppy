// Tiny haptic vocabulary for the few moments that deserve physical feedback.
// Everything is fire-and-forget and swallowed on failure (simulators, devices
// with haptics disabled) — a missing buzz should never break a flow.
import * as Haptics from "expo-haptics";

/** A destructive commit landed (message swiped to trash). */
export function hapticDelete(): void {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
}

/** The active mailbox changed. */
export function hapticSwitch(): void {
  void Haptics.selectionAsync().catch(() => {});
}

/** A message was handed off for sending. */
export function hapticSend(): void {
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}
