import { useEffect, useRef } from "react";
import { Animated, Easing, type StyleProp, type ImageStyle } from "react-native";

// The loading spinner: MailPoppy is a poppy, so its busy indicator is the poppy mark turning
// continuously, tinted to whatever colour the caller passes (the app's crimson by default). A
// drop-in replacement for React Native's <ActivityIndicator>, matching its `size`/`color` props.
//
// The mark is a white PNG (assets/poppy-spinner.png) recoloured via `tintColor`; the rotation runs
// on the native driver so it stays smooth without JS work.
const SRC = require("../../assets/poppy-spinner.png");

export function PoppySpinner({
  size = "small",
  color,
  style,
}: {
  size?: number | "small" | "large";
  color?: string;
  style?: StyleProp<ImageStyle>;
}) {
  const px = typeof size === "number" ? size : size === "large" ? 34 : 20;
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 1000, easing: Easing.linear, useNativeDriver: true }),
    );
    anim.start();
    return () => anim.stop();
  }, [spin]);

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });

  return (
    <Animated.Image
      source={SRC}
      accessibilityRole="image"
      accessibilityLabel="Loading"
      style={[{ width: px, height: px, transform: [{ rotate }] }, color ? { tintColor: color } : null, style]}
    />
  );
}
