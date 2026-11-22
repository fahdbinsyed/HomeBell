# ADR-0017: Mobile platform strategy — Android and iOS in the MVP

- **Status**: Accepted (supersedes the "Android-first, iOS later" wording in the original brief, ADR-0001 and ADR-0005)
- **Date**: 2026-11-22

## Context

The product owner corrected the mobile strategy: HomeBell supports **both Android and iOS from the
beginning**, from **one** React Native + Expo + TypeScript codebase (`apps/mobile-guardian`). iOS is not a
future addition. Store publication for each platform can happen independently once that platform passes
its release-readiness checks.

## Decision

### 1. One codebase, isolated platform differences

- A single Expo app; **no second mobile application**.
- Shared code by default. Platform-specific code only where technically necessary, isolated behind the
  `@homebell/client-services` interfaces (`SecureStore`, `DeviceIdentity`, `PushService`,
  `BillingService`) with implementations in `apps/mobile-guardian/src/platform/<service>/` using
  `*.android.ts` / `*.ios.ts` (Metro platform extensions) or `Platform.select` inside a single adapter.
  Screens and feature code never branch on `Platform.OS`; ESLint rule (Phase 1) restricts
  `Platform.OS` usage to `src/platform/**`.
- Native configuration via Expo config plugins + Continuous Native Generation (`expo prebuild`);
  `android/` and `ios/` folders are generated, not committed.

### 2. Cross-platform capability matrix (all in MVP)

| Capability                     | Android                                              | iOS                                                          | Notes                                                                                                                                   |
| ------------------------------ | ---------------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| Secure storage                 | `expo-secure-store` → Android Keystore               | `expo-secure-store` → Keychain                               | iOS: `WHEN_UNLOCKED_THIS_DEVICE_ONLY` (not iCloud-synced, not migrated to a new phone)                                                  |
| Device install ID              | random UUID in secure store; cleared on uninstall    | random UUID in Keychain; **can survive uninstall/reinstall** | Server treats install ID as an opaque identity; reinstall on iOS may keep the same device (acceptable — it is the same physical device) |
| OTP                            | SMS; Android SMS Retriever/one-tap autofill optional | SMS with `textContentType="oneTimeCode"` autofill            | Same API flow                                                                                                                           |
| Push                           | FCM                                                  | FCM (delivers via APNs; APNs auth key uploaded to Firebase)  | `PushService` + `expo-notifications`; provider value `fcm` on both; `apns` reserved for direct APNs                                     |
| Deep links                     | Android App Links (`/.well-known/assetlinks.json`)   | Universal Links (`/.well-known/apple-app-site-association`)  | Fallback custom scheme `homebell://`; used for invitations `/invite/{code}`                                                             |
| Device registration / transfer | same API                                             | same API                                                     | `DevicePlatform` = `android` \| `ios`                                                                                                   |
| In-app purchase                | Google Play Billing                                  | Apple In-App Purchase (StoreKit 2)                           | ADR-0005                                                                                                                                |
| Location (optional rule)       | `ACCESS_COARSE/FINE_LOCATION`, when-in-use           | `NSLocationWhenInUseUsageDescription`                        | Requested only when the school enables the location rule                                                                                |
| Future attestation             | Play Integrity                                       | App Attest                                                   | Hook only (11-future-hooks)                                                                                                             |

### 3. Permissions (requested just-in-time, with explanation screens)

- Notifications: Android 13+ `POST_NOTIFICATIONS`; iOS notification authorization.
- Location (only if the tenant rule is enabled): when-in-use only; never background location.
- No camera, contacts, microphone or background location in the MVP.

### 4. Builds, signing and release workflow

- **EAS Build** profiles: `development` (dev client, internal), `preview` (internal distribution / TestFlight
  internal), `production` (store). Bundle/application IDs per environment
  (e.g. `…homebell.dev`, `…homebell.staging`, `…homebell`).
- **Android signing**: Play App Signing; upload keystore managed in EAS credentials (never committed).
- **iOS signing**: Apple Developer Program team; distribution certificate and provisioning profiles managed
  in EAS credentials; Associated Domains entitlement for Universal Links; Push Notifications capability;
  In-App Purchase capability; APNs auth key (.p8) uploaded to Firebase.
- **Release**: EAS Submit to Play Console (internal → closed → production tracks) and App Store Connect
  (TestFlight → review → release). OTA JavaScript updates via EAS Update on per-channel runtime versions;
  native changes always ship through store builds.
- **Release readiness per platform** (each platform publishes independently when its own checklist passes):
  store listing + privacy disclosures (Play Data safety form / App Store privacy nutrition labels),
  account-deletion path, IAP products approved, crash-free sessions threshold on internal testing,
  full mobile regression suite green on that platform.

### 5. Development and test discipline

- Every mobile feature is developed and validated on **both** platforms; a feature is "done" only when its
  tests pass and it has been exercised on an Android emulator/device **and** an iOS simulator/device.
- The primary development machine is Windows, which cannot run the iOS Simulator or Xcode. iOS
  validation uses **EAS Build development builds on a physical iPhone** (and EAS cloud builds), or a macOS
  machine/CI runner for the Simulator and Maestro/Detox E2E. Securing iOS test access (Apple Developer
  account, at least one test iPhone or a Mac/cloud Mac runner) is a Phase 1 prerequisite.
- E2E: Maestro flows run on both platforms in CI (Android emulator on Linux runner, iOS Simulator on macOS
  runner) from Phase 1 against mocks, and from Phase 3 against the real backend.

## Consequences

- Contract: `BillingProvider.apple_app_store` becomes MVP scope; `PurchaseIntent` carries an
  `appAccountToken` for StoreKit; new internal webhook `POST /v1/webhooks/app-store`
  (App Store Server Notifications V2) mirrors the Google Play RTDN handling.
- Cost/ops: Apple Developer Program membership, macOS CI minutes, App Store review lead time in plans.
- Phase acceptance criteria updated in `docs/architecture/12-delivery-phases.md`.
