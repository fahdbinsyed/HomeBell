/**
 * Mock environment: one per app process. Wires the DB, scenarios, MSW handlers, the mock
 * `fetch` transport (passed to @homebell/api-client), realtime feeds and the simulator.
 *
 * Transport: requests are resolved in-process with MSW's `getResponse(handlers, request)`
 * instead of a service worker / global patch. MSW 3 has no React Native entry, and an injected
 * fetch works identically on web, React Native and Node tests (ADR-0018).
 */
import { getResponse, type RequestHandler } from 'msw';
import { MockDb, type MockPersistence } from './db/db';
import { createSeed } from './db/seed';
import type { MockState } from './db/types';
import { authHandlers } from './http/auth';
import { createContext, ProblemError, problemResponse, type MockContext } from './http/context';
import { displayHandlers } from './http/display';
import { guardianHandlers } from './http/guardian';
import { platformHandlers } from './http/platform';
import { schoolHandlers } from './http/school';
import {
  MockDisplayFeed,
  MockGuardianFeed,
  MockQueueFeed,
  startSimulator,
  type SimulatorOptions,
} from './realtime';
import { scenarioById, SCENARIOS, type MockApp, type Scenario } from './scenarios';

export interface KeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export interface MockEnvironmentOptions {
  app: MockApp;
  /** Durable storage for the DB snapshot and active scenario (e.g. localStorage). */
  store?: KeyValueStore | null;
  /** Session-scoped storage for the simulated BFF session (e.g. sessionStorage). */
  sessionStore?: KeyValueStore | null;
  simulator?: SimulatorOptions | false;
}

export interface MockEnvironment {
  app: MockApp;
  db: MockDb;
  ctx: MockContext;
  handlers: RequestHandler[];
  fetch: typeof globalThis.fetch;
  scenarios: Scenario[];
  currentScenario(): Scenario;
  setScenario(id: string): void;
  reset(): void;
  createQueueFeed(): MockQueueFeed;
  createDisplayFeed(getToken: () => string | null): MockDisplayFeed;
  createGuardianFeed(getAccessToken: () => string | null): MockGuardianFeed;
  /**
   * Mock-only stand-in for the Phase 3 BFF token exchange: the platform portal hands a support
   * session to the school dashboard (separate origin → separate mock DB) via a URL payload.
   */
  importSupportSession(payload: SupportHandoff): boolean;
  stop(): void;
}

export interface SupportHandoff {
  tenantId: string;
  expiresAt: string;
  platformUserName: string;
  reason: string;
}

export const encodeSupportHandoff = (p: SupportHandoff): string =>
  btoa(encodeURIComponent(JSON.stringify(p)));
export const decodeSupportHandoff = (s: string): SupportHandoff | null => {
  try {
    return JSON.parse(decodeURIComponent(atob(s))) as SupportHandoff;
  } catch {
    return null;
  }
};

export function buildHandlers(ctx: MockContext): RequestHandler[] {
  return [
    ...authHandlers(ctx),
    ...platformHandlers(ctx),
    ...schoolHandlers(ctx),
    ...guardianHandlers(ctx),
    ...displayHandlers(ctx),
  ] as RequestHandler[];
}

export function createMockFetch(
  ctx: MockContext,
  handlers: RequestHandler[],
): typeof globalThis.fetch {
  return async (input, init) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const flags = ctx.scenario.flags ?? {};
    if (flags.networkFailure)
      throw new TypeError('Network request failed (scenario: network failure)');
    await new Promise((r) => setTimeout(r, flags.slowNetworkMs ?? 120 + Math.random() * 180));
    try {
      const response = await getResponse(handlers, request);
      if (response) return response;
    } catch (e) {
      if (e instanceof ProblemError) return problemResponse(e);
      console.error('[mock] handler error', e);
      return problemResponse(new ProblemError('INTERNAL_ERROR', String(e)));
    }
    return problemResponse(
      new ProblemError(
        'NOT_FOUND',
        `No mock handler for ${request.method} ${new URL(request.url).pathname}`,
      ),
    );
  };
}

export function createMockEnvironment(opts: MockEnvironmentOptions): MockEnvironment {
  const prefix = `hb.mock.${opts.app}`;
  const persistence: MockPersistence | null = opts.store
    ? {
        load: () => {
          try {
            const raw = opts.store!.get(`${prefix}.db`);
            const parsed = raw ? (JSON.parse(raw) as MockState) : null;
            return parsed?.version === 1 ? parsed : null;
          } catch {
            return null;
          }
        },
        save: (state) => {
          try {
            opts.store!.set(`${prefix}.db`, JSON.stringify(state));
          } catch {
            /* quota exceeded — keep running in memory */
          }
        },
        clear: () => opts.store!.remove(`${prefix}.db`),
      }
    : null;

  const db = new MockDb(createSeed, persistence);
  const ctx = createContext(db, opts.store?.get(`${prefix}.scenario`) ?? 'default');
  ctx.webSessionId = opts.sessionStore?.get(`${prefix}.session`) ?? null;
  ctx.onWebSessionChange = (id) =>
    id
      ? opts.sessionStore?.set(`${prefix}.session`, id)
      : opts.sessionStore?.remove(`${prefix}.session`);
  const handlers = buildHandlers(ctx);
  let stopSim = opts.simulator ? startSimulator(ctx, opts.simulator) : () => {};

  const env: MockEnvironment = {
    app: opts.app,
    db,
    ctx,
    handlers,
    fetch: createMockFetch(ctx, handlers),
    scenarios: SCENARIOS.filter((s) => s.apps.includes(opts.app)),
    currentScenario: () => ctx.scenario,
    setScenario(id) {
      ctx.scenario = scenarioById(id);
      opts.store?.set(`${prefix}.scenario`, ctx.scenario.id);
      db.reset();
      ctx.scenario.apply?.(db);
      // The dev panel reloads the page right after this, so save synchronously.
      db.flush();
    },
    reset() {
      db.reset();
      ctx.scenario.apply?.(db);
      db.flush();
      ctx.webSessionId = null;
      ctx.onWebSessionChange?.(null);
    },
    createQueueFeed: () => new MockQueueFeed(ctx),
    createDisplayFeed: (getToken) => new MockDisplayFeed(ctx, getToken),
    createGuardianFeed: (getAccessToken) => new MockGuardianFeed(ctx, getAccessToken),
    importSupportSession(p) {
      if (!db.tenant(p.tenantId) || p.expiresAt < db.nowIso()) return false;
      let user = db.state.users.find(
        (u) => u.fullName === p.platformUserName && u.platformRoles.length,
      );
      if (!user) {
        user = {
          id: db.id(),
          fullName: p.platformUserName,
          email: null,
          phone: null,
          password: null,
          platformRoles: ['platform.support_analyst'],
          platformStatus: 'active',
          mfaEnabled: true,
          locale: 'en',
          termsVersion: null,
          lastLoginAt: null,
        };
        db.state.users.push(user);
      }
      const id = db.id();
      db.state.sessions.push({
        id,
        userId: user.id,
        kind: 'support',
        scope: 'support.read_only',
        deviceId: null,
        accessToken: db.token('at'),
        refreshToken: db.token('rt'),
        accessExpiresAt: p.expiresAt,
        refreshExpiresAt: p.expiresAt,
        supportTenantId: p.tenantId,
        revokedAt: null,
      });
      db.state.supportSessions.push({
        id,
        tenantId: p.tenantId,
        platformUserId: user.id,
        reason: p.reason,
        startedAt: db.nowIso(),
        expiresAt: p.expiresAt,
        endedAt: null,
      });
      ctx.webSessionId = id;
      ctx.onWebSessionChange?.(id);
      db.touch();
      return true;
    },
    stop() {
      stopSim();
      stopSim = () => {};
    },
  };
  return env;
}
