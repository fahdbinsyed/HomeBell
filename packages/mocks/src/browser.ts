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
  const env = createMockEnvironment({
    ...opts,
    store: hasWindow ? wrap(window.localStorage) : null,
    sessionStore: hasWindow ? wrap(window.sessionStorage) : null,
  });
  if (hasWindow) {
    // Several tabs of the same app share one DB snapshot. Without this, each tab saves its own
    // in-memory copy over the others' (e.g. dropping another tab's sign-in session), so a refresh
    // there signs the user out. Adopt the newer snapshot whenever another tab writes it.
    const key = `hb.mock.${opts.app}.db`;
    window.addEventListener('storage', (e) => {
      if (e.key !== key || !e.newValue) return;
      try {
        const next = JSON.parse(e.newValue) as typeof env.db.state;
        if (next?.version === 1) env.db.state = next;
      } catch {
        /* ignore malformed snapshots */
      }
    });
  }
  return env;
}

export * from './index';
