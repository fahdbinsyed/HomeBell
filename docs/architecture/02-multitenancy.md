# Multitenancy

## 1. Model

- **One school = one tenant.** `Tenant` lives in the control plane (`platform` schema).
- **Campus** is modelled now (`campus_id` nullable on tenant-owned operational tables where relevant),
  exposed later (multi-campus, ADR future hook).
- **People are global, roles are per tenant.** A `UserAccount` (Identity) is global. Staff join tenants
  through `TenantMembership`; guardians through a per-tenant `Guardian` profile (ADR-0006).

## 2. Control plane vs tenant plane

| Control plane (`/v1/platform/**`)                                                                                                      | Tenant plane (`/v1/t/{tenantId}/**`, `/v1/me/**`, `/v1/display/**`)                                                    |
| -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Tenants, lifecycle, plans, plan versions, subscriptions, overrides, flags, notes, platform users, support sessions, cross-tenant audit | Students, classes, guardians, invitations, licenses, pickup requests, queue, displays, settings, reports, tenant audit |
| Caller must hold a platform role; never implicitly tenant-scoped                                                                       | Caller must be scoped to the tenant (membership / guardian profile / display token / support session)                  |

Control-plane code may read tenant-plane data only through module Contracts (e.g. usage counters), never
by querying tenant tables directly.

## 3. Tenant resolution

| Caller           | How the tenant is determined                                                                                                                                   |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| School staff     | `tenantId` path segment, validated against the caller's active memberships (claim `mem` + DB check, cached 60 s)                                               |
| Guardian         | `/v1/me/**` aggregates across the guardian's tenants; writes carry `tenantId` in the body/path and are validated against the caller's active Guardian profiles |
| Display          | `tenantId` comes **only** from the display token; displays cannot address other tenants                                                                        |
| Platform support | Read-only `SupportSession` token scoped to one tenant for ≤ 30 min                                                                                             |

Tenant is **never** taken from an `X-Tenant-Id` header, hostname, or request body for authorization.
Unknown or foreign tenant IDs return `404 NOT_FOUND` (never 403) to avoid tenant enumeration.

## 4. Isolation — defense in depth

1. **Authorization policy** checks tenant scope before any handler runs.
2. **`ITenantContext`** is set once per request; repositories cannot be constructed without it.
3. **EF Core global query filters** on every `ITenantOwned` entity: `e.TenantId == _tenant.Id`.
4. **SaveChanges interceptor** stamps `TenantId` on insert and throws on cross-tenant update/delete.
5. **PostgreSQL Row-Level Security** on every tenant-owned table:
   ```sql
   ALTER TABLE schools.student ENABLE ROW LEVEL SECURITY;
   ALTER TABLE schools.student FORCE ROW LEVEL SECURITY;
   CREATE POLICY tenant_isolation ON schools.student
     USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
   ```
   The connection interceptor runs `SET LOCAL app.tenant_id = '<id>'` inside each transaction. The
   application role is not the table owner and has no `BYPASSRLS`. Control-plane and worker jobs that
   legitimately span tenants use a separate role with an explicit, audited code path.
6. **Tenant-isolation test suite** (Phase 2): for every tenant-owned endpoint, a token for tenant A
   requesting tenant B's resource must yield 404, and list endpoints must return zero foreign rows.
7. **Cache keys, SignalR groups, idempotency keys, rate-limit keys and storage paths** are all prefixed
   with the tenant ID.

## 5. Hybrid-ready placement

`Tenant.dataPlacement` (`shared` | `dedicated`) + `placementKey` select a connection string through
`ITenantConnectionFactory`. MVP: everything is `shared`. A large group can later move to a dedicated
database (or region) without domain-code changes; migrations are run per placement.

## 6. Tenant-aware everything

Configuration (`TenantSettings`), entitlements (`EntitlementResolver`), reports, live queue, display feed,
audit logs, notifications and rate limits are all keyed by tenant. Tenant timezone (IANA) drives
dismissal windows, "today", queue-day sequencing and report day boundaries.
