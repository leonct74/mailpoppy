import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { colors, fonts } from "../theme";
import { PRIVACY_INTRO, PRIVACY_LAST_UPDATED, PRIVACY_SECTIONS } from "../legal";

/**
 * Full-screen, scrollable Privacy Policy. Rendered as a Modal so it works both
 * from the signed-out login screen (which is outside the navigation stack) and
 * from Settings. Content comes from src/legal.ts (the canonical copy).
 */
export function PrivacyPolicy({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <View style={styles.container}>
        <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
          <Text style={styles.title}>Privacy Policy</Text>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn} hitSlop={8} accessibilityLabel="Close">
            <Ionicons name="close" size={24} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}>
          <Text style={styles.updated}>Last updated: {PRIVACY_LAST_UPDATED}</Text>
          <Text style={styles.intro}>{PRIVACY_INTRO}</Text>
          {PRIVACY_SECTIONS.map((section) => (
            <View key={section.heading} style={styles.section}>
              <Text style={styles.heading}>{section.heading}</Text>
              {section.blocks.map((block, i) =>
                "ul" in block ? (
                  <View key={i} style={styles.list}>
                    {block.ul.map((item, j) => (
                      <View key={j} style={styles.listItem}>
                        <Text style={styles.bullet}>•</Text>
                        <Text style={styles.listText}>{item}</Text>
                      </View>
                    ))}
                  </View>
                ) : (
                  <Text key={i} style={styles.paragraph}>
                    {block.p}
                  </Text>
                ),
              )}
            </View>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: { fontFamily: fonts.bold, fontSize: 18, color: colors.text },
  closeBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: 20 },
  content: { padding: 20 },
  updated: { fontFamily: fonts.medium, fontSize: 12, color: colors.textMuted, marginBottom: 16 },
  intro: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 23, color: colors.text, marginBottom: 8 },
  section: { marginTop: 18 },
  heading: { fontFamily: fonts.bold, fontSize: 16, color: colors.heading, marginBottom: 8 },
  paragraph: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 22, color: colors.text, marginBottom: 10 },
  list: { marginBottom: 10, gap: 6 },
  listItem: { flexDirection: "row", gap: 8, paddingRight: 8 },
  bullet: { fontFamily: fonts.bold, fontSize: 14, lineHeight: 22, color: colors.primary },
  listText: { flex: 1, fontFamily: fonts.regular, fontSize: 14, lineHeight: 22, color: colors.text },
});
