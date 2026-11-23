/**
 * Display token storage (ADR-0013). IndexedDB via idb-keyval — not localStorage — so the token isn't
 * exposed to casual inspection scripts that read localStorage. Phase 3 may move it behind an httpOnly
 * cookie on the display app's own BFF.
 */
import { del, get, set } from 'idb-keyval';

const KEY = 'hb.displayToken';

export const loadToken = async (): Promise<string | null> => {
  try {
    return (await get<string>(KEY)) ?? null;
  } catch {
    return null;
  }
};
export const saveToken = (token: string) => set(KEY, token).catch(() => undefined);
export const clearToken = () => del(KEY).catch(() => undefined);
