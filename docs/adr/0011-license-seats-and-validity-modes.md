# ADR-0011: License seats and validity modes

- **Status**: Accepted (open decision 7)
- **Date**: 2026-11-22

## Decision

**Charging**: an additional guardian license is a **seat per school term** (annual, aligned to the tenant
term end date) — a one-time consumable store purchase (Google Play or Apple IAP, ADR-0005) per term,
re-purchased for the next term. Not an auto-renewing
subscription (store subscriptions anchor to purchase date, not school terms).

**Seat vs. access**: a seat belongs to the primary guardian (per tenant). An invitation consumes a seat.
The validity mode controls the delegate's access within the seat term:

| Mode               | Definition                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------- |
| `permanent`        | active until seat term end or revoked                                                             |
| `temporary`        | relative: `durationDays` 1–30 from activation                                                     |
| `valid_until_date` | absolute: until `validUntil` (date, tenant-local end of day), ≤ seat term end                     |
| `one_time`         | ends at the first acknowledged pickup by that guardian, or 24 h after activation, whichever first |

**Seat return**: when a delegate expires or is revoked, the seat returns to `available` for reuse,
up to **5 reassignments per seat per term** (`SEAT_REASSIGNMENT_LIMIT`). This makes temporary/one-time
delegates (a driver for a week) practical without each needing a new purchase, while capping abuse.

Per-student cap: `additional_guardians.max_per_student` (plan limit, default 4).

## Consequences

Enums `LicenseValidityMode`, `LicenseSeatState`, `LicenseSeatSource`. Validation errors
`INVALID_VALIDITY_WINDOW`, `NO_AVAILABLE_SEAT`.
