# Backend Modules and Dependency Rules

The backend is a **modular monolith**: one deployable API (`HomeBell.Api`) and one deployable worker
(`HomeBell.Worker`), composed of independent modules. Module boundaries are designed so that any module
could later be extracted, but no extraction is planned.

## 1. Modules

| Module            | Plane   | Owns                                                                                                                                                                                                     |
| ----------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Platform**      | control | Tenant, TenantLifecycleHistory, SubscriptionPlan, PlanVersion, TenantSubscription, EntitlementOverride, FeatureFlag, SupportNote, SupportSession, PlatformUser roles. Hosts the **EntitlementResolver**. |
| **Identity**      | global  | UserAccount, Credential (staff), MfaFactor, Session, RefreshToken, DeviceRegistration, DeviceTransfer, CooldownOverride, OtpChallenge, OtpLog                                                            |
| **Schools**       | tenant  | TenantMembership (staff), StaffInvitation, Class, Section, Student, TenantSettings, DisplayDevice, ImportJob                                                                                             |
| **Guardians**     | tenant  | Guardian (per-tenant profile of a UserAccount), GuardianStudentLink, PrimaryGuardianEntitlement, LicenseSeat (additional guardian license), GuardianInvitation                                           |
| **Dismissal**     | tenant  | PickupRequest, PickupStatusHistory, PickupAcknowledgment, QueueEvent (sequenced stream)                                                                                                                  |
| **Billing**       | tenant  | PurchaseIntent, PurchaseRecord, provider verification, store notifications (voids/refunds observed — never initiated)                                                                                    |
| **Notifications** | tenant  | Notification, PushToken, delivery attempts                                                                                                                                                               |
| **Audit**         | both    | AuditLog (append-only)                                                                                                                                                                                   |
| **Reporting**     | tenant  | Read models / rollups; read-only access to other modules via their Contracts                                                                                                                             |

## 2. Project layering (per module)

```
HomeBell.Modules.<M>.Contracts        public: integration events, query/command interfaces, DTOs
        ▲                              (no EF, no ASP.NET, no other module references)
HomeBell.Modules.<M>.Domain           entities, value objects, domain events, invariants
        ▲                              → BuildingBlocks.Domain only
HomeBell.Modules.<M>.Application      use cases (commands/queries), authorization policies, ports
        ▲                              → own Domain, own Contracts, other modules' Contracts,
        │                                BuildingBlocks.Application
HomeBell.Modules.<M>.Infrastructure   EF Core DbContext (own schema), repositories, provider adapters,
                                       endpoint mapping, DI registration (Add<M>Module / Map<M>Endpoints)
                                       → own Application, BuildingBlocks.Infrastructure
Host: HomeBell.Api / HomeBell.Worker  → every module's Infrastructure (composition root only)
```

## 3. Dependency rules (enforced by `HomeBell.ArchitectureTests`)

1. A module's Domain/Application/Infrastructure **must not** reference another module's
   Domain/Application/Infrastructure. Cross-module calls go through `<Other>.Contracts` only.
2. `Contracts` projects reference nothing except `BuildingBlocks.Contracts` (none today).
3. `Domain` must not reference EF Core, ASP.NET Core, or any `Infrastructure`.
4. `BuildingBlocks.*` must not reference any module.
5. Only Host projects may reference multiple modules' Infrastructure.
6. Persistence entities never leave Application: public HTTP responses are DTOs mapped to the OpenAPI
   contract.

## 4. Persistence

- One PostgreSQL database; **one schema per module** (`platform`, `identity`, `schools`, `guardians`,
  `dismissal`, `billing`, `notifications`, `audit`, `reporting`).
- One `DbContext` per module, own migrations history table (`<schema>.__ef_migrations`).
- No cross-schema foreign keys. Cross-module references are plain IDs, validated through Contracts.
- Tenant-owned tables carry `tenant_id uuid not null` + RLS (see 02-multitenancy).
- IDs are UUIDv7 (time-ordered, index-friendly), generated in the application.
- Optimistic concurrency via PostgreSQL `xmin` mapped as row version.

## 5. Request pipeline (API)

```
Kestrel → ForwardedHeaders → RequestId/Correlation → Serilog request logging → ExceptionHandler
(ProblemDetails) → RateLimiter → Authentication (JWT / display token) → SessionRevocationCheck (Redis sid
denylist) → TenantResolution (path /v1/t/{tenantId}) → Authorization (policies: role + permission +
tenant scope + entitlement) → Idempotency filter (Idempotency-Key) → Endpoint (minimal APIs, grouped per
module) → Unit of work (DbContext + outbox in one transaction)
```

## 6. Endpoint style

Minimal APIs grouped per module (`app.MapGroup("/v1/t/{tenantId}/students")`), with typed results and
`ProblemDetails`. The OpenAPI document produced by the backend is **compared against** the hand-authored
contract in CI (Phase 3); the hand-authored contract wins.
