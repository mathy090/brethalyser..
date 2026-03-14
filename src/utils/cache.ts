import AsyncStorage from "@react-native-async-storage/async-storage";

// Only for non-sensitive flags (e.g. verified status, preferences)
// Secrets always go to secureStorage.ts (Keychain)
const PREFIX = "blowsafe_";

export const Cache = {
  set: async (key: string, value: unknown): Promise<void> => {
    await AsyncStorage.setItem(PREFIX + key, JSON.stringify(value));
  },

  get: async <T = unknown>(key: string): Promise<T | null> => {
    const raw = await AsyncStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : null;
  },

  remove: async (key: string): Promise<void> => {
    await AsyncStorage.removeItem(PREFIX + key);
  },

  clear: async (): Promise<void> => {
    const keys = await AsyncStorage.getAllKeys();
    const mine = keys.filter((k) => k.startsWith(PREFIX));
    if (mine.length) await AsyncStorage.multiRemove(mine);
  },
};