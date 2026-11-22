# ADR-0003: Shared-schema multitenancy with PostgreSQL RLS

- **Status**: Accepted
- **Date**: 2026-11-22

## Context

Many small tenants (schools) with spiky, similar workloads; strict isolation is mandatory; a few large
groups may need stronger isolation later.

## Options

1. Database per tenant — strongest isolation, high operational cost at hundreds of schools.
2. Schema per tenant — migration fan-out pain, connection pool pressure.
3. **Shared schema with `tenant_id` + RLS** — cheapest, scales well, isolation via layered controls.

## Decision

Option 3, with layered enforcement: path-scoped tenant → membership check → `ITenantContext` → EF global
query filters → SaveChanges interceptor → PostgreSQL RLS (`SET LOCAL app.tenant_id`) → isolation test suite.
`Tenant.dataPlacement` keeps a path to dedicated databases (hybrid) without domain changes.

## Consequences

Every tenant-owned table needs `tenant_id`, an index leading with `tenant_id`, and an RLS policy (migration
checklist + architecture test that asserts all `ITenantOwned` entities are configured). Cross-tenant jobs
use a separate DB role and are audited.
