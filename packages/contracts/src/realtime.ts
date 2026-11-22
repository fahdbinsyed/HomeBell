/**
 * Typed realtime event payloads — mirrors realtime/realtime.asyncapi.yaml.
 * The compile-time check at the bottom fails if an event is added to the AsyncAPI
 * document without a payload type here (or vice versa).
 */
import type { RealtimeEventType } from './generated/realtime';
import type {
  DisplayItem,
  GuardianPickupRequest,
  GuardianState,
  OperationalMode,
  QueueItem,
  SessionRevokeReason,
  TenantLifecycleState,
} from './generated/schemas';

export interface RealtimeEventPayloads {
  'queue.request.created': { item: QueueItem };
  'queue.request.updated': { item: QueueItem };
  'queue.reset': { reason: 'day_rollover' | 'resync_required'; newQueueDate?: string | null };
  'display.item.upserted': { item: DisplayItem };
  'display.item.removed': { itemId: string };
  'display.revoked': { displayId: string };
  'guardian.request.status_changed': { request: GuardianPickupRequest };
  'guardian.access.changed': {
    tenantId: string;
    guardianId: string;
    state: GuardianState;
    reasonCode?: string | null;
  };
  'tenant.state_changed': {
    tenantId: string;
    state: TenantLifecycleState;
    operationalMode: OperationalMode;
  };
  'session.revoked': { sessionId: string; reason: SessionRevokeReason };
}

/** Envelope delivered through the single `event` client method. */
export type RealtimeEvent<T extends RealtimeEventType = RealtimeEventType> = {
  [K in T]: {
    eventId: string;
    type: K;
    version: 1;
    tenantId?: string | null;
    queueDate?: string | null;
    /** Per (tenantId, queueDate) monotonic sequence for queue/display events. */
    seq?: number | null;
    occurredAt: string;
    data: RealtimeEventPayloads[K];
  };
}[T];

export interface JoinTenantQueueArgs {
  tenantId: string;
  queueDate?: string | null;
  lastSeq?: number | null;
}
export interface JoinTenantQueueResult {
  queueDate: string;
  latestSeq: number;
  catchUp: 'none' | 'events' | 'snapshot';
}

// ── compile-time parity with the AsyncAPI document ──
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const _parity: Exact<keyof RealtimeEventPayloads, RealtimeEventType> = true;
void _parity;
