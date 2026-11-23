import { ERROR_CATALOG, type ErrorCode, type Permission, type Problem } from '@homebell/contracts';
import { HttpResponse, type HttpResponseResolver, type PathParams } from 'msw';
import type { MockDb } from '../db/db';
import type { ActorRecord, SessionRecord } from '../db/types';
import { scenarioById, type Scenario } from '../scenarios';
import { permissionsForPlatformRoles, permissionsForSchoolRole } from '../rules/permissions';
import { OPERATIONAL_MODE } from '../rules/lifecycle';

export interface MockContext {
  db: MockDb;
  scenario: Scenario;
  /**
   * Simulated BFF session for web apps (ADR-0016): the browser never holds tokens, so web
   * requests carry no Authorization header and resolve to this session instead.
   */
  webSessionId: string | null;
  onWebSessionChange?: (id: string | null) => void;
}

export function createContext(db: MockDb, scenarioId = 'default'): MockContext {
  return { db, scenario: scenarioById(scenarioId), webSessionId: null };
}

export class ProblemError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly detail?: string,
    readonly meta?: Record<string, unknown>,
    readonly errors?: Problem['errors'],
  ) {
    super(code);
  }
}

export const fail = (code: ErrorCode, detail?: string, meta?: Record<string, unknown>): never => {
  throw new ProblemError(code, detail, meta);
};

export const invalid = (field: string, message: string): never => {
  throw new ProblemError('VALIDATION_FAILED', message, undefined, [
    { field, code: 'invalid', message },
  ]);
};

export function problemResponse(e: ProblemError): Response {
  const info = ERROR_CATALOG[e.code];
  const body: Problem = {
    type: `https://docs.homebell.app/errors/${e.code.toLowerCase().replace(/_/g, '-')}`,
    title: info.description,
    status: info.status,
    code: e.code,
    traceId: `mock-${Math.random().toString(16).slice(2, 10)}`,
    ...(e.detail ? { detail: e.detail } : {}),
    ...(e.meta ? { meta: e.meta } : {}),
    ...(e.errors ? { errors: e.errors } : {}),
  };
  const headers: Record<string, string> = { 'Content-Type': 'application/problem+json' };
  if (info.status === 429 && typeof e.meta?.retryAfterSeconds === 'number')
    headers['Retry-After'] = String(e.meta.retryAfterSeconds);
  return new HttpResponse(JSON.stringify(body), { status: info.status, headers });
}

type ResolverInfo = Parameters<HttpResponseResolver<PathParams>>[0];

/** Wrap a resolver so ProblemError becomes a problem+json response. */
export function handle(
  fn: (info: ResolverInfo) => Promise<Response> | Response,
): HttpResponseResolver<PathParams> {
  return async (info) => {
    try {
      return await fn(info);
    } catch (e) {
      if (e instanceof ProblemError) return problemResponse(e);
      throw e;
    }
  };
}

export const json = <T>(body: T, status = 200, headers?: Record<string, string>) =>
  HttpResponse.json(body as never, { status, ...(headers ? { headers } : {}) });
export const noContent = () => new HttpResponse(null, { status: 204 });

export async function body<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    return fail('BAD_REQUEST', 'Body must be JSON');
  }
}

// ── sessions ───────────────────────────────────────────────
export function findSession(ctx: MockContext, request: Request): SessionRecord | null {
  const auth = request.headers.get('Authorization');
  const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
  const s = token
    ? ctx.db.state.sessions.find((x) => x.accessToken === token)
    : ctx.webSessionId
      ? ctx.db.state.sessions.find((x) => x.id === ctx.webSessionId)
      : undefined;
  return s ?? null;
}

export function requireSession(
  ctx: MockContext,
  request: Request,
  kinds?: SessionRecord['kind'][],
): SessionRecord {
  const s = findSession(ctx, request);
  if (!s) return fail('UNAUTHENTICATED');
  if (s.revokedAt) return fail(s.deviceId ? 'DEVICE_REVOKED' : 'SESSION_REVOKED');
  if (
    s.kind === 'support' &&
    ctx.db.state.supportSessions.find((x) => x.id === s.id)?.expiresAt! < ctx.db.nowIso()
  )
    return fail('SUPPORT_SESSION_EXPIRED');
  if (kinds && !kinds.includes(s.kind)) return fail('FORBIDDEN');
  if (s.deviceId) {
    const dev = ctx.db.state.devices.find((d) => d.id === s.deviceId);
    if (dev && dev.state !== 'active') return fail('DEVICE_REVOKED');
    const header = request.headers.get('X-Device-Id');
    if (header && header !== s.deviceId) return fail('DEVICE_MISMATCH');
  }
  return s;
}

export function actorOf(ctx: MockContext, s: SessionRecord): ActorRecord {
  const u = ctx.db.user(s.userId);
  return {
    type: s.kind === 'support' ? 'support' : 'user',
    id: s.userId,
    displayName: u?.fullName ?? 'Unknown',
  };
}

export function requirePlatform(
  ctx: MockContext,
  request: Request,
  permission: Permission,
  write = false,
): SessionRecord {
  const s = requireSession(ctx, request, ['platform']);
  const u = ctx.db.user(s.userId)!;
  if (!permissionsForPlatformRoles(u.platformRoles).includes(permission))
    return fail('FORBIDDEN', `Requires ${permission}`);
  if (write && ctx.scenario.flags?.permissionDenied)
    return fail('FORBIDDEN', 'Scenario: permission denied');
  return s;
}

/**
 * Staff access to a tenant: membership (or support session) + permission + lifecycle gate.
 * Foreign tenants → 404 (never 403) to avoid enumeration.
 */
export function requireStaff(
  ctx: MockContext,
  request: Request,
  tenantId: string,
  permission: Permission,
  write = false,
): SessionRecord {
  const s = requireSession(ctx, request, ['staff', 'support']);
  const t = ctx.db.tenant(tenantId);
  if (!t) return fail('NOT_FOUND');
  if (s.kind === 'support') {
    if (s.supportTenantId !== tenantId) return fail('NOT_FOUND');
    if (write) return fail('SCOPE_INSUFFICIENT', 'Support sessions are read-only');
    return s;
  }
  const m = ctx.db.state.memberships.find(
    (x) => x.userId === s.userId && x.tenantId === tenantId && x.status === 'active',
  );
  if (!m) return fail('NOT_FOUND');
  if (!permissionsForSchoolRole(m.role).includes(permission))
    return fail('FORBIDDEN', `Requires ${permission}`);
  const mode = OPERATIONAL_MODE[t.state];
  if (mode === 'blocked')
    return fail('TENANT_NOT_OPERATIONAL', undefined, { state: t.state, operationalMode: mode });
  if (write && mode !== 'full' && mode !== 'setup')
    return fail('TENANT_READ_ONLY', undefined, { state: t.state });
  if (write && ctx.scenario.flags?.permissionDenied)
    return fail('FORBIDDEN', 'Scenario: permission denied');
  return s;
}

export function requireGuardian(
  ctx: MockContext,
  request: Request,
  allowLimited = false,
): SessionRecord {
  if (!request.headers.get('X-Device-Id')) return fail('DEVICE_ID_REQUIRED');
  const s = requireSession(ctx, request, ['guardian']);
  if (s.scope !== 'full' && !allowLimited) return fail('SCOPE_INSUFFICIENT');
  return s;
}

// ── pagination ─────────────────────────────────────────────
export function page<T>(items: T[], url: URL, defaultLimit = 25) {
  const limit = Math.min(
    100,
    Math.max(1, Number(url.searchParams.get('limit') ?? defaultLimit) || defaultLimit),
  );
  const cursor = url.searchParams.get('cursor');
  const offset = cursor ? Number(atobSafe(cursor)) || 0 : 0;
  const slice = items.slice(offset, offset + limit);
  const next = offset + limit < items.length ? btoaSafe(String(offset + limit)) : null;
  return { items: slice, nextCursor: next, limit, totalEstimate: items.length };
}
const btoaSafe = (s: string) => btoa(s);
const atobSafe = (s: string) => atob(s);

export const q = (url: URL, name: string) => url.searchParams.get(name) || null;
export const matches = (needle: string | null, ...hay: Array<string | null | undefined>) =>
  !needle || hay.some((h) => h?.toLowerCase().includes(needle.toLowerCase()));
export const inRange = (iso: string, from: string | null, to: string | null) =>
  (!from || iso.slice(0, 10) >= from) && (!to || iso.slice(0, 10) <= to);

// ── idempotency ────────────────────────────────────────────
export async function idempotent(
  ctx: MockContext,
  request: Request,
  scope: string,
  run: (rawBody: string) => Promise<Response> | Response,
): Promise<Response> {
  const key = request.headers.get('Idempotency-Key');
  if (!key) return fail('IDEMPOTENCY_KEY_REQUIRED');
  const raw = await request.clone().text();
  const storeKey = `${scope}:${key}`;
  const prior = ctx.db.state.idempotency[storeKey];
  if (prior) {
    if (prior.hash !== raw) return fail('IDEMPOTENCY_KEY_REUSED');
    return HttpResponse.json(prior.body as never, {
      status: prior.status,
      headers: { 'Idempotent-Replayed': 'true' },
    });
  }
  const response = await run(raw);
  if (response.status < 500) {
    const text = await response.clone().text();
    ctx.db.state.idempotency[storeKey] = {
      hash: raw,
      status: response.status,
      body: text ? JSON.parse(text) : null,
    };
  }
  return response;
}
