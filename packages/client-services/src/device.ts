import type { DeviceInfo } from '@homebell/contracts';

/** Keys the apps may persist in secure storage. Nothing else goes in there. */
export type SecureStoreKey =
  'hb.installId' | 'hb.accessToken' | 'hb.refreshToken' | 'hb.sessionId' | 'hb.displayToken';

/**
 * Platform secure storage: expo-secure-store (Android Keystore / iOS Keychain) on mobile.
 * Never AsyncStorage. Web apps do not store tokens in the browser (BFF, ADR-0016).
 */
export interface SecureStore {
  get(key: SecureStoreKey): Promise<string | null>;
  set(key: SecureStoreKey, value: string): Promise<void>;
  delete(key: SecureStoreKey): Promise<void>;
}

/** Install identity sent as X-Device-Id. Future: Keystore-backed key pair + attestation. */
export interface DeviceIdentity {
  getDeviceId(): Promise<string>;
  getDeviceInfo(): Promise<DeviceInfo>;
}

/** Injectable clock so mocks and tests can simulate time (cooldowns, timeouts, windows). */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };
