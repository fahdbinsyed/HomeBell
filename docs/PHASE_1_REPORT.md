# Phase 1 completion report

Completed locally on 2026-10-08 under the user's approval of the Phase 1 proposal and setup work. Phase 2 has not been started. This report describes a tested backend foundation, not a production launch.

## Implemented

- TypeScript/ESM pnpm workspace, NestJS API and shared validated contracts.
- Isolated local Node runtime, PostgreSQL development/test cluster, authenticated Redis instance, generated environment files and signing material.
- Four reviewed migrations covering tenant/campus, users/external identities, roles/permissions/membership, session/refresh/device and OTP primitives, school/guardian records, durable audit, idempotency and outbox.
- Restricted identity, tenant and control-plane database roles; forced tenant RLS; composite same-tenant foreign keys; explicit transaction context; account/session access guards.
- Staff OIDC Authorization Code with PKCE/state/nonce, explicit ID-token signature checks, issuer/audience/expiry checks and provider-specific MFA assurance.
- Five-minute application access tokens, rotating refresh tokens, family revocation on reuse, immediate current-session checks, secure cookies/CSRF/origin enforcement and logout.
- Primary-device slot enforcement and account security-version revocation primitives. Public guardian login, transfer and OTP delivery remain in their planned later phases.
- Persisted permission checks; scoped student/class/section/guardian CRUD; guardian linking and blocking/deactivation; draft tenant creation/default campus/roles; membership discovery and tenant audit retrieval.
- Transactional idempotency, optimistic versions, mutation/audit/outbox atomicity, safe errors, redacted structured logs, request/correlation/trace context, bounded request metrics, security-denial audit and readiness checks.
- Operator bootstrap, setup/start/stop helpers, CI workflow and optional container service template.

## Files and modules

Root: `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, runtime/TypeScript/lint/test configuration, `.env.example`, `compose.yaml`, `.github/workflows/ci.yml`, updated `.gitignore` and README.

Source: [API modules](../apps/api/src/app.ts), [contracts](../packages/contracts/src/index.ts), [migrations and review](../apps/api/migrations/README.md), [integration tests](../apps/api/test/foundation.integration.test.ts), [OIDC tests](../apps/api/test/oidc.integration.test.ts), [unit tests](../apps/api/test/security.unit.test.ts), and scripts for setup/migration/bootstrap/services.

Local-only ignored artifacts: `.local`, `.env`, `.env.test`, dependencies/store and build output. They contain local data/credentials and must not be published. No Git repository, remote, commit, paid provider account or deployment was created.

## Verification evidence

| Check | Result |
|---|---|
| Node / package runtime | Node 24.19.0, pnpm 11.19.0; machine-wide Node unchanged |
| Database / Redis connectivity | PostgreSQL 18.4 runtime role verified; authenticated Redis responds PONG |
| Build | `pnpm build` passed |
| Typecheck | `pnpm typecheck` passed |
| Lint | `pnpm lint` passed |
| Formatting | `pnpm format:check` passed |
| Unit tests | `pnpm test`: 6 passed |
| Integration tests | `pnpm test:integration`: 31 passed using actual PostgreSQL/Redis and signed test OIDC tokens |
| Dependency peers | `pnpm peers check`: no issues |
| Production dependency audit | `pnpm audit --prod`: no known vulnerabilities reported at verification time |
| Migrations | Applied to local development and test databases; subsequent development run reported no pending migrations |
| API startup | Server started on 127.0.0.1:3000 |
| HTTP health | `/health/live` returned `ok`; `/health/ready` returned `ready` |

Security/integration coverage includes missing and cross-tenant context, write policies, restricted database roles, pooled-context cleanup, wrong audience, read-only roles, mass assignment, CSRF, current membership/expiry, idempotency races, invalid references, version conflicts, scoped cursors, guarded guardian links, audit immutability and rollback, refresh replay, logout, concurrent device claims, OTP attempt/purpose/proof controls, MFA and signed OIDC claim/signature/state rejection.

The API was left running locally after the health check. If that terminal process has since stopped, use [LOCAL_SETUP.md](LOCAL_SETUP.md) to restart it.

## Acceptance and limitations

The local Phase 1 acceptance boundary is met: the runnable backend and real-database security/API checks pass. No production-readiness or certification claim is made.

- Real staff OIDC issuer/client credentials and assurance mapping are not supplied. Login is disabled by default; the test issuer is test-only. Production issuer validation is still required.
- Browser login needs HTTPS. Local HTTP currently supports health/API development checks; Secure cookies are not weakened for convenience. Separate school/platform frontends and origin configuration belong to later phases.
- No school dashboard, mobile app, pickup flow, paid licensing, live sockets, SMS delivery, payment integration, outbox relay or public display is implemented in Phase 1.
- Tenant creation produces `draft`; full subscription/grant/lifecycle administration is Phase 2. Tests use bounded synthetic trial data. Guardian links confer no automatic paid mobile entitlement.
- Only the current signing verification key is loaded. Rotation invalidates outstanding access tokens; managed overlapping-key rotation remains an operational integration task.
- Logs, internal request metrics and trace context exist; there is no external monitoring provider or deployed metrics exporter.
- CI configuration is prepared but has not run remotely. Docker/container templates have not been executed here; the verified setup uses native PostgreSQL plus WSL Redis. Container image digest verification is not claimed.
- Production region, retention, backup objectives, capacity targets and operational procedures remain the previously recorded launch gates.

## Changes from the initial proposal

Reused installed PostgreSQL and the existing WSL distribution instead of installing Docker. Used the bundled Node 24 runtime instead of replacing system Node. Redis 6.0.16 with Ubuntu packaging is sufficient for the tested Phase 1 limit/state commands; the unexecuted container/CI template targets Redis 7.4. BullMQ is not yet introduced.

Selected and verified `pg` 8.23.1 and `node-pg-migrate` 9.0.0; retained TypeScript 6.0.3 as proposed. Updated lint tooling to compatible ESLint 10 / typescript-eslint 8.71.1 after peer checks found the initially selected lint version did not support TypeScript 6. Exact dependency versions are in the lockfile.

The initial applied local migration files received formatting-only normalization, with no change to their SQL behavior. They are frozen from this handoff; future schema changes must use new migrations. A separate additive migration records named database operators without falsely attributing bootstrap actions to the newly provisioned user.

## Next phase

Phase 2 is the Platform Owner Control Panel: tenant details, lifecycle actions, plans/subscriptions, bounded trial/free/manual grants, notes, usage and audit. Its concrete proposal and explicit approval are required before implementation, per CLAUDE.md sections 66–67. No Phase 2 work was started under this approval.
