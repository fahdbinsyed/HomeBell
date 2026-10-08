# Database and migrations

Status: Phase 0 logical design with the Phase 1 subset now applied to local development/test PostgreSQL. See [migration review](../apps/api/migrations/README.md) and [PHASE_1_REPORT.md](PHASE_1_REPORT.md) for exact implementation scope. Pickup, billing and invitation schema below remains future design. Entity ownership is defined in [DOMAIN_MODEL.md](DOMAIN_MODEL.md).

## Representation

Use UUID primary IDs, `timestamptz` for instants, explicit IANA school time zones, and server timestamps. Store money as integer minor units with currency; school subscriptions are annual USD. Do not use floating-point money or derive renewal boundaries from a fixed 365-day duration. Store explicit subscription period start/end.

Tenant tables use `(tenant_id, id)` as a referenced unique key even if IDs are globally unique. History tables contain actor and tenant context. Sensitive phone values use a normalized form with restricted access; provider credentials and refresh/invitation secrets are never plaintext database fields. Short OTPs require a keyed verifier or equivalent protected verification mechanism, not an easily brute-forced plain hash.

## Essential constraints and indexes

| Data | Constraint / access path |
|---|---|
| Membership | Unique current tenant/user membership; roles reference same tenant |
| School records | Composite tenant foreign keys across student, class, section, campus |
| Guardian link | Unique current tenant/student/guardian link; historical changes retained |
| Primary entitlement | At most one current primary entitlement per tenant/student; licensed-child allocation counted transactionally |
| License coverage | Tenant-consistent guardian/student references; explicit license and validity |
| Open pickup | Partial unique tenant/student index for `requested`, `sent_out_pending_acknowledgment`, `exception` |
| Pickup acknowledgment | Unique pickup reference; same-tenant actor relationship; no duplicate final acknowledgment |
| Pickup history | Tenant/request/time and sequence/version indexes |
| Invitation | Unique token digest; expiry; redeemed timestamp/user; conditional single-use transition |
| Primary device | Account-level active primary device slot referencing registry; row lock prevents competing activations |
| Refresh session | Unique token digest, family/version, expiry, revocation and device references |
| Payment event | Unique provider/event identifier; order ownership and amount/currency validation |
| Idempotency | Unique tenant-or-platform scope, actor, operation and key; payload digest and outcome |
| Outbox | Event UUID, aggregate version, tenant, publish/retry status; pending-work index |
| Plans | Unique plan/version; published versions immutable |
| Audit | Tenant/time, actor/time and resource/time indexes; append-oriented privileges |

Avoid volatile time-based partial-index predicates. Persist current lifecycle markers and enforce expiry during authorization. Expiry jobs are cleanup aids, never the access-control source of truth. Partial-index predicates and exact lifecycle columns must be verified in the Phase 1 schema proposal.

## Transaction boundaries

**Pickup command:** verify session; acquire shared guards on account/session authorization, tenant access state, guardian/link, and relevant license/student records; recheck eligibility; acquire the pickup/student serialization lock as needed; enforce uniqueness/version; update state, history, idempotency outcome, audit and outbox together. The database commit determines success.

**Block, revoke, suspend:** acquire conflicting exclusive authorization guards and update access state/version plus audit/outbox. This orders revocation against in-flight commands: commands ordered before revocation may finish, commands ordered after it cannot pass. No client timestamp overrides that ordering.

**Device transfer:** lock account security row, validate purpose-bound OTP and cooldown, revoke old sessions, increment session/security version, set active device, record transfer/audit/outbox, then commit. Realtime disconnect is best-effort notification; subsequent authorization denies old sessions regardless of notification delivery.

**Invitation redemption:** lock applicable access guards and invitation; verify OTP proof, single-use token and entitlement; create/reuse only the invitee's verified identity, add permitted links, mark redemption, and write audit/outbox atomically.

**Payment / grants:** validate provider event before processing; lock order and grant allocation; deduplicate event; apply entitlement/invitation once; audit and publish through outbox. Provider calls are outside database transactions; ambiguous provider outcomes require reconciliation.

Lock ordering: account security/session, tenant access, guardian/link, student/license allocation, business aggregate (pickup/invitation/order), then history/audit/outbox. Within a category sort by stable identifier. Final schema review must test this ordering against each workflow, especially multi-child operations. Shared access guards permit concurrent readers; avoid serializing every tenant pickup on one exclusive tenant lock.

Idempotency records and business effects commit together. Same key with a different payload is a conflict. Concurrent same-key calls wait or receive a stable in-progress response. Retention of mutation results must exceed the published retry window; billing deduplication follows the longer payment history retention decision.

## Migrations and recovery

Use checked-in, ordered migrations; never edit applied historical files. Phase 1 selects tooling only after proving RLS and transaction support. Disable automatic schema synchronization in production.

Every migration review records forward changes, compatibility with old application versions, data backfill, locking/timeout impact, expected table size, rollout order, and recovery. Prefer add nullable field, deploy compatible code, batch backfill, validate constraint, then separately approve removal. Separate long-running backfills from startup.

Use short lock timeouts and rehearse against realistic nonproduction data. Destructive operations require explicit approval. Recovery may be a forward repair or tested backup restoration; do not promise a lossy down migration as rollback. Backups/PITR, restore drills, retention and recovery objectives are launch gates.

## Retention

Do not hard-delete pickup/security history as routine cleanup. Retention and anonymization rules require launch-jurisdiction and contractual review. Apply rules consistently to databases, backups, exports, provider payloads, logs and audit. Partitioning is deferred until measurement justifies it; do not add operational complexity preemptively.

## Phase 2 implementation (2026-10-08)

Additive migrations 0004–0005 create platform role templates, immutable annual plan versions, tenant subscriptions/grants/overrides, private notes, lifecycle history and aggregate usage. Counter triggers have a dedicated non-login owner with narrowly granted counter privileges and fixed `pg_catalog` search path. Tenant allocation locks require both scoped RLS SELECT/UPDATE policies and a narrow UPDATE column grant. Control sessions cannot query raw student/guardian tables. Run `scripts/preflight-phase2.mjs` before upgrading and `scripts/reconcile-usage.mjs` afterward. Restrictive enforcement requires forward repair; rollback to Phase 1 is unsafe.

See [PHASE_2_REPORT.md](PHASE_2_REPORT.md) for verification and remaining production gates.

