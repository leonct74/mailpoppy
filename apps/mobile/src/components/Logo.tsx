import { View, Text, Image, StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import { colors, fonts } from "../theme";

type Size = "sm" | "md" | "lg";

const DIMS: Record<Size, { mark: number; font: number; gap: number }> = {
  sm: { mark: 30, font: 22, gap: 8 },
  md: { mark: 40, font: 24, gap: 10 },
  lg: { mark: 88, font: 0, gap: 0 },
};

/**
 * The Mailpoppy brand lockup — the "M" mark next to the crimson "MailPoppy"
 * wordmark (Crimson Navy design). At `lg` the mark sits in a rounded surface
 * tile (used on the login screen) and the wordmark is omitted.
 */
export function Logo({
  size = "md",
  showWordmark = true,
  style,
}: {
  size?: Size;
  showWordmark?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const d = DIMS[size];
  if (size === "lg") {
    return (
      <View style={[styles.tile, style]} accessibilityLabel="Mailpoppy">
        <Image
          source={require("../../assets/logo-mark.png")}
          style={styles.tileMark}
          resizeMode="contain"
        />
      </View>
    );
  }
  return (
    <View style={[styles.row, { gap: d.gap }, style]} accessibilityLabel="Mailpoppy">
      <Image
        source={require("../../assets/logo-mark.png")}
        style={{ width: d.mark, height: d.mark }}
        resizeMode="contain"
      />
      {showWordmark && (
        <Text style={[styles.wordmark, { fontSize: d.font }]} numberOfLines={1}>
          MailPoppy
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  wordmark: { fontFamily: fonts.bold, color: colors.primary, letterSpacing: -0.3 },
  tile: {
    width: 128,
    height: 128,
    borderRadius: 24,
    backgroundColor: colors.surfaceContainer,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  tileMark: { width: 88, height: 88 },
});
