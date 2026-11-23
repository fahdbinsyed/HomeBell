/** Browser wiring: DB snapshot + scenario in localStorage, simulated BFF session in sessionStorage. */
import {
  createMockEnvironment,
  type KeyValueStore,
  type MockEnvironment,
  type MockEnvironmentOptions,
} from './environment';

const wrap = (s: Storage | undefined): KeyValueStore | null =>
  s
    ? {
        get: (k) => {
          try {
            return s.getItem(k);
          } catch {
            return null;
          }
        },
        set: (k, v) => {
          try {
            s.setItem(k, v);
          } catch {
            /* storage unavailable */
          }
        },
        remove: (k) => {
          try {
            s.removeItem(k);
          } catch {
            /* storage unavailable */
          }
        },
      }
    : null;

export function createBrowserMockEnvironment(
  opts: Omit<MockEnvironmentOptions, 'store' | 'sessionStore'>,
): MockEnvironment {
  const hasWindow = typeof window !== 'undefined';
  return createMockEnvironment({
    ...opts,
    store: hasWindow ? wrap(window.localStorage) : null,
    sessionStore: hasWindow ? wrap(window.sessionStorage) : null,
  });
}

export * from './index';
