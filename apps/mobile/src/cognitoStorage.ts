import AsyncStorage from "@react-native-async-storage/async-storage";

// amazon-cognito-identity-js expects a SYNCHRONOUS, Web-Storage-like object
// (getItem/setItem/removeItem/clear), but React Native's AsyncStorage is async.
// Bridge: keep a synchronous in-memory map for the library to read/write, and
// mirror every mutation to AsyncStorage so the session survives app restarts.
// Call hydrate() ONCE at startup, before the user pool reads a restored session.
const PREFIX = "@mailpoppy/cognito:";

class CognitoMemoryStorage {
  private data: Record<string, string> = {};

  setItem(key: string, value: string): void {
    this.data[key] = value;
    void AsyncStorage.setItem(PREFIX + key, value);
  }

  getItem(key: string): string | null {
    const v = this.data[key];
    return v === undefined ? null : v;
  }

  removeItem(key: string): void {
    delete this.data[key];
    void AsyncStorage.removeItem(PREFIX + key);
  }

  clear(): void {
    const persisted = Object.keys(this.data).map((k) => PREFIX + k);
    this.data = {};
    if (persisted.length > 0) void AsyncStorage.multiRemove(persisted);
  }

  /** Load any previously persisted Cognito session into the in-memory map. */
  async hydrate(): Promise<void> {
    const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(PREFIX));
    if (keys.length === 0) return;
    for (const [k, v] of await AsyncStorage.multiGet(keys)) {
      if (v != null) this.data[k.slice(PREFIX.length)] = v;
    }
  }
}

export const cognitoStorage = new CognitoMemoryStorage();
