# ADR-0001: Approved technology stack

- **Status**: Accepted
- **Date**: 2026-11-22

## Context

HomeBell needs a guardian app for Android **and** iOS from one codebase (ADR-0017), three web surfaces (school dashboard, platform
portal, display), and a secure multi-tenant backend with realtime fan-out and background processing.

## Decision

- **Mobile**: React Native + Expo + TypeScript, one codebase for Android and iOS (ADR-0017), Expo
  development builds (not Expo Go only), EAS Build/Submit/Update, feature-based structure,
  `expo-secure-store` for secrets (Android Keystore / iOS Keychain).
- **Web**: Next.js + React + TypeScript; separate apps for school, platform and display.
- **Backend**: ASP.NET Core Web API, C#, .NET 10 LTS (supported to Nov 2028; SDK 10.0.401 verified on the
  dev machine), modular monolith, EF Core, PostgreSQL, SignalR + Redis backplane, .NET Worker Service,
  Serilog, OpenTelemetry, OpenAPI.
- **Repo**: pnpm workspaces + Turborepo; .NET solution in `backend/`.
- **Libraries chosen inside the stack**: `openapi-typescript` + `openapi-fetch` (typed client),
  TanStack Query (server state), MSW (mocks on web and React Native via `msw/native`), Redocly CLI
  (bundle + lint).

## Consequences

Frontend and backend use different languages, so the OpenAPI contract is the only shared truth
(ADR-0004). Stack changes require a new ADR with evidence and explicit approval.
