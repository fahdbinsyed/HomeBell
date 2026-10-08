# Phase 2 implementation report

Implemented locally on 2026-10-08 after explicit approval of [PHASE_2_PROPOSAL.md](PHASE_2_PROPOSAL.md). This is the owner control panel and its backend; Phase 3 and production deployment have not started.

## Delivered

- Next.js 16.4.0 / React 19.3.0 owner portal with school search/filter/pagination, global operational counts, draft onboarding, tenant details, effective access, aggregate usage, plans/immutable versions, annual assignments, grants, extensions, overrides, internal/refund-status notes and scoped audit history.
- Platform role templates: Super Admin, Platform Operations, Billing Operations and Support Analyst. Assignments are explicit through the audited operator bootstrap command. Existing identities are not promoted. Capability checks remain authoritative in the API; a platform role does not grant school-record access.
- Central durable entitlement evaluation on every protected school request. Immediate lifecycle denials precede grants and capability overrides. No grace period or worker-dependent expiry. Active students allocate child slots; atomic usage triggers and allocation locks serialize concurrent admissions. Future lower-cap overrides reserve capacity by limiting new allocations as well.
- USD minor-unit annual plan versions cannot be edited by the runtime. Calendar anniversaries clamp leap day. Current non-paid access can be replaced by an explicitly recorded annual assignment; its original grant evidence remains. Paid access extensions create separate complimentary manual grants and preserve the subscription term. No payment verification or refund is claimed.
- All tenant control commands use expected versions, actor-bound idempotency and atomic control audit, tenant-safe audit and outbox writes. Lifecycle history includes status changes caused by grants/subscriptions. Note bodies stay in the private note table. Audit pagination applies category permissions and filters before paging and orders newest first.
- Separate `hb_platform_*` cookies and `/api/v1/platform-auth/*` routes, platform Origin checks, platform MFA and current permissions in session responses. School cookies survive platform login. The fixed-target Next proxy excludes school routes, checks mutation Origin, preserves Set-Cookie headers and never caches authenticated responses.
- Responsive tables/forms, native confirmation dialogs, pending/error/empty states, stable retry keys for unknown outcomes, visible stale-edit conflicts, annual-end preview and sign-out on desktop/mobile.

## Database and setup

Additive migrations `1780000000004-control-plane` and `1780000000005-allocation-lock-policy` were rehearsed on the dedicated test database and applied locally. The second migration supplies the RLS UPDATE policy needed to lock allocation rows; column privileges still prohibit changing usage counters from tenant code. Previously applied migrations were not rewritten.

Development preflight found no existing tenants or allocated children. The upgrade supports bounded legacy grants for existing valid non-paid Phase 1 access, retaining its prior expiry and current allocation cap; unreconciled paid rows fail preflight. Counter maintenance uses a dedicated non-login, non-superuser, non-BYPASSRLS function owner and explicit object names. The control runtime has no raw student/guardian SELECT privilege.

`scripts/preflight-phase2.mjs` reports aggregate migration readiness. `scripts/reconcile-usage.mjs` compares counters in a consistent read-only snapshot and exits nonzero on mismatch. Both local and test reconciliation reported zero mismatches. Applied migrations are excluded from automatic formatting to preserve history.

The portal uses workspace-local self-signed HTTPS certificates through `scripts/start-portal.ps1`; no trust root was installed and no global TLS bypass was enabled. The certificate expires after 30 days. Setup and real-provider provisioning are in [LOCAL_SETUP.md](LOCAL_SETUP.md).

## Verification

- 10 unit tests and 39 real PostgreSQL/Redis integration tests pass. The original 37 Phase 1 checks remain, with expiry fixtures moved to the authoritative grant table.
- Five Chromium browser tests cover signed OIDC login, separate cookies, onboarding, trial/free/annual grants, complimentary extensions, overrides/revocation, suspension/reinstatement, notes/audit, plan publication, stale edits, restricted roles, session expiry, cross-origin rejection and school-route exclusion.
- Desktop, mobile and conflict-dialog screenshots were inspected. Browser tests assert no mobile page overflow. Test data is synthetic and confined to the dedicated test database.
- API build, API/test typecheck, portal production build, portal typecheck, ESLint and formatting checks pass. Frozen-lockfile installation succeeds; production dependency audit reports no known vulnerabilities. Next.js/React peer requirements were checked against registry metadata. The attempted `pnpm explain peer-requirements` command is not supported by this pnpm version; it is not counted as a passed check.
- The full Chrome executable hit a Windows side-by-side launch error. Playwright's downloaded Chromium headless shell works and is used by the passing browser suite. TLS certificate acceptance is confined to the isolated test context.

CI now includes portal builds and browser verification. No remote CI run or PR exists because this workspace has no Git repository/remote.

## Operational limits

Real OIDC issuer/client/MFA mapping and redirect registration remain unconfigured. The live local portal therefore displays configuration-required sign-in; synthetic browser authentication is confined to tests. Use a trusted certificate for a real provider/browser integration.

Trial/free/manual activation and annual assignments must cover the current instant. Scheduled cancellation and implicit grace remain excluded. Future bounded overrides and paid complimentary extensions are supported. Plans contain no seeded production prices. Refund status is a manual note only. Offboarding denies service without claiming deletion/export.

Production hosting, provider validation, external metrics export/alerts, workload sizing, backups/retention and managed signing-key rotation remain release gates. Process-local policy counters expose entitlement denials and version conflicts to the runtime but are not an external monitoring deployment. The outbox has no delivery worker yet. The school UI, guardian app and dismissal workflows remain later phases.

Recovery after restrictive policies are enabled requires a forward repair or a maintenance window that disables school operations. Running the old Phase 1 code against these policies could bypass restrictions and is not a safe rollback.
