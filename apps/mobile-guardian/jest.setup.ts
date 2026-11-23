// Mimic Hermes: React Native has no DOM event globals. Removing them here makes any dependency
// that needs them (e.g. the real MSW) fail in tests the same way it fails on a phone.
for (const name of ['MessageEvent', 'BroadcastChannel', 'EventTarget', 'Event', 'CustomEvent']) {
  delete (globalThis as Record<string, unknown>)[name];
}

// In-memory stand-ins for native modules in unit tests (jest-expo runs without native code).
const mockStore = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
  getItemAsync: jest.fn(async (k: string) => mockStore.get(k) ?? null),
  setItemAsync: jest.fn(async (k: string, v: string) => void mockStore.set(k, v)),
  deleteItemAsync: jest.fn(async (k: string) => void mockStore.delete(k)),
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => '11111111-2222-4333-8444-555555555555' }));
jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  getCurrentPositionAsync: jest.fn(async () => ({
    coords: { latitude: 40.71, longitude: -74.0, accuracy: 10 },
    timestamp: Date.now(),
  })),
  Accuracy: { High: 4 },
}));
