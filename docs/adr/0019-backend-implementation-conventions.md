# ADR-0019: Backend implementation conventions

- **Status**: Accepted
- **Date**: 2026-11-23

## Context

Phase 2 implements the contract on the .NET modular monolith (ADR-0001, ADR-0002, ADR-0003). Several
implementation choices affect every module and are recorded here so later slices stay consistent.

## Decision

1. **Contract constants are generated.** `packages/contracts/scripts/generate-dotnet.mjs` emits
   `BuildingBlocks.Domain/Contract/ErrorCodes.g.cs` (code → HTTP status/title from `error-catalog.yaml`)
   and `ContractEnums.g.cs` (every string enum as `const string`s with the exact wire values). It runs in
   `pnpm --filter @homebell/contracts generate`, and `check` fails on drift. Handlers throw
   `ApiProblemException(code)`; the status always comes from the catalog.
2. **Where code lives.** Pure rules (OTP policy, lifecycle → operational mode, role → permission bundles)
   live in Domain/Application and are unit-tested. Endpoint handlers and their EF Core queries live in the
   module's Infrastructure project (vertical slices). Persistence entities never leave a handler: responses
   are DTO records mirroring the contract, and integration tests validate every response against the
   OpenAPI schema.
3. **One connection and transaction per request.** All module DbContexts share a request-scoped
   `NpgsqlConnection` (`ConnectionScope`). `IUnitOfWork.ExecuteAsync` opens one transaction that every
   context joins on SaveChanges, so a change, its audit rows and (later) its outbox rows commit together.
   Failure paths that must persist (failed OTP attempts, refresh-token reuse revocation) save outside the
   unit of work before returning the error.
4. **RLS session state.** A command interceptor sets `app.tenant_id` and `app.cross_tenant` on the
   PostgreSQL session whenever `ITenantContext` changes. Policies:
   `cross_tenant = 'on' OR tenant_id = app.tenant_id`, with `ENABLE` + `FORCE ROW LEVEL SECURITY`. The API
   connects as `homebell_app` (not owner, `NOBYPASSRLS`); the migrator connects as the owner and re-grants
   the app role after every migration. The audit log is `SELECT, INSERT` only.
5. **Cross-tenant reads are explicit.** `ITenantContext.CrossTenant(reason)` lifts scoping for code paths
   that legitimately span tenants (a user's own memberships/guardian profiles, platform-plane endpoints).
   It is scoped (`using`), nests, and is the only way to see rows of more than one tenant.
6. **Audit in the same transaction.** `IAuditWriter.Write` buffers rows that the next module SaveChanges
   persists in the same transaction; anything left is flushed at the end of the request. Security
   failures use `WriteImmediatelyAsync` (own transaction) so a rollback cannot erase them. Phones are
   masked; codes and tokens are never written.
7. **Tokens.** Access tokens are ES256 JWTs (10 min); sessions are revoked through a Redis denylist
   checked on every request. Refresh tokens are opaque, SHA-256 hashed, rotated on use, and reuse revokes
   the session. Staff MFA step tokens and TOTP secrets use ASP.NET Data Protection. **Production must
   configure a persistent, shared Data Protection key ring** (Phase 7) — otherwise TOTP secrets become
   unreadable after a key-ring loss.
8. **OTP delivery.** `IOtpSender` is an abstraction. Development delivers the "SMS" to the local Mailpit
   inbox (never to logs); production fails closed (`OTP_TEMPORARILY_UNAVAILABLE`) until the SMS provider
   decision is made (Phase 3). `Otp:DevelopmentFixedCode` is honoured only in Development/Testing.
9. **File logging.** Serilog with the neuXplus line format
   `yyyy-MM-dd HH:mm:ss,fff - LEVEL - UniqueId - PlainText - SensitiveData`, a rolling application log and
   a separate audit-trail log (10 × 10 MB), errors also to the console. `LogHelper` / `IAppLogger` keep
   the familiar `WriteLine(level, id, plainText, sensitiveData)` API. Sensitive data is always masked
   (`SensitiveData.Mask`/`Scrub`); the database audit log stays the authoritative audit record.

10. **Idempotency records** live in Redis for 24 h (AOF persistence on), keyed by operation scope + caller +
    key, with the request hash. Same key + same body replays the stored response (`Idempotent-Replayed:
true`); a different body is `422 IDEMPOTENCY_KEY_REUSED`; a request still running is `409
IDEMPOTENCY_IN_PROGRESS`. Errors and 5xx responses are not stored, so a retry re-executes. A durable
    PostgreSQL copy (07-audit-outbox-workers §3) is added before multi-region deployment.
11. **Pagination cursors** are opaque; today they encode an offset. Clients must treat them as opaque so a
    later move to keyset cursors needs no contract change.

## Consequences

- New modules follow the same pattern: `AddModuleDbContext`, tenant-owned entities implement
  `ITenantOwned`, migrations call `EnableTenantRls`, endpoints use `RequireTenantPermission` /
  `RequirePlatformPermission`.
- Integration tests need Docker (Testcontainers PostgreSQL 17 + Redis 7).
- Rate limiting is in-process for now; it moves to Redis-backed partitions before multi-instance
  deployment (Phase 7).
