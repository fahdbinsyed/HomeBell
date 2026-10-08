# Testing and quality gates

Status: verification plan with Phase 1 execution recorded in [PHASE_1_REPORT.md](PHASE_1_REPORT.md): 6 unit and 31 real-service integration tests pass, along with build/type/lint/format checks. Later-phase scenarios below remain required plans, not completed tests.

## Layers

| Layer | Focus | Required environment |
|---|---|---|
| Unit | State transitions, policy precedence, validity, redaction, error mapping | Deterministic clocks and synthetic fixtures |
| Database integration | RLS, constraints, locks, migrations, idempotency, outbox | Actual PostgreSQL with production-like runtime roles |
| API integration | Validation, audiences, RBAC, tenant boundaries, safe errors | Backend plus database; controlled provider adapters |
| Worker integration | Duplicate/retried work, poison jobs, lost queue recovery | Redis/BullMQ plus durable intent records |
| Web/mobile | Pending/stale/offline states, permission handling, secure credential boundaries | Component tests plus supported Android/browser environments |
| End to end | Onboarding, request/acknowledgment, invite, block, transfer | Staging-like topology and synthetic tenants |
| Load/reliability | Dismissal bursts, reconnect storms, fairness, provider failure | Approved workload model, bounded test environment |
| Operational | Backup restore, rollback compatibility, monitoring and runbooks | Isolated recovery/staging environment |

## Mandatory security and business cases

- Tenant A cannot read/write Tenant B students, guardians, queue, reports, audit, sockets or display projections; missing context denies access.
- Reused pooled connections do not leak tenant context. Composite references reject cross-tenant relationships. Test actual RLS runtime roles, not owners/superusers.
- A platform token cannot act as a school user. School role changes and membership disablement take effect on existing sessions.
- An unrelated, blocked, inactive or expired guardian cannot request for a child; additional guardians cannot use unlicensed links.
- Suspension or expiry defeats a grant/flag. Trial, free/pilot and bounded overrides work without pretending payment occurred.
- Primary-device transfer revokes old HTTP, refresh and socket access; concurrent transfers yield one valid active device; cooldown checks use server time.
- Invitation is single-use, expires, binds phone/purpose, rechecks blocks and sponsor authority, and activates without school approval.
- OTP limits work across API replicas, resist verification/resend races, and fail safely when coordination/provider services fail.
- Replayed/forged/out-of-order payment events do not grant duplicate or unpaid access; cancellation invokes no refund API.
- Logs, errors, traces, push and public display reject forbidden secret/private fields.

## Concurrency and recovery cases

For the same student, send simultaneous requests from different guardians with different idempotency keys: at most one nonterminal pickup is created. Retry identical keys: one committed result. Reuse a key with different data: conflict. Crash after commit before HTTP response: retry recovers that result.

Race acknowledgment/cancellation/sent-out/block/suspension and verify an allowed serialized outcome, version conflict or denial with intact history. Simulate missing staff sent-out updates: direct guardian acknowledgment still works. Unacknowledged pickups become visible exceptions, never automatic completion. Race license cap allocation and invitation redemption.

Crash relay after enqueue before outbox marking; replay duplicates; delete nonproduction queue data and reconcile pending durable work. Simulate provider timeout after success and verify reconciliation/known uncertainty. Deliver socket events duplicated, out of order, missing and after reconnect; verify snapshot convergence, terminal removals and stale-state visibility.

Test dismissal windows around midnight, daylight-saving transitions where relevant, expired grants at exact boundaries, and delayed expiry jobs. Retention/anonymization and one-time usage tests wait for approved semantics, then become release gates for those features.

## CI and delivery

Relevant changes require formatting, lint, strict TypeScript checking, unit/integration tests, build checks, migration validation and configured dependency/secret checks. Do not disable failing tests. Use a protected main branch, short-lived branches and reviewed changes; no live release is implied by a merge.

Each phase reports commands executed, results, limitations, migrations, API changes and acceptance outcomes. A passing mocked repository test does not prove RLS. Documentation-only work does not claim passing application builds or runtime behavior.

Before pilot, verify the complete required workflow with real topology and synthetic data, restore a backup, simulate loss of realtime/provider service, exercise the school's agreed fallback, and record workload/service-objective evidence. Production personal data must never be used as test fixtures.

## Phase 0 review criteria

All required documents exist and link correctly; fixed rules remain consistent; ownership, tenant boundaries, state transitions and authorization are explicit; phase dependencies and security foundations are assigned; unresolved product decisions have owners/gates and no silent defaults; documentation does not claim deployed or tested functionality.

## Phase 2 implementation (2026-10-08)

Local Phase 2 verification passes 10 unit, 39 PostgreSQL/Redis integration and 5 Chromium browser tests. Run `pnpm build` before API tests because fixtures import compiled code, then `pnpm test`, `pnpm test:integration`, and `pnpm test:browser`. Browser tests require the workspace-local certificate, installed Playwright Chromium, and port 3101. They use signed test OIDC rather than injected platform authentication. Desktop/mobile/conflict screenshots are saved under ignored `.local/screenshots`. The real provider remains unverified; CI configuration is present but has not run remotely.

See [PHASE_2_REPORT.md](PHASE_2_REPORT.md) for verification and remaining production gates.

