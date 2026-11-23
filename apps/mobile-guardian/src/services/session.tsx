import Constants from 'expo-constants';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError, createGuardianClient, unwrap, type GuardianClient } from '@homebell/api-client';
import type { ErrorCode, Me, TokenPair } from '@homebell/contracts';
import type {
  BillingService,
  DeviceIdentity,
  GuardianFeed,
  SecureStore,
} from '@homebell/client-services';
import { createMockEnvironment, type MockEnvironment } from '@homebell/mocks/native';
import { labels } from '@homebell/copy';
import { billing } from '@/platform/billing';
import { currentDeviceId, deviceIdentity } from '@/platform/device';
import { pushService } from '@/platform/push';
import { secureStore } from '@/platform/secure-store';

type Status = 'loading' | 'signedOut' | 'signedIn';

export interface Services {
  client: GuardianClient;
  mock: MockEnvironment | null;
  secureStore: SecureStore;
  device: DeviceIdentity;
  billing: BillingService;
  push: typeof pushService;
}

interface SessionValue {
  status: Status;
  me: Me | null;
  /** Limited purchase-only session from a device conflict (ADR-0017 / 03-identity §4). */
  limited: boolean;
  signOutReason: ErrorCode | null;
  signIn: (tokens: TokenPair, me?: Me) => Promise<void>;
  signOut: (reason?: ErrorCode) => Promise<void>;
  refreshMe: () => Promise<void>;
  services: Services;
}

const SessionContext = createContext<SessionValue | null>(null);
export const useSession = () => {
  const v = useContext(SessionContext);
  if (!v) throw new Error('useSession outside SessionProvider');
  return v;
};
export const useServices = () => useSession().services;

const extra = (Constants.expoConfig?.extra ?? {}) as { apiMode?: string; apiBaseUrl?: string };
const MODE =
  (process.env.EXPO_PUBLIC_HB_API_MODE ?? extra.apiMode ?? 'mock') === 'real' ? 'real' : 'mock';
const FATAL: ErrorCode[] = [
  'DEVICE_REVOKED',
  'SESSION_REVOKED',
  'REFRESH_TOKEN_INVALID',
  'REFRESH_TOKEN_REUSED',
  'DEVICE_MISMATCH',
];

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2,
    },
    mutations: { retry: false },
  },
});

export function SessionProvider({ children }: { children: ReactNode }) {
  const tokens = useRef<TokenPair | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [me, setMe] = useState<Me | null>(null);
  const [signOutReason, setSignOutReason] = useState<ErrorCode | null>(null);
  const refreshing = useRef<Promise<boolean> | null>(null);

  const mock = useMemo(
    () =>
      MODE === 'mock'
        ? createMockEnvironment({
            app: 'guardian',
            simulator: {
              autoDispatch: true,
              dispatchForUserId: () => meRef.current?.userId ?? null,
            },
          })
        : null,
    [],
  );
  const meRef = useRef<Me | null>(null);
  meRef.current = me;

  const clearLocal = useCallback(async (reason?: ErrorCode) => {
    tokens.current = null;
    await Promise.all([
      secureStore.delete('hb.accessToken'),
      secureStore.delete('hb.refreshToken'),
      secureStore.delete('hb.sessionId'),
    ]);
    queryClient.clear();
    setMe(null);
    setSignOutReason(reason ?? null);
    setStatus('signedOut');
  }, []);

  const client = useMemo(() => {
    const c = createGuardianClient({
      baseUrl: extra.apiBaseUrl ?? 'https://api.homebell.app',
      ...(mock ? { fetch: mock.fetch } : {}),
      getAccessToken: () => tokens.current?.accessToken ?? null,
      getDeviceId: () => currentDeviceId() ?? deviceIdentity.getDeviceId(),
      onUnauthorized: (problem) => {
        if (!tokens.current) return;
        if (problem && FATAL.includes(problem.code)) return void clearLocal(problem.code);
        void tryRefresh();
      },
    });
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mock]);

  const persist = async (t: TokenPair) => {
    tokens.current = t;
    await Promise.all([
      secureStore.set('hb.accessToken', t.accessToken),
      secureStore.set('hb.refreshToken', t.refreshToken),
      secureStore.set('hb.sessionId', t.sessionId),
    ]);
  };

  const tryRefresh = useCallback(async (): Promise<boolean> => {
    if (refreshing.current) return refreshing.current;
    refreshing.current = (async () => {
      const refreshToken =
        tokens.current?.refreshToken ?? (await secureStore.get('hb.refreshToken'));
      if (!refreshToken) return false;
      try {
        const t = await unwrap(client.POST('/v1/auth/refresh', { body: { refreshToken } }));
        await persist(t);
        return true;
      } catch (e) {
        await clearLocal(
          e instanceof ApiError && FATAL.includes(e.code as ErrorCode)
            ? (e.code as ErrorCode)
            : 'TOKEN_EXPIRED',
        );
        return false;
      } finally {
        refreshing.current = null;
      }
    })();
    return refreshing.current;
  }, [client, clearLocal]);

  const refreshMe = useCallback(async () => {
    const m = await unwrap(client.GET('/v1/me/profile'));
    setMe(m);
  }, [client]);

  // Restore session on launch.
  useEffect(() => {
    (async () => {
      await deviceIdentity.getDeviceId();
      const [accessToken, refreshToken, sessionId] = await Promise.all([
        secureStore.get('hb.accessToken'),
        secureStore.get('hb.refreshToken'),
        secureStore.get('hb.sessionId'),
      ]);
      if (!accessToken || !refreshToken) return setStatus('signedOut');
      tokens.current = {
        accessToken,
        refreshToken,
        sessionId: sessionId ?? '',
        accessTokenExpiresAt: '',
        refreshTokenExpiresAt: '',
        scope: 'full',
      };
      try {
        setMe(await unwrap(client.GET('/v1/me/profile')));
        setStatus('signedIn');
      } catch {
        // Mock data lives in memory, so a stored token from a previous launch is unknown — sign in again.
        await clearLocal();
      }
    })();
  }, [client, clearLocal]);

  // Guardian realtime feed (mock now; SignalR in Phase 4) → cache refresh, banners, forced sign-out.
  useEffect(() => {
    if (status !== 'signedIn' || !mock) return;
    const feed: GuardianFeed = mock.createGuardianFeed(() => tokens.current?.accessToken ?? null);
    const sub = feed.onEvent((e) => {
      if (e.type === 'session.revoked') return void clearLocal('DEVICE_REVOKED');
      void queryClient.invalidateQueries();
      if (e.type === 'guardian.request.status_changed') {
        const r = e.data.request;
        pushService.emit({
          type: 'pickup_status',
          title: `${r.studentFirstName}: ${labels.pickupState[r.state]}`,
          body: r.statusMessage ?? '',
          data: { pickupRequestId: r.id },
          opened: false,
        });
      }
      if (e.type === 'guardian.access.changed')
        pushService.emit({
          type: 'access_changed',
          title: 'Access changed',
          body: `Your access is now ${labels.guardianState[e.data.state].toLowerCase()}.`,
          data: {},
          opened: false,
        });
    });
    void feed.connect();
    return () => {
      sub.unsubscribe();
      void feed.disconnect();
    };
  }, [status, mock, clearLocal]);

  const value: SessionValue = {
    status,
    me,
    limited: me?.session.scope === 'guardian.license_purchase',
    signOutReason,
    signIn: async (t, m) => {
      await persist(t);
      setSignOutReason(null);
      setMe(m ?? (await unwrap(client.GET('/v1/me/profile'))));
      setStatus('signedIn');
    },
    signOut: async (reason) => {
      try {
        await client.POST('/v1/auth/logout');
      } catch {
        /* signing out locally regardless */
      }
      await clearLocal(reason);
    },
    refreshMe,
    services: { client, mock, secureStore, device: deviceIdentity, billing, push: pushService },
  };
  return (
    <QueryClientProvider client={queryClient}>
      <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
    </QueryClientProvider>
  );
}
