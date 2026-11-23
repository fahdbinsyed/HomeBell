# HomeBell API contract changelog

Versioning follows ADR-0004: additive changes bump the minor `info.version` within `/v1`; breaking
changes need an ADR and a `/v2` path for the affected resources.

## 1.2.0 — 2026-11-23 (additive)

- Every operation that takes `Idempotency-Key` now documents all three idempotency outcomes: `400`
  (`IDEMPOTENCY_KEY_REQUIRED`), `409` (`IDEMPOTENCY_IN_PROGRESS`) and `422` (`IDEMPOTENCY_KEY_REUSED`).
  Ten operations were missing one or two of them (e.g. `POST /v1/platform/tenants` lacked `422`).
  Found by the backend's contract-conformance tests (Phase 2b). Enforced by a contract rule test.

## 1.1.0 — 2026-11-23 (additive)

- Every `/v1/me/**` guardian operation now documents `400` (`DEVICE_ID_REQUIRED`, `VALIDATION_FAILED`)
  and `403` (`SCOPE_INSUFFICIENT` for limited purchase sessions, guardian/tenant state codes). The
  server already behaved this way per the design; the responses were missing from the spec.
  Found by the Phase 1 mock conformance test. Enforced by a contract rule test.
- `POST /v1/auth/staff/invitations/accept` documents `401 INVALID_CREDENTIALS` (existing account,
  wrong password).

## 1.0.0 — 2026-11-22

- Initial v1 contract (Phase 0).
