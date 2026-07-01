import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../AuthContext";
import { ResolveError } from "../config";
import { Logo } from "../components/Logo";
import { PrivacyPolicy } from "../components/PrivacyPolicy";
import { hasAcceptedPrivacy, setPrivacyAccepted } from "../privacyConsent";
import { colors, fonts } from "../theme";

type Mode = "signin" | "newpw" | "forgot" | "reset";
type IconName = React.ComponentProps<typeof Ionicons>["name"];

export function LoginScreen() {
  const { signIn, completeNewPassword, requestPasswordReset, confirmPasswordReset } = useAuth();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Privacy Policy: must be accepted before the first sign-in (remembered after).
  const [accepted, setAccepted] = useState(false);
  const [policyOpen, setPolicyOpen] = useState(false);

  useEffect(() => {
    void hasAcceptedPrivacy().then(setAccepted);
  }, []);

  function toggleAccepted() {
    const next = !accepted;
    setAccepted(next);
    if (next) void setPrivacyAccepted(); // remember so returning users aren't re-prompted
  }

  function go(next: Mode) {
    setMode(next);
    setError(null);
  }

  async function onSignIn() {
    if (!email.trim() || !password || !accepted) return;
    setBusy(true);
    setError(null);
    try {
      const status = await signIn(email, password);
      if (status === "new-password-required") go("newpw");
    } catch (e) {
      setError(friendly(e));
    } finally {
      setBusy(false);
    }
  }

  async function onSetNewPassword() {
    if (!newPassword) return;
    setBusy(true);
    setError(null);
    try {
      await completeNewPassword(newPassword);
    } catch (e) {
      setError(friendly(e));
    } finally {
      setBusy(false);
    }
  }

  async function onRequestReset() {
    if (!email.trim()) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await requestPasswordReset(email);
      setResetCode("");
      setNewPassword("");
      setNotice(`We emailed a reset code to ${email.trim().toLowerCase()}.`);
      go("reset");
    } catch (e) {
      setError(friendly(e));
    } finally {
      setBusy(false);
    }
  }

  async function onConfirmReset() {
    if (!resetCode.trim() || !newPassword) return;
    setBusy(true);
    setError(null);
    try {
      await confirmPasswordReset(email, resetCode, newPassword);
      setPassword("");
      setNewPassword("");
      setResetCode("");
      setNotice("Password changed. Sign in with your new password.");
      go("signin");
    } catch (e) {
      setError(friendly(e));
    } finally {
      setBusy(false);
    }
  }

  const resetting = mode === "forgot" || mode === "reset";

  return (
    <SafeAreaView style={styles.safe}>
      {/* Ambient crimson glow behind the card */}
      <View style={styles.glow} pointerEvents="none" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Logo size="lg" style={styles.logo} />
          <Text style={styles.heading}>{resetting ? "Reset your password" : "Welcome Back"}</Text>
          <Text style={styles.subtitle}>
            {resetting ? "We'll get you back in" : "Sign in to manage your inbox"}
          </Text>

          {notice && (mode === "signin" || mode === "reset") ? (
            <Text style={styles.noticeOk}>{notice}</Text>
          ) : null}

          <View style={styles.card}>
            {mode === "signin" && (
              <>
                <Field
                  label="Email Address"
                  icon="mail-outline"
                  placeholder="you@yourdomain.com"
                  value={email}
                  onChangeText={setEmail}
                  editable={!busy}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  textContentType="username"
                />
                <Field
                  label="Password"
                  icon="lock-closed-outline"
                  placeholder="••••••••"
                  value={password}
                  onChangeText={setPassword}
                  editable={!busy}
                  secureTextEntry
                  textContentType="password"
                  onSubmitEditing={onSignIn}
                />
                <Consent
                  accepted={accepted}
                  onToggle={toggleAccepted}
                  onOpenPolicy={() => setPolicyOpen(true)}
                />
                <PrimaryButton
                  label="Sign In"
                  icon="arrow-forward"
                  busy={busy}
                  disabled={!accepted}
                  onPress={onSignIn}
                />
                <View style={styles.linkRow}>
                  <LinkButton label="Forgot Password?" onPress={() => go("forgot")} disabled={busy} />
                </View>
              </>
            )}

            {mode === "newpw" && (
              <>
                <Text style={styles.notice}>
                  This mailbox needs a new password to finish setup. Choose one now.
                </Text>
                <Field
                  label="New Password"
                  icon="lock-closed-outline"
                  placeholder="••••••••"
                  value={newPassword}
                  onChangeText={setNewPassword}
                  editable={!busy}
                  secureTextEntry
                  onSubmitEditing={onSetNewPassword}
                />
                <PrimaryButton label="Set password & sign in" busy={busy} onPress={onSetNewPassword} />
              </>
            )}

            {mode === "forgot" && (
              <>
                <Text style={styles.notice}>
                  Enter your mailbox address and we'll email you a code to reset your password.
                </Text>
                <Field
                  label="Email Address"
                  icon="mail-outline"
                  placeholder="you@yourdomain.com"
                  value={email}
                  onChangeText={setEmail}
                  editable={!busy}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  textContentType="username"
                  onSubmitEditing={onRequestReset}
                />
                <PrimaryButton label="Send reset code" busy={busy} onPress={onRequestReset} />
                <View style={styles.linkRow}>
                  <LinkButton label="Back to sign in" onPress={() => go("signin")} disabled={busy} />
                </View>
              </>
            )}

            {mode === "reset" && (
              <>
                <Field
                  label="Reset Code"
                  icon="key-outline"
                  placeholder="123456"
                  value={resetCode}
                  onChangeText={setResetCode}
                  editable={!busy}
                  keyboardType="number-pad"
                  autoCapitalize="none"
                  textContentType="oneTimeCode"
                />
                <Field
                  label="New Password"
                  icon="lock-closed-outline"
                  placeholder="••••••••"
                  value={newPassword}
                  onChangeText={setNewPassword}
                  editable={!busy}
                  secureTextEntry
                  textContentType="newPassword"
                  onSubmitEditing={onConfirmReset}
                />
                <PrimaryButton label="Reset password" busy={busy} onPress={onConfirmReset} />
                <View style={styles.linkRow}>
                  <LinkButton label="Resend code" onPress={() => go("forgot")} disabled={busy} />
                </View>
              </>
            )}

            {error && <Text style={styles.error}>{error}</Text>}
          </View>

          <View style={styles.footer}>
            <Ionicons name="cloud-outline" size={14} color={colors.textMuted} />
            <Text style={styles.footerText}>Runs on your own AWS account</Text>
            <Text style={styles.footerDot}>·</Text>
            <TouchableOpacity onPress={() => setPolicyOpen(true)} hitSlop={8}>
              <Text style={styles.footerLink}>Privacy Policy</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <PrivacyPolicy visible={policyOpen} onClose={() => setPolicyOpen(false)} />
    </SafeAreaView>
  );
}

/** The pre-sign-in consent row: a checkbox plus a tappable Privacy Policy link. */
function Consent({
  accepted,
  onToggle,
  onOpenPolicy,
}: {
  accepted: boolean;
  onToggle: () => void;
  onOpenPolicy: () => void;
}) {
  return (
    <View style={styles.consent}>
      <TouchableOpacity
        onPress={onToggle}
        style={styles.checkbox}
        hitSlop={8}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: accepted }}
        accessibilityLabel="I have read and agree to the Privacy Policy"
      >
        <Ionicons
          name={accepted ? "checkbox" : "square-outline"}
          size={22}
          color={accepted ? colors.primary : colors.textMuted}
        />
      </TouchableOpacity>
      <Text style={styles.consentText}>
        I have read and agree to the{" "}
        <Text style={styles.consentLink} onPress={onOpenPolicy}>
          Privacy Policy
        </Text>
        .
      </Text>
    </View>
  );
}

function Field({
  label,
  icon,
  ...input
}: { label: string; icon: IconName } & React.ComponentProps<typeof TextInput>) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label.toUpperCase()}</Text>
      <View style={styles.inputWrap}>
        <Ionicons name={icon} size={20} color={colors.textMuted} style={styles.inputIcon} />
        <TextInput
          style={styles.input}
          placeholderTextColor="rgba(229,189,182,0.45)"
          autoCorrect={false}
          {...input}
        />
      </View>
    </View>
  );
}

function PrimaryButton({
  label,
  icon,
  busy,
  disabled,
  onPress,
}: {
  label: string;
  icon?: IconName;
  busy: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.button, (busy || disabled) && styles.buttonDisabled]}
      onPress={onPress}
      disabled={busy || disabled}
      activeOpacity={0.85}
    >
      {busy ? (
        <ActivityIndicator color={colors.primaryText} />
      ) : (
        <>
          <Text style={styles.buttonText}>{label}</Text>
          {icon && <Ionicons name={icon} size={18} color={colors.primaryText} />}
        </>
      )}
    </TouchableOpacity>
  );
}

function LinkButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <TouchableOpacity onPress={onPress} disabled={disabled} hitSlop={8}>
      <Text style={styles.link}>{label}</Text>
    </TouchableOpacity>
  );
}

/** Turn Cognito errors into something a non-technical user can act on. */
function friendly(e: unknown): string {
  // The Hub already phrased these for humans (no active plan / domain not set up).
  if (e instanceof ResolveError) return e.message;
  const msg = e instanceof Error ? e.message : String(e);
  if (/UserNotFound|NotAuthorized|Incorrect username or password/i.test(msg))
    return "That email or password isn't right. Please try again.";
  if (/Password does not conform|InvalidPassword/i.test(msg))
    return "That password doesn't meet the requirements (min 8 chars, upper & lower case, a number and a symbol).";
  if (/CodeMismatch/i.test(msg)) return "That reset code isn't right. Check the email and try again.";
  if (/ExpiredCode/i.test(msg)) return "That reset code has expired. Request a new one.";
  if (/LimitExceeded|TooManyRequests/i.test(msg))
    return "Too many attempts. Please wait a few minutes and try again.";
  if (/Network|fetch|timeout/i.test(msg))
    return "Couldn't reach the server. Check your connection and try again.";
  return msg;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  glow: {
    position: "absolute",
    top: -120,
    left: -80,
    width: 360,
    height: 360,
    borderRadius: 360,
    backgroundColor: colors.primaryBright,
    opacity: 0.08,
  },
  scroll: { flexGrow: 1, justifyContent: "center", paddingHorizontal: 24, paddingVertical: 40 },
  logo: { alignSelf: "center", marginBottom: 24 },
  heading: {
    fontFamily: fonts.bold,
    fontSize: 24,
    color: colors.heading,
    textAlign: "center",
  },
  subtitle: {
    fontFamily: fonts.regular,
    fontSize: 15,
    color: colors.textMuted,
    textAlign: "center",
    marginTop: 6,
    marginBottom: 24,
  },
  card: {
    backgroundColor: colors.surfaceContainer,
    borderRadius: 16,
    padding: 22,
    borderWidth: 1,
    borderColor: colors.border,
  },
  field: { marginBottom: 16 },
  fieldLabel: {
    fontFamily: fonts.semibold,
    fontSize: 11,
    letterSpacing: 1,
    color: colors.textMuted,
    marginBottom: 6,
    marginLeft: 2,
  },
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surfaceHigh,
    borderRadius: 12,
    height: 54,
    paddingHorizontal: 14,
  },
  inputIcon: { marginRight: 10 },
  input: { flex: 1, fontFamily: fonts.regular, fontSize: 16, color: colors.text, padding: 0 },
  button: {
    flexDirection: "row",
    gap: 8,
    backgroundColor: colors.primary,
    borderRadius: 14,
    height: 54,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 6,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { fontFamily: fonts.bold, color: colors.primaryText, fontSize: 15, letterSpacing: 0.3 },
  linkRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 16, paddingHorizontal: 2 },
  link: { fontFamily: fonts.semibold, fontSize: 13, color: colors.heading },
  notice: { fontFamily: fonts.regular, fontSize: 14, color: colors.textMuted, marginBottom: 16, lineHeight: 20 },
  noticeOk: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.text,
    backgroundColor: colors.surfaceContainer,
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    lineHeight: 20,
    borderWidth: 1,
    borderColor: colors.border,
  },
  error: { fontFamily: fonts.regular, color: colors.danger, marginTop: 16, textAlign: "center", lineHeight: 20 },
  consent: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginTop: 4, marginBottom: 12, paddingHorizontal: 2 },
  checkbox: { paddingTop: 1 },
  consentText: { flex: 1, fontFamily: fonts.regular, fontSize: 13, lineHeight: 20, color: colors.textMuted },
  consentLink: { fontFamily: fonts.semibold, color: colors.heading },
  footer: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 28 },
  footerText: { fontFamily: fonts.medium, fontSize: 11, color: colors.textMuted },
  footerDot: { fontFamily: fonts.medium, fontSize: 11, color: colors.textMuted },
  footerLink: { fontFamily: fonts.semibold, fontSize: 11, color: colors.heading },
});
