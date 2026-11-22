# Frontend Architecture

## 1. Apps

| App                    | Framework                | Auth                                                                                           | Notes                                      |
| ---------------------- | ------------------------ | ---------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `apps/web-school`      | Next.js (App Router)     | BFF cookie session                                                                             | School Dashboard                           |
| `apps/web-platform`    | Next.js (App Router)     | BFF cookie session + TOTP                                                                      | separate origin (e.g. `admin.` subdomain)  |
| `apps/web-display`     | Next.js (static-capable) | display token in `localStorage`-free storage (IndexedDB, httpOnly cookie via its own tiny BFF) | TV layout, kiosk mode                      |
| `apps/mobile-guardian` | Expo (dev builds, EAS)   | tokens in `expo-secure-store`                                                                  | **Android + iOS**, one codebase (ADR-0017) |

Web and mobile share **contracts, API client, client-service interfaces and design tokens** — not UI
components.

## 2. Data access

```
Screen → feature hook (TanStack Query) → @homebell/api-client (openapi-fetch, typed by contracts)
       → transport: web: BFF route `/api/hb/*` → backend `/v1/*`;  mobile: backend `/v1/*` directly
```

- Screens never call `fetch`. Lint rule (Phase 1): `no-restricted-globals: fetch` in `apps/*/src/**`
  except `lib/transport`.
- Errors are `Problem` objects with `code`; UIs map `code` → message/action via a single
  `errorMessages.ts` table per app (no string matching on `detail`).
- Mutations that require `Idempotency-Key` generate the key **once per user intent** (stored with the
  pending mutation) so retries/double taps reuse it.

## 3. Client services (`@homebell/client-services`)

| Interface        | Mock (Phase 1)                                                  | Real                                                           |
| ---------------- | --------------------------------------------------------------- | -------------------------------------------------------------- |
| `QueueFeed`      | timer-driven events, configurable rate, gaps to test catch-up   | SignalR (Phase 4)                                              |
| `GuardianFeed`   | mock status changes                                             | SignalR (Phase 4)                                              |
| `PushService`    | in-app simulated notifications                                  | FCM on Android and iOS (via APNs) (Phase 7)                    |
| `OtpService`     | thin wrapper over API; mock reads code from scenario (`000000`) | API (Phase 3)                                                  |
| `BillingService` | simulated purchase sheet, success/cancel/pending/failure        | Google Play Billing (Android) + StoreKit 2 (iOS) (Phase 5)     |
| `SecureStore`    | in-memory                                                       | `expo-secure-store` (Keystore / Keychain) / BFF session        |
| `DeviceIdentity` | fixed or scenario-provided install ID                           | secure-store install ID (later: Keystore / Secure Enclave key) |
| `Clock`          | controllable clock for scenarios                                | system clock                                                   |

Implementations are selected in one `services.ts` composition file per app from environment config
(`HB_API_MODE=mock|real` per module, enabling the Phase 3 module-by-module switch).

## 4. Mock layer (Phase 1)

- `packages/mocks`: MSW 2 handlers (`msw/browser` for web, `msw/native` for Expo) generated against the
  contract types; in-memory DB seeded with multiple tenants; **named scenarios** switchable at runtime
  (dev menu / `?scenario=`): `blocked_guardian`, `deactivated_guardian`, `tenant_suspended`,
  `tenant_expired`, `tenant_cancelled`, `trial_expiring`, `device_conflict_transfer_allowed`,
  `device_conflict_in_cooldown`, `otp_resend_limit`, `otp_locked`, `invitation_expired`,
  `invitation_used`, `duplicate_pickup`, `permission_denied`, `network_failure`, `slow_network`.
- Contract conformance: a test validates every mock response body against the bundled OpenAPI schema.
- Mock business rules live in `packages/mocks/src/rules` and are labelled _simulation_; they exist to
  drive UI states, not to define behaviour.

## 5. Generation

`pnpm contracts:generate`:

1. `redocly bundle` → `packages/contracts/bundled/openapi.v1.yaml` (committed).
2. `openapi-typescript` → `packages/contracts/src/generated/openapi.ts` (committed).
3. Enum value arrays exported for runtime use (`src/enums.ts` re-exports).

## 6. Mobile platform isolation (ADR-0017)

```
apps/mobile-guardian/src/
  features/…            shared screens and logic — no Platform.OS branching
  platform/
    secure-store/       index.ts (+ .ios.ts / .android.ts only if behaviour differs)
    push/               expo-notifications + FCM adapter
    billing/            billing.android.ts (Play Billing) · billing.ios.ts (StoreKit 2)
    device/             install ID, device info
    linking/            App Links / Universal Links config
```

`Platform.OS` is allowed only under `src/platform/**` (lint rule). Each platform adapter implements the
same `@homebell/client-services` interface and has its own unit tests; feature E2E (Maestro) runs on both
platforms.

## 7. UX baseline

Large tap targets (≥ 48 dp), explicit states for blocked/expired/transfer, loading/empty/error states on
every screen, WCAG 2.2 AA contrast, screen-reader labels, RTL-ready layout (multilingual hook), offline
banner on mobile.
