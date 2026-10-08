# Authentication, authorization and devices

Status: Phase 0 design, with the approved Phase 1 staff/session/device/OTP primitives implemented and tested. Exact implemented defaults are in [PHASE_1_PROPOSAL.md](PHASE_1_PROPOSAL.md); operational limitations and actual provider gates are in [PHASE_1_REPORT.md](PHASE_1_REPORT.md). Guardian login, transfer UX and display sessions below remain later-phase designs.

## Sessions

Identity is global; school authority comes from tenant membership or a guardian relationship. Distinct audiences separate platform, school, guardian and display sessions. Reject a token issued for a different audience even if its subject is valid.

Use short-lived access tokens referencing a server-side session, and rotating opaque refresh tokens stored as digests. Proposed starting access-token lifetime is five minutes, subject to the Phase 1 security review. Refresh families have explicit absolute/idle expiry, device binding, reuse detection and revocation. Never rely on token expiration alone for blocking, transfer or suspension.

Every protected request checks current session/security version and current resource authorization. Sensitive mutations perform the final check within the guarded transaction described in [DATABASE.md](DATABASE.md). Cache-only authorization cannot grant stale access. Database failure denies protected commands.

Web sessions use Secure, HttpOnly cookies restricted to their application context, explicit SameSite policy, CSRF protection and origin checks for mutations. Mobile stores refresh material in platform-backed secure storage and keeps access tokens out of diagnostic logs. Logout revokes server state. Refresh-token races require client single-flight refresh and server replay/reuse handling without inadvertently issuing parallel token families.

Recommend managed, standards-based staff identity with MFA, especially for platform administrators; exact provider selection is unresolved. Do not improvise a custom credential protocol or default shared admin password.

## OTP and invitation proof

OTP purposes: initial activation, invitation redemption, suspicious authentication, device transfer and critical recovery. Ordinary application launch uses the existing session.

Challenges bind purpose, subject/invited normalized phone, expiry, attempt budget and operation context. Verification produces a short-lived, single-use proof restricted to that operation. A login challenge cannot approve a transfer or redeem another invitation. Store protected verifiers, never plaintext OTPs; never log OTP/provider message content.

Rate-limit by account/phone digest, device, network source, purpose and provider budget. Enforce resend cooldown, verification limits and bounded lockouts. Return enumeration-resistant responses. Provider timeout does not authorize access; use delivery idempotency/reconciliation where supported and cap retries to control cost. All exact thresholds must be configured and tested before enabling OTP.

Invitation redemption sends OTP only to the server-stored invited number. Tokens are unguessable, single-use, expiring and stored as digests. Revalidate school blocks and sponsor authority at redemption; an old paid invitation cannot override a block. No school approval step is added.

## Primary-device transfer

One primary guardian account has one active mobile device across schools and children. Device identifiers alone do not prove person identity.

New-device authentication enters a restricted workflow: transfer account, or buy additional access for a separate person/account. It cannot issue a normal second primary session. Successful transfer checks an operation-bound OTP and the last successful transfer time, enforces the default 30-day cooldown, revokes prior sessions atomically, and records old/new device references and actual actor.

Initial enrollment is not a repeated transfer. Cooldown override/recovery behavior is unresolved; implement no silent bypass. Lost-device recovery requires a separately approved process. Additional-guardian device count is not implicitly fixed by the primary rule and must be resolved before that feature ships.

## Proposed permission matrix

Permissions are persisted and evaluated centrally; this table defines proposed seeded role templates, not hardcoded user privileges. Changing assignments is audited. Deny by default.

| Capability | Super Admin | Platform Ops | Billing Ops | School Admin | Dispatcher | Front Desk / Teacher / Coordinator | Reporting | Primary guardian | Additional guardian |
|---|---|---|---|---|---|---|---|---|---|
| Tenant lifecycle | Yes | Yes | No | No | No | No | No | No | No |
| Plans / grants | Yes | Read | Yes | Own school read | No | No | No | No | No |
| Platform notes / audit | Yes | Scoped | Billing scope | No | No | No | No | No | No |
| Students / staff / settings | No | No | No | Own school | Read operational minimum | Explicit assigned scope | No | No | No |
| Guardian block/deactivate | No | No | No | Own school | No by default | No by default | No | No | No |
| Live queue / mark sent / exceptions | No | No | No | Own school | Own school | Explicit assigned scope | Read only if granted | Own requests only | Own requests only |
| Reports / tenant audit | No | No | No | Own school | Limited operational | No by default | Assigned reports | Own history | Own history |
| Request / acknowledge | No | No | No | No guardian impersonation | No guardian impersonation | No guardian impersonation | No | Linked eligible children | Linked eligible children |
| Purchase / invite additional guardian | No | No | No | No | No | No | No | Own primary links | No |

The optional Support Analyst receives only explicit read-only control-plane permissions. Staff role templates can be refined in the Phase 3 proposal without accidentally granting platform-to-tenant access. Cross-guardian confirmation and guardian-history visibility beyond one's own requests remain explicit product decisions.

## Display credentials and realtime

School Admin enrolls a display using an expiring one-use pairing code. Exchange it for a scoped, revocable display session; keep credentials out of URLs, analytics and logs. Set rotation/expiry and idle-screen behavior during Phase 3. No unauthenticated listing of school queues.

Socket handshakes validate session, audience, tenant and permissions. Server constructs channels; clients cannot name arbitrary rooms. Revalidate before sending protected content and after token refresh/reconnect; expiry or revocation disconnects access. Revocation messages accelerate cleanup but cannot be the sole enforcement mechanism.

## Phase 2 implementation (2026-10-08)

Platform sign-in uses `/api/v1/platform-auth/oidc/start?audience=platform`, its separate callback, refresh/logout/me routes and `hb_platform_access`, `hb_platform_refresh`, `hb_platform_csrf` cookies. Platform CSRF checks compare `PLATFORM_ORIGIN`; school checks continue to use `WEB_ORIGIN`. Platform MFA and audience checks remain mandatory. Persisted role assignments union with existing explicit capabilities; adding a role does not revoke old capabilities. Use the audited bootstrap `--role` option to assign a named template. UI controls use current `/me` permissions, but each API action independently checks durable authority.

See [PHASE_2_REPORT.md](PHASE_2_REPORT.md) for verification and remaining production gates.

