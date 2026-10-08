# Domain model

Status: Phase 0 design; no schema or behavior is implemented. See [ARCHITECTURE.md](ARCHITECTURE.md) and the decision register in [PHASE_PLAN.md](PHASE_PLAN.md).

## Ownership and aggregates

| Module / aggregate | Entities | Ownership and invariants |
|---|---|---|
| Tenancy | Tenant, Campus, TenantSettings, SupportAdminNote | One school is one tenant. Default campus allows future expansion without treating campuses as tenants. Platform-only support notes are never school-visible by default. |
| Identity | User, DeviceRegistration, Session, DeviceTransferRecord, OTPChallenge, OTPVerificationLog | Identity and primary-device restriction are account-wide. Public identity lookup never enumerates accounts. Tenant operators see only authorized tenant relationships. |
| Authorization | Role, Permission, TenantMembership, PlatformRoleAssignment | School roles are tenant-scoped. Platform assignments are distinct from tenant membership. |
| School records | Student, Class, Section | Every record belongs to a tenant. Classes/sections and students cannot be cross-linked across tenants. |
| Guardians | Guardian, GuardianStudentLink | Guardian profile is tenant-owned and references a global user. Links carry role, validity, and lifecycle; identity alone grants no child access. |
| Licensing | PrimaryGuardianEntitlement, AdditionalGuardianLicense, LicenseCoverage | One current primary entitlement per licensed child. Additional coverage explicitly names children; pricing scope is unresolved. |
| Invitations | GuardianInvitation, InvitationStudentLink | Invitation binds invited phone, sponsoring primary guardian, tenant, paid coverage, expiry, and single-use token digest. |
| Dismissal | PickupRequest, PickupStatusHistory, PickupAcknowledgment | One nonterminal pickup per student; acknowledgement is a guardian statement, not identity verification. |
| Billing | SubscriptionPlan, PlanVersion, TenantSubscription, PaymentOrder, PaymentEvent | Plan versions are immutable once used. Tenant subscription is annual USD. Provider state does not directly confer access. |
| Entitlements | EntitlementOverride, FeatureFlag | Explicit capability, limit, start/end, operator and reason; deny conditions have precedence. |
| Notifications | Notification, DeliveryAttempt | Tenant and audience scoped; deduplicated intent, bounded provider retries. |
| Evidence / infrastructure | AuditLog, OutboxEvent, IdempotencyRecord, ReportJob, DisplayRegistration | Audit is durable; application logs are separate. Display registrations have minimal audience privileges. |

Global identity does not imply that schools can discover a user's other school relationships. One person can be primary for multiple children through separate child entitlements. A single global primary-device slot prevents using different tenant sessions to bypass the one-device rule. Additional-guardian device-count policy beyond separate accounts remains an open decision.

## Guardian relationship lifecycle

Link states: `active`, `blocked`, `deactivated`, `revoked`; time/usage validity is evaluated separately. A tenant guardian block denies all links in that school; a child-specific restriction can deny an individual link. Revocation retains evidence and cannot be undone by invitation replay. Reactivation requires permission and a new authorization evaluation.

Validity modes: `permanent`, `temporary`, `one_time`, `valid_until_date`. Permanent means no link-level end date, not exemption from school or license expiry. Temporary uses a bounded interval. Exact one-time consumption/reuse semantics and school-local end-date interpretation must be confirmed before Phase 6 implementation.

Invitation states: `pending`, `redeemed`, `expired`, `revoked`. Verified payment creates coverage and invitation atomically through an idempotent payment-event handler. Redemption rechecks sponsor authority, tenant access, paid coverage, invited phone proof, expiry and current school blocks before granting links. School approval is not required. Existing users can redeem into their own separate identity only when the invited phone is verified; never merge the sponsor and invitee.

## Pickup state machine

| From | Command / actor | To | Preconditions |
|---|---|---|---|
| None | Request / eligible linked guardian | `requested` | Active tenant, student, link and license; dismissal window; optional location policy; no existing open pickup |
| `requested` | Mark sent / permitted school operator | `sent_out_pending_acknowledgment` | Expected version matches; record actor/time |
| `requested` or `sent_out_pending_acknowledgment` | Confirm / authorized guardian | `acknowledged_complete` | Explicit guardian acknowledgment after physical receipt; actor policy must be confirmed before Phase 4 |
| `requested` | Cancel / requesting guardian or permitted operator | `cancelled` | No sent-out marker; deliberate command and reason |
| `requested` or `sent_out_pending_acknowledgment` | Flag unresolved / operator or policy job | `exception` | Preserve previous state and reason; never infer successful handoff |
| `exception` | Record late acknowledgment / authorized guardian | `acknowledged_complete` | Recheck permissions and explicit receipt; retain exception history |
| `exception` | Resolve cancellation / permitted operator | `cancelled` | Explicit investigation outcome and reason; not a pickup acknowledgment |

Sent-out tracking is optional: direct confirmation from `requested` is valid so staff marking is never a required physical-release step. Cancellation after a sent-out marker requires exception investigation. Terminal states are immutable except append-only corrections by an explicitly designed audited workflow; there is no generic status-edit API.

`exception` remains nonterminal and keeps the child out of a second active request until resolved. Day-end processing flags old requests and never automatically marks them complete. Exact escalation deadlines belong to tenant policy. If guardian access is revoked mid-pickup, preserve the request for staff follow-up; staff cannot fabricate guardian acknowledgment.

## Concurrency and evidence

All state-changing commands produce history with previous/new state, actor, server timestamp, correlation ID, and reason where applicable. Use resource versions for competing commands. Lock/validate authorization state in the same transaction as the business mutation, following the lock ordering in [DATABASE.md](DATABASE.md). Unknown client outcomes are reconciled using the same idempotency key.

Audit and transactional events describe business facts, not entire entity snapshots. Notifications and displays receive minimized projections. Reports use tenant-owned history and cannot reinterpret an unresolved pickup as completed.
