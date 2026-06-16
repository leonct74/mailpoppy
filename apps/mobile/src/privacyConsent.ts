import AsyncStorage from "@react-native-async-storage/async-storage";
import { PRIVACY_VERSION } from "./legal";

// Records that the user accepted the Privacy Policy before signing in. Stored as
// the accepted version number, so bumping PRIVACY_VERSION (a material policy
// change) re-prompts everyone. Best-effort: a storage failure just means the
// user is asked to accept again, never that they're let through silently.
const KEY = "@mailpoppy/privacy-accepted-version";

export async function hasAcceptedPrivacy(): Promise<boolean> {
  try {
    const v = await AsyncStorage.getItem(KEY);
    return v != null && Number(v) >= PRIVACY_VERSION;
  } catch {
    return false;
  }
}

export async function setPrivacyAccepted(): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, String(PRIVACY_VERSION));
  } catch {
    /* non-fatal — they'll just be asked again next launch */
  }
}
