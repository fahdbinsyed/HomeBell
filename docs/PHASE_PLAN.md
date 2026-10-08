# Delivery plan and decision register

## Current status

Phase 0 documentation is complete. The [Phase 1 proposal](PHASE_1_PROPOSAL.md) was subsequently approved, including setup. Phase 1 implementation and local verification completed on 2026-10-08; see [PHASE_1_REPORT.md](PHASE_1_REPORT.md). The user approved the [Phase 2 proposal](PHASE_2_PROPOSAL.md); its owner portal and control plane are implemented and verified locally. See [PHASE_2_REPORT.md](PHASE_2_REPORT.md). Phase 3 has not started. No production deployment exists.

Authority: [PRODUCT_REQUIREMENTS.md](PRODUCT_REQUIREMENTS.md), then applicable explicit human approval, then [../CLAUDE.md](../CLAUDE.md). Each implementation phase requires a concrete proposal, explicit approval, implementation, relevant checks, completion report, then a stop before the next phase.

## Phase 0 delivery contract

- **Goal/scope:** reviewable blueprint for the complete MVP and future extension boundaries.
- **Dependencies:** founder requirements and engineering contract; approved initial proposal.
- **Assumptions:** one school per tenant, Android first, annual school USD subscriptions, baseline stack unchanged, providers and capacity not yet selected.
- **Architecture:** modular NestJS backend, separate web contexts, React Native guardian client, PostgreSQL/RLS, Redis, BullMQ, transactional outbox, centralized authorization/entitlements.
- **Files:** ARCHITECTURE, DOMAIN_MODEL, DATABASE, API_STANDARDS, MULTITENANCY, AUTH_AND_RBAC, ENTITLEMENTS, REALTIME, SECURITY, OBSERVABILITY, TESTING and this PHASE_PLAN; update README index/status.
- **Database/API/UI impact:** proposed logical models, transaction boundaries, contract inventory and screen responsibilities only. No migrations, endpoints or screens are implemented.
- **Security/isolation:** defined in dedicated documents; no current system is represented as secured or production-ready.
- **Validation:** document completeness, link checks, frozen-rule consistency, cross-document ownership/state review.
- **Rollout:** review documentation locally; no deployment, package installation, account setup or external publication.
- **Acceptance:** required decisions are documented or explicitly gated as open; frozen rules preserved; no premature production code; next phase remains unstarted.

## Shared requirements for every implementation phase

Before approval, provide goal, scope and exclusions; dependencies and assumptions; architecture/module changes; database/migration changes; exact API contracts; UI/mobile changes; security and tenant-isolation effects; logging/audit/metrics; tests; risks; rollout/recovery; acceptance criteria and expected files. The summaries below are planning boundaries, not permission to skip that proposal.

Every phase applies current-session checks, tenant isolation, safe errors, redaction, idempotency where needed and audit. Mobile/dismissal features are developed behind flags with synthetic data until their dependencies and security controls are complete. No intermediate phase is automatically a production launch.

## Phase sequence

| Phase | Goal and scope | Dependencies / planned files | Database and API changes | UI changes | Validation, rollout and acceptance |
|---|---|---|---|---|---|
| 1 — Core foundation | Establish tenancy, identity, permissions, sessions, school/guardian records, configuration and observability | Approved Phase 0; resolve Phase 1 decisions. `apps/api`, shared contracts/config/security/observability/testing, workspace and CI files; worker/outbox foundation as required | Reviewed initial migrations for tenant, identity, membership, school and guardian core, session/device slot, audit/idempotency/outbox; auth and scoped CRUD contracts | No production mobile or web workflow; development API inspection only | Real PostgreSQL RLS/pool tests, current-session revocation, safe errors and logs, migration/build gates; isolated development rollout; no known tenant bypass |
| 2 — Platform portal | Tenant onboarding, plan/version assignment, lifecycle, grants, usage, notes and audit | Phase 1, approved permission/entitlement policies. `apps/platform-admin`, API tenancy/subscription/entitlement modules | Plan, subscription, override, support-note models; control-plane APIs and state commands | Platform login, list/detail, grants, lifecycle confirmations, audit and usage | Platform-to-tenant denial, expiry/override precedence, lifecycle conflicts and audit; staging-only until approved; no refund automation |
| 3 — School dashboard | School operations, staff/settings, guardian control, report and display foundation | Phases 1–2; display enrollment/privacy decision. `apps/school-web`, `apps/display`, relevant API modules | Staff/settings and report/display registration migrations; scoped school, pairing and projection APIs | Overview, records, staff, settings, queue shell, history/report shell, display | Role/tenant tests, projection/credential tests, accessibility and browser checks; expose only complete capabilities; no unrestricted public feed |
| 4 — Guardian Android core | Activation, child list, request/acknowledgment/history, blocked/expired UX, notification groundwork | Phases 1–3; acknowledgment policy and secure mobile storage choice. `apps/mobile`, API dismissal core, notification adapter | Basic pickup/history/acknowledgment models and HTTP commands, OTP/session integration; foundational primary-device enforcement already available | Android core actions with pending/offline/retry states | End-to-end synthetic HTTP pickup, no required staff release marker, idempotency, current device check, OTP limits; no real-school pilot before all required security dependencies |
| 5 — Realtime dismissal | Live propagation, queue ordering/recovery, display updates, unresolved workflow, burst resilience | Phase 4 durable pickup commands/outbox. API realtime module, `apps/worker`, queue/dashboard/display/mobile integration | Event/projection/version refinements and exception operations; no replacement of durable pickup truth | Live queue, status sync, stale/reconnect indicators, manual follow-up | Multi-client convergence, duplicate/out-of-order/lost events, outage fallback, concurrency and load tests; staged enablement, authoritative polling fallback |
| 6 — Paid additional access | Verified orders, licenses, invitation issuance/redemption and validity | Existing identity, tenant, OTP and entitlement foundation; commercial/one-time/provider decisions. Guardian/billing modules, worker, mobile flows | Orders/events/licenses/coverage/invitations; verified payment webhook and redemption APIs | Purchase/add guardian, invitation status, redemption, validity and blocked states | Duplicate payment/redemption races, invited-number proof, school-block precedence, no school approval, no refunds; provider sandbox before bounded rollout |
| 7 — Transfer / anti-sharing UX | Complete transfer-or-buy, cooldown visibility, recovery policy, suspicious-transfer tooling | Core one-device/revocation foundation from Phase 1; additional accounts from Phase 6; recovery decisions. Auth/device modules and mobile/staff surfaces | Transfer audit/cooldown workflow refinements, restricted new-device challenge/transfer APIs | Transfer choices, cooldown warnings, separate-account purchase path, transfer visibility | Two-device/concurrent-transfer tests, immediate HTTP/refresh/socket revocation, default 30-day cooldown; no implicit recovery bypass |
| 8 — Reports and production readiness | Complete reports, reliability/security/performance review, recovery and operational readiness | All MVP flows and release decisions resolved. Reporting, dashboards, runbooks, CI/deployment configuration | Approved report queries/indexes and any reviewed retention migrations; authorized export APIs | Final operational reports and actionable error/exception presentation | Full regression, peak-load evidence, backup restore, security review and pilot checklist; explicit production rollout approval with rollback/fallback plan |
| 9 — Future hooks | Validate extension seams for audio, QR, iOS, campus and enterprise billing | Stable MVP contracts; separate phase approval. Relevant interfaces/contracts/docs only | Prefer no migrations; any structural need requires separate justification | No new audio/scanning/iOS production feature | Compatibility tests and scope review; hooks remain disabled; no expansion of MVP claims |

## Dependency clarifications

Phase 4 needs a minimal durable pickup lifecycle before Phase 5 adds realtime delivery and operational completeness. Phase 1 provides session/device foundations; Phase 4 must enforce one active primary device even though Phase 7 delivers the complete transfer experience. Until transfer is implemented, a new device is denied/restricted, never silently activated. OTP abuse prevention is required wherever OTP first becomes available, not deferred to Phase 8.

Phase 2 uses audited manual subscription/grant administration; a payment provider is selected before automated collection is enabled. Paid additional-guardian provider work belongs to Phase 6. Commercial access cannot be simulated as settled payment outside test fixtures.

## Open decision register

Open entries are not contradictions in the source requirements. They are unspecified details requiring explicit resolution before the named dependent implementation or release. Recommendations below are proposals only. Record the decision, approver and date when resolved.

| ID | Decision / recommendation | Owner | Gate / safeguard |
|---|---|---|---|
| D01 | Data-access/migration library and exact dependency versions. Prefer a maintained TypeScript solution proven with transaction-local RLS and composite constraints. | Engineering | Phase 1 proposal; no schema implementation before selection |
| D02 | Staff identity provider, MFA method, access/refresh expiry and OTP thresholds. Prefer standards-based identity, privileged MFA and short access lifetime. | Engineering + product owner | Phase 1 auth proposal; no exposed authentication without controls |
| D03 | Pilot schools, children, simultaneous requests/connections, service objectives and recovery targets. Measure burst workload before sizing. | Product + operations | Before load-test acceptance/pilot; make no unmeasured SLA claim |
| D04 | Hosting region, data retention/anonymization, export/backup policy, monitoring provider. Choose for launch geography and contractual needs. | Product + operations with appropriate review | Before production personal data/provider setup |
| D05 | Additional-license pricing, currency, renewal and sibling coverage. Model explicit child coverage, with bundling only if approved. | Product owner | Before Phase 6 commercial implementation |
| D06 | One-time usage consumption, cancellation/reuse and date-bound validity. Prefer atomic reservation for one pickup, with explicit cancellation outcome. | Product owner | Before Phase 6 validity implementation; no guessed usage behavior |
| D07 | Who may acknowledge another guardian's request and what guardian history is visible. Prefer requesting guardian acknowledgment and own-request history initially. | Product owner | Before Phase 4 pickup contracts |
| D08 | Payment/OTP providers and mobile purchase requirements in launch markets. Use adapters and verified callbacks. | Product + engineering | Before provider integration/paid flows; no provider commitment yet |
| D09 | Lost-device recovery/cooldown exception and additional-guardian device count. Preserve primary one-device and 30-day defaults; no silent bypass. | Product + security owner | Before Phase 7 recovery and Phase 6 additional-device policy |
| D10 | Display alias issuance/rotation and pairing expiry. Prefer dismissal-specific school aliases and short-lived pairing codes. | Product + school operations | Before Phase 3 display implementation |
| D11 | Optional geofence behavior and dismissal exception timing. Keep location off unless configured; treat it as eligibility input, not identity proof. | Product + school operations | Before corresponding Phase 4/5 behavior |
| D12 | Scheduled cancellation, grace/acknowledgment-only access, lower-cap allocation policy. Prefer explicit effective dates and no inferred grace; never delete records to meet a cap. | Product owner | Before exposing those controls in Phase 2; baseline denies operational access when suspended/expired |
| D13 | Operational outage fallback, incident owner and pilot rollout/rollback criteria. Agree school procedure and practice it. | Operations + pilot schools | Before real dismissal pilot |

Phase 1 decision updates (2026-10-08): D01 is resolved for the implemented foundation with `pg` 8.23.1, `node-pg-migrate` 9.0.0 and exact lockfile versions; real RLS, transaction, constraints and pool-context checks pass. D02's protocol/session/OTP-foundation defaults were approved and tested; actual issuer/client/MFA mapping and live OTP vendor remain deployment/integration gates. Other decisions retain their phase/release gates. This records implementation evidence without treating provider tests as real-provider approval.

## Principal risks

| Risk | Mitigation / evidence |
|---|---|
| Tenant data disclosure | Layered authorization/RLS, composite references, real runtime-role negative tests |
| Device revocation race | Guarded transactions, durable session versions, protected stream checks |
| Lost/duplicated realtime work | Transactional outbox, durable intent reconciliation, snapshots and resource versions |
| Guardian licensing ambiguity | Explicit decision gates and coverage model; no guessed billing behavior |
| Children released without acknowledgment | Honest state/history, unresolved follow-up, no identity-verification claim |
| Dismissal spikes / provider outages | Load model, bounded retries/fairness, stale-state UX, school fallback |
| Late security implementation | Required controls start in Phase 1 and each feature's first exposure |

## Phase 0 review and handoff

Documentation review must verify the twelve blueprint files, local links, frozen-rule preservation, transaction/authorization consistency, and explicit open decisions. No application test/build result is implied. After documentation checks, report created/modified files, checks and limitations, then request explicit permission to start the Phase 1 proposal. Do not create the monorepo, migrations, packages or deployment resources under Phase 0 authorization.

### Review record — 2026-10-07

- Created all twelve required blueprint documents and updated README status/navigation.
- Automated filesystem/Markdown checks passed: required files present, local links resolve, fenced code blocks balanced.
- Reviewed the frozen annual USD school subscription, separate paid guardian accounts, no school approval for invitation activation, primary one-device/default 30-day transfer rule, guardian acknowledgment, no MVP audio/scanning, and manual-only refunds across the blueprint.
- Reviewed phase dependencies: basic HTTP pickup precedes realtime, device/session enforcement precedes mobile pilot, and observability/OTP controls are not postponed to hardening.
- Acceptance: Phase 0 documentation scope complete; D01–D13 remain explicit implementation/release gates. No source requirement was intentionally changed.
- No runtime source, migrations, endpoints, application tests, builds, deployments or infrastructure were created or executed. Implementation behavior remains unverified.
- Next authorized step requires explicit permission to begin the Phase 1 proposal; this record does not authorize Phase 1 implementation.

Phase 2 decision update (2026-10-08): D12 is resolved for this scope: immediate cancellation, no implicit grace, and rejection of child-cap reductions below allocated usage. Active students allocate child slots. Current annual assignments may replace non-paid grants, with retained evidence and no payment-verification claim. Scheduled cancellation remains deferred. D01 now includes pinned Next.js 16.4.0, React 19.3.0 and Playwright 1.64.0; D02 real-provider configuration remains open.

