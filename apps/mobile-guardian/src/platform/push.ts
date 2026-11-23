import type {
  IncomingPush,
  PushPermission,
  PushService,
  PushToken,
} from '@homebell/client-services';

/**
 * Phase 1 mock PushService: in-app banners fed by the guardian realtime feed. Phase 7 swaps in the FCM
 * adapter (expo-notifications device token on Android and iOS via APNs) behind this interface.
 */
const pushListeners = new Set<(p: IncomingPush) => void>();
let permission: PushPermission = 'undetermined';

export const pushService: PushService & { emit(p: IncomingPush): void } = {
  getPermission: async () => permission,
  requestPermission: async () => (permission = 'granted'),
  getToken: async (): Promise<PushToken | null> =>
    permission === 'granted' ? { provider: 'fcm', token: 'mock-fcm-token' } : null,
  onTokenRefresh: () => ({ unsubscribe() {} }),
  onPush(listener) {
    pushListeners.add(listener);
    return { unsubscribe: () => pushListeners.delete(listener) };
  },
  emit(p) {
    pushListeners.forEach((l) => l(p));
  },
};
