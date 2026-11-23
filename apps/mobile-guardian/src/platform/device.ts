import { Platform } from 'react-native';
import * as Application from 'expo-application';
import * as Crypto from 'expo-crypto';
import * as Device from 'expo-device';
import type { DeviceInfo } from '@homebell/contracts';
import type { DeviceIdentity } from '@homebell/client-services';
import { secureStore } from './secure-store';

/** The only module that inspects the OS for device identity (ADR-0017). */
export const platformName: DeviceInfo['platform'] = Platform.OS === 'ios' ? 'ios' : 'android';
export const isIOS = platformName === 'ios';

let cachedId: string | null = null;

/**
 * Install ID sent as X-Device-Id. Android: cleared on uninstall. iOS: the Keychain item can survive a
 * reinstall on the same phone (never migrates to another phone) — the server treats it as the same device.
 * Future: Keystore / Secure Enclave key pair + Play Integrity / App Attest.
 */
export const deviceIdentity: DeviceIdentity = {
  async getDeviceId() {
    if (cachedId) return cachedId;
    const stored = await secureStore.get('hb.installId');
    cachedId = stored ?? Crypto.randomUUID();
    if (!stored) await secureStore.set('hb.installId', cachedId);
    return cachedId;
  },
  async getDeviceInfo(): Promise<DeviceInfo> {
    return {
      platform: platformName,
      model: Device.modelName ?? (isIOS ? 'iPhone' : 'Android phone'),
      osVersion: Device.osVersion ?? 'unknown',
      appVersion: Application.nativeApplicationVersion ?? '1.0.0',
    };
  },
};

/** Synchronous accessor for the API client after the first `getDeviceId()` resolved. */
export const currentDeviceId = () => cachedId;
