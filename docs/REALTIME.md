# Realtime delivery and background work

Status: Phase 0 design. Durable facts live in PostgreSQL; sockets and push notifications are delivery mechanisms.

## Command-to-client flow

1. Client sends an authenticated HTTP command with an idempotency key.
2. API validates current authorization and updates aggregate, history, audit, idempotency result and outbox in one transaction.
3. API returns committed state. Notification delivery is not part of command success.
4. Outbox relay claims pending records with short database leases/row locking and enqueues stable event IDs.
5. Consumers publish audience-specific events or schedule provider work. They deduplicate effects using durable event/intent identity.
6. Clients reconcile by aggregate version and fetch authoritative state when disconnected, stale or uncertain.

Never mark an outbox event published before delivery handoff succeeds. A crash after enqueue but before marking produces a duplicate, which consumers must tolerate. Reconcile incomplete intents against the database after Redis loss; queue job IDs alone are insufficient permanent deduplication once jobs are removed. This is at-least-once processing, not an exactly-once delivery guarantee.

## Event contract

```json
{
  "eventId": "<uuid>",
  "type": "pickup.updated",
  "schemaVersion": 1,
  "tenantId": "<authorized-tenant-id>",
  "aggregateId": "<pickup-id>",
  "aggregateVersion": 2,
  "occurredAt": "2026-10-07T10:01:00Z",
  "correlationId": "<safe-correlation-id>",
  "data": {"status": "sent_out_pending_acknowledgment"}
}
```

This is an internal/staff example. Display and guardian payloads use their own minimized schemas, and need not expose tenant/internal IDs. No raw guardian phone, invitation token, credentials or notes are included. Version schemas explicitly; outbox records carry only fields required for their purpose.

## Audience authorization

Server assigns rooms from current trusted context: school staff by permission, guardian by identity and authorized request/link, display by enrolled projection. Never accept arbitrary room names from a client. Reauthorize subscriptions on reconnect/refresh and before emitting protected content; invalidate/disconnect on role changes, guardian blocking, tenant suspension or device transfer. Authorization check failures stop delivery.

Use bounded connection expiry and proactive revocation notifications for cleanup, plus durable current access checks. A lost Redis revocation event must not make an old socket permanently authorized. Push payloads contain generic hints rather than student details and require authenticated refetch.

## Snapshot recovery

Socket.IO's standard Redis adapter provides cross-instance fanout but not connection-state recovery; use application-level recovery. See the [adapter documentation](https://socket.io/docs/v4/redis-adapter).

On connect, establish the authorized subscription and buffer subsequent events, then fetch an authoritative snapshot with a revision from the same consistent database view. Apply only buffered updates newer than the snapshot/resource versions; refetch on ambiguity or buffer overflow. Discard duplicate/older aggregate versions. A detected version gap triggers refetch, not invented intermediate states.

Snapshot includes current open queue items, stable ordering by server request timestamp plus ID, and server time. Completion/cancellation events remove rows. A periodic bounded snapshot refresh catches a missed terminal event even if no later event arrives. Define the refresh interval from load testing; use jitter and backoff to avoid synchronized reconnect storms. Clients visibly label stale data and never interpret a missing event as successful pickup.

Do not assume a PostgreSQL sequence alone describes commit order. If a tenant-wide cursor is introduced, its allocation/commit semantics require a transaction design and concurrency test. Per-resource versions plus snapshot reconciliation are the initial correctness mechanism.

If long-polling transport is enabled with multiple Socket.IO instances, configure load-balancer affinity per adapter requirements. Test both configured transports and reconnect behavior in staging.

## Workers

| Work | Reliability and authorization |
|---|---|
| Outbox relay | Short leases; recover abandoned claims; measure oldest pending record |
| Notifications | Durable intent and provider reference; recheck recipient access; retry transient errors only |
| Reports | Fresh tenant context; scoped queries and download authorization; explicit expiry |
| Expiry | Idempotent conditional transitions; access checks already enforce expiry independently |
| Payment reconciliation | Validate provider order state; deduplicate grants; alert ambiguous outcomes |
| OTP delivery | Separate restricted queue if asynchronous; bound attempts/cost and avoid secret logging |

Configure finite attempts, exponential backoff with jitter, timeouts, concurrency caps and per-tenant fairness. Poison/permanently invalid jobs go to an inspected failed-work path. Authorized operators can retry using the same durable intent, with an audit trail. Do not retry a permanently revoked recipient indefinitely.

BullMQ's [idempotent job guidance](https://docs.bullmq.io/patterns/idempotent-jobs) supports designing retried jobs with equivalent final effects. External provider delivery may still duplicate after an ambiguous timeout; use provider idempotency where available, reconciliation otherwise, and do not claim guaranteed single delivery.

## Failure behavior

- Redis/socket outage: committed pickups remain available through scoped snapshot polling; notify operators of stale realtime state. Outbox backlog remains durable.
- OTP/rate-limit coordination unavailable: fail closed for protected challenge flows rather than issuing uncontrolled messages.
- Worker/provider outage: preserve pending work and surface delivery failure; do not undo valid pickup commands.
- Database outage: reject mutations; show unavailable/stale state and use the school's operational fallback procedure.
- Burst/reconnect overload: bound buffers and connections, shed nonessential reports first, and measure tenant fairness.
