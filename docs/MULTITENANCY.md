# Multitenancy

Status: Phase 0 design. One school equals one tenant.

## Trusted context

1. Authenticate a session for the correct audience.
2. Resolve a requested school against active server-side membership or guardian links. A path/header tenant ID is a selector, never proof of access.
3. Evaluate tenant lifecycle, capability, role and resource relationship.
4. Pass an immutable context containing tenant, actor, session, audience and correlation identifiers into application services and repositories.
5. Begin a database transaction and set tenant context locally on that transaction's connection.

Repositories reject missing tenant context. There is no default tenant and no implicit 'all tenants' mode. A multi-school guardian obtains an explicitly scoped session/context per selected school; each request has one tenant. Tenant selection never weakens account-wide device enforcement.

## Database enforcement

Tenant-owned tables have non-null `tenant_id`, tenant-leading indexes, and composite references such as `(tenant_id, student_id)` to `(tenant_id, id)`. RLS policies check both reads (`USING`) and writes (`WITH CHECK`) against transaction-local trusted context; absent context denies access.

Runtime roles are non-owner, non-superuser, without `BYPASSRLS`. Enable and force RLS on protected tables. Use a separately controlled migration role. Parameterize context setting; never interpolate an arbitrary tenant string into SQL. Set transaction-local context for each checked-out connection so pooled requests cannot inherit another tenant's context.

RLS is defense in depth against query mistakes, not a defense against a fully compromised application role that can set tenant context. Authenticated membership validation and parameterized queries remain mandatory. Integrity errors must be normalized so foreign-key/uniqueness details do not reveal another tenant's records.

PostgreSQL owner/bypass behavior and policy semantics are documented in the [official RLS reference](https://www.postgresql.org/docs/current/ddl-rowsecurity.html).

## Control plane

Keep global plan definitions, global identity and platform role assignments separate from tenant data. Tenant catalogs and subscriptions are accessible through narrow control-plane repositories authorized for explicit platform capabilities. Use a separate control-plane database role/pool that grants only required control-plane table access, not blanket RLS bypass.

Tenant lifecycle changes use scoped administrative operations and audit the actual platform actor. Global usage views expose operational aggregates, not raw children/guardian data. Tenant-plane APIs reject a platform token unless a separately approved access mechanism exists. Support impersonation is not part of the MVP baseline.

## Other isolation boundaries

| Surface | Required isolation |
|---|---|
| Redis keys | Namespace by environment, tenant and resource; global account limits explicitly separate |
| Realtime | Server-assigned tenant plus audience channels; per-user guardian projections |
| Workers | Trusted outbox/job record resolved server-side; establish fresh tenant transaction context |
| Reports | Tenant-filtered queries; owner/permission checked on download; short-lived download authorization |
| Display | Tenant-bound restricted credential; minimal projection only |
| Search and counts | Scope before filtering, aggregation and pagination |
| Audit | Tenant audit and platform audit have distinct authorized retrieval paths |
| Files / exports | Tenant and report owner metadata; no public object listing or predictable public URLs |

Jobs are not authorized simply because a payload contains a tenant ID. Correlate them with durable server-created intent and validate applicable current recipient access before external delivery. A revoked recipient must not receive newly generated sensitive content.

## Required verification

Use actual PostgreSQL and the production-like runtime role to test reads, writes, joins, pagination, raw queries, exports, jobs, and connection-pool reuse across tenants. Test missing context, mismatched composite references, platform token misuse, socket subscription forgery, and stale cached entitlements. Administrative access and migrations require distinct test credentials.

Future dedicated-tenant database placement must preserve the same authenticated tenant context and contracts. It is an extension seam, not current deployment scope.
