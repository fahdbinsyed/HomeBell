import * as ExpoSecureStore from 'expo-secure-store';
import type { SecureStore, SecureStoreKey } from '@homebell/client-services';

/**
 * Android: values encrypted with the Android Keystore (expo-secure-store).
 * iOS: Keychain, WHEN_UNLOCKED_THIS_DEVICE_ONLY — never synced to iCloud or restored to another phone
 * (ADR-0017). Tokens are never written to AsyncStorage.
 */
const OPTIONS: ExpoSecureStore.SecureStoreOptions = {
  keychainAccessible: ExpoSecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export const secureStore: SecureStore = {
  get: (key: SecureStoreKey) => ExpoSecureStore.getItemAsync(key, OPTIONS),
  set: (key: SecureStoreKey, value: string) => ExpoSecureStore.setItemAsync(key, value, OPTIONS),
  delete: (key: SecureStoreKey) => ExpoSecureStore.deleteItemAsync(key, OPTIONS),
};
