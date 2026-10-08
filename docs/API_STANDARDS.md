# API standards and proposed contracts

Status: full-product contract design. The Phase 1 subset listed in [PHASE_1_PROPOSAL.md](PHASE_1_PROPOSAL.md) is implemented and locally verified; other routes below remain proposed. See [PHASE_1_REPORT.md](PHASE_1_REPORT.md). Authentication/RBAC and tenant policy apply independently to every route.

## Conventions

Base path `/api/v1`. JSON, UTC ISO-8601 instants, UUID identifiers. Tenant routes use `/tenants/{tenantId}` as an explicit selector validated against authenticated context. Platform routes use `/platform` and require a platform audience. Mobile multi-child requests create one pickup per child initially; clients show each result separately, not false all-or-nothing success.

Success: `{ "data": { ... }, "meta": { "requestId": "..." } }`. Lists additionally return opaque `nextCursor`; scope cursor signing/validation to tenant, filter and sort. Errors: `{ "error": { "code": "...", "message": "...", "requestId": "...", "details": [] } }`. Details contain safe field validation only, never SQL, stack traces, private records or secrets.

Validate parameters, bodies, query strings, headers, deep links, webhooks and uploads. Reject unknown writable fields. Bound page sizes and request sizes. Use allowlisted sort/filter fields and parameterized persistence.

| HTTP | Meaning / examples |
|---|---|
| 400 | Malformed or invalid input: `VALIDATION_FAILED` |
| 401 | Missing/expired/revoked session: `SESSION_INVALID` |
| 403 | Known context lacks permission/access: `TENANT_SUSPENDED`, `GUARDIAN_BLOCKED` |
| 404 | Absent or inaccessible resource; do not reveal cross-tenant existence |
| 409 | Version/idempotency/state conflict: `PICKUP_ALREADY_REQUESTED`, `VERSION_CONFLICT`, `IDEMPOTENCY_CONFLICT` |
| 422 | Valid request violates a business rule: `DEVICE_TRANSFER_COOLDOWN`, `DISMISSAL_WINDOW_CLOSED` |
| 429 | Rate limited: `OTP_RATE_LIMITED`; safe `Retry-After` |
| 503 | Dependency unavailable; no false confirmation of a failed mutation |
| 500 | Unexpected failure: safe `INTERNAL_ERROR` plus request ID |

Invitation expired/used responses must avoid account enumeration; exact authenticated error presentation is finalized with the flow.

## Mutation safety

Require `Idempotency-Key` for pickup commands, invitations/purchases, transfers, subscription/override and tenant lifecycle actions. Scope to authenticated actor, tenant or platform scope, operation and canonical body digest. After authenticating/authorizing the caller, replay the original committed result for an identical retry; do not leak replayed content to a revoked caller. Same key/different body returns 409. Define and publish result retention before client release.

Updates include `expectedVersion` or a defined `If-Match` equivalent. Server transactions compare current version and return conflicts, never silently overwrite. Client timeout retries preserve the key. Payment webhook deduplication uses provider event identity as well as order state.

## Route inventory

| Area | Proposed routes | Authority / behavior |
|---|---|---|
| Auth | `POST /auth/otp/challenges`, `POST /auth/otp/verifications`, `POST /auth/refresh`, `POST /auth/logout` | Purpose-bound challenges, protected rotation, revocation |
| Tenant selection | `GET /me/tenants`, `POST /auth/tenant-context` | Only caller's authorized memberships/links |
| Platform tenants | `GET/POST /platform/tenants`, `GET /platform/tenants/{id}` | Authorized catalog and onboarding |
| Lifecycle | `POST /platform/tenants/{id}/lifecycle-actions` | Named action, reason, expected version |
| Plans/subscriptions | `GET /platform/plans`, `POST /platform/tenants/{id}/plan-assignments` | Versioned plan and audited assignment |
| Overrides/notes | `POST /platform/tenants/{id}/entitlement-overrides`, `POST /platform/tenants/{id}/notes` | Scoped privilege; no refund execution |
| School records | `GET/POST /tenants/{t}/students`, `PATCH /tenants/{t}/students/{id}`, corresponding class/section routes | Student-management permission, same-tenant references |
| Staff/settings | `/tenants/{t}/staff`, `/tenants/{t}/roles`, `/tenants/{t}/settings` | Separate read/manage capabilities |
| Guardians | `GET /tenants/{t}/guardians`, `POST /tenants/{t}/guardians/{id}/access-actions` | Block/deactivate/reactivate with reason/version |
| Purchase | `POST /tenants/{t}/guardian-license-orders` | Primary guardian, eligible selected links, server-owned pricing |
| Invitations | `GET /tenants/{t}/guardian-invitations`, `POST /guardian-invitations/redeem` | Paid-order-created invitations; token and phone proof; derive tenant from invitation |
| Pickup | `POST /tenants/{t}/pickups`, `POST /tenants/{t}/pickups/{id}/acknowledgments` | Linked eligible guardian; actor policy finalized before Phase 4 |
| Pickup operations | `POST /tenants/{t}/pickups/{id}/sent-out`, `/cancellations`, `/exceptions` | Explicit command authorization and transition checks |
| Queue | `GET /tenants/{t}/queue` | Staff projection; guardian uses own `/pickups` view |
| Display | `POST /tenants/{t}/display-pairings`, `POST /display/sessions`, `GET /display/feed` | School-admin pairing, restricted session, tenant derived from credential |
| Device | `GET /me/devices`, `POST /auth/device-transfer-challenges`, `POST /auth/device-transfers` | Restricted new-device flow and operation-bound proof |
| Reports/audit | `POST /tenants/{t}/reports`, `GET /tenants/{t}/reports/{id}`, `GET /tenants/{t}/audit-events` | Permission/filter-limited, authorized export download |
| Webhooks | `POST /integrations/payments/{provider}/webhook` | Provider verification, replay protection, durable event receipt |

The route inventory defines areas, not authorization shortcuts or an exhaustive OpenAPI schema. Phase proposals refine required fields and responses before implementation. No generic arbitrary status/entitlement update endpoint is permitted.

## Example pickup contract

```http
POST /api/v1/tenants/{authorizedTenantId}/pickups
Idempotency-Key: <client-generated-operation-id>
Content-Type: application/json

{"studentId":"<linked-student-id>"}
```

```json
{
  "data": {
    "id": "<pickup-id>",
    "studentId": "<linked-student-id>",
    "status": "requested",
    "version": 1,
    "requestedAt": "2026-10-07T10:00:00Z"
  },
  "meta": {"requestId": "<server-request-id>"}
}
```

Acknowledgment body: `{ "expectedVersion": 1, "receivedChild": true }`. Server derives actor, tenant and timestamp. `receivedChild` expresses the user's statement, not independent evidence of handoff. Location input, if enabled, is separately validated and cannot be treated as identity proof.

Queue snapshots return a revision/cursor for synchronization. Event envelopes and resync behavior are defined in [REALTIME.md](REALTIME.md). Preserve compatibility for older mobile versions; contract changes require compatibility tests and a rollout plan.

## Phase 2 implementation (2026-10-08)

The implemented owner routes follow the [Phase 2 proposal](PHASE_2_PROPOSAL.md): tenant catalog/detail, plans and immutable versions, subscriptions, lifecycle actions, extensions, overrides/revocation, notes, entitlements, usage and audit. `/api/v1/platform/overview` adds global operational counts. Mutations require CSRF, platform audience/MFA, a current capability, idempotency key and expected version where updating an existing resource. Lists accept bounded cursors; audit filters bind into signed cursors and apply before pagination. Dates are ISO UTC, prices integer USD minor units, and no writable object accepts arbitrary status or actor fields.

See [PHASE_2_REPORT.md](PHASE_2_REPORT.md) for verification and remaining production gates.

