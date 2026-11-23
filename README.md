# HomeBell

Multi-tenant school pickup and dismissal platform — _Powered by neuXplus_.

Safer dismissal, smoother pickup, better visibility and clearer accountability. (The MVP does not perform
identity-verified physical handoff and does not process refunds.)

## Status

**Phase 0 complete; Phase 1 built** (all apps on the mock API — see status table). See
[docs/architecture/12-delivery-phases.md](docs/architecture/12-delivery-phases.md).

## Layout

| Path                            | What                                                                                                                                                                |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/contracts`            | **Single source of truth**: OpenAPI 3.1 (`openapi/`), AsyncAPI 3.0 (`realtime/`), generated TS (`src/generated/`), [error codes](packages/contracts/ERROR_CODES.md) |
| `packages/api-client`           | Typed HTTP client (openapi-fetch)                                                                                                                                   |
| `packages/client-services`      | QueueFeed, PushService, OtpService, BillingService, SecureStore, DeviceIdentity interfaces                                                                          |
| `packages/config`               | Shared tsconfig presets                                                                                                                                             |
| `apps/`                         | Phase 1: `mobile-guardian` (one Expo app for Android **and** iOS), `web-school`, `web-platform`, `web-display`                                                      |
| `backend/`                      | ASP.NET Core (.NET 10) modular monolith: 9 modules × 4 layers, API + Worker hosts, architecture tests                                                               |
| `infra/`                        | Local Postgres / Redis / Mailpit (`docker compose -f infra/docker-compose.yml up -d`)                                                                               |
| `docs/architecture`, `docs/adr` | Architecture docs and decision records                                                                                                                              |

## Prerequisites

Node 26 LTS (≥ 22.13), pnpm 10 (`npm i -g pnpm@10.34.9`), .NET SDK 10.0.4xx, Docker (from Phase 2),
EAS CLI + Apple Developer account + iOS test device or macOS runner (from Phase 1). See ADR-0015/0017.

## Commands

```
pnpm install
pnpm contracts:lint        # Redocly + AsyncAPI validation
pnpm contracts:generate    # bundle + TS types + error catalog + realtime constants
pnpm contracts:check       # generate and fail on uncommitted drift (CI)
pnpm --filter @homebell/contracts test   # HomeBell contract rules
pnpm typecheck
pnpm backend:build
pnpm backend:test          # architecture tests (Microsoft.Testing.Platform)
```

## Contract workflow

Change the spec first → `pnpm contracts:generate` → commit spec + generated files together → ADR for any
non-additive change (ADR-0004).
