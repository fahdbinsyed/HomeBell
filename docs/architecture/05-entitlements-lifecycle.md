# Entitlements, Plans and Tenant Lifecycle

## 1. Principles

- Access is **never** hard-coded as "paid vs free". Every gate asks the **EntitlementResolver**:
  `can(tenantId, feature)` / `limit(tenantId, name)` / `operationalMode(tenantId)`.
- Refunds are **never** processed by HomeBell. Lifecycle actions only change service state; any money
  movement happens outside the product. Notes can record `refundStatus = refund_handled_manually`.
- Every lifecycle action and override is audited with actor, reason code, note and before/after state.

## 2. Plans

- `SubscriptionPlan` (e.g. _Standard_, _Pilot_) → immutable `PlanVersion`s
  (`draft → published → retired`). A tenant subscription pins exactly one published version, so later
  price/feature changes never silently alter existing tenants.
- `PlanVersion` = `{ priceMinor (USD cents), billingPeriod: annual, features: {key: bool},
limits: {key: int|null} }`. `null` limit = unlimited.

### Feature keys (v1)

| Key                                                                                   | Meaning                                            |
| ------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `dismissal.queue`                                                                     | live queue + pickup requests                       |
| `dismissal.display`                                                                   | public display screens                             |
| `dismissal.location_rule`                                                             | geofence rule may be enabled                       |
| `dismissal.sent_out_step`                                                             | dispatcher "sent out" action                       |
| `guardians.additional_purchase`                                                       | guardians may buy additional guardian seats in-app |
| `guardians.school_granted_seats`                                                      | school/platform may grant seats                    |
| `imports.csv`                                                                         | CSV import                                         |
| `reports.standard` / `reports.export`                                                 | reports / CSV export                               |
| `branding.custom`                                                                     | logo + colour                                      |
| _(future)_ `audio.announcements`, `qr.verification`, `campus.multi`, `sso.enterprise` | reserved, default false                            |

### Limit keys (v1)

`students.max`, `staff.max`, `displays.max`, `additional_guardians.max_per_student`,
`otp.daily_budget`, `imports.max_rows`.

## 3. Resolution algorithm

```
effective = planVersion.features/limits            (from the active TenantSubscription)
          ⊕ lifecycle gate (operationalMode)       (see table below; can only restrict)
          ⊕ active EntitlementOverrides            (not revoked, now < expiresAt; latest wins per key)
          ⊕ FeatureFlags                           (global kill switches / staged rollout; can only restrict)
```

Each effective value carries its **source** (`plan`, `override`, `lifecycle`, `flag`) so the platform
portal can explain _why_. Result cached in Redis 60 s, key `ent:{tenantId}`, invalidated by any
subscription/override/lifecycle/flag change event.

## 4. Lifecycle states and operational mode

| State             | operationalMode            | Staff dashboard          | Guardian pickup            | Display | Expiry                      |
| ----------------- | -------------------------- | ------------------------ | -------------------------- | ------- | --------------------------- |
| `draft`           | `setup`                    | platform-only setup      | ✗                          | ✗       | —                           |
| `trial`           | `full`                     | ✓                        | ✓                          | ✓       | required                    |
| `pilot_free`      | `full`                     | ✓                        | ✓                          | ✓       | optional                    |
| `active_paid`     | `full`                     | ✓                        | ✓                          | ✓       | required (subscription end) |
| `manual_override` | `full`                     | ✓                        | ✓                          | ✓       | optional                    |
| `expired`         | `read_only` (14-day grace) | read-only                | ✗ `TENANT_NOT_OPERATIONAL` | ✗       | —                           |
| `suspended`       | `read_only`                | read-only                | ✗                          | ✗       | —                           |
| `deactivated`     | `blocked`                  | login shows notice       | ✗                          | ✗       | —                           |
| `cancelled`       | `blocked`                  | login shows notice       | ✗                          | ✗       | —                           |
| `offboarding`     | `export_only`              | data export only (admin) | ✗                          | ✗       | retention timer             |

## 5. Transitions

| Action                         | From                                                                    | To                                                     | Requires                                              |
| ------------------------------ | ----------------------------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------- |
| `start_trial`                  | draft, expired                                                          | trial                                                  | `expiresAt` (≤ 90 days default)                       |
| `grant_free`                   | draft, trial, expired, active_paid                                      | pilot_free                                             | `reasonCode`, optional `expiresAt`                    |
| `activate` / `convert_to_paid` | draft, trial, pilot_free, manual_override, expired                      | active_paid                                            | subscription with published plan version, `expiresAt` |
| `apply_manual_override`        | trial, pilot_free, active_paid, expired, suspended                      | manual_override                                        | note, optional `expiresAt`                            |
| `extend_expiry`                | trial, pilot_free, active_paid, manual_override                         | (same)                                                 | new `expiresAt` > current                             |
| `suspend`                      | trial, pilot_free, active_paid, manual_override, expired                | suspended                                              | reason                                                |
| `deactivate`                   | trial, pilot_free, active_paid, manual_override, expired, suspended     | deactivated                                            | reason                                                |
| `cancel`                       | any except draft, offboarding                                           | cancelled                                              | reason, optional `refundStatus` note                  |
| `start_offboarding`            | cancelled, deactivated                                                  | offboarding                                            | `retentionDays` (default 90)                          |
| `reinstate`                    | suspended, deactivated, cancelled                                       | `previousOperationalState` (or explicit `targetState`) | valid expiry for target                               |
| _(system)_ `expire`            | trial, pilot_free, active_paid, manual_override with `expiresAt` passed | expired                                                | worker sweep, hourly                                  |

Every transition request carries `expectedState`; a mismatch returns `409 LIFECYCLE_STATE_CHANGED`
(prevents two operators acting on stale screens). Invalid transitions return
`409 INVALID_LIFECYCLE_TRANSITION`. The tenant detail response includes `allowedActions` computed from
this table **and** the caller's permissions.

Side effects (via outbox): entitlement cache bust, `tenant.state_changed` realtime event, session policy
re-evaluation (blocked tenants: guardian/staff sessions continue to authenticate but all tenant-plane
writes fail with `TENANT_NOT_OPERATIONAL`; displays are disconnected).

## 6. Free / trial / charity / pilot

- **Trial**: time-boxed, full features, converts to paid or expires.
- **Pilot / charity**: `pilot_free` with optional expiry and optional usage caps via overrides
  (e.g. `students.max = 200`).
- **Manual override**: operator escape hatch for contract edge cases; always requires a note.
- All of them are just states + overrides; no special code paths.
