import type { RealtimeEvent } from '@homebell/contracts';
import type {
  ActorRecord,
  AuditRecord,
  MockState,
  PickupRecord,
  QueueEventRecord,
  TenantRecord,
} from './types';
import { zonedClock, zonedDate } from './tz';

export type MockListener = (event: RealtimeEvent, audience: EventAudience) => void;

/** Who a realtime event is for — mirrors the SignalR groups in realtime.asyncapi.yaml. */
export type EventAudience =
  | { kind: 'tenant-queue'; tenantId: string }
  | { kind: 'tenant-display'; tenantId: string }
  | { kind: 'user'; userId: string }
  | { kind: 'session'; sessionId: string };

export interface MockPersistence {
  load(): MockState | null;
  save(state: MockState): void;
  clear(): void;
}

const randomUuid = (): string => {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  // RFC 4122 v4 fallback (React Native without crypto.randomUUID).
  const hex = [...Array(32)].map(() => Math.floor(Math.random() * 16).toString(16));
  hex[12] = '4';
  hex[16] = ((parseInt(hex[16] ?? '0', 16) & 0x3) | 0x8).toString(16);
  const h = hex.join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * In-memory mock database. One instance per app process (browser tab / RN runtime / test).
 * SIMULATION ONLY: it drives UI states; it does not define server behaviour.
 */
export class MockDb {
  state: MockState;
  /** Milliseconds added to the real clock (lets scenarios simulate time passing). */
  clockOffsetMs = 0;
  private listeners = new Set<MockListener>();
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly seed: () => MockState,
    private readonly persistence: MockPersistence | null = null,
  ) {
    this.state = persistence?.load() ?? seed();
  }

  // ── time & ids ─────────────────────────────────────────────
  now(): Date {
    return new Date(Date.now() + this.clockOffsetMs);
  }
  nowIso(): string {
    return this.now().toISOString();
  }
  addMinutes(minutes: number, from: Date = this.now()): string {
    return new Date(from.getTime() + minutes * 60_000).toISOString();
  }
  addDays(days: number, from: Date = this.now()): string {
    return new Date(from.getTime() + days * 86_400_000).toISOString();
  }
  id(): string {
    return randomUuid();
  }
  token(prefix: string): string {
    return `${prefix}_${randomUuid().replace(/-/g, '')}`;
  }
  crockford(length: number): string {
    let s = '';
    for (let i = 0; i < length; i++) s += CROCKFORD[Math.floor(Math.random() * 32)];
    return s;
  }

  /** Tenant-local calendar date (YYYY-MM-DD). */
  localDate(timezone: string, at: Date = this.now()): string {
    return zonedDate(timezone, at);
  }
  /** Tenant-local HH:mm and ISO weekday (1 = Monday). */
  localClock(timezone: string, at: Date = this.now()): { time: string; isoWeekday: number } {
    return zonedClock(timezone, at);
  }

  // ── lookups ────────────────────────────────────────────────
  tenant(id: string): TenantRecord | undefined {
    return this.state.tenants.find((t) => t.id === id);
  }
  today(tenantId: string): string {
    const t = this.tenant(tenantId);
    return this.localDate(t?.timezone ?? 'UTC');
  }
  user(id: string) {
    return this.state.users.find((u) => u.id === id);
  }

  // ── writes ─────────────────────────────────────────────────
  /** Call after every mutation; persistence is debounced. */
  touch(): void {
    if (!this.persistence) return;
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => this.persistence?.save(this.state), 150);
  }

  reset(): void {
    this.persistence?.clear();
    this.state = this.seed();
    this.clockOffsetMs = 0;
    this.touch();
  }

  audit(
    entry: Omit<
      AuditRecord,
      | 'id'
      | 'occurredAt'
      | 'onBehalfOf'
      | 'data'
      | 'targetLabel'
      | 'reasonCode'
      | 'targetType'
      | 'targetId'
    > &
      Partial<AuditRecord>,
  ): void {
    this.state.audit.unshift({
      id: this.id(),
      occurredAt: this.nowIso(),
      onBehalfOf: null,
      targetType: null,
      targetId: null,
      targetLabel: null,
      reasonCode: null,
      data: {},
      ...entry,
    });
    if (this.state.audit.length > 2000) this.state.audit.length = 2000;
  }

  /** Allocate the next queue sequence for (tenant, queueDate) and record a queue event. */
  queueEvent(pickup: PickupRecord, type: QueueEventRecord['type']): QueueEventRecord {
    const key = `${pickup.tenantId}:${pickup.queueDate}`;
    const seq = (this.state.queueSeq[key] ?? 0) + 1;
    this.state.queueSeq[key] = seq;
    pickup.seq = seq;
    const ev: QueueEventRecord = {
      eventId: this.id(),
      tenantId: pickup.tenantId,
      queueDate: pickup.queueDate,
      seq,
      type,
      pickupId: pickup.id,
      occurredAt: this.nowIso(),
    };
    this.state.queueEvents.push(ev);
    if (this.state.queueEvents.length > 5000) this.state.queueEvents.splice(0, 1000);
    return ev;
  }

  latestSeq(tenantId: string, queueDate: string): number {
    return this.state.queueSeq[`${tenantId}:${queueDate}`] ?? 0;
  }

  // ── realtime bus ───────────────────────────────────────────
  subscribe(listener: MockListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  emit(event: RealtimeEvent, audience: EventAudience): void {
    for (const l of this.listeners) {
      try {
        l(event, audience);
      } catch {
        /* a failing listener must not break the mock */
      }
    }
  }

  systemActor(): ActorRecord {
    return { type: 'system', id: null, displayName: 'System' };
  }
}
