/**
 * Mock realtime feeds implementing the @homebell/client-services interfaces, plus a background
 * simulator that produces dismissal activity. The feeds deliver the same envelopes as the
 * SignalR hubs (realtime.asyncapi.yaml) and support a simulated connection drop so clients
 * exercise their gap detection + HTTP catch-up path.
 */
import type {
  JoinTenantQueueArgs,
  JoinTenantQueueResult,
  RealtimeEvent,
} from '@homebell/contracts';
import type {
  ConnectionState,
  DisplayFeedChannel,
  DisplayFeedEvent,
  GuardianFeed,
  GuardianFeedEvent,
  QueueFeed,
  QueueFeedEvent,
  Subscription,
} from '@homebell/client-services';
import type { EventAudience, MockDb } from './db/db';
import { acknowledge, createPickup, sendOut, sweepTimeouts } from './dismissal';
import type { MockContext } from './http/context';
import { OPEN_STATES } from './rules/eligibility';
import { isOperational } from './rules/lifecycle';

abstract class MockFeedBase<E extends RealtimeEvent> {
  private _state: ConnectionState = 'idle';
  private listeners = new Set<(e: E) => void>();
  private stateListeners = new Set<(s: ConnectionState) => void>();
  private unsub: (() => void) | null = null;
  private droppedUntil = 0;

  constructor(protected readonly ctx: MockContext) {}

  get state(): ConnectionState {
    return this._state;
  }
  protected setState(s: ConnectionState): void {
    this._state = s;
    for (const l of this.stateListeners) l(s);
  }
  protected abstract accepts(event: RealtimeEvent, audience: EventAudience): boolean;

  async connect(): Promise<void> {
    if (this.unsub) return;
    this.setState('connecting');
    await new Promise((r) => setTimeout(r, 300));
    if (this.ctx.scenario.flags?.networkFailure) {
      this.setState('reconnecting');
      throw new Error('Realtime connection failed (scenario: network failure)');
    }
    this.unsub = this.ctx.db.subscribe((event, audience) => {
      if (Date.now() < this.droppedUntil) return; // events lost while "disconnected"
      if (this.accepts(event, audience)) for (const l of this.listeners) l(event as E);
    });
    this.setState('connected');
  }
  async disconnect(): Promise<void> {
    this.unsub?.();
    this.unsub = null;
    this.setState('disconnected');
  }
  onEvent(listener: (event: E) => void): Subscription {
    this.listeners.add(listener);
    return { unsubscribe: () => this.listeners.delete(listener) };
  }
  onStateChange(listener: (state: ConnectionState) => void): Subscription {
    this.stateListeners.add(listener);
    return { unsubscribe: () => this.stateListeners.delete(listener) };
  }
  /** Dev tool: lose events for `ms`, then "reconnect" (clients must catch up over HTTP). */
  simulateDrop(ms = 8000): void {
    this.droppedUntil = Date.now() + ms;
    this.setState('reconnecting');
    setTimeout(() => this.setState('connected'), ms);
  }
}

export class MockQueueFeed extends MockFeedBase<QueueFeedEvent> implements QueueFeed {
  private tenantId: string | null = null;
  private classIds: readonly string[] = [];
  protected accepts(e: RealtimeEvent, a: EventAudience): boolean {
    if (a.kind !== 'tenant-queue' || a.tenantId !== this.tenantId) return false;
    if (this.classIds.length && 'item' in e.data && e.data.item && 'student' in e.data.item)
      return this.classIds.includes(e.data.item.student.classId ?? '');
    return true;
  }
  async join(args: JoinTenantQueueArgs): Promise<JoinTenantQueueResult> {
    this.tenantId = args.tenantId;
    const queueDate = args.queueDate ?? this.ctx.db.today(args.tenantId);
    const latestSeq = this.ctx.db.latestSeq(args.tenantId, queueDate);
    const last = args.lastSeq ?? null;
    return {
      queueDate,
      latestSeq,
      catchUp:
        last === null
          ? 'snapshot'
          : last >= latestSeq
            ? 'none'
            : latestSeq - last > 500
              ? 'snapshot'
              : 'events',
    };
  }
  async subscribeClasses(tenantId: string, classIds: readonly string[]): Promise<void> {
    this.tenantId = tenantId;
    this.classIds = classIds;
  }
}

export class MockDisplayFeed extends MockFeedBase<DisplayFeedEvent> implements DisplayFeedChannel {
  constructor(
    ctx: MockContext,
    private readonly getToken: () => string | null,
  ) {
    super(ctx);
  }
  private tenantId(): string | null {
    const token = this.getToken();
    return this.ctx.db.state.displays.find((d) => d.token === token)?.tenantId ?? null;
  }
  protected accepts(_e: RealtimeEvent, a: EventAudience): boolean {
    return a.kind === 'tenant-display' && a.tenantId === this.tenantId();
  }
  async hello(lastSeq: number | null): Promise<JoinTenantQueueResult> {
    const tenantId = this.tenantId() ?? '';
    const queueDate = this.ctx.db.today(tenantId);
    const latestSeq = this.ctx.db.latestSeq(tenantId, queueDate);
    return {
      queueDate,
      latestSeq,
      catchUp: lastSeq === null ? 'snapshot' : lastSeq >= latestSeq ? 'none' : 'events',
    };
  }
}

export class MockGuardianFeed extends MockFeedBase<GuardianFeedEvent> implements GuardianFeed {
  constructor(
    ctx: MockContext,
    private readonly getAccessToken: () => string | null,
  ) {
    super(ctx);
  }
  protected accepts(_e: RealtimeEvent, a: EventAudience): boolean {
    const token = this.getAccessToken();
    const s = token
      ? this.ctx.db.state.sessions.find((x) => x.accessToken === token || x.id === token)
      : undefined;
    if (!s) return false;
    return (
      (a.kind === 'user' && a.userId === s.userId) || (a.kind === 'session' && a.sessionId === s.id)
    );
  }
}

export interface SimulatorOptions {
  /** Other guardians create requests (school/display apps). */
  createRequests?: boolean;
  /** A simulated dispatcher sends requests out (guardian/display apps). */
  autoDispatch?: boolean;
  /** Guardians confirm pickups after being sent out (school/display apps). */
  autoAcknowledge?: boolean;
  /** Only dispatch requests for these users' children (guardian app). */
  dispatchForUserId?: () => string | null;
  tickMs?: number;
}

/** Background activity generator. SIMULATION ONLY. Returns a stop function. */
export function startSimulator(ctx: MockContext, opts: SimulatorOptions): () => void {
  const db: MockDb = ctx.db;
  const tick = () => {
    sweepTimeouts(db);
    if (!ctx.scenario.flags?.liveSimulation) return;
    const tenant = db.state.tenants.find((t) => t.slug === 'greenfield-academy');
    if (!tenant || !isOperational(tenant.state)) return;
    const today = db.today(tenant.id);
    const todays = db.state.pickups.filter(
      (p) => p.tenantId === tenant.id && p.queueDate === today,
    );
    const open = todays.filter((p) => (OPEN_STATES as readonly string[]).includes(p.state));
    const dispatcher = { type: 'user' as const, id: null, displayName: 'Simulated dispatcher' };

    if (opts.createRequests && open.length < 10 && Math.random() < 0.35) {
      const busy = new Set(open.map((p) => p.studentId));
      const candidates = db.state.links.filter((l) => {
        if (l.tenantId !== tenant.id || !l.isPrimary || l.removedAt || busy.has(l.studentId))
          return false;
        const g = db.state.guardians.find((x) => x.id === l.guardianId);
        const s = db.state.students.find((x) => x.id === l.studentId);
        return (
          g?.state === 'active' &&
          g.phone.startsWith('+1555020') &&
          s?.status === 'active' &&
          s.dismissalEligibility === 'eligible'
        );
      });
      const pick = candidates[Math.floor(Math.random() * candidates.length)];
      if (pick) {
        const g = db.state.guardians.find((x) => x.id === pick.guardianId)!;
        createPickup(db, {
          tenantId: tenant.id,
          studentId: pick.studentId,
          guardianId: g.id,
          note: Math.random() < 0.2 ? 'Blue sedan, car line' : null,
          actor: { type: 'user', id: g.userId, displayName: g.fullName },
        });
      }
    }
    if (opts.autoDispatch) {
      const userId = opts.dispatchForUserId?.() ?? null;
      for (const p of open.filter(
        (x) => x.state === 'requested' && x.requestedAt < db.addMinutes(-0.25),
      )) {
        const forUser =
          !userId ||
          db.state.links.some(
            (l) =>
              l.studentId === p.studentId &&
              db.state.guardians.find((g) => g.id === l.guardianId)?.userId === userId,
          );
        if (forUser && Math.random() < 0.5) sendOut(db, p, dispatcher);
      }
    }
    if (opts.autoAcknowledge) {
      for (const p of open.filter(
        (x) => x.state === 'sent_out' && x.sentOutAt! < db.addMinutes(-0.5),
      )) {
        const g = db.state.guardians.find((x) => x.id === p.guardianId)!;
        if (g.phone.startsWith('+1555020') && Math.random() < 0.4)
          acknowledge(db, p, g.id, { type: 'user', id: g.userId, displayName: g.fullName });
      }
    }
  };
  const handle = setInterval(tick, opts.tickMs ?? 5000);
  return () => clearInterval(handle);
}
