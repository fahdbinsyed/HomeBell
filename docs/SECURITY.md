# Security design

Status: Phase 0 threat and control baseline. This document makes no certification or regulatory compliance claim.

## Assets and boundaries

Protect student/guardian data, account/session credentials, invitation and OTP secrets, paid entitlements, device ownership, dismissal history, audit evidence, and platform authority. Treat browser/mobile input, school selectors, deep links, payment webhooks and queued payloads as untrusted until validated through their boundary.

| Threat | Required control | Verification |
|---|---|---|
| Cross-school object access | Verified membership, scoped repositories, RLS, composite references | Adversarial multi-tenant integration suite |
| Stale/replayed credentials | Session checks, rotation, revocation, audience enforcement | Old token, reused refresh, changed-role and transfer tests |
| OTP enumeration/brute force/cost abuse | Generic responses, purpose binding, distributed limits, keyed verification, spend ceilings | Expiry/resend/attempt/concurrent-limit/provider-failure tests |
| Invitation theft/reuse | Phone proof, digest-only token storage, expiry, atomic consumption, block recheck | Concurrent redeem and wrong-phone/purpose tests |
| Double pickup / conflicting guardians | Partial unique constraint, idempotency, guarded version transitions | Concurrent multi-guardian requests and terminal-state tests |
| License bypass | Server-owned orders, verified payment events, centralized resolver | Forged webhook, stale grant, duplicate event and cap-race tests |
| Display/notification disclosure | Dedicated projections, restricted display session, generic push hints | Payload schema/forbidden-field tests |
| Privileged misuse | Separate platform roles, least privilege, reasoned commands and audit | Platform-to-tenant denial and audit actor tests |
| Browser attacks | CSRF/origin checks, secure cookies, output escaping, CSP, allowlisted CORS | Cross-origin mutation and unsafe rendering tests |
| Injection/SSRF/upload attacks | Input allowlists, parameterized SQL, fixed provider endpoints, bounded validated uploads when introduced | Malformed-input and boundary tests |
| Secret leakage | Secret management, redaction, safe errors, no payload logging by default | Canary-secret assertions in logs/errors/traces |

## Operational baseline

TLS externally and appropriate encrypted connections internally; least-privilege runtime/migration credentials; separate environments; no production PII in test fixtures; dependency/license review; startup configuration validation. Store no secrets in Git or source examples.

Critical access checks depend on current durable state. If a required authorization dependency is unavailable, fail closed. Redis cache misses cannot confer access. Feature flags only narrow enabled functionality; authorization and entitlement checks still apply.

Public display credentials never grant student-management or guardian endpoints. Pairing tokens expire and redeem once; revoke lost displays. Display aliases should be rotated per dismissal session where practical and visible to authorized guardians/staff. Exact alias issuance is finalized in Phase 3.

## Child-data and retention boundaries

Minimize student information in clients, providers, audit metadata and operational logs. Restrict school notes to authorized roles and exclude them from public projection and push. Exports require explicit permission and expire; download authorization is rechecked.

Retention, anonymization, legal request handling and backup expiry require launch-geography and contractual decisions. Until approved, production collection/launch is blocked; development uses synthetic data. Do not interpret indefinite preservation of history as an approved legal retention policy.

## Incidents and support

Document runbooks for tenant data exposure, stolen guardian session, suspicious transfer, OTP spend spike, stuck paid order, display compromise, dismissal outage, and backup recovery. Runbooks identify responsible operator, immediate containment, evidence preservation, communication owner and recovery verification.

Emergency session/tenant revocation uses audited administrative commands. No unlogged database edits or universal support backdoor. Support impersonation and cooldown overrides need separate design/approval. Manual school fallback during service outage must be agreed before pilot dismissal use.

## Launch gates

Before any pilot with real children: passing tenant/auth/concurrency tests; one-device enforcement; anti-abuse OTP limits; current-session revocation; minimal display/push payloads; tested backups/restoration; monitored errors and audit; provider credentials secured; named incident owner; approved retention/region; agreed operational fallback. Phase 8 strengthens these controls; it does not postpone their initial implementation.

Audio, QR, stronger attestation and automated identity claims remain outside MVP. Android secure storage protects credentials but does not prove who physically holds a device or receives a child.

## Phase 2 implementation (2026-10-08)

Phase 2 uses separate platform cookie names and callback paths, exact Origin checks at proxy and API, and server-enforced current capabilities/MFA. The proxy rejects school API paths and traversal-like segments, forwards to a configured fixed origin, preserves separate Set-Cookie headers and disables caching. Native confirmation dialogs are usability controls, not authorization. Non-login counter ownership avoids granting school-record read access to the control runtime. Browser tests cover cookie isolation, cross-origin denial, restricted roles and session revocation.

See [PHASE_2_REPORT.md](PHASE_2_REPORT.md) for verification and remaining production gates.

