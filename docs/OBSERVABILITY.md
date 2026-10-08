# Observability and audit

Status: Phase 0 standard. Phase 1 implements the foundation; every later module must adopt it.

## Diagnostic logging

Use structured JSON through an internal logger. Standard fields: timestamp, severity, service, environment, release, requestId, correlationId, traceId/spanId where available, tenantId, actorType/actorId where appropriate, route template, method, statusCode, durationMs, event and stable errorCode.

Generate server request IDs; validate externally supplied correlation values for format/length and never trust them as authorization. Propagate context through application services, database instrumentation, outbox, jobs and provider adapters. Propagate safe headers only; provider URLs and raw request bodies may contain secrets.

Central redaction removes passwords, OTPs, authorization/cookie headers, access/refresh tokens, invitation secrets, private keys, payment and database credentials. Avoid guardian phone numbers, child names and sensitive notes. Sanitize user-controlled log fields. No request/response-body logging by default.

Mobile/web logging uses the same severity and redaction concepts. Production disables sensitive verbose logging. Error monitoring receives scrubbed diagnostics and release metadata through replaceable adapters; provider choice remains unresolved.

## Errors and health

Global exception handling maps known domain failures to stable API codes. Unexpected errors log diagnostic context once and return a safe request ID; no SQL, stack trace or infrastructure detail reaches the client. Expected denials are visible without flooding error alerts.

Liveness indicates process health; readiness indicates ability to serve the advertised workload. Separate database readiness and realtime/queue degradation. A Redis fanout failure may leave database-backed API operations available, while OTP flows that need distributed limits are unavailable. Worker readiness verifies required queue/database dependencies. Dependency details are restricted to operations, not public health responses.

## Metrics and alerts

| Signal | Operational meaning |
|---|---|
| Request rate, duration percentiles, error rate | API saturation or regressions |
| Pickup commit-to-client delay, snapshot staleness | Dismissal coordination quality |
| Open/exception pickup count and age | Unresolved acknowledgment workload |
| Outbox oldest age, pending count | Durable events not progressing |
| Queue lag, failed attempts, processing duration | Worker/provider health |
| Socket connections, reconnects, denied subscriptions | Fanout load and authorization issues |
| OTP requests, verification failures, provider spend | Abuse and cost controls |
| Device transfers, denied cooldown attempts, revocations | Account security activity |
| Payment reconciliation age / ungranted paid orders | Commercial workflow failures |
| Database pool waits, lock waits, deadlocks, capacity | Transaction contention |
| Backup age and restore-drill outcome | Recovery readiness |

Use bounded labels; do not put every tenant/user/request ID in metrics labels. Investigate tenant detail via scoped logs/reports. Define numerical service objectives and alert thresholds from the approved workload model before pilot. Alert on sustained degradation and actionable anomalies, with runbook links and responsible owners.

## Durable audit

Audit records include event ID, timestamp, tenant or explicit platform scope, actual actor and type, action, resource type/ID, result, safe before/after metadata, reason where required, and correlation ID. Record authentication/OTP outcomes, pickup commands, invitation creation/redemption, transfers, guardian access changes, roles, subscriptions, overrides, lifecycle actions and privileged notes.

Successful business mutations write audit in the same database transaction; inability to persist required evidence aborts the mutation. Denied/authentication events use a separate bounded durable recording path because failed transactions cannot retain inserted audit rows. Alert when security-event recording is impaired; protect it against attacker-induced resource exhaustion.

Application roles cannot update/delete historical audit entries. Corrections append references to earlier events. Audit metadata has an allowlist and excludes secrets and unnecessary child data. Append-oriented storage alone is not a claim of cryptographic tamper-proofing.

Platform and school audit retrieval enforce their own permissions and data scopes. Audit export access is itself audited. Retention is finalized with [SECURITY.md](SECURITY.md); shipping to a monitoring provider never substitutes for durable business audit.

## Phase 2 implementation (2026-10-08)

The database service now counts entitlement denials and lifecycle version conflicts in `policyMetrics`, without tenant/user metric labels. `scripts/reconcile-usage.mjs` emits a safe mismatch count and fails on divergence. Control audit records carry tenant linkage, permitted action categories, actor/operator provenance and versioned command evidence; tenant audit/outbox metadata excludes private note bodies and commercial reasons. External metric export, dashboards and alert delivery remain deployment work.

See [PHASE_2_REPORT.md](PHASE_2_REPORT.md) for verification and remaining production gates.

