# Phase 2 — Platform Owner Control Panel

Status: approved by the user on 2026-10-08 and implemented. See [PHASE_2_REPORT.md](PHASE_2_REPORT.md) for delivered behavior, validation and remaining integration gates.

## Goal and scope

Deliver the owner-facing Next.js portal and its authoritative backend workflows: platform sign-in, tenant onboarding/list/detail, annual USD plans and immutable plan versions, manual subscription assignment, trial/free/pilot/manual grants, lifecycle actions, limits/usage, entitlement overrides, internal notes and platform audit.

The owner must be able to create a school, assign bounded access, inspect its effective permissions/limits, suspend it immediately and reinstate it only when a valid grant exists. UI state must reflect committed backend results, including stale-version conflicts and failed requests.

Excluded: school dashboard, guardian/mobile workflows, pickup, payment collection, automatic refunds, public display, impersonation, production deployment and irreversible offboarding deletion/export implementation. Offboarding is an audited service lifecycle state; it must not claim data export or deletion has occurred.

## Existing dependencies and assumptions

Phase 1 supplies tested sessions/OIDC, PostgreSQL roles/RLS, scoped school records, atomic audit/outbox and idempotency. It currently provides only platform tenant list/create, and school admission checks `status` plus `access_until`. Existing platform bootstrap grants only `tenant.create` and `tenant.read`.

Node 24.19, pnpm 11.19, PostgreSQL 18.4 and local WSL Redis are available. Keep these. Add Next.js, React and Playwright only when implementation starts; verify supported compatible releases, peer dependencies and security advisories, then pin exact versions. Retain TypeScript 6 if compatible; report a material tooling incompatibility instead of silently changing the approved stack.

Real OIDC credentials are still absent. The portal will show a clear configuration-required sign-in state, and full authenticated browser tests will use the existing pattern of an isolated signed test issuer. No login bypass, fake administrator header or production-enabled test issuer will be introduced. Live provider configuration remains an external integration gate.

## Product decisions proposed for approval

These refine D12 and clarify Phase 2's limit accounting. Approval of this proposal approves these defaults; it does not settle later additional-guardian pricing decisions.

| Decision | Recommended behavior |
|---|---|
| Cancellation | Immediate effective cancellation in Phase 2. Preserve underlying history and record the reason. Scheduled end-of-term cancellation is deferred. |
| Grace access | No implicit grace period and no acknowledgment-only exception. Suspended/deactivated/cancelled/offboarding/expired tenants cannot use protected school operations. |
| Lower licensed-child cap | Reject any new assignment/override/removal that would reduce the current effective cap below allocated usage. Do not delete, deactivate or silently grandfather children. Expiry still ends access independently of usage. |
| License allocation | Count active students as allocated licensed-child slots in Phase 2. Creation/reactivation consumes one; inactivation releases it. Inactive/history records remain retained. No paid guardian access is inferred from a student or relationship. |
| Annual paid assignment | Select an immutable USD plan version and annual term. Record an explicit manual commercial assignment/reference and reason. It is not a gateway-verified payment or refund. No invented production prices are seeded. |
| Annual term calculation | One calendar year from the selected UTC start instant; clamp February 29 to February 28 in a non-leap anniversary year. Show the computed end before submission. Do not assume 365 days. |
| Complimentary extension | Extend a trial/free/manual grant explicitly. Extending access beyond a paid term creates a separately labeled bounded manual grant; it does not rewrite the original annual subscription term. |
| Free/pilot/trial | Require an explicit start, end, capability set and licensed-child cap. No unbounded silent free access. Charity/free access is represented by the pilot/free grant with a labeled reason. |
| Manual overrides | Typed capability allow/deny or explicit limit override, bounded start/end, reason and actor. Denials beat allows; suspension/deactivation cannot be overridden. Reject overlapping active overrides for the same capability/limit to avoid ambiguous precedence. |

Reject grant removal or replacement that leaves an operational state without valid access unless the command explicitly suspends/deactivates/cancels it. Natural expiration always denies access even if a background job has not run.

## Architecture and application boundary

Create `apps/platform-admin` with Next.js App Router, React and TypeScript. Use server-rendered page structure with small client components for search, forms, confirmation dialogs and pending states. Keep business rules in NestJS; the web app never connects to PostgreSQL or decides whether access is permitted.

Use a restricted same-origin API proxy for the portal. Allow only the platform API, platform authentication and current-session routes. Preserve separate `Set-Cookie` headers, status codes, correlation headers and safe errors; disable response caching for authenticated data. Fix the backend target in server-only configuration and reject arbitrary destinations/path traversal. Do not forward tenant-plane routes or trust browser-provided forwarded-host/origin headers. Verify the browser's exact Origin before forwarding mutations; a proxy must not manufacture a trusted origin for an untrusted caller.

Continue Secure/HttpOnly session cookies, CSRF, current-session checks and platform MFA. Introduce explicit platform versus school audience/origin/cookie handling so a school session cannot masquerade as a platform session and logging into one context does not overwrite the other. Preserve existing backend test callers through explicitly defined configuration; avoid broad wildcard CORS or token access in browser localStorage. `/me` provides server-computed platform permissions for display decisions; every mutation still enforces those permissions in NestJS.

Local HTTPS uses workspace-local certificates and documented Next development HTTPS flags. Do not install a system trust root automatically. Browser automation may accept only the local test certificate in its isolated test context. Production provider/browser configuration requires trusted TLS. Do not set global TLS-verification bypass variables.

Next documentation confirms that route handlers and server functions require their own authorization checks, and documents explicit development certificate flags: [authentication](https://nextjs.org/docs/app/guides/authentication), [CLI HTTPS options](https://nextjs.org/docs/app/api-reference/cli/next), [installation/build checks](https://nextjs.org/docs/app/getting-started/installation). A successful Next build does not substitute for a separate lint check.

## Backend modules and authorization

Split the expanded platform service into focused tenant administration, plan/subscription, grants/entitlements, lifecycle, notes, usage and audit services/controllers. Extend shared Zod contracts. Keep the transaction/idempotency/evidence infrastructure and avoid a single generic status-update endpoint.

Persist explicit platform role templates and assignments, mapped to capabilities. Add a reviewed operator command to assign these roles with reason/audit. Existing Phase 1 identities retain their existing two permissions until explicitly assigned a new role; do not automatically promote everyone to Super Admin.

| Capability group | Super Admin | Platform Operations | Billing Operations | Optional Support Analyst |
|---|---|---|---|---|
| Tenant catalog/detail and aggregate usage | Yes | Yes | Yes | Read only |
| Create tenant; suspend/deactivate/cancel/offboard/reinstate | Yes | Yes | No | No |
| Plan/version management and manual subscription assignment | Yes | Read | Yes | Read only if explicitly granted |
| Trial/free/manual grants and bounded overrides | Yes | No by default | Yes | No |
| Internal notes | Yes | Yes | Yes within authorized tenant scope | Read only |
| Platform audit | Yes | Operations actions | Billing actions | Explicit safe read scope |
| Tenant student/guardian records or impersonation | No implicit access | No | No | No |

Use capabilities rather than checking role names in controllers. Platform authority and school authority remain distinct. All scope filtering occurs before pagination/counts; UI-hidden controls do not constitute authorization.

## Data model, isolation and migrations

Append migrations after `1780000000003`; do not modify previously applied migration behavior.

1. **Platform authority and commercial definitions:** platform roles/role permissions/assignments; plan and published immutable plan version, USD minor-unit annual amount, capability definitions and child cap. Editing a published plan creates a new version; archiving stops new assignments without changing existing terms.
2. **Tenant commercial/access state:** tenant subscription/history, explicit grant records, time-bounded overrides, lifecycle history, safe control-plane notes and refund-status notes. Tenant-owned rows carry `tenant_id` and appropriate composite references. Preserve the existing tenant row version as the common concurrency guard for changes to effective access.
3. **Usage and enforcement:** tenant aggregate counters for total/active students, active/blocked guardians and active staff memberships, with snapshot/update time. No child/guardian identity fields enter these counters. Add platform-audit tenant linkage and relevant time/resource indexes without rewriting old evidence.

The control database role can access control-plane records and aggregate usage, never arbitrary raw school tables. Tenant runtime reads only its own effective access data under RLS. Plan definitions are globally readable as required; grants/subscriptions remain tenant-scoped. Internal platform notes are never returned to school APIs.

Populate usage counters through narrowly scoped database trigger functions with a dedicated non-login owner, fixed search path, explicit object names and no public execution grant. The function owner gets only the counter-table permissions it needs; no blanket RLS bypass for the control-plane runtime. Triggers adjust counters in the same transaction as school-record writes. Verify create, inactive/reactivate, block/deactivate and membership updates. An authorized reconciliation process compares aggregates under the migration/maintenance boundary; raw records never cross into the portal response.

For cap admission, use a tenant-scoped allocation-row lock before student creation/reactivation; current mutations retain the tenant access guard. Competing allocations cannot exceed the cap. Count changes and records commit together. A cap reduction/lifecycle mutation locks the tenant access row exclusively, ordering against school commands already holding its shared lock. Maintain the global account/session → tenant → membership/resource/allocation → audit/outbox ordering and test deadlocks/conflicts explicitly.

### Upgrade handling

Before migration, inventory existing tenant states, expiry, assignments and active counts without printing personal data. Preserve drafts. There is no authoritative commercial plan for a Phase 1 synthetic trial; do not invent a paid plan or label test data as revenue.

New entitlement enforcement initially supports an explicitly recorded, bounded legacy-access grant for an existing valid trial/pilot/manual record, limited to its previous expiry and existing capabilities, with cap equal to its current active allocation. It preserves existing operational access but does not allow adding licensed children until an operator assigns a suitable cap. Mark its provenance as migration and show it for reconciliation. Existing `active_paid` records without authoritative subscription details require operator reconciliation; fail the preflight for those records rather than inventing commercial history or silently cutting access. Phase 1 test fixtures are updated to create explicit grants.

Use additive schema first, validate/backfill aggregates and access records, then enable the new resolver. Keep `access_until` as a compatibility projection during this phase; it is no longer sufficient to authorize access. Once restrictive Phase 2 policies are enabled, rolling back to Phase 1 would bypass them, so recovery requires a forward repair or a maintenance window with tenant operations disabled. Do not advertise a simple old-code rollback. Rehearse migrations on the dedicated test database, measure lock scope and set bounded lock/statement timeouts.

## Entitlement and lifecycle rules

The central resolver returns allowed/denied, reason code, effective interval, capabilities, limits, usage, provenance and policy/tenant version. Evaluate explicit lifecycle denials first, current base subscription/grant second, typed overrides third, then user permissions/relationship and operation-specific eligibility. A feature flag cannot create a permission. Every school operation queries current durable policy; API denial cannot depend on a browser cache or periodic expiry task.

Lifecycle commands: activate with a valid access basis, start trial, grant free, assign paid, grant manual access, extend access, suspend, deactivate, cancel, offboard and reinstate. Every command carries `expectedVersion`, idempotency key and reason. Validate required setup fields and current state. Reinstate re-evaluates current grants and expiry; it never blindly restores an old paid state. Effective expiry is calculated at read/request time and displayed even before stored-state reconciliation.

Mutations commit their business change, access/version projection, platform audit, tenant-safe audit and outbox event atomically. Private note text and private commercial reasons stay in authorized control-plane evidence, not public/tenant event payloads. No financial side effect is generated. Future realtime consumers can respond to access-change events; Phase 2 school API checks already enforce the new access immediately.

## Proposed API contracts

All routes below use `/api/v1/platform`, platform audience, MFA and the applicable capability. Lists accept bound cursor/limit (default 25, max 100); validate search/status/time filters. All mutations are idempotent, reject unknown writable fields and validate versions. Server supplies actor, tenant scope and timestamps.

| Method / route | Main input | Result / rule |
|---|---|---|
| GET `/tenants` | `search`, `status`, cursor, limit | Catalog with effective state, access expiry and aggregate limits; no student/guardian objects |
| POST `/tenants` | Existing name/time zone contract | Draft tenant, default campus/roles; keep Phase 1 behavior |
| GET `/tenants/{id}` | Tenant UUID | Detail, effective access/provenance, commercial summary and permitted actions |
| GET `/plans`; POST `/plans` | POST name (1–120), code (unique, bounded) | Plan definition; no invented default production pricing |
| POST `/plans/{id}/versions` | Annual USD amount in integer minor units, child cap, allowlisted capabilities, expected plan version, reason | Publish immutable version after validation |
| POST `/plans/{id}/archive` | Expected version, reason | Prevent new assignments; retain prior subscriptions |
| POST `/tenants/{id}/subscriptions` | Plan-version UUID, UTC term start, manual reference/reason, expected tenant version | Annual assignment/history; no gateway payment claim; reject overlapping active paid terms |
| POST `/tenants/{id}/lifecycle-actions` | Named action, reason, expected version; typed access basis/interval/cap when required | New lifecycle/effective access; reject arbitrary status writes and invalid transitions |
| POST `/tenants/{id}/access-extensions` | Target grant/subscription reference, new end, reason, expected version | Extend eligible free grant or create explicit complimentary grant beyond paid term |
| POST `/tenants/{id}/entitlement-overrides` | Typed target, value, start/end, reason, expected version | Bounded override; reject overlap and under-cap changes |
| POST `/tenants/{id}/entitlement-overrides/{overrideId}/revoke` | Reason, expected version | Append revocation evidence and recompute access |
| GET `/tenants/{id}/entitlements`; GET `/tenants/{id}/usage` | Tenant UUID | Resolver explanation and aggregate usage with observation time |
| GET/POST `/tenants/{id}/notes` | POST text (1–2000), optional manual refund-status enum, expected version | Append-only internal note; no refund action |
| GET `/audit-events` | Bounded date range, optional authorized tenant/action/actor filter | Permission-filtered platform evidence including operator provenance |

Errors follow existing conventions: `FORBIDDEN`, `NOT_FOUND`, `VERSION_CONFLICT`, `IDEMPOTENCY_CONFLICT`, plus `INVALID_LIFECYCLE_TRANSITION`, `NO_VALID_ACCESS_BASIS`, `CAP_BELOW_USAGE`, `LICENSE_LIMIT_REACHED`, `OVERLAPPING_GRANT` and `PLAN_VERSION_IMMUTABLE`. UI shows a safe explanation and refresh path; it never overwrites a conflict automatically.

## Screens and interaction design

- **Sign-in/session:** configured OIDC sign-in, missing-configuration state, loading, access denied, expired session and logout. Refresh is single-flight; failed refresh requires sign-in.
- **Overview:** school totals by effective lifecycle, expiring access and reconciliation-needed counts. These are operational counts, not unsupported revenue analytics.
- **Tenant list:** accessible search/filter, state badges, expiry, usage/cap and cursor pagination; clear loading/error/empty states.
- **Create tenant:** school name/time zone and a clear draft outcome.
- **Tenant detail:** overview, subscription/plan, effective entitlements, overrides, usage, internal notes and audit. Show access provenance and explicit denial reason.
- **Plans:** list, create, publish immutable version, archive; make annual USD terms and child cap visible.
- **Privileged actions:** deliberate dialog showing school, effect, time/cap and required reason. Disable repeat submission while pending; retry unknown outcomes with the same key. Confirm suspension/cancellation/offboarding distinctly.

Use a restrained desktop operations layout with responsive navigation, readable tables, keyboard focus, labeled inputs and text-backed status colors. Distinguish a committed action from a timeout; do not show success before the API commits. Use synthetic test fixtures for screenshots, never private school data.

## Logging, testing and acceptance

Extend structured logs with safe action/result identifiers, effective-policy version and correlation; omit tokens and note bodies. Audit every grant/subscription/override/lifecycle/note/role-assignment change. Track entitlement denial counts, lifecycle conflicts and aggregate-reconciliation failures without high-cardinality metric labels.

Required checks:

1. Preserve the existing 37 Phase 1 tests, adapting synthetic grants only for the new authoritative model.
2. Add unit tests for lifecycle transitions, denial precedence, interval/anniversary boundaries, cap rules and overlap rejection.
3. Real PostgreSQL tests for role boundaries, cross-tenant references, immutable versions, grant expiry without jobs, concurrent cap allocation/reduction, suspend-versus-write ordering, idempotent retries, atomic audit/outbox and counter reconciliation.
4. Test the privilege boundary directly: the control-plane runtime cannot select raw students/guardians even though usage is visible.
5. Browser tests through signed test OIDC: login, tenant list/create/detail, plan assignment, trial/free/override, suspend/reinstate, notes/audit, restricted roles, CSRF, session expiry and conflicting edits.
6. Inspect screenshots at desktop/mobile widths and verify keyboard/dialog/error states. No screenshot bypass of authentication.
7. Run API and web builds, strict type checks, lint, formatting, unit/integration/browser suites, migrations and dependency checks. Record any missing external-provider validation honestly.

Acceptance: an authorized operator can perform the stated end-to-end workflows; permissions, denial precedence and child caps remain server-enforced; historical evidence survives lifecycle changes; browser tests and relevant existing checks pass; setup/run instructions support local HTTPS; no automatic financial/refund action or unrequested school access exists. No production release is implied.

## Expected changes, rollout and risk

Create `apps/platform-admin` and its tests; add focused backend services/controllers and shared schemas; add new migrations, role-bootstrap support, browser-test configuration and local HTTPS/start helpers. Update workspace/build/CI configuration and ARCHITECTURE, AUTH_AND_RBAC, DATABASE, ENTITLEMENTS, API_STANDARDS, TESTING, LOCAL_SETUP and PHASE_PLAN. Existing migration files stay frozen.

Implement in checkpoints: migration/preflight and resolver first; API/role/concurrency tests next; HTTPS/session integration next; portal and browser verification last. Use only synthetic local/test data during development. Production issuer configuration and any system trust-store change require their own concrete setup, not implicit approval to publish or purchase services.

Main risks: granting stale access after suspension, counter/cap races, unsafe aggregate privileges, migration of access without commercial evidence, and cookie/origin leakage through the portal proxy. The specific locks, restricted roles, migration preflight, same-origin allowlist and negative tests above are acceptance conditions.

## Approval record

The user approved this scope and the decision table with “Proceed to implement Phase 2”, including web dependencies, additive migrations, local HTTPS helpers and browser tests. Real OIDC credentials can be supplied later through local configuration; they are not needed in chat. Phase 3 and production deployment remain outside this approval.

