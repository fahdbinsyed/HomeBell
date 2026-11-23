# ADR-0018: Mock transport — MSW handlers behind an injected fetch

- **Status**: Accepted
- **Date**: 2026-11-23

## Context

Phase 1 runs every app on mocks. The brief called for MSW on web and "an equivalent mock adapter" on
mobile. ADR-0001 assumed `msw/native` for React Native, but **MSW 3 (current major) removed the
React Native entry point**; it ships `msw/browser` (service worker), `msw/node`, and the
`getResponse(handlers, request)` utility.

## Options

1. Service worker on web + an experimental `defineNetwork` interceptor on React Native — two transports,
   global patching, experimental API.
2. Pin MSW 2 for `msw/native` — an outdated major in a new product.
3. **One set of MSW request handlers, resolved in-process by a mock `fetch`** that is injected into
   `@homebell/api-client` (`createHomeBellClient({ fetch })`).

## Decision

Option 3. `packages/mocks` exposes `createMockEnvironment({ app })` → `{ fetch, handlers, db, scenarios,
feeds… }`. The mock fetch applies scenario transport effects (latency, network failure) and calls
`getResponse`. Web, React Native and Node tests use the same path.

- Web apps keep the BFF shape (ADR-0016): the browser sends no tokens; the mock simulates the BFF
  session (stored in `sessionStorage` to imitate the httpOnly cookie).
- Selection is per app via `NEXT_PUBLIC_HB_API_MODE` / `EXPO_PUBLIC_HB_API_MODE` (`mock` | `real`).
- Contract conformance: `packages/mocks/test` validates every mock response against the bundled OpenAPI
  document (Ajv, JSON Schema 2020-12). It already found and fixed two contract gaps (contract 1.1.0).

## Consequences

- No service-worker file, no global `fetch` patching, no RN polyfills, identical behaviour everywhere.
  − Mock requests don't appear in the browser Network tab; the dev panel shows the active scenario instead.

## Addendum (2026-11-23) — Hermes

MSW 3's dependencies (`@mswjs/interceptors`, `rettime`) extend browser globals such as `MessageEvent` at
load time, which crashes on React Native's Hermes engine. The guardian app therefore aliases `msw` to
`packages/mocks/src/msw-lite.ts` (Metro `resolveRequest` in `apps/mobile-guardian/metro.config.js` and
the Jest `moduleNameMapper`): a small, dependency-free implementation of `http.*`, `HttpResponse` and
`getResponse` that runs the same handlers. Web apps and the contract-conformance tests keep real MSW, so
handlers must stay MSW-compatible. The mobile Jest setup deletes DOM event globals to catch regressions,
and mock time-zone maths uses only numeric `formatToParts` fields (`packages/mocks/src/db/tz.ts`).
