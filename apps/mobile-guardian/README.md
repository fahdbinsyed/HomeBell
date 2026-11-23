# HomeBell guardian app (Android + iOS)

One Expo (SDK 58) codebase for both platforms (ADR-0017). Platform differences live only in
`src/platform/**` (secure storage, device identity, billing adapter, location, push).

## Run (mock mode)

Native modules (secure store, notifications, location) need a **development build**, not Expo Go.

```
npx eas-cli@latest build --profile development --platform android   # APK for emulator/device
npx eas-cli@latest build --profile development --platform ios       # physical iPhone (Apple Developer account)
npx eas-cli@latest build --profile development-simulator --platform ios  # iOS Simulator (needs a Mac to run)
pnpm --filter @homebell/mobile-guardian start
```

Demo accounts and scenarios: `packages/mocks/README.md`, or **Account → Developer: mock scenarios** in the app.

## Checks

```
pnpm --filter @homebell/mobile-guardian typecheck
pnpm --filter @homebell/mobile-guardian test           # jest-expo
pnpm --filter @homebell/mobile-guardian export:check   # Metro bundles for android AND ios
maestro test e2e/                                       # E2E on an Android emulator or iOS simulator
```

## Status (Phase 1)

- Verified here: typecheck, unit tests, and production bundles for **both** Android and iOS.
- Not yet verified: running on an Android emulator and on iOS (Simulator / iPhone) and the Maestro
  flows — no emulator, Mac or iPhone is attached to this dev machine (see ADR-0015/0017).
