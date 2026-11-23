# ADR-0015: Toolchain versions

- **Status**: Accepted
- **Date**: 2026-11-22

## Context (verified 2026-11-22)

Dev machine: Node 20.15.0 (Node 20 reached end-of-life April 2026), no pnpm, .NET SDKs 7/8/9/10.0.401,
no Docker. Current registry: Next.js 16.x (`node >= 20.9`), Expo SDK 58, Redocly CLI 2.x
(`node >= 20.19 || >= 22.12`), TypeScript 7.0 (native compiler) and 5.9.3, openapi-typescript 7.13
(peer `typescript ^5`).

## Decision

- **Node 26 LTS** (`.nvmrc` = 26). `engines.node` stays `>=22.13.0` (the floor required by Expo 58 /
  React Native 0.88, MSW 3, Vitest 5). _Updated 2026-11-23: dev machine upgraded to Node 26.13.1 via
  `winget install OpenJS.NodeJS.LTS`._
- **pnpm 10.34.x**, pinned in `packageManager`. Node 25+ no longer bundles Corepack, so pnpm is installed
  with `npm install -g pnpm@10.34.9` (or `npm i -g corepack && corepack enable`). pnpm 12 is evaluated later.
- **TypeScript 5.9.3** across the repo until the generator and lint tooling officially support TS 7.
- **.NET SDK 10.0.4xx** pinned in `backend/global.json` (`rollForward: latestFeature`), target `net10.0`.
- **Docker Desktop (or Podman)** required from Phase 2 for Postgres/Redis and Testcontainers.
- **Mobile builds (ADR-0017)**: EAS CLI for Android and iOS builds. iOS needs an Apple Developer Program
  account and Xcode on macOS (local Mac or EAS/macOS CI runners); the Windows dev machine cannot run the
  iOS Simulator, so iOS checks use EAS development builds on a physical iPhone and macOS CI.
  Android: Android Studio emulator + JDK 17 for local native builds.
- Exact package versions are pinned (no `^`) in apps; Renovate/Dependabot added in Phase 7.

## Consequences

CI images use Node 26 and .NET 10 SDK. Re-check versions at the start of each phase.
