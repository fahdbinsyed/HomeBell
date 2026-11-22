# ADR-0016: Backend-for-frontend authentication for web apps

- **Status**: Accepted
- **Date**: 2026-11-22

## Decision

The School Dashboard and Platform Portal authenticate through their own Next.js server (BFF). Next.js
route handlers call `/v1/auth/*`, keep the token pair server-side (encrypted session cookie or server
store), and proxy `/api/hb/*` → `/v1/*` adding the bearer token, `X-Request-Id` and forwarding
`Idempotency-Key`. Browser JavaScript never sees access or refresh tokens. Cookies: `__Host-hb_session`,
httpOnly, Secure, SameSite=Lax; CSRF double-submit token on mutating routes.

SignalR from the browser connects with a short-lived (60 s) **connection ticket** minted by the BFF via
`POST /v1/auth/realtime-tickets`, passed as `access_token` query parameter (standard SignalR practice),
single-use.

## Consequences

In Phase 1, MSW intercepts `/api/hb/*` in the browser, so the BFF proxy is exercised only from Phase 3.
