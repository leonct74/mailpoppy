// Cross-platform pinch-zoom for the full-screen image preview. ScrollView's
// maximumZoomScale only works on iOS, and this app deliberately avoids native
// gesture libraries (the inbox swipe rows are plain PanResponder too) — so pinch,
// pan-when-zoomed and double-tap-to-zoom are implemented with core PanResponder +
// Animated and behave the same on iOS and Android.
import { useRef } from "react";
import { Animated, PanResponder, StyleSheet, View, type LayoutChangeEvent } from "react-native";

const MIN_SCALE = 1;
const MAX_SCALE = 5;
const DOUBLE_TAP_MS = 280;
const DOUBLE_TAP_SCALE = 2.5;

export function ZoomableImage({ uri, onError }: { uri: string; onError?: (message: string) => void }) {
  // The committed transform (as of the last completed gesture)…
  const base = useRef({ scale: 1, tx: 0, ty: 0 });
  // …the transform currently on screen (mirrors the Animated values, which can't
  // be read synchronously)…
  const live = useRef({ scale: 1, tx: 0, ty: 0 });
  // …and the Animated values actually driving the image.
  const scale = useRef(new Animated.Value(1)).current;
  const tx = useRef(new Animated.Value(0)).current;
  const ty = useRef(new Animated.Value(0)).current;

  const viewport = useRef({ w: 0, h: 0 });
  const pinchUnit = useRef<number | null>(null); // finger distance at scale 1
  const pinched = useRef(false); // this gesture pinched → ignore its pan/tap
  const lastTap = useRef(0);

  function apply(s: number, x: number, y: number) {
    live.current = { scale: s, tx: x, ty: y };
    scale.setValue(s);
    tx.setValue(x);
    ty.setValue(y);
  }

  /** Cap the pan so the scaled image's edges can't drift past the viewport. */
  function clamp(v: number, s: number, extent: number) {
    const max = (extent * (s - 1)) / 2;
    return Math.min(max, Math.max(-max, v));
  }

  function springTo(s: number, x: number, y: number) {
    live.current = { scale: s, tx: x, ty: y };
    base.current = { scale: s, tx: x, ty: y };
    Animated.parallel([
      Animated.spring(scale, { toValue: s, useNativeDriver: true }),
      Animated.spring(tx, { toValue: x, useNativeDriver: true }),
      Animated.spring(ty, { toValue: y, useNativeDriver: true }),
    ]).start();
  }

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        pinchUnit.current = null;
        pinched.current = false;
      },
      onPanResponderMove: (e, g) => {
        const touches = e.nativeEvent.touches;
        if (touches.length >= 2) {
          pinched.current = true;
          const [a, b] = touches;
          const dist = Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
          if (pinchUnit.current == null) pinchUnit.current = dist / base.current.scale;
          const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, dist / pinchUnit.current));
          apply(s, clamp(base.current.tx, s, viewport.current.w), clamp(base.current.ty, s, viewport.current.h));
        } else if (!pinched.current && base.current.scale > 1) {
          // One-finger drag pans the zoomed image (a fresh drag after a pinch —
          // mid-gesture finger lifts would make dx jump).
          const s = live.current.scale;
          apply(
            s,
            clamp(base.current.tx + g.dx, s, viewport.current.w),
            clamp(base.current.ty + g.dy, s, viewport.current.h),
          );
        }
      },
      onPanResponderRelease: (_e, g) => {
        const wasTap = !pinched.current && Math.abs(g.dx) < 8 && Math.abs(g.dy) < 8;
        if (wasTap) {
          const now = Date.now();
          if (now - lastTap.current < DOUBLE_TAP_MS) {
            lastTap.current = 0;
            springTo(live.current.scale > 1.05 ? 1 : DOUBLE_TAP_SCALE, 0, 0);
            return;
          }
          lastTap.current = now;
        }
        if (live.current.scale <= 1.05) {
          springTo(1, 0, 0); // zoomed all the way back out → snap tidy
          return;
        }
        base.current = { ...live.current };
      },
    }),
  ).current;

  return (
    <View
      style={styles.fill}
      onLayout={(ev: LayoutChangeEvent) => {
        viewport.current = { w: ev.nativeEvent.layout.width, h: ev.nativeEvent.layout.height };
      }}
      {...responder.panHandlers}
    >
      <Animated.Image
        source={{ uri }}
        style={[styles.fill, { transform: [{ translateX: tx }, { translateY: ty }, { scale }] }]}
        resizeMode="contain"
        // Without this, ANY native decode failure renders as a silent black screen —
        // indistinguishable from a corrupt file, an unsupported format, or an OOM.
        // Surface it so the preview can show a diagnostic instead.
        onError={(e) => onError?.(e?.nativeEvent?.error ? String(e.nativeEvent.error) : "the image failed to decode")}
      />
    </View>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1, width: "100%" } });
