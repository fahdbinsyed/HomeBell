# HomeBell — Architecture Overview

HomeBell is a multi-tenant school pickup and dismissal SaaS platform (_Powered by neuXplus_).
One school = one tenant. The school pays an annual USD subscription; additional guardians are paid add-ons.

Positioning constraint: HomeBell provides **safer dismissal, smoother pickup, better visibility, better
coordination and clearer accountability**. The MVP does **not** perform identity-verified physical handoff
and does **not** process refunds. Do not claim either in UI copy, docs or marketing.

## 1. System context

```
┌──────────────────────────── Clients ────────────────────────────┐
│ apps/mobile-guardian   (Expo RN — Android + iOS, one codebase)   │
│ apps/web-school        (Next.js — School Dashboard, BFF)         │
│ apps/web-platform      (Next.js — Platform Owner Portal, BFF)    │
│ apps/web-display       (Next.js — TV display, display token)     │
└──────────┬─────────────────────┬───────────────────┬────────────┘
           │ HTTPS JSON (/v1)    │ SignalR (WebSocket, fallback SSE/LP)
┌──────────▼─────────────────────▼───────────────────▼────────────┐
│ HomeBell.Api — ASP.NET Core (.NET 10), stateless, N instances    │
│   Control plane : Platform (tenants, plans, lifecycle,           │
│                   entitlements, notes, flags, support sessions)  │
│   Tenant plane  : Schools · Guardians · Dismissal · Notifications│
│                   · Reporting                                    │
│   Cross-cutting : Identity (accounts, sessions, OTP, devices)    │
│                   · Billing · Audit · Tenancy · Idempotency      │
│                   · Rate limiting · Outbox                        │
│   Hubs          : /hubs/queue · /hubs/display · /hubs/guardian    │
├──────────────────────────────────────────────────────────────────┤
│ HomeBell.Worker — .NET Worker Service                            │
│   outbox dispatch · push (FCM) · SMS/OTP delivery · pickup        │
│   timeouts/escalation · expiry sweeps · report rollups · retention│
└──────────┬──────────────────┬───────────────────┬────────────────┘
      PostgreSQL           Redis              External providers
  (one DB, schema per   (cache, rate limits, (FCM, SMS/OTP, Google Play
   module, RLS)          SignalR backplane,   Billing) — all behind
                         idempotency, sid     provider interfaces
                         denylist)
```

## 2. Approved stack (frozen — see ADR-0001)

| Layer                | Choice                                                                                                               |
| -------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Mobile               | React Native + Expo (development builds, EAS) + TypeScript — **Android and iOS in the MVP**, one codebase (ADR-0017) |
| Web                  | Next.js + React + TypeScript (3 apps: school, platform, display)                                                     |
| Backend              | ASP.NET Core Web API, C#, .NET 10 LTS, modular monolith                                                              |
| Data                 | PostgreSQL + EF Core (migrations per module)                                                                         |
| Realtime             | SignalR + Redis backplane                                                                                            |
| Async                | .NET Worker Service + transactional outbox (RabbitMQ deferred, ADR-0002)                                             |
| Cache / coordination | Redis                                                                                                                |
| Contracts            | OpenAPI 3.1 (`packages/contracts/openapi`) + AsyncAPI 3.0 (`packages/contracts/realtime`)                            |
| Logging / telemetry  | Serilog + OpenTelemetry                                                                                              |
| Push / SMS / Billing | FCM (Android + iOS via APNs), SMS provider, Google Play Billing + Apple IAP — each behind an abstraction             |
| Repo                 | pnpm workspaces + Turborepo; .NET solution `backend/HomeBell.slnx`                                                   |
| Toolchain            | Node ≥ 22.12 (24 LTS recommended), pnpm 10, .NET SDK 10.0.4xx (ADR-0015)                                             |

## 3. Repository layout

```
apps/                    Phase 1: mobile-guardian (single Android + iOS app), web-school, web-platform, web-display
packages/
  contracts/             SINGLE SOURCE OF TRUTH: openapi/, realtime/, bundled/, src/generated/
  api-client/            typed HTTP client (openapi-fetch) over the generated types
  client-services/       QueueFeed, PushService, OtpService, BillingService, SecureStore interfaces
  config/                shared tsconfig presets (ESLint presets added in Phase 1)
  mocks/                 Phase 1: MSW handlers + scenarios (msw/browser and msw/native)
  design-tokens/         Phase 1
  ui-web/                Phase 1
backend/
  HomeBell.slnx
  src/BuildingBlocks/    Domain primitives, Application abstractions, Infrastructure plumbing
  src/Modules/<M>/       HomeBell.Modules.<M>.{Domain,Application,Infrastructure,Contracts}
  src/Host/              HomeBell.Api, HomeBell.Worker
  tests/                 HomeBell.ArchitectureTests (+ Unit/Integration/Contract from Phase 2)
infra/                   docker-compose for local Postgres/Redis/Mailpit
docs/architecture/       this folder
docs/adr/                architecture decision records
```

## 4. Contract-first delivery

1. Change `packages/contracts/openapi/**` or `realtime/**` first (never the implementation first).
2. Record non-additive or behavioural changes in `docs/adr/`.
3. `pnpm contracts:generate` → regenerates `bundled/openapi.v1.yaml` and `src/generated/openapi.ts`.
4. `pnpm contracts:lint` must pass (Redocly recommended rules + HomeBell rules).
5. CI fails if `bundled/` or `src/generated/` differ from a fresh generation (drift check), and — from
   Phase 3 — if backend responses drift from the spec (contract tests).

Frontend screens never call `fetch` directly; they use `@homebell/api-client` hooks. Realtime, push, OTP
hand-off, billing and secure storage go through `@homebell/client-services` interfaces so mock and real
implementations are swapped by configuration.

## 5. Document index

| Doc                                                             | Topic                                                             |
| --------------------------------------------------------------- | ----------------------------------------------------------------- |
| [01-backend-modules](01-backend-modules.md)                     | Modules, layering, dependency rules                               |
| [02-multitenancy](02-multitenancy.md)                           | Tenant model, control vs tenant plane, isolation                  |
| [03-identity-auth-otp-devices](03-identity-auth-otp-devices.md) | Accounts, sessions, tokens, OTP, device rule                      |
| [04-realtime](04-realtime.md)                                   | Hubs, events, sequencing, catch-up, scale-out                     |
| [05-entitlements-lifecycle](05-entitlements-lifecycle.md)       | Plans, overrides, lifecycle state machine                         |
| [06-state-machines](06-state-machines.md)                       | Pickup, guardian, invitation, license, device states              |
| [07-audit-outbox-workers](07-audit-outbox-workers.md)           | Audit, outbox, idempotency, background jobs                       |
| [08-security-privacy](08-security-privacy.md)                   | Threat model, rate limits, privacy, retention                     |
| [09-frontend-architecture](09-frontend-architecture.md)         | Client services, BFF, mocks, generation                           |
| [10-domain-model](10-domain-model.md)                           | Entities and ownership                                            |
| [11-future-hooks](11-future-hooks.md)                           | Audio, QR, attestation, multi-campus, enterprise billing          |
| [12-delivery-phases](12-delivery-phases.md)                     | Phase plan and acceptance criteria (incl. Android + iOS gates)    |
| [ADR-0017](../adr/0017-mobile-platform-strategy.md)             | Mobile platform strategy: Android + iOS, builds, signing, release |
