# State Machines (normative)

The enums below are defined in `packages/contracts/openapi/components/enums.yaml`. Transitions are enforced
server-side only; clients render whatever state the server returns.

## 1. Pickup request — `PickupRequestState`

```
               dispatcher "sent out"            guardian "confirm picked up"
  requested ─────────────────────────► sent_out ───────────────────────────► acknowledged (terminal)
     │  │                                 │  │
     │  └── guardian confirm (direct) ────┼──┼──────────────────────────────► acknowledged
     │                                    │  └── timeout (default 15 min) ──► exception
     │                                    │                                      │
     ├── guardian cancel (before sent_out)│                                      ├─ guardian late confirm ─► acknowledged
     ├── staff cancel (any open state) ───┴──────────► cancelled (terminal)      └─ staff resolve ─► resolved (terminal)
     └── end-of-day sweep ──────────────────────────► exception
```

| From                           | To           | Actor                                              | Rule                                                        |
| ------------------------------ | ------------ | -------------------------------------------------- | ----------------------------------------------------------- |
| —                              | requested    | guardian                                           | eligibility checks pass (below); `Idempotency-Key` required |
| requested                      | sent_out     | staff (`queue.dispatch`)                           | only if `dismissal.sent_out_step` enabled                   |
| requested, sent_out, exception | acknowledged | guardian (requester or any linked active guardian) | records `PickupAcknowledgment`; `viaSentOut` flag           |
| requested                      | cancelled    | guardian                                           | own request only                                            |
| requested, sent_out, exception | cancelled    | staff                                              | reason required                                             |
| sent_out                       | exception    | system                                             | `sentOutExceptionMinutes` elapsed without ack               |
| requested                      | exception    | system                                             | end of tenant day (configurable time)                       |
| exception                      | resolved     | staff                                              | `resolution` + note required                                |

Flags (not states): `stale` (requested for > `requestedStaleMinutes`), `reminderSentAt`.

**Rejections are not states.** A request that fails eligibility is rejected with an error code and audited
(`pickup.request_rejected`); nothing enters the queue:
`GUARDIAN_BLOCKED`, `GUARDIAN_DEACTIVATED`, `GUARDIAN_ACCESS_EXPIRED`, `GUARDIAN_NOT_LINKED`,
`STUDENT_INACTIVE`, `STUDENT_NOT_ELIGIBLE`, `OUTSIDE_DISMISSAL_WINDOW`, `LOCATION_REQUIRED`,
`OUTSIDE_PICKUP_ZONE`, `TENANT_NOT_OPERATIONAL`, `FEATURE_NOT_ENTITLED`.

**Duplicates**: one open request (requested/sent_out/exception) per `(tenant, student, queueDate)`. A
second request for the same student returns `409 DUPLICATE_ACTIVE_REQUEST` with `meta.existingRequestId`.
A retried POST with the same `Idempotency-Key` returns the original response (`Idempotent-Replayed: true`).

## 2. Guardian — `GuardianState`

| From                                | To                          | Actor                                                                  |
| ----------------------------------- | --------------------------- | ---------------------------------------------------------------------- |
| —                                   | pending_activation          | school import/manual add (primary) or invitation creation (additional) |
| pending_activation                  | active                      | guardian OTP activation / invitation redemption                        |
| active                              | blocked                     | school admin (reason)                                                  |
| blocked                             | active                      | school admin (unblock)                                                 |
| active, blocked, pending_activation | deactivated                 | school admin                                                           |
| deactivated                         | active / pending_activation | school admin (reactivate; pending if never activated)                  |
| active, pending_activation          | revoked                     | primary guardian (additional guardians only)                           |
| active                              | expired                     | system (validity window ended)                                         |
| expired                             | active                      | primary guardian extends validity (within seat term)                   |

History (pickups, audit) is always retained; states only gate future actions.

## 3. Guardian invitation — `InvitationState`

`pending → redeemed` (single use) · `pending → expired` (default 72 h, max 7 d) · `pending → revoked`
(primary guardian / school). `resend` regenerates the code and resets expiry; the old code stops working
immediately. The code is 10 characters, Crockford base32 (no ambiguous chars), stored hashed; the deep
link is `homebell://invite/{code}` + verified App Link `https://<app-domain>/invite/{code}`.

## 4. License seat — `LicenseSeatState` (ADR-0011)

| From                | To        | Trigger                                                                                                   |
| ------------------- | --------- | --------------------------------------------------------------------------------------------------------- |
| —                   | available | purchase verified / school grant / platform grant                                                         |
| available           | assigned  | invitation created against the seat                                                                       |
| assigned            | available | invitation expired/revoked, or guardian expired/revoked — _if_ `reassignmentsUsed < 5` and term not ended |
| assigned, available | expired   | term end date                                                                                             |
| any                 | voided    | store refund / chargeback notification (observed, not initiated) → linked guardian moves to `expired`     |

## 5. Device — `DeviceState`

`active → revoked` (logout, admin, account deactivation) · `active → transferred_out` (device transfer).
A device is never reactivated; a new login creates a new registration.

## 6. Display — `DisplayState`

`pairing → active → revoked`. Pairing sessions expire after 10 min.

## 7. Session — `SessionState`

`active → revoked | expired`. Revocation reasons: `logout`, `device_transfer`, `admin_action`,
`refresh_reuse`, `account_deactivated`, `tenant_blocked`, `password_reset`.

## 8. Tenant lifecycle

See [05-entitlements-lifecycle](05-entitlements-lifecycle.md#5-transitions).

## 9. License validity modes — `LicenseValidityMode` (ADR-0011)

| Mode               | Access window                                                                                         |
| ------------------ | ----------------------------------------------------------------------------------------------------- |
| `permanent`        | from activation until the seat's term end, or until revoked                                           |
| `temporary`        | `durationDays` (1–30) from activation                                                                 |
| `valid_until_date` | from activation until `validUntil` (≤ seat term end)                                                  |
| `one_time`         | ends at the first **acknowledged** pickup by this guardian, or 24 h after activation, whichever first |
