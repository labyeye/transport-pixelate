import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';

// Tokens live in the OS keychain/keystore; only non-secret data goes in AsyncStorage.
export const secure = {
  async getTokens() {
    try {
      const c = await Keychain.getGenericPassword();
      return c ? JSON.parse(c.password) : null;
    } catch {
      return null;
    }
  },
  async setTokens(tokens) {
    await Keychain.setGenericPassword('nest-transport', JSON.stringify(tokens));
  },
  async clearTokens() {
    try {
      await Keychain.resetGenericPassword();
    } catch {
      /* nothing stored */
    }
  },
};

export const store = {
  async get(key, fallback = null) {
    try {
      const v = await AsyncStorage.getItem(key);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  async set(key, value) {
    try {
      await AsyncStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage full or unavailable: the app keeps working in memory */
    }
  },
  async remove(key) {
    try {
      await AsyncStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};
