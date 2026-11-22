# ADR-0015: Toolchain versions

- **Status**: Accepted
- **Date**: 2026-11-22

## Context (verified 2026-11-22)

Dev machine: Node 20.15.0 (Node 20 reached end-of-life April 2026), no pnpm, .NET SDKs 7/8/9/10.0.401,
no Docker. Current registry: Next.js 16.x (`node >= 20.9`), Expo SDK 58, Redocly CLI 2.x
(`node >= 20.19 || >= 22.12`), TypeScript 7.0 (native compiler) and 5.9.3, openapi-typescript 7.13
(peer `typescript ^5`).

## Decision

- **Node ≥ 22.12, recommended 24 LTS** (`.nvmrc` = 24, `engines.node`). Developers must upgrade from 20.x.
- **pnpm 10.34.x** via `packageManager` (Corepack). pnpm 12 is evaluated later.
- **TypeScript 5.9.3** across the repo until the generator and lint tooling officially support TS 7.
- **.NET SDK 10.0.4xx** pinned in `backend/global.json` (`rollForward: latestFeature`), target `net10.0`.
- **Docker Desktop (or Podman)** required from Phase 2 for Postgres/Redis and Testcontainers.
- **Mobile builds (ADR-0017)**: EAS CLI for Android and iOS builds. iOS needs an Apple Developer Program
  account and Xcode on macOS (local Mac or EAS/macOS CI runners); the Windows dev machine cannot run the
  iOS Simulator, so iOS checks use EAS development builds on a physical iPhone and macOS CI.
  Android: Android Studio emulator + JDK 17 for local native builds.
- Exact package versions are pinned (no `^`) in apps; Renovate/Dependabot added in Phase 7.

## Consequences

CI images use Node 24 and .NET 10 SDK. Re-check versions at the start of each phase.
