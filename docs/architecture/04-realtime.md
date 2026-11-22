# Realtime Architecture

Formal contract: [`packages/contracts/realtime/realtime.asyncapi.yaml`](../../packages/contracts/realtime/realtime.asyncapi.yaml).

## 1. Hubs and groups

| Hub              | Auth                                  | Groups (server-assigned, never client-chosen)                                        |
| ---------------- | ------------------------------------- | ------------------------------------------------------------------------------------ |
| `/hubs/queue`    | staff JWT with `queue.read` in tenant | `t:{tenantId}:queue`, optional `t:{tenantId}:class:{classId}` via `SubscribeClasses` |
| `/hubs/display`  | display token                         | `t:{tenantId}:display` (or `t:{tenantId}:display:zone:{zone}`)                       |
| `/hubs/guardian` | guardian JWT                          | `u:{userId}`                                                                         |

Tenant is derived from the token/membership on connect; `JoinTenantQueue(tenantId)` re-validates
membership. Session revocation closes connections (`session.revoked` sent first).

## 2. Events

Every event uses one envelope:

```json
{
  "eventId": "uuid",
  "type": "queue.request.updated",
  "version": 1,
  "tenantId": "uuid",
  "queueDate": "2026-11-23",
  "seq": 1042,
  "occurredAt": "2026-11-23T14:31:07Z",
  "data": {}
}
```

| Event                                            | Hubs            | Purpose                                                                           |
| ------------------------------------------------ | --------------- | --------------------------------------------------------------------------------- |
| `queue.request.created`                          | queue           | new pickup request                                                                |
| `queue.request.updated`                          | queue           | state change (sent_out, acknowledged, cancelled, exception, resolved, stale flag) |
| `display.item.upserted` / `display.item.removed` | display         | privacy-reduced item added/changed or removed                                     |
| `queue.reset`                                    | queue, display  | new queue day or forced resync — client must reload snapshot                      |
| `guardian.request.status_changed`                | guardian        | status for the guardian's own requests                                            |
| `guardian.access.changed`                        | guardian        | blocked / deactivated / expired / reactivated                                     |
| `session.revoked`                                | all             | device transfer, logout elsewhere, admin action                                   |
| `tenant.state_changed`                           | queue, guardian | lifecycle change affecting operations                                             |
| `display.revoked`                                | display         | display unpaired                                                                  |

Display payloads are **privacy-reduced** server-side (`DisplayItem`: first name + last initial, class
label, status, request time). Phone numbers, guardian names and notes never reach the display hub.

## 3. Sequencing and catch-up

- Each `(tenantId, queueDate)` has a monotonic `seq` allocated in the same transaction as the state change
  (row-locked counter `dismissal.queue_sequence`). `queueDate` is the tenant-local date.
- Clients keep `lastSeq`. On reconnect they call
  `GET /v1/t/{tenantId}/queue/events?queueDate=…&afterSeq=N` (display: `/v1/display/feed/events`).
  - ≤ 500 missed events → events returned in order; client applies them.
  - more, or events purged → `410 QUEUE_CATCHUP_GAP_TOO_LARGE` → client reloads the snapshot
    (`GET /queue`) which carries the current `seq`.
- Clients ignore events with `seq <= lastSeq` (idempotent apply) and trigger a catch-up call on a gap
  (`seq > lastSeq + 1`).
- **The database is the source of truth; SignalR is a delivery channel.** Lost messages are always
  recoverable through catch-up.

## 4. Write path and fan-out

```
POST pickup request ──► API: validate → insert PickupRequest + StatusHistory + QueueEvent(seq)
                              + OutboxMessage  (one transaction)  ──► 201 to guardian
Worker (outbox poller, LISTEN/NOTIFY wake-up, ~50 ms) ──► SignalR via Redis backplane
                                                      ──► FCM push (guardian)
                                                      ──► timeout schedules
```

The API can also publish to SignalR immediately after commit (low latency) with the outbox as the
guaranteed path; clients dedupe by `eventId`/`seq`.

## 5. Scale-out

- API instances are stateless; SignalR uses the **Redis backplane** (`AddStackExchangeRedis`) with a
  channel prefix per environment. Sticky sessions are required only if long-polling fallback is enabled;
  WebSocket-only is the default for apps; display allows SSE fallback.
- Hot path per request: 1 transaction, 4 inserts, no external calls. Push/SMS are asynchronous.
- Spike target (Phase 4 load test): 2,000 schools × 300 requests in a 15-minute window, p95 create
  < 300 ms, p95 fan-out < 2 s.
- Upgrade path if Redis backplane becomes a bottleneck: Azure SignalR Service / dedicated realtime nodes,
  without contract changes.

## 6. Frontend abstraction

`QueueFeed` (`@homebell/client-services`) hides the transport: `connect`, `subscribe(listener)`,
`state`, `resync()`. Implementations: `MockQueueFeed` (timer-driven, Phase 1) and `SignalRQueueFeed`
(Phase 4). Both implement the same catch-up semantics.
