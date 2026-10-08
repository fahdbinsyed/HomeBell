# Phase 1 — Platform core and multi-tenant backend foundation

Status: proposal approved by the user's “Ok Proceed” instruction following setup confirmation. Phase 1 was implemented and verified locally on 2026-10-08. This document preserves the approved scope; see [PHASE_1_REPORT.md](PHASE_1_REPORT.md) for actual tooling, checks, deviations and remaining provider/release gates.

## Goal and acceptance boundary

Deliver a runnable, tested backend foundation with tenant isolation, identity/session management, persisted permissions, school and guardian records, audit, configuration, logging and database migrations. Success means a synthetic two-school scenario works through authenticated APIs, while attempts to cross tenant or permission boundaries fail under the real database runtime role.

No web/mobile UI, pickup workflow, billing, live queue, public display, paid guardian invitations, device-transfer UX or production deployment is included. Phase 1 implements the account/device/session primitives needed to enforce those later features safely. No real student data or live SMS is needed.

## Dependencies, environment and assumptions

- Phase 0 proposal and documentation are the design baseline; frozen product rules remain unchanged.
- Local inspection found Node.js 20.15.0, npm 10.7.0, pnpm 11.19.0 and Git commands. Docker, Podman, PostgreSQL and Redis executables were not found on PATH. This is not proof they are absent elsewhere or that no remote test services exist.
- Recommend an isolated Node.js 24 LTS runtime and Docker Compose for PostgreSQL/Redis test services. Do not replace the machine-wide Node installation as an incidental setup action.
- Integration tests require actual PostgreSQL and Redis. Missing services are a verification blocker, not permission to substitute mocks and claim completion. A user-supplied dedicated nonproduction database/Redis endpoint can substitute for local containers.
- No Git metadata currently exists in this folder. Prepare CI configuration locally; remote creation/publishing is outside this phase.
- Initial tenants and identity mappings are provisioned through a controlled operator bootstrap command. No public registration or default admin credentials.

## Tooling recommendation (D01)

| Component | Proposed selection | Reason / validation |
|---|---|---|
| Runtime | Node.js 24 LTS, patched release meeting tooling minimums | Supported LTS baseline; installed Node 20.15 is below the documented Nest 12 runtime floor |
| Framework | NestJS 12, Express adapter, ESM | Current documented framework line; consistent TypeScript backend and standard middleware |
| Language | TypeScript 6, strict configuration | Match current Nest tooling direction; validate decorators, ESM and test transforms together |
| Workspace | pnpm, exact version pinned after Node compatibility check | One workspace lockfile; reproducible frozen installs |
| Database | PostgreSQL 18; `pg` driver | Explicit parameterized SQL and one checked-out client for each guarded tenant transaction |
| Migrations | `node-pg-migrate`, reviewed SQL operations | Explicit RLS, grants, constraints and transaction behavior without schema auto-sync |
| Validation | Zod schemas at config and API boundaries | Explicit allowlisted writable fields and shared contracts |
| Auth protocol | `openid-client` for staff OIDC; `jose` for application access tokens | Maintained protocol/token libraries rather than custom cryptography |
| Logs | Pino through internal redacting logger | Structured logs with centralized redaction |
| Tests | Vitest, Supertest; actual PostgreSQL/Redis integration suites | Unit, HTTP and isolation/concurrency verification |
| Quality | ESLint with TypeScript support, Prettier, TypeScript compiler | Deterministic format/lint/type/build gates |

Use Redis for distributed authentication/rate-limit coordination. BullMQ, notification delivery and a running outbox relay are deferred until a real consumer is needed; Phase 1 creates transactional outbox storage and proves its atomic writes.

Alternatives considered: Prisma/Drizzle offer generated/query types but add another abstraction around custom policies and transaction context. Parameterized SQL repositories are preferred for this foundation because RLS and locking are central. Tradeoff: explicit result mapping and more SQL review. Prohibit ad hoc `pool.query` inside a transaction and restrict direct database imports to infrastructure/repositories.

D01 is a recommended choice, not a claim of completed compatibility proof. First implementation checkpoint: pin exact published package versions and image digests, validate licenses/engines/peer dependencies, compile an ESM Nest module, then prove RLS/context/reset behavior with `pg`. Record versions and evidence in the lockfile and setup documentation. Do not silently switch libraries if this fails; report any material redesign. Patch pins are intentionally not invented in this proposal.

References checked 2026-10-07: [Node releases](https://nodejs.org/en/about/previous-releases), [Nest migration/runtime requirements](https://docs.nestjs.com/migration-guide), [pg transaction requirements](https://node-postgres.com/features/transactions), [node-pg-migrate](https://salsita.github.io/node-pg-migrate/), [openid-client](https://github.com/panva/openid-client).

## Authentication and authorization proposal (D02)

### Staff OIDC

Implement Authorization Code flow with PKCE, state and nonce through an allowlisted configured issuer. Verify issuer, audience, signature, expiry and nonce; use fixed callback URLs and allowlisted post-login redirects. The application maps `(issuer, subject)` to a provisioned user. Email/domain claims never grant platform or school roles automatically.

Require configured, provider-specific verified MFA assurance for platform sessions. Missing or insufficient assurance denies the session; do not treat any arbitrary `amr` string as universal MFA proof. School-admin MFA is also required in the initial role policy. Issuer onboarding documentation must specify the assurance mapping. Test with a local test-only OIDC issuer and signed fixtures; production staff login stays disabled until the chosen issuer/client/MFA configuration is supplied and validated. No paid provider account is created.

Proposed token/session defaults:

| Setting | Initial default |
|---|---|
| Application access token | 5 minutes; issuer, audience, subject, session ID, issued/expiry time, token ID |
| Staff session | 8-hour absolute lifetime, 30-minute idle timeout |
| Guardian session primitive | 30-day absolute lifetime, 7-day idle timeout; guardian login remains unavailable in this phase |
| Refresh | Rotate on every successful use; store digest only; spent-token reuse revokes family |
| Web cookies | Secure, HttpOnly, host-only, SameSite=Lax; explicit CSRF token and origin check on mutation/refresh/logout |
| Primary mobile device | One durable active-device slot per primary account; deny a second device until approved transfer workflow exists |

Session permissions are never trusted solely from a token. Resolve current account/session, tenant state, membership and resource permission for each operation; final mutation checks happen in the guarded database transaction. Logout and user/membership disabling immediately prevent subsequent authorized operations. Token keys use configured asymmetric signing with key IDs and rotation support; never ship a default signing key.

Client refresh is single-flight. Strict spent-token reuse revokes the family, so network loss after rotation may require reauthentication; document this tradeoff and do not add an unreviewed replay grace window.

### OTP boundary

Define purpose-bound challenge/proof interfaces and protected storage model now. Implement policy primitives and tests, but do not expose public guardian OTP or delivery endpoints until the guardian onboarding phase and provider selection. No debug route returns codes or tokens.

Proposed defaults for the later enabled flow: 5-minute challenge expiry, 60-second resend interval, 5 verification attempts per challenge, 5 sends/hour per normalized-phone digest and 20/hour per network source, 15-minute lockout after challenge exhaustion. Counters apply atomically across replicas; resending does not reset the failed-attempt budget. Provider daily spend ceiling is required before delivery enablement. Limits remain configurable and subject to provider/launch review; these numbers are proposals, not measured production settings.

D02 protocol/session choices can be approved with this proposal. External staff issuer, claim mapping and OTP vendor remain separate integration gates; tests do not imply provider integration has been validated.

## Modules and domain scope

`apps/api/src` contains config, database, request-context, auth, authorization, tenancy, school-records, guardians, audit, idempotency, health and observability modules. Controllers validate DTOs; application services authorize and transact; repositories accept trusted context and a transaction-bound client. No controller accepts a client-supplied actor or directly persists arbitrary request bodies.

Initially create shared config, API contracts/validation and testing packages where there are actual consumers. Keep server-only security and observability modules in the API until another application needs them. This follows the Phase 0 rule against empty shared packages.

Persist permissions and role templates in tables; provision tenant role instances with each tenant. Phase 1 exposes only capabilities it implements. Read-only roles cannot mutate. Platform staff cannot use tenant CRUD by virtue of their platform role. Guardian-scoped self-service operations are not enabled yet.

## Database changes and migration plan

Proposed ordered migrations, each with checked-in review notes:

1. **Foundation:** schemas, database roles/grants, tenant catalog, campus, tenant access policy/version. Model all required tenant states but expose only draft tenant creation at this phase; operator-only synthetic fixtures can create bounded trial access for tests.
2. **Identity and authority:** users, external identities, account security/device slot, device registry, sessions and refresh family/token digests; tenant memberships, role/permission definitions, role grants and platform assignments. OTP challenge/proof storage remains unreachable from public HTTP.
3. **School records:** classes, sections, students, tenant guardian profiles and guardian-student links with role/status/validity metadata. No paid license or invitation grants are manufactured.
4. **Evidence and infrastructure:** tenant/platform audit storage, idempotency records and transactional outbox.

All tenant-owned tables: non-null tenant ID, `(tenant_id, id)` referenced key, composite foreign keys, forced RLS read/write policies, tenant-leading query indexes, created/updated timestamps and optimistic versions where mutable. Device/session ownership is global account identity and receives distinct narrow access boundaries.

Use distinct migration, identity, tenant and control-plane database pools/roles with only needed grants. Identity lookup APIs are internal only. The tenant repository has no platform bypass option. Missing context denies all access. Wrap `BEGIN`, parameterized transaction-local context setup, authorization guard locks, work and `COMMIT/ROLLBACK` on one checked-out client; always release/reset safely. Review platform catalog policies separately from school operational tables.

At most one current primary guardian link per student; history remains retained. A relationship alone does not grant paid mobile entitlement. First-phase staff management of links does not bypass later licensing rules. Tenant state admission is centralized and fails closed; full subscription resolution arrives in Phase 2 before pilot use.

Every successful mutation atomically writes audit and relevant outbox facts. Resource creation and idempotency outcome commit together; 24-hour initial replay retention, with expired-key rejection behavior documented before any client uses it. Nonterminal in-progress keys are not silently reused. Disabled actors cannot retrieve an old replay response.

No migration touches an existing production database. Provision roles through an explicit setup command using administrative credentials, never through normal API startup. Rerun migrations to prove no-op behavior; test upgrade from earlier migration boundaries. Use forward repairs; destructive reset commands are test-only and require a dedicated test database guard.

## Proposed API contracts

All paths below are under `/api/v1` except health. Strict UUIDs, bounded strings, enums and schema validation apply. Unknown writable fields are rejected. Responses follow API_STANDARDS.md; server derives actor, timestamps and tenant authorization.

| Method / path | Input | Output / permission |
|---|---|---|
| GET `/auth/oidc/start` | Allowlisted audience `platform` or `school`; optional allowlisted return path | 302 issuer redirect plus one-use transaction cookie; rate limited |
| GET `/auth/oidc/callback` | Provider `code`, `state`; transaction cookie | 303 allowlisted application target and secure session cookies after verification; no tokens in URL |
| POST `/auth/refresh` | Refresh cookie, CSRF proof | 200 session metadata; rotated cookies; no cached permission grant |
| POST `/auth/logout` | Session cookie, CSRF proof | 204; revoke session/family and clear cookies |
| GET `/me` | Authenticated session | Current user ID, session audience, expiry; no secret material |
| GET `/me/tenants` | School audience | Authorized membership summaries only |
| POST `/platform/tenants` | `name` (1–120), IANA `timeZone`, idempotency key | 201 draft tenant/default campus, version 1; `tenant.create` |
| GET `/platform/tenants` | Optional cursor, limit 1–100 (default 25) | Minimal tenant catalog; `tenant.read` |
| GET `/tenants/{t}` | Verified tenant context | Operational tenant summary; `tenant.read` within school membership |
| GET/POST `/tenants/{t}/classes` | POST `name` (1–80), idempotency key | Tenant class list / 201 resource; `school.records.read/write` |
| GET/POST `/tenants/{t}/sections` | POST `classId`, `name` (1–80), key | Same-tenant class validation; list / 201; records permissions |
| GET/POST `/tenants/{t}/students` | POST `displayName` (1–120), `classId`, optional `sectionId`, key | Minimal list / 201 student; records permissions |
| GET/PATCH `/tenants/{t}/students/{id}` | PATCH allowlisted name/class/section/status, `expectedVersion` | 200 safe record; inactive status retains history; records permissions |
| GET/POST `/tenants/{t}/guardians` | POST `fullName` (1–120), normalized phone, key | Tenant-owned contact/profile without automatic global account access; `guardians.read/manage` |
| POST `/tenants/{t}/students/{id}/guardian-links` | `guardianId`, `role` primary/additional, `relationship` (1–80), key | 201 relationship; `guardians.manage`; no mobile entitlement grant |
| POST `/tenants/{t}/guardians/{id}/access-actions` | action `block`/`deactivate`, reason (1–500), expectedVersion, key | 200 updated status; audit and authorization version change |
| GET `/tenants/{t}/audit-events` | Cursor, bounded time range, limit 1–100 | Safe event metadata; `audit.read` |
| GET `/health/live`, `/health/ready` | No credentials | Minimal process/readiness status; no database/secret details |

Lists sort by stable tuple and use context/filter-bound cursors. Create bodies never accept tenant/actor IDs beyond validated route selection. Class/section references are checked for mutual consistency. Error codes cover validation, session invalid, forbidden, not found, tenant unavailable, version/idempotency conflicts, rate limits and unavailable dependencies.

Tenant membership and role bootstrap uses operator commands in this phase, with explicit target/actor/reason and audit. Staff-management UI/API expansion belongs to Phase 3. There is no arbitrary public user-role assignment or status-update endpoint.

## Security, observability and UI effects

Implement trusted-proxy configuration, bounded requests, allowlisted CORS, security headers, strict DTOs, safe errors, distributed auth throttling and secure cookies/CSRF. No client can set its own permissions or choose an arbitrary database tenant. Production mode refuses test identity/OTP adapters and missing signing/issuer settings for enabled flows.

Use structured logs with request/correlation context, duration/status and stable error codes; redact secrets and sensitive personal fields centrally. Audit successful mutations transactionally and denied/security events through a separate durable path. Add bounded metrics and tracing interfaces; no external monitoring account is required. Protect operational metrics and detailed dependency diagnostics.

No customer-facing UI changes. Development-only OpenAPI documentation can describe authenticated contracts; it must not contain live credentials or become an unrestricted production administrative interface.

## Expected files

Root workspace manifest/lockfile, pnpm workspace config, strict TypeScript configuration, lint/format settings, runtime version pin, `.env.example`, `.github/workflows/ci.yml`, local Compose service definition and setup commands. API source/modules and unit/integration tests under `apps/api`; actual shared contract/config/testing packages as needed. Reviewed migrations and bootstrap commands under an explicit API database directory.

Update README, DATABASE, AUTH_AND_RBAC, ARCHITECTURE, TESTING and PHASE_PLAN with actual selected versions/behavior and verification results. Add local setup instructions. Do not scaffold empty web/mobile apps or worker processes merely to match the future tree.

## Verification and implementation order

1. Verify runtime/dependency compatibility and freeze versions; establish build/lint/typecheck/unit harness.
2. Prove PostgreSQL non-owner RLS, transaction-local context and pool reuse; verify migration role separation before expanding schema.
3. Implement identity/session/OIDC with signed test issuer, audience/issuer/nonce/PKCE checks, MFA mapping, refresh replay and revocation tests.
4. Implement tenant context, persisted permissions and guarded school/guardian operations, audit/idempotency/outbox in one transaction.
5. Run actual PostgreSQL/Redis API tests for two tenants, missing context, platform-token misuse, class/section mismatches, arbitrary IDs, duplicate commands, optimistic conflicts, role changes, primary-device races and revoked sessions.
6. Verify canary secrets never reach logs/errors/traces; exercise unhealthy dependencies, fail-closed authorization and startup validation.
7. Run format, lint, typecheck, unit, integration, API build and migration checks; document exact commands/results and any blockers.

Acceptance requires all applicable checks passing; skipped real-database tests do not count. Future pickup/paid-license/socket tests are deferred with their features, not claimed as Phase 1 coverage. Actual OIDC vendor integration is separately verified before operational use even if protocol fixtures pass.

## Rollout, risks and recovery

Rollout is local/synthetic only. Apply migrations using dedicated setup credentials, bootstrap explicit synthetic operators/tenants, run smoke checks and retain logs without secrets. CI uses isolated PostgreSQL/Redis services; remote CI execution requires a repository integration not currently present.

Main risks: unavailable local database/container runtime, ESM/decorator/test-tool incompatibility, accidental RLS owner bypass, revocation races, and an overly permissive identity issuer. Mitigate with the ordered proof gates above. Do not expand to Phase 2 or a pilot merely because an HTTP server starts.

Recovery for local setup preserves user data and avoids machine-wide tool replacement. Any container installation, external service provisioning or system-level runtime change requires its own concrete authorization where applicable. Project dependency installation and source implementation follow approval of this proposal and applicable sandbox permissions.

## Approval requested

Approve Phase 1 implementation with the scope, tooling direction, staff OIDC/session defaults and test-only provider boundary above. This authorizes local source, reviewed migrations, dependencies and tests; it does not authorize production deployment, paid provider setup or Phase 2. Record final compatible version pins and integration evidence during implementation; keep D01/D02 partially open until their stated proof/provider gates are met.
