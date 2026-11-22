# Audit, Outbox, Idempotency and Background Workers

## 1. Audit log

- Append-only table `audit.audit_log`; the application DB role has `INSERT, SELECT` only (no `UPDATE`,
  `DELETE`). Retention purge runs under a separate maintenance role.
- Row: `id, occurred_at, tenant_id (nullable for platform events), actor_type (user|system|display|
support|provider), actor_id, actor_display, on_behalf_of (support sessions), action, target_type,
target_id, outcome (success|denied|failed), reason_code, ip_hash, user_agent, device_id, request_id,
data (jsonb: before/after diff, no secrets, no OTP codes, phone numbers masked)`.
- Written **in the same transaction** as the business change (`IAuditWriter` participates in the module
  unit of work), so a change can never commit without its audit row. Denied/failed security events
  (login failure, OTP failure, rejected pickup) are written in their own transaction.
- Action naming: `<area>.<verb>` — e.g. `auth.login`, `otp.sent`, `otp.verified`, `otp.locked`,
  `pickup.requested`, `pickup.request_rejected`, `pickup.sent_out`, `pickup.acknowledged`,
  `pickup.exception`, `pickup.resolved`, `invitation.created`, `invitation.redeemed`, `device.transferred`,
  `device.cooldown_overridden`, `guardian.blocked`, `guardian.deactivated`, `tenant.lifecycle_changed`,
  `subscription.changed`, `override.applied`, `override.revoked`, `support_session.started`,
  `note.added`, `display.paired`, `display.revoked`. Full list: `AuditAction` enum in the contract.
- Tenant users see their tenant's audit; platform users see all; support sessions are themselves audited.

## 2. Transactional outbox

- Each module persists domain/integration events into `<schema>.outbox_message` in the same transaction.
- The worker polls (`FOR UPDATE SKIP LOCKED`, batch 100) and is woken early by `pg_notify`.
- Delivery is **at-least-once**; consumers are idempotent (inbox table keyed by `message_id` per consumer).
- Retries with exponential backoff (1 s → 5 min, max 12 attempts) then dead-letter + alert.
- RabbitMQ can replace the in-process dispatcher later behind `IEventBus` without changing producers.

## 3. Idempotency

- Header `Idempotency-Key` (UUID recommended, 8–128 chars) **required** on: pickup create, acknowledge,
  sent-out (single and bulk), purchase completion, invitation create, tenant create, import commit,
  device transfer.
- Stored as `(scope = tenant|user, key) → request hash, status, response code, response body`, TTL 24 h
  (Redis for fast path, Postgres for durability).
- Same key + same body → replay original response with header `Idempotent-Replayed: true`.
- Same key + different body → `422 IDEMPOTENCY_KEY_REUSED`.
- Same key while first request still running → `409 IDEMPOTENCY_IN_PROGRESS` (client retries after
  `Retry-After`).

## 4. Background jobs (HomeBell.Worker)

| Job                   | Schedule                       | Purpose                                                                                                  |
| --------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------- |
| OutboxDispatcher      | continuous                     | publish events (SignalR, push, SMS, internal consumers)                                                  |
| PickupTimeouts        | every 30 s                     | sent_out reminders (5 min) and exceptions (15 min); stale flags                                          |
| EndOfDaySweep         | per tenant local time          | open requests → exception; queue day rollover (`queue.reset`)                                            |
| TenantExpirySweep     | hourly                         | `expire` transitions; trial-ending notifications (7 d / 1 d)                                             |
| GuardianValiditySweep | every 5 min                    | temporary/valid-until/one-time expiry; seat return                                                       |
| SeatTermSweep         | daily                          | seats past term end → expired                                                                            |
| OtpCleanup            | hourly                         | expire challenges, release lockouts                                                                      |
| ReportRollups         | every 15 min + nightly         | daily aggregates for reports                                                                             |
| RetentionPurge        | nightly                        | apply retention policy (ADR-0012)                                                                        |
| BillingNotifications  | continuous (webhook-fed queue) | process Google Play RTDN and App Store Server Notifications V2 (voids/refunds observed, never initiated) |

Jobs use Postgres advisory locks (or Redis locks) so multiple worker instances never double-run a
schedule; all jobs are idempotent.
