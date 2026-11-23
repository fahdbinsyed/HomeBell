import * as ExpoSecureStore from 'expo-secure-store';
import { createMockBilling, mockStoreSheet } from '@/platform/billing/mock-store';
import { deviceIdentity } from '@/platform/device';
import { secureStore } from '@/platform/secure-store';

describe('platform adapters', () => {
  it('stores secrets with this-device-only Keychain accessibility', async () => {
    await secureStore.set('hb.accessToken', 'abc');
    expect(ExpoSecureStore.setItemAsync).toHaveBeenCalledWith('hb.accessToken', 'abc', {
      keychainAccessible: ExpoSecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
    expect(await secureStore.get('hb.accessToken')).toBe('abc');
  });

  it('creates a stable install id once', async () => {
    const a = await deviceIdentity.getDeviceId();
    const b = await deviceIdentity.getDeviceId();
    expect(a).toBe(b);
    expect(await secureStore.get('hb.installId')).toBe(a);
  });

  it('mock store sheet resolves the purchase outcome chosen by the user', async () => {
    const billing = createMockBilling('apple_app_store');
    expect(billing.provider).toBe('apple_app_store');
    const intent = {
      intentId: 'i',
      provider: 'apple_app_store' as const,
      productId: 'guardian_seat_term',
      appAccountToken: 'i',
      expiresAt: '',
      seatTermEndsAt: '',
    };
    const p = billing.purchase(intent);
    mockStoreSheet.settle({ status: 'cancelled' });
    await expect(p).resolves.toEqual({ status: 'cancelled' });
  });
});
