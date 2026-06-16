import { useEffect, useRef } from "react";
import { StatusBar } from "expo-status-bar";
import { ActivityIndicator, View } from "react-native";
import { NavigationContainer, createNavigationContainerRef } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { SafeAreaProvider } from "react-native-safe-area-context";
import * as Notifications from "expo-notifications";
import {
  useFonts,
  HankenGrotesk_400Regular,
  HankenGrotesk_500Medium,
  HankenGrotesk_600SemiBold,
  HankenGrotesk_700Bold,
} from "@expo-google-fonts/hanken-grotesk";
import type { Folder } from "@mailpoppy/core";
import type { RootStackParamList } from "./src/navigation";
import { AuthProvider, useAuth } from "./src/AuthContext";
import { LoginScreen } from "./src/screens/LoginScreen";
import { InboxScreen } from "./src/screens/InboxScreen";
import { MessageScreen } from "./src/screens/MessageScreen";
import { ComposeScreen } from "./src/screens/ComposeScreen";
import { SettingsScreen } from "./src/screens/SettingsScreen";
import { colors } from "./src/theme";

const Stack = createNativeStackNavigator<RootStackParamList>();
// Shared ref so we can navigate from a notification tap (outside any screen).
const navigationRef = createNavigationContainerRef<RootStackParamList>();

/** Open the message a notification refers to. Its `data` carries messageId/folder;
 *  the title/body carry sender/subject, reused as the initial header text. */
function openFromNotification(response: Notifications.NotificationResponse | null): boolean {
  if (!response || !navigationRef.isReady()) return false;
  const content = response.notification.request.content;
  const data = content.data as { messageId?: string; folder?: string } | undefined;
  if (!data?.messageId) return false;
  navigationRef.navigate("Message", {
    messageId: data.messageId,
    folder: (data.folder as Folder) ?? "inbox",
    subject: content.body ?? "",
    from: content.title ?? "",
  });
  return true;
}

function Root() {
  const { status } = useAuth();
  // A tap that arrived before the navigator was ready (cold start, or before
  // sign-in completes) is held here and replayed once we're signed in.
  const pending = useRef<Notifications.NotificationResponse | null>(null);

  // Taps while the app is running or backgrounded, plus the cold-start tap.
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      if (!openFromNotification(response)) pending.current = response;
    });
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response && !openFromNotification(response)) pending.current = response;
    });
    return () => sub.remove();
  }, []);

  // Once signed in and the navigator is mounted, replay any held tap.
  useEffect(() => {
    if (status !== "signed-in" || !pending.current) return;
    const replay = pending.current;
    // Defer a tick so the NavigationContainer has finished mounting.
    const t = setTimeout(() => {
      if (openFromNotification(replay)) pending.current = null;
    }, 0);
    return () => clearTimeout(t);
  }, [status]);

  if (status === "loading") {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (status === "signed-out") return <LoginScreen />;

  return (
    <NavigationContainer ref={navigationRef}>
      {/* Each screen renders its own header to match the redesign, so the native
          stack header is hidden. */}
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="Inbox" component={InboxScreen} />
        <Stack.Screen name="Message" component={MessageScreen} />
        <Stack.Screen name="Settings" component={SettingsScreen} />
        <Stack.Screen name="Compose" component={ComposeScreen} options={{ presentation: "modal" }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

export default function App() {
  // Load the Hanken Grotesk family. expo-font is part of the dev client already,
  // and the .ttf are bundled assets, so this needs no native rebuild. Render once
  // loaded OR on error (fall back to the system font rather than blocking).
  const [fontsLoaded, fontError] = useFonts({
    HankenGrotesk_400Regular,
    HankenGrotesk_500Medium,
    HankenGrotesk_600SemiBold,
    HankenGrotesk_700Bold,
  });
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      {fontsLoaded || fontError ? (
        <AuthProvider>
          <Root />
        </AuthProvider>
      ) : (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.primary} />
        </View>
      )}
    </SafeAreaProvider>
  );
}

const styles = {
  loading: { flex: 1, alignItems: "center" as const, justifyContent: "center" as const, backgroundColor: colors.bg },
};
