import { useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import type { RootStackParamList } from "../navigation";
import { useAuth } from "../AuthContext";
import { PrivacyPolicy } from "../components/PrivacyPolicy";
import { MailboxSwitcher } from "../components/MailboxSwitcher";
import { BUILD_TAG } from "../buildInfo";
import { colors, fonts } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "Settings">;

export function SettingsScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { email, signOut, accounts } = useAuth();
  const [policyOpen, setPolicyOpen] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const multiple = accounts.length > 1;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn} hitSlop={8} accessibilityLabel="Back">
          <Ionicons name="arrow-back" size={24} color={colors.textMuted} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={styles.iconBtn} />
      </View>

      <View style={styles.content}>
        {/* Account */}
        <Text style={styles.sectionLabel}>ACCOUNT</Text>
        <View style={styles.card}>
          <View style={styles.avatar}>
            <Ionicons name="person" size={22} color={colors.heading} />
          </View>
          <View style={styles.accountInfo}>
            <Text style={styles.accountLabel}>Signed in as</Text>
            <Text style={styles.accountEmail} numberOfLines={1}>
              {email ?? "your mailbox"}
            </Text>
          </View>
        </View>

        {/* Mailboxes */}
        <Text style={[styles.sectionLabel, styles.sectionGap]}>MAILBOXES</Text>
        <TouchableOpacity style={styles.row} onPress={() => setSwitcherOpen(true)} activeOpacity={0.7}>
          <Ionicons name="mail-outline" size={20} color={colors.textMuted} />
          <Text style={styles.rowText}>{multiple ? "Switch or manage mailboxes" : "Add another mailbox"}</Text>
          <Text style={styles.count}>{accounts.length}</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </TouchableOpacity>

        {/* Legal */}
        <Text style={[styles.sectionLabel, styles.sectionGap]}>LEGAL</Text>
        <TouchableOpacity style={styles.row} onPress={() => setPolicyOpen(true)} activeOpacity={0.7}>
          <Ionicons name="shield-checkmark-outline" size={20} color={colors.textMuted} />
          <Text style={styles.rowText}>Privacy Policy</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </TouchableOpacity>

        <TouchableOpacity style={styles.signOut} onPress={signOut} activeOpacity={0.85}>
          <Ionicons name="log-out-outline" size={20} color={colors.danger} />
          <Text style={styles.signOutText}>{multiple ? "Sign out of all mailboxes" : "Sign out"}</Text>
        </TouchableOpacity>

        <View style={styles.footer}>
          <View style={styles.footerRow}>
            <Ionicons name="cloud-outline" size={14} color={colors.textMuted} />
            <Text style={styles.footerText}>MailPoppy · on your own AWS account</Text>
          </View>
          <Text style={styles.buildText}>{BUILD_TAG}</Text>
        </View>
      </View>

      <PrivacyPolicy visible={policyOpen} onClose={() => setPolicyOpen(false)} />
      <MailboxSwitcher visible={switcherOpen} onClose={() => setSwitcherOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 10,
    paddingBottom: 6,
  },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontFamily: fonts.bold, fontSize: 18, color: colors.text },
  content: { flex: 1, padding: 16 },
  sectionLabel: { fontFamily: fonts.semibold, fontSize: 11, letterSpacing: 1, color: colors.textMuted, marginBottom: 8, marginLeft: 4 },
  sectionGap: { marginTop: 24 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: colors.surface,
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
  rowText: { flex: 1, fontFamily: fonts.semibold, fontSize: 15, color: colors.text },
  count: { fontFamily: fonts.semibold, fontSize: 13, color: colors.textMuted, marginRight: 2 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 16,
  },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surfaceVariant, alignItems: "center", justifyContent: "center" },
  accountInfo: { flex: 1, minWidth: 0 },
  accountLabel: { fontFamily: fonts.regular, fontSize: 12, color: colors.textMuted },
  accountEmail: { fontFamily: fonts.semibold, fontSize: 16, color: colors.text, marginTop: 2 },
  signOut: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 52,
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: 24,
  },
  signOutText: { fontFamily: fonts.semibold, fontSize: 15, color: colors.danger },
  footer: { alignItems: "center", gap: 4, marginTop: "auto", paddingBottom: 16 },
  footerRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  footerText: { fontFamily: fonts.medium, fontSize: 12, color: colors.textMuted },
  buildText: { fontFamily: fonts.regular, fontSize: 10, color: colors.textMuted, textAlign: "center", paddingHorizontal: 24 },
});
