'use client';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError, createHomeBellClient, type HomeBellClient } from '@homebell/api-client';
import type { MockEnvironment, MockApp } from '@homebell/mocks';
import type { QueueFeed } from '@homebell/client-services';
import { errorMessage } from '@homebell/copy';
import { DevPanel, ToastProvider } from '@homebell/ui-web';

export type ApiMode = 'mock' | 'real';

export interface ApiContextValue {
  mode: ApiMode;
  client: HomeBellClient;
  mock: MockEnvironment | null;
  createQueueFeed: () => QueueFeed;
}

const ApiContext = createContext<ApiContextValue | null>(null);

export function useApi(): ApiContextValue {
  const v = useContext(ApiContext);
  if (!v) throw new Error('useApi must be used inside <ApiProvider>');
  return v;
}

/** Real-mode realtime (SignalR) arrives in Phase 4; until then real mode has no live feed. */
class UnavailableQueueFeed implements QueueFeed {
  state = 'disconnected' as const;
  async connect() {
    throw new Error('Realtime is connected in Phase 4');
  }
  async disconnect() {}
  onEvent() {
    return { unsubscribe() {} };
  }
  onStateChange() {
    return { unsubscribe() {} };
  }
  async join() {
    return { queueDate: '', latestSeq: 0, catchUp: 'snapshot' as const };
  }
  async subscribeClasses() {}
}

export function ApiProvider({
  app,
  mode,
  children,
  onUnauthorized,
}: {
  app: MockApp;
  mode: ApiMode;
  children: ReactNode;
  onUnauthorized?: () => void;
}) {
  const [value, setValue] = useState<ApiContextValue | null>(null);
  const queryClient = useMemo(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            refetchOnWindowFocus: false,
            retry: (count, err) =>
              !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
          },
          mutations: { retry: false },
        },
      }),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (mode === 'mock') {
        // Loaded lazily so real builds can tree-shake the mock layer.
        const { createBrowserMockEnvironment } = await import('@homebell/mocks/browser');
        const simulator =
          app === 'school'
            ? { createRequests: true, autoAcknowledge: true }
            : app === 'display'
              ? { createRequests: true, autoDispatch: true, autoAcknowledge: true }
              : false;
        const env = createBrowserMockEnvironment({ app, simulator });
        const client = createHomeBellClient({
          baseUrl: 'https://api.homebell.mock',
          fetch: env.fetch,
          onUnauthorized: () => onUnauthorized?.(),
        });
        if (!cancelled)
          setValue({ mode, client, mock: env, createQueueFeed: () => env.createQueueFeed() });
      } else {
        const client = createHomeBellClient({
          baseUrl: '/api/hb',
          onUnauthorized: () => onUnauthorized?.(),
        });
        if (!cancelled)
          setValue({ mode, client, mock: null, createQueueFeed: () => new UnavailableQueueFeed() });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [app, mode, onUnauthorized]);

  useEffect(() => () => value?.mock?.stop(), [value]);

  if (!value) return null;
  return (
    <ApiContext.Provider value={value}>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          {children}
          {value.mock && <MockPanel env={value.mock} onChange={() => queryClient.clear()} />}
        </ToastProvider>
      </QueryClientProvider>
    </ApiContext.Provider>
  );
}

function MockPanel({ env, onChange }: { env: MockEnvironment; onChange: () => void }) {
  const [current, setCurrent] = useState(env.currentScenario().id);
  return (
    <DevPanel
      scenarios={env.scenarios}
      current={current}
      onSelect={(id) => {
        env.setScenario(id);
        setCurrent(id);
        onChange();
        window.location.reload();
      }}
      onReset={() => {
        env.reset();
        onChange();
        window.location.reload();
      }}
    />
  );
}

/** Human message for any error thrown by the API client. */
export const messageFor = (err: unknown): string =>
  err instanceof ApiError ? errorMessage(err.code) : errorMessage(null);

/** Field errors from a VALIDATION_FAILED problem, keyed by field path. */
export function fieldErrors(err: unknown): Record<string, string> {
  if (!(err instanceof ApiError) || !err.problem?.errors) return {};
  return Object.fromEntries(err.problem.errors.map((e) => [e.field, e.message]));
}

/** Problem `detail` is shown only alongside the mapped message (e.g. validation hints). */
export const detailFor = (err: unknown): string | null =>
  err instanceof ApiError ? (err.problem?.detail ?? null) : null;

export { ApiError };
