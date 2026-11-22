# Delivery Phases and Acceptance Criteria

Frontend-first, contract-first. The OpenAPI/AsyncAPI contract in `packages/contracts` governs every phase
(ADR-0004). **Mobile rule (ADR-0017): every mobile deliverable targets Android and iOS from the single
`apps/mobile-guardian` codebase. A mobile feature is accepted only when it passes on both platforms.**

## Definition of done — mobile (applies to every phase that touches the app)

1. Same feature code on both platforms; platform differences only inside `src/platform/**`.
2. Unit/component tests green; Maestro E2E flow green on an Android emulator **and** an iOS simulator
   (macOS CI) or physical iPhone dev build.
3. Manually exercised on at least one physical Android and one physical iOS device for flows involving
   secure storage, push, deep links, OTP autofill, device transfer or purchases.
4. Accessibility check on both (TalkBack / VoiceOver labels, dynamic type / font scaling).
5. No new permission without a usage string (iOS `Info.plist`) and a just-in-time explanation screen.

---

## Phase 0 — Solution blueprint, monorepo, API contract ✅ (this phase)

**Acceptance**

- Monorepo (pnpm + Turborepo) and .NET modular-monolith skeleton build cleanly; architecture tests pass.
- OpenAPI v1 covers every section-18 API area; Redocly lint passes; contract rule tests pass.
- AsyncAPI realtime contract validates; realtime TS constants/types generated with parity checks.
- All state enums, error catalog and permission catalog are in the contract.
- ADRs recorded for the stack and every open decision (ADR-0012 pending the target market).
- Mobile strategy documented for Android + iOS (ADR-0017), including builds, signing, permissions and
  release workflow; contract includes both billing providers and both store webhooks.

## Phase 1 — Complete frontend on mock API

**Scope**: Platform portal, School dashboard, Display, Guardian app (Android + iOS), MSW mocks +
scenarios, mock realtime, design tokens, tests.
**Prerequisites**: Apple Developer Program account, iOS test device and/or macOS CI runner, Android
emulator; EAS project with `development` and `preview` profiles for both platforms.
**Acceptance**

- Every screen in brief sections 4, 11 and 12 works end to end on mocks, including every non-happy-path
  scenario (blocked/deactivated guardian, tenant states, trial expiry, device conflict + cooldown,
  OTP resend limit + lockout, invitation expired/used, duplicate tap, permission denied, network failure,
  slow responses).
- Guardian app: development builds install and run on **Android and iOS**; all guardian flows (OTP
  onboarding, children, request pickup, confirm pickup, history, notifications, add guardian, invitation
  acceptance via deep link on both App Links and Universal Links config, transfer-or-buy, account/device
  status, blocked/expired handling, settings) pass Maestro E2E on both platforms against mocks.
- Mock `BillingService` covers success/cancel/pending/failure for both store adapters' UI paths.
- Loading/empty/error states and accessibility basics on every screen (web + both mobile platforms).
- Does not claim server-side verification.

## Phase 2 — .NET backend core and multi-tenant foundation

**Acceptance**: tenant resolution + scope enforcement on every tenant-owned resource; RBAC; auth/session
(issue, refresh/rotation, revocation); OTP with all limits/lockouts; audit; entitlements; core entities +
migrations; platform/school/student/guardian APIs conform to the contract; integration tests incl. the
tenant-isolation suite; `DevicePlatform` handled for `android` and `ios` alike.

## Phase 3 — Bridge: connect frontend to real backend

**Acceptance**

- Each module switched from mock to real behind configuration; contract tests in CI fail on drift.
- Real auth/session lifecycle on web (BFF) and on the guardian app on **both Android and iOS**: tokens in
  Keystore/Keychain via secure store, refresh, forced logout, revocation handling.
- Real OTP flow verified on both platforms (including iOS one-time-code autofill and Android autofill).
- E2E: platform admin creates and activates a school → school admin imports students/guardians →
  guardian activates via OTP **on Android and on iOS**.
- Gaps between mock and real behaviour recorded in ADRs.

## Phase 4 — Real-time dismissal engine

**Acceptance**: server pickup lifecycle with idempotency and duplicate protection; SignalR hubs per the
realtime contract with tenant-scoped groups; Redis backplane; reconnect + catch-up; `QueueFeed` and
`GuardianFeed` switched to SignalR in dashboard, display and the guardian app on **both platforms**
(including app background/foreground reconnect behaviour on Android and iOS); unresolved workflow +
timeout worker; load test of a multi-school dismissal spike meets the targets in 04-realtime.

## Phase 5 — Additional guardian paid access

**Acceptance**

- Seat/license model, invitations (single-use, expiring, deep link) and redemption with OTP to the invited
  number only, on both platforms.
- Purchases verified server-side on **Google Play Billing (Android)** and **Apple In-App Purchase /
  StoreKit 2 (iOS)**; store refund notifications (Play RTDN, App Store Server Notifications V2) void seats
  and are audited; HomeBell never initiates refunds.
- Purchase tested in Play internal testing and App Store sandbox/TestFlight; IAP product approved in both
  consoles.
- School block/deactivate enforced server-side; guardian-management screens connected on both platforms.

## Phase 6 — Device transfer and anti-sharing

**Acceptance**: one-active-device rule, transfer-or-buy, old-session revocation (including push/realtime
sign-out of the old device), 30-day cooldown and override path, suspicious-transfer visibility, audit —
all verified with **cross-platform transfers** (Android→iOS, iOS→Android, same-platform), plus the iOS
reinstall-on-same-phone case (ADR-0017 §2).

## Phase 7 — Notifications, reports, hardening, production readiness

**Acceptance**

- FCM push replaces the mock `PushService` on Android and iOS (APNs key configured in Firebase); deep
  links from notifications open the right screen on both.
- Reports complete; observability (Serilog, OpenTelemetry, dashboards, alerts); OTP abuse + cost review;
  API rate limiting; retry-safety, performance, security and dependency reviews.
- **Release workflows** live for both platforms: EAS Build/Submit production profiles, signing credentials
  in EAS (Play App Signing; Apple distribution cert + profiles), EAS Update channels, store listings,
  privacy disclosures (Play Data safety; App Store privacy labels), account-deletion path.
- Production readiness checklist and rollout plan. Each platform may be published independently once its
  release-readiness checklist passes.

## Phase 8 — Future feature hooks

**Acceptance**: extension-safe hooks for audio announcements, QR verification, stronger device identity
(Play Integrity + App Attest on both platforms), multi-campus and enterprise billing — hooks/placeholders
only unless structurally required. (iOS is no longer a Phase 8 item; it ships in the MVP.)
