# @homebell/mocks

Contract-conformant mock API for Phase 1 (ADR-0018). **Simulation only** — the real rules live on the
server. All credentials below are local demo values; they exist only inside this mock.

## Demo accounts

| App              | Login                                                                                                          | Notes                                                                        |
| ---------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Platform portal  | `owner@homebell.test` / `demo1234`, MFA `000000`                                                               | super admin. Also `ops@`, `billing@`, `support@homebell.test` (role-limited) |
| School dashboard | `admin@greenfield.test` / `demo1234`                                                                           | Greenfield Academy admin (active, live queue)                                |
|                  | `dispatch@greenfield.test`, `frontdesk@greenfield.test`, `reports@greenfield.test`                             | role-limited staff                                                           |
|                  | `multi@homebell.test`                                                                                          | member of 3 schools (school picker)                                          |
|                  | `admin@riverside.test` (trial, 3 days left), `admin@hillcrest.test` (suspended), `admin@oakwood.test` (MFA on) | tenant states                                                                |
| Display          | pairing code from the screen → enter in School dashboard › Displays                                            | or demo token `disp_demo_greenfield_front_gate`                              |
| Guardian app     | phone below, OTP `000000`                                                                                      |                                                                              |

### Guardian phones

| Phone               | Behaviour                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------ |
| `+15550100001`      | Jordan Rivera — primary at Greenfield (2 children) **and** Riverside (1 child); manages additional guardians |
| `+15550100002`      | Alex Rivera — additional guardian (has an active device → device conflict on a new phone)                    |
| `+15550100003`      | blocked guardian                                                                                             |
| `+15550100004`      | deactivated guardian                                                                                         |
| `+15550100005`      | pending activation → activates on first OTP                                                                  |
| `+15550100006`      | active on another phone → **transfer allowed**                                                               |
| `+15550100007`      | transferred 10 days ago → **transfer blocked (cooldown)**                                                    |
| `+15550100008`      | guardian at a suspended school                                                                               |
| `+15550100009`      | additional guardian whose one-time access expired                                                            |
| `+15550100010`      | invited driver — use invitation code `GRNFD7K2QX`                                                            |
| `+15550109999`      | no account at any school                                                                                     |
| any non-`+1` number | `PHONE_NOT_SUPPORTED`                                                                                        |

Invitation codes: `GRNFD7K2QX` (valid), `EXPRD00000` (expired), `SPENT00000` (already used).
Store purchases: tokens starting `pending` → pending, `invalid` → verification fails, anything else → verified.

## Scenarios

Switch in each app's dev panel (bottom-right on web, Settings › Developer on mobile). Switching resets the
mock data. See `src/scenarios.ts`: default, quiet_queue, slow_network, network_failure, permission_denied,
tenant_suspended / expired / cancelled, trial_expiring, blocked_guardian, deactivated_guardian,
device_conflict_transfer_allowed / in_cooldown, otp_resend_limit, otp_locked, duplicate_pickup.

## Tests

`pnpm --filter @homebell/mocks test` — drives platform, school, guardian, onboarding and display sessions
and validates every response against the bundled OpenAPI contract.
