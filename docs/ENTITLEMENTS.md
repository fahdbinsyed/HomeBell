# Subscriptions, entitlements and lifecycle

Status: Phase 0 design. See unresolved commercial semantics in [PHASE_PLAN.md](PHASE_PLAN.md).

## Frozen commercial rules

School annual USD subscription includes school dashboard/display access, permitted internal staff, and one primary guardian account per licensed child. Additional people require separate paid guardian access initiated and paid for by the primary guardian. Payment providers are adapters; HomeBell never automatically issues refunds or calls refund APIs. Manual refund status notes are evidence only and do not trigger money movement.

## Central resolver

The resolver returns `allowed`, stable reason code, effective limits, evaluated time and policy/version metadata for a named capability and resource. Evaluate:

1. Session/account validity and audience.
2. Tenant lifecycle denial conditions.
3. Effective immutable plan version and subscription/grant interval.
4. Authorized time-bounded overrides and limits.
5. Feature availability; a flag can restrict a capability, never manufacture permission.
6. Staff permission or guardian/student relationship, block/deactivation and validity.
7. Licensed-child allocation and additional guardian coverage as applicable.
8. Dismissal-specific timing/location/student eligibility.

Suspension, deactivation, cancelled/offboarding/expired operational denial, school blocks and account revocation cannot be bypassed by ordinary grant/feature flags. Evaluate expiry using server time on every protected operation; scheduled expiry changes improve visibility only. Capacity allocation locks the relevant counter/allocation rows to prevent over-allocation.

Caches contain versioned projections, not independent authority. Final protected mutations recheck current durable policy. Any UI access indicators are advisory.

## Tenant state model

| State | Tenant operational access | Entry / exit rule |
|---|---|---|
| `draft` | Denied | Create tenant; complete required setup before activation |
| `trial` | Granted within explicit interval/caps | Start trial; convert to paid, pilot, override, or expire |
| `pilot_free` | Granted within explicit grant/caps | Free/charity/pilot grant; extend, convert, or expire |
| `active_paid` | Granted within subscription interval/limits | Verified payment or explicitly audited manual assignment; renewal extends period |
| `manual_override` | Only explicit bounded grant | Authorized operator sets reason, capability scope and expiry |
| `suspended` | Denied | Temporary explicit hold; reinstate only after re-evaluating valid underlying grant |
| `deactivated` | Denied | Immediate administrative disable; explicit reinstatement required |
| `cancelled` | Denied | Effective cancellation; no refund automation |
| `offboarding` | Normal operations denied | Controlled export/retention workflow under explicit administrative authorization |
| `expired` | Denied | No effective access interval; renew or grant access explicitly |

Cancellation-at-period-end, if approved, is a scheduled cancellation field while the tenant remains in its current valid access state; `cancelled` means cancellation has taken effect. No assumed grace period. Configuration for grace or acknowledgment-only access during suspension requires explicit product approval before implementation.

Central commands: create, activate, start trial, convert to paid, grant free, extend expiry, suspend, deactivate, cancel, offboard, reinstate, apply/remove override. Each records expected version, actual actor, reason, old/new state, entitlement consequences and audit/outbox events. Reject invalid transitions and stale versions with conflict responses. Reinstate recomputes the valid target state; never blindly restores `active_paid` from an expired subscription. Offboarding restoration requires an explicit operation and must be prohibited once irreversible anonymization has occurred.

## Additional licenses and invitations

Create a server-owned payment order from selected eligible child links and an approved price definition. Verify provider event signature, identity, order, amount, currency and settled status. A mobile success screen is not proof of payment. Provider events deduplicate before granting access; late/out-of-order events reconcile against authoritative order state.

After verified payment, create license coverage and invitation in one transaction. Redemption binds the invited separate identity, phone proof and selected children. A later school block prevents use even when a license is paid. Deactivation retains payment and relationship history.

Coverage explicitly models each child. Whether a purchase bundles siblings, how additional licenses renew, and their currency/price are unresolved; do not infer them from school pricing. One-time validity requires an atomic usage reservation/consumption policy before shipping; suggested reservation at pickup creation is a proposal, not a finalized rule.

## Operational controls

Operator overrides include capability/limit, start/end, reason and operator. Display them prominently in tenant detail and audit. Removing an override recomputes effective access and may invalidate live sessions/streams. Usage is measured independently of billing; reducing a cap below existing allocations cannot silently delete children or history. Define the precise grandfathering/reallocation policy before exposing cap reduction.

Provider failure cannot silently extend entitlement or lose a paid order. Reconciliation queues surface stuck purchases to authorized operations users. Automated refund behavior remains out of scope even after cancellation or payment anomalies.

## Phase 2 implementation (2026-10-08)

The authoritative implemented resolver is `apps/api/src/entitlements.ts`. It reads durable grants/overrides on every school request; `access_until` is only a compatibility projection. Lifecycle denial wins. Intervals are start-inclusive/end-exclusive, capability denial wins over allow, and overrides cannot revive suspended access. Current annual assignments can close current non-paid grants while retaining their grant/audit history. Active students allocate slots; cap reductions below usage are rejected and future lower-cap overrides also constrain new allocations. Immediate cancellation has no grace. Paid extensions are separately labeled manual grants, not subscription-term edits or payment claims. Later guardian/mobile entitlements remain planned.

See [PHASE_2_REPORT.md](PHASE_2_REPORT.md) for verification and remaining production gates.

