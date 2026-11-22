import type {
  JoinTenantQueueArgs,
  JoinTenantQueueResult,
  RealtimeEvent,
} from '@homebell/contracts';

export type ConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

export interface Subscription {
  unsubscribe(): void;
}

/** Common surface of every realtime feed (mock timer feed or SignalR). */
export interface RealtimeFeed<E> {
  readonly state: ConnectionState;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  /** Events are delivered in arrival order; consumers dedupe with SequenceTracker. */
  onEvent(listener: (event: E) => void): Subscription;
  onStateChange(listener: (state: ConnectionState) => void): Subscription;
}

export type QueueFeedEvent = RealtimeEvent<
  | 'queue.request.created'
  | 'queue.request.updated'
  | 'queue.reset'
  | 'tenant.state_changed'
  | 'session.revoked'
>;

/** Staff live-queue feed (/hubs/queue). */
export interface QueueFeed extends RealtimeFeed<QueueFeedEvent> {
  join(args: JoinTenantQueueArgs): Promise<JoinTenantQueueResult>;
  /** Narrow to classes; empty array = whole tenant. */
  subscribeClasses(tenantId: string, classIds: readonly string[]): Promise<void>;
}

export type DisplayFeedEvent = RealtimeEvent<
  'display.item.upserted' | 'display.item.removed' | 'queue.reset' | 'display.revoked'
>;

/** Public display feed (/hubs/display). */
export interface DisplayFeedChannel extends RealtimeFeed<DisplayFeedEvent> {
  hello(lastSeq: number | null): Promise<JoinTenantQueueResult>;
}

export type GuardianFeedEvent = RealtimeEvent<
  | 'guardian.request.status_changed'
  | 'guardian.access.changed'
  | 'tenant.state_changed'
  | 'session.revoked'
>;

/** Guardian app feed (/hubs/guardian). */
export type GuardianFeed = RealtimeFeed<GuardianFeedEvent>;
