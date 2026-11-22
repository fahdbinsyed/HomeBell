# ADR-0007: Primary guardian provisioning by school import + OTP activation

- **Status**: Accepted (open decision 3)
- **Date**: 2026-11-22

## Decision

1. School admin imports students via CSV (or adds manually) with `primaryGuardianName`,
   `primaryGuardianPhone` (E.164), `relationship`. Import is two-step: validate → preview → commit
   (`Idempotency-Key`).
2. The system creates (or links to an existing) `UserAccount` by phone, a `Guardian` profile in
   `pending_activation`, a `GuardianStudentLink (isPrimary)` and a `PrimaryGuardianEntitlement`.
3. The guardian installs the app, enters the phone, verifies OTP; **all** pending profiles for that phone
   across tenants activate; terms acceptance is recorded.
4. If no school has registered the phone, verification returns `outcome: no_account` (no account is
   created) with guidance to contact the school.
5. Welcome SMS is optional and school-triggered (`POST …/guardians/{id}/send-welcome`), rate-limited and
   counted against the tenant SMS budget.
6. Changing a primary guardian's phone is a school-admin action, audited.

## Consequences

CSV template is part of the contract (`GET /v1/t/{tenantId}/imports/template`). Siblings share one primary
guardian profile with multiple links. One primary guardian per student (enforced).
