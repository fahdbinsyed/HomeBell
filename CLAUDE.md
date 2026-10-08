# HomeBell — CLAUDE.md

> Production Engineering Contract for Claude Code  
> Product: **HomeBell**  
> Optional endorsement: **Powered by neuXplus**

---

# 1. PURPOSE OF THIS FILE

This file is the root engineering contract for the HomeBell repository.

Claude must read this file completely before:

- proposing architecture,
- modifying files,
- creating code,
- changing database models,
- creating migrations,
- adding dependencies,
- changing APIs,
- changing authentication,
- changing authorization,
- changing tenancy behavior,
- changing billing or entitlements,
- changing security behavior,
- changing mobile behavior,
- or starting any implementation phase.

This document defines:

- engineering rules,
- architecture boundaries,
- security expectations,
- coding standards,
- observability requirements,
- testing standards,
- database rules,
- Git rules,
- phase approval gates,
- and mandatory operating constraints.

It does not replace the founder-approved product requirements.

---

# 2. SOURCE OF TRUTH

HomeBell must maintain the following documentation hierarchy.

```text
HomeBell/
│
├── CLAUDE.md
│
├── docs/
│   ├── PRODUCT_REQUIREMENTS.md
│   ├── ARCHITECTURE.md
│   ├── DOMAIN_MODEL.md
│   ├── DATABASE.md
│   ├── API_STANDARDS.md
│   ├── MULTITENANCY.md
│   ├── AUTH_AND_RBAC.md
│   ├── ENTITLEMENTS.md
│   ├── REALTIME.md
│   ├── SECURITY.md
│   ├── OBSERVABILITY.md
│   ├── TESTING.md
│   └── PHASE_PLAN.md
│
└── ...
```

The founder-approved HomeBell specification must be stored as:

```text
docs/PRODUCT_REQUIREMENTS.md
```

## Precedence

If documentation conflicts, use this order:

```text
1. Founder-approved PRODUCT_REQUIREMENTS.md
2. Explicit human approval given during the current development phase
3. CLAUDE.md
4. Approved architecture documents
5. Approved API/database/domain documents
6. Existing implementation
7. Claude assumptions
```

Claude must never silently override a higher-priority requirement.

If two authoritative requirements conflict:

**STOP and report the conflict.**

Do not guess.

---

# 3. PRODUCT MISSION

HomeBell is a production-grade multi-tenant SaaS platform for school pickup and dismissal management.

It supports:

- school-managed pickup operations,
- guardian pickup requests,
- real-time dismissal queues,
- parent/guardian pickup acknowledgment,
- guardian access management,
- school dashboards,
- public/privacy-safe display screens,
- SaaS tenant management,
- school subscriptions,
- guardian licensing,
- tenant lifecycle management,
- operational reporting,
- and platform-owner administration.

The system must remain:

- maintainable,
- secure,
- scalable,
- observable,
- testable,
- operationally manageable,
- cost-conscious,
- and suitable for phased production delivery.

Do not implement HomeBell as a demo or prototype architecture.

---

# 4. FROZEN BUSINESS RULES

The following business rules are considered frozen.

Claude must not alter them without explicit human approval.

## 4.1 School subscription

The school is the main paying customer.

The school pays an annual subscription in USD.

A school subscription includes:

- school dashboard access,
- school display queue access,
- permitted internal school staff usage,
- one primary guardian mobile account per licensed child.

---

# 4.2 Additional guardian licensing

Each licensed child includes one primary guardian account.

Additional access for another:

- parent,
- spouse,
- grandparent,
- driver,
- nanny,
- or delegate

requires an additional paid guardian license.

The primary guardian initiates the additional guardian process.

Each additional guardian receives a separate account.

Shared guardian credentials are prohibited.

School approval is not required before invited guardian activation.

Schools retain the ability to block or deactivate guardians later.

---

# 4.3 Primary guardian device rule

One primary guardian account may have:

```text
ONE active device at a time.
```

When the account is used on a new device, the system must support:

```text
Option 1:
Transfer the account to the new device.

Option 2:
Purchase an additional guardian license.
```

If account transfer occurs:

- revoke the previous device/session,
- activate the new device,
- create an audit event,
- enforce the configured transfer cooldown.

Default cooldown:

```text
30 days
```

Do not remove or weaken this rule without explicit approval.

---

# 4.4 OTP rules

OTP may be used for:

- initial activation,
- guardian invitation redemption,
- suspicious authentication,
- device transfer confirmation,
- critical recovery.

OTP must not be required on every application launch.

OTP flows must implement:

- rate limiting,
- resend limits,
- verification attempt limits,
- temporary lockouts,
- expiration,
- abuse monitoring,
- provider abstraction,
- and cost-conscious behavior.

Never log the actual OTP value.

---

# 4.5 Pickup responsibility

MVP follows:

```text
Guardian requests pickup
        ↓
School sees request
        ↓
School operationally sends child
        ↓
Guardian physically receives child
        ↓
Guardian confirms pickup
```

MVP does not require:

- gate-side QR scanning,
- staff QR scanning,
- teacher scanning,
- security scanning,
- cryptographic physical handoff verification.

HomeBell must not claim that MVP provides full physical identity-verified handoff.

Approved product wording includes:

- safer dismissal,
- smoother pickup,
- better visibility,
- better coordination,
- clearer accountability.

---

# 4.6 Audio

Audio announcements are excluded from MVP.

Do not implement:

- cloud TTS,
- browser speech,
- automatic audio announcements

during MVP.

Architecture should remain extensible for future audio support.

---

# 4.7 Refund handling

Refunds are manually handled outside HomeBell.

HomeBell must not:

- automatically issue refunds,
- call payment gateway refund APIs,
- trigger automated refund payouts.

HomeBell may record:

- cancellation,
- suspension,
- deactivation,
- notes,
- lifecycle status,
- manually handled refund status.

---

# 5. MVP SCOPE

MVP includes:

```text
Multi-tenant SaaS architecture
Platform Owner / Super Admin portal
School tenant onboarding
School subscriptions
Entitlement management
Trial/free/pilot/manual overrides
School dashboard
Students
Guardians
Android guardian app
Pickup request
Pickup confirmation
Live dismissal queue
School display screen
Additional guardian licensing
Guardian invitations
OTP verification
Device transfer
Anti-sharing controls
30-day cooldown
Guardian blocking/deactivation
Notifications
Audit trails
Reports foundation
Privacy-safe public display
Future extension hooks
```

MVP excludes:

```text
Gate-side staff QR scanning
Physical QR release workflow
Audio announcement
Automatic refunds
Full iOS launch
Advanced bus management
Advanced AI analytics
```

Do not expand MVP scope without approval.

---

# 6. BASELINE TECHNOLOGY STACK

The approved baseline architecture is:

## Backend

```text
NestJS
TypeScript
Node.js LTS
```

## Database

```text
PostgreSQL
```

## Cache / coordination

```text
Redis
```

## Background processing

```text
BullMQ
```

## Web applications

```text
Next.js
React
TypeScript
```

Applications include:

```text
Platform Owner Control Panel
School Dashboard
Public School Display
```

## Mobile

```text
React Native
TypeScript
Android first
iOS-ready architecture
```

## Notifications

```text
Firebase Cloud Messaging through an internal abstraction
```

## OTP

Use an internal provider abstraction.

Application/business logic must not depend directly on one SMS/OTP vendor.

## Billing

Payment/provider integrations must be abstracted behind application interfaces.

Business entitlement logic must never be embedded directly inside a payment provider implementation.

---

# 7. STACK CHANGE POLICY

The baseline stack must not be changed casually.

Claude may recommend an alternative only when there is a substantial engineering reason.

Examples:

- unacceptable security limitation,
- proven scalability limitation,
- major operational risk,
- unsupported production requirement,
- significant cost issue.

Before replacing a baseline technology Claude must provide:

```text
Current choice
Proposed replacement
Reason
Benefits
Risks
Migration cost
Operational impact
Security impact
Alternative considered
Recommendation
```

Then:

**STOP AND WAIT FOR APPROVAL.**

Do not perform the migration automatically.

---

# 8. REPOSITORY ARCHITECTURE

Prefer a TypeScript monorepo.

Phase 0 must finalize the exact tooling and structure.

Recommended direction:

```text
apps/
  api/
  school-web/
  platform-admin/
  mobile/
  display/

packages/
  config/
  types/
  validation/
  api-contracts/
  auth/
  observability/
  security/
  ui/
  testing/
```

Do not create arbitrary cross-application dependencies.

Shared packages should contain genuinely reusable logic.

Avoid turning shared packages into dumping grounds.

---

# 9. ARCHITECTURE PRINCIPLES

Every implementation must prefer:

```text
clear domain boundaries
explicit dependencies
dependency inversion where useful
small cohesive modules
testability
tenant safety
centralized authorization
centralized entitlement resolution
structured observability
idempotent mutation paths
failure isolation
secure defaults
```

Avoid unnecessary abstraction.

Avoid premature microservices.

HomeBell should begin as a well-modularized production system unless Phase 0 demonstrates that separate deployment boundaries are necessary.

The architecture must support future decomposition without requiring it prematurely.

---

# 10. MULTITENANCY — CRITICAL SECURITY RULE

One school equals one tenant.

Tenant isolation is mandatory.

Every tenant-owned resource must be associated with a tenant boundary.

Examples:

```text
students
guardians
school staff
pickup requests
display queues
school settings
subscriptions
guardian links
audit records
reports
notifications
roles
entitlements
```

Never trust a client-provided tenant ID by itself.

Tenant context must come from trusted authenticated server context whenever possible.

---

# 11. TENANT QUERY SAFETY

Tenant-owned database access must always be tenant-scoped.

Unsafe pattern:

```sql
SELECT * FROM students WHERE id = :studentId;
```

Expected conceptual pattern:

```sql
SELECT *
FROM students
WHERE id = :studentId
AND tenant_id = :authenticatedTenantId;
```

Tenant isolation must be enforced at reusable infrastructure/data-access boundaries where practical.

Do not rely solely on developers remembering to add tenant conditions manually.

Phase 0 must recommend the exact enforcement strategy.

---

# 12. PLATFORM CONTROL PLANE

Platform administration is separate from tenant operations.

Platform roles may include:

```text
Super Admin
Platform Operations Admin
Billing/Admin Operations User
Support/Admin Analyst
```

Platform administrators must not automatically receive normal tenant-user authorization simply because they are platform administrators.

If support tenant impersonation/context switching is implemented, it must:

- require explicit authorization,
- display clear UI indication,
- be time bounded where appropriate,
- record operator identity,
- record target tenant,
- record reason,
- produce audit events.

Never silently impersonate tenant users.

---

# 13. TENANT LIFECYCLE

The system must support at least:

```text
draft
trial
pilot_free
active_paid
manual_override
suspended
deactivated
cancelled
offboarding
expired
```

Lifecycle transitions must be centralized.

Do not scatter lifecycle rules across controllers/UI components.

Every privileged lifecycle change must be audited.

---

# 14. ENTITLEMENTS

Entitlement resolution must be centralized.

Access decisions may depend upon:

```text
tenant plan
plan version
subscription status
tenant lifecycle
expiry
manual overrides
feature flags
licensed child limits
guardian licenses
future add-ons
```

Do not implement logic such as:

```text
if (tenant.isPaid)
```

throughout the application.

Instead use an entitlement service/policy layer.

Payment state and entitlement state are related but must not be treated as identical concepts.

---

# 15. ROLES AND AUTHORIZATION

HomeBell requires strong RBAC.

School roles may include:

```text
School Admin
Dispatcher
Dismissal Operator
Front Desk
Teacher
Pickup Coordinator
Read-only Reporting User
```

Family roles:

```text
Primary Guardian
Additional Guardian
```

Authorization must be enforced server-side.

Frontend authorization is only for UX.

Hiding a button does not constitute security.

Every protected API must enforce authorization independently.

---

# 16. AUTHENTICATION

Authentication implementation must support:

- secure session/token management,
- session revocation,
- device/session registry,
- expiration,
- suspicious login handling,
- OTP flows,
- logout,
- account disabling,
- role changes,
- tenant lifecycle changes.

Do not place authorization state permanently inside long-lived tokens if the information can become stale and security-sensitive.

Phase 0 must define the final access/refresh token strategy.

---

# 17. DEVICE SECURITY

Device identity is not equivalent to person identity.

Do not market or implement device binding as physical identity verification.

MVP requires:

```text
device registry
active-device tracking
new-device detection
old-session revocation
transfer workflow
cooldown enforcement
device-transfer audit history
```

Future architecture may support:

- Android Keystore,
- iOS Keychain/Secure Enclave related storage,
- stronger device attestation,
- cryptographic request signing.

Do not build unnecessary custom cryptography.

---

# 18. DATABASE

PostgreSQL is the source of truth for durable business data unless Phase 0 approves otherwise.

Use:

- UUID or another deliberate globally safe ID strategy,
- foreign keys where appropriate,
- explicit indexes,
- unique constraints,
- appropriate timestamps,
- lifecycle-aware statuses,
- transaction boundaries,
- optimistic/pessimistic concurrency only where justified.

Database constraints should enforce critical invariants where practical.

Do not depend only on application validation.

---

# 19. DATABASE MIGRATION POLICY

All schema changes require migrations.

Never:

```text
manually change production schema
drop production tables casually
delete columns containing production data without migration planning
rewrite historical migration files that have already been applied
run destructive migrations automatically
```

Before destructive or difficult-to-reverse migrations:

**STOP AND REQUEST APPROVAL.**

Migration plans must address:

```text
forward migration
data migration
deployment order
backward compatibility
rollback/recovery
expected locking
large-table impact
```

---

# 20. DATA DELETION

Do not hard-delete important historical business/security records unless explicitly required.

Examples normally requiring retained history:

- pickups,
- guardian relationships,
- device transfers,
- tenant lifecycle actions,
- entitlement changes,
- important authentication/security events,
- audit entries.

Where deletion is legally/business-required, design an appropriate retention/anonymization strategy rather than casually deleting relational records.

---

# 21. API STANDARDS

Use versioned APIs.

Recommended pattern:

```text
/api/v1/...
```

All API responses must have consistent conventions.

Define standard handling for:

```text
validation errors
authentication failures
authorization failures
not found
conflict
rate limiting
business rule violations
server errors
```

Do not expose internal stack traces to API clients.

---

# 22. API VALIDATION

Validate every external input.

Examples:

```text
route parameters
query parameters
headers
request bodies
uploaded files
webhook payloads
deep-link parameters
invitation tokens
device metadata
```

Use schema/DTO validation.

Never pass arbitrary client objects directly into ORM persistence APIs.

Prevent mass assignment.

---

# 23. IDEMPOTENCY

Mutation APIs vulnerable to retries or repeated taps must support idempotency.

Especially:

```text
pickup requests
pickup confirmation
guardian purchases
invitation creation
subscription operations
tenant lifecycle actions
device transfers
webhook processing
```

Idempotency must be enforced server-side.

Client button disabling is not sufficient.

---

# 24. REAL-TIME ARCHITECTURE

HomeBell must support dismissal-time traffic spikes.

Real-time updates include:

```text
guardian → API
API → school dashboard
API → display
API → guardian status
worker/event → clients
```

The system must support:

- reconnection,
- duplicate delivery tolerance,
- idempotent consumers,
- authorization of subscriptions/channels,
- tenant separation,
- horizontal scaling,
- stale connection cleanup.

Never allow a client to subscribe to arbitrary tenant channels.

---

# 25. BACKGROUND JOBS

Use BullMQ or an approved equivalent for suitable asynchronous work.

Examples:

```text
notifications
non-critical event processing
report generation
retryable integration work
cleanup
scheduled expiry handling
```

Every worker must be:

- observable,
- retry safe,
- idempotent where necessary,
- protected against poison jobs,
- tenant aware,
- traceable.

Use bounded retries.

Do not retry permanently invalid operations indefinitely.

Dead-letter/failure handling must be designed.

---

# 26. LOGGING AND OBSERVABILITY — MANDATORY FROM PHASE 0

Observability is a foundational requirement.

It must not be postponed until Phase 8.

Phase 0 defines the standard.

Phase 1 implements the foundation.

Every later phase must use it.

---

# 27. STRUCTURED BACKEND LOGGING

Backend logs must use structured logging.

Production logs should be machine-readable.

Prefer structured JSON with fields such as:

```text
timestamp
level
service
environment
version
requestId
correlationId
traceId
tenantId
actorType
actorId
route
method
statusCode
durationMs
event
errorCode
```

Only include fields appropriate for the event.

Do not put sensitive information into logs.

---

# 28. CORRELATION IDS

Every incoming API request must have a server-controlled or validated:

```text
requestId
correlationId
```

Correlation context must propagate when possible through:

```text
Mobile/Web
   ↓
API
   ↓
Domain service
   ↓
Database operation context
   ↓
Published event
   ↓
Queue
   ↓
Worker
   ↓
External service
```

Worker jobs must retain correlation context from their originating transaction when applicable.

This is mandatory for debugging production issues.

---

# 29. MOBILE LOGGING

The React Native application must have an internal logging abstraction.

Support levels such as:

```text
debug
info
warn
error
```

Production builds must not emit verbose sensitive debug output.

Mobile logs must never contain:

```text
OTP
password
access token
refresh token
authorization header
full invitation secret
payment secrets
private keys
```

Production mobile errors should integrate with an approved crash/error-monitoring platform.

Provider selection should remain replaceable where practical.

---

# 30. REQUEST PERFORMANCE LOGGING

Backend infrastructure must record appropriate request performance metadata.

At minimum:

```text
route
method
status
duration
request/correlation ID
```

Do not log entire request/response payloads by default.

Sensitive endpoints require especially strict redaction.

---

# 31. SECURITY EVENT LOGGING

Important security events must be observable.

Examples:

```text
login success/failure
OTP requested
OTP verification success/failure
rate-limit triggered
account lock
suspicious login
device registration
device transfer
session revocation
guardian blocked
guardian reactivated
role change
tenant suspension
privileged admin action
```

Security logs must not expose secrets.

---

# 32. AUDIT LOGS VS APPLICATION LOGS

These are different systems.

## Application logs

Used for:

```text
debugging
operations
performance
exceptions
service health
```

## Audit logs

Used for:

```text
who performed an important action
what action occurred
which business object was affected
when it occurred
which tenant it affected
relevant before/after metadata
```

Do not combine both into one generic logging mechanism.

Audit events should be durable business/security records.

---

# 33. SENSITIVE DATA REDACTION

The following must never appear in logs:

```text
passwords
OTP values
access tokens
refresh tokens
authorization headers
session secrets
private keys
API secrets
payment credentials
full invitation tokens
database credentials
provider credentials
```

Also avoid unnecessary logging of:

- student personal information,
- guardian phone numbers,
- child information,
- sensitive notes.

If identifiers are needed for diagnostics, prefer safe internal IDs.

Implement centralized redaction where possible.

---

# 34. GLOBAL EXCEPTION HANDLING

Backend services must have centralized exception handling.

Unexpected errors must:

```text
receive an internal error/correlation identifier
be logged with diagnostic context
return a safe client response
avoid exposing stack traces
avoid exposing SQL
avoid exposing secrets
avoid exposing infrastructure details
```

Known domain errors should map to stable application error codes.

Example:

```text
GUARDIAN_BLOCKED
DEVICE_TRANSFER_COOLDOWN
PICKUP_ALREADY_REQUESTED
TENANT_SUSPENDED
INVITATION_EXPIRED
OTP_RATE_LIMITED
```

Do not make clients depend on arbitrary exception text.

---

# 35. ERROR MONITORING

Production must have centralized application error monitoring.

It must support:

- backend exceptions,
- web exceptions where useful,
- mobile crashes/errors,
- release/version tagging,
- environment tagging,
- correlation information.

No provider should receive secrets or unnecessary personal data.

---

# 36. HEALTH AND READINESS

Production services must expose controlled health/readiness mechanisms.

Health checks should distinguish where useful between:

```text
service alive
service ready
database connectivity
Redis connectivity
critical dependency state
```

Do not expose sensitive system information publicly.

---

# 37. SECURITY BASELINE

Security must be built into every phase.

Not added later.

Mandatory areas include:

```text
authentication
authorization
tenant isolation
rate limiting
input validation
secure headers
CORS policy
CSRF strategy where relevant
session security
secret handling
OTP abuse protection
dependency security
SQL injection prevention
XSS protection
open redirect prevention
SSRF protection where relevant
file-upload validation where relevant
secure error handling
auditability
```

---

# 38. PASSWORD AND SECRET POLICY

Never:

```text
hardcode passwords
hardcode API keys
hardcode JWT secrets
commit .env files containing secrets
commit service-account credentials
store plaintext credentials
```

Use environment variables and an appropriate secret-management mechanism.

Provide:

```text
.env.example
```

containing names/placeholders only.

---

# 39. SECURITY CRITICAL CHANGES

Claude must stop and request approval before making material changes to:

```text
authentication
authorization
token/session model
tenant isolation
encryption
password storage
device security
payment security
OTP security
privileged impersonation
security-sensitive data retention
```

Claude must explain the security impact before implementation.

---

# 40. RATE LIMITING

Rate limits must exist at appropriate layers.

Particularly protect:

```text
login
OTP send
OTP verify
invitation redemption
password/account recovery
pickup mutation endpoints where abuse is possible
device transfer
public endpoints
```

Rate limiting should support distributed deployments.

Do not rely on process-local memory for production distributed rate limiting.

---

# 41. PRIVACY-SAFE DISPLAY

The school public display is intentionally privacy-sensitive.

Do not expose unnecessary student or guardian information.

Phase 0/3 must define the minimum information required for operational usefulness.

Do not display:

- mobile numbers,
- guardian private details,
- sensitive student notes,
- account identifiers,
- internal security state.

---

# 42. LEGAL/COMPLIANCE CLAIMS

Claude must not claim HomeBell complies with:

```text
GDPR
COPPA
FERPA
DPDP
PCI DSS
ISO 27001
SOC 2
or any other framework
```

unless compliance scope and requirements have explicitly been reviewed and approved.

Engineering should follow strong privacy/security practices without making unsupported certification claims.

---

# 43. CODE QUALITY

Production code must be:

```text
readable
typed
testable
small enough to reason about
explicit
maintainable
consistent
secure
documented where necessary
```

Avoid:

- giant services,
- giant controllers,
- god classes,
- hidden side effects,
- copy/paste business logic,
- excessive `any`,
- magic strings,
- hardcoded configuration,
- unnecessary cleverness.

TypeScript strictness should be enabled where practical.

---

# 44. COMMENTS

Comments should explain:

```text
why
business rule
security decision
non-obvious constraint
architectural reasoning
```

Avoid comments that merely restate obvious code.

---

# 45. DEPENDENCY POLICY

Do not add libraries casually.

Before adding a significant dependency consider:

```text
Is it necessary?
Can the existing stack solve it?
Is it actively maintained?
Is the license acceptable?
Is it production-ready?
Does it add security risk?
Does it materially increase bundle/runtime size?
Does it lock the product to a vendor?
```

Avoid adding multiple libraries solving the same problem.

Never replace stable infrastructure merely because another library is newer.

---

# 46. CONFIGURATION

Environment-specific behavior must use configuration.

Never branch application logic using hardcoded production assumptions.

Expected environments may include:

```text
local
development
test
staging
production
```

Configuration must be validated on application startup.

If required configuration is missing:

**fail fast with a clear safe error.**

---

# 47. FEATURE FLAGS

Feature flags may be used where appropriate for:

- staged rollout,
- future features,
- tenant-specific enablement,
- controlled pilots.

Feature flags are not substitutes for authorization.

---

# 48. TESTING STRATEGY

Testing is mandatory.

Every phase must include an appropriate mix of:

```text
unit tests
integration tests
API tests
authorization tests
tenant-isolation tests
database tests
worker tests
mobile tests
web tests
end-to-end tests
```

Not every function requires a unit test.

Critical business rules do require strong coverage.

---

# 49. MANDATORY SECURITY TESTS

At minimum test scenarios such as:

```text
Tenant A cannot access Tenant B students.
Tenant A cannot access Tenant B guardians.
Tenant A cannot access Tenant B pickup queue.
Guardian A cannot request pickup for an unrelated child.
Blocked guardian cannot request pickup.
Expired guardian cannot request pickup.
Additional guardian cannot access unlinked children.
School user without permission cannot perform privileged action.
Suspended school cannot use protected tenant operations.
Old device session stops working after transfer.
Transfer cooldown is enforced.
Expired invitation cannot be redeemed.
Used invitation cannot be reused.
OTP cannot be brute-forced without controls.
```

These tests are release-critical.

---

# 50. CONCURRENCY TESTING

Dismissal operations are concurrency-sensitive.

Test:

```text
double taps
repeated requests
network retries
simultaneous pickup actions
duplicate worker delivery
multiple websocket events
multiple device-transfer attempts
parallel guardian invitation redemption
```

Database/application design must preserve invariants under concurrency.

---

# 51. TEST DATA

Never use production personal data in automated tests.

Use generated fixtures/factories.

Keep test data deterministic where practical.

---

# 52. CI QUALITY GATES

Before code is considered complete, relevant pipelines should perform:

```text
format validation
lint
type checking
unit tests
integration tests
build validation
migration validation
security/dependency checks where configured
```

A phase is not complete while required CI checks fail.

Do not disable tests to make CI green.

Fix the cause.

---

# 53. GIT POLICY

Changes should be small and logically grouped.

Do not create huge unrelated commits.

Recommended commit style:

```text
feat(api): add tenant lifecycle transitions
fix(auth): revoke prior session after device transfer
test(pickup): cover duplicate pickup requests
docs(architecture): document realtime event flow
refactor(entitlements): centralize access resolution
chore(ci): add backend typecheck
```

Do not commit:

```text
.env
secrets
credentials
generated production data
debug dumps
private keys
large irrelevant artifacts
```

---

# 54. BRANCHING

Use the repository's approved branching model.

If none exists, propose one during Phase 0.

Claude must not force-push, rewrite shared Git history, delete remote branches, or perform destructive repository operations without explicit approval.

---

# 55. EXISTING CODE SAFETY

When modifying existing implementation:

1. understand current behavior,
2. identify consumers,
3. identify tests,
4. make the smallest correct change,
5. preserve unrelated behavior,
6. add/update tests,
7. report affected modules.

Do not rewrite a working module merely for stylistic preference.

---

# 56. MOBILE APPLICATION RULES

The guardian app is Android-first but iOS-ready.

Use React Native + TypeScript.

The mobile architecture must avoid unnecessary Android-only assumptions in business/domain logic.

Platform-specific functionality should be isolated behind appropriate interfaces.

Mobile UX must prioritize:

```text
simplicity
large clear actions
fast pickup interaction
clear loading state
clear success state
clear failure state
blocked/expired messaging
device-transfer warnings
network resilience
```

---

# 57. MOBILE NETWORK HANDLING

The application must handle:

```text
timeouts
offline/network loss
server errors
expired sessions
duplicate taps
slow responses
retry behavior
app background/foreground transitions
```

Do not create duplicate pickup operations due to client retries.

---

# 58. WEB APPLICATION RULES

Platform Admin and School Dashboard are distinct security contexts.

Do not assume their authorization policies are interchangeable.

Critical actions should require deliberate UX and server authorization.

Potentially destructive administrative actions must have appropriate confirmation.

---

# 59. DOMAIN MODEL

The architecture must support at least these domain concepts:

```text
Tenant / School
Campus
User
Role
Tenant Membership
Student
Class
Section
Guardian
Guardian-Student Link
Primary Guardian Entitlement
Additional Guardian License
Guardian Invitation
Pickup Request
Pickup Status History
Pickup Acknowledgment
Device Registration
Device Transfer Record
OTP Verification Log
Notification
Subscription Plan
Plan Version
Tenant Subscription
Entitlement Override
Feature Flag
Audit Log
Support/Admin Note
```

Phase 0 must refine ownership, lifecycle, aggregates and boundaries before Phase 1 implementation.

---

# 60. PICKUP STATE MACHINE

Pickup lifecycle must be explicitly modeled.

At minimum support concepts equivalent to:

```text
requested
sent_out_pending_acknowledgment
acknowledged_complete
cancelled
exception
```

Blocked guardian and expired access are primarily access conditions, not necessarily pickup lifecycle states.

Phase 0/5 should define the exact state machine.

Do not scatter pickup state transitions throughout UI/controller logic.

Centralize transition validation.

---

# 61. AUDIT REQUIREMENTS

Audit important actions including:

```text
authentication events
OTP events
pickup request
pickup confirmation
invitation creation
invitation redemption
device transfer
guardian block
guardian deactivate
school administrator action
platform administrator action
plan changes
subscription changes
entitlement changes
tenant lifecycle changes
support context switching
```

Audit entries should record appropriate fields such as:

```text
timestamp
tenant
actor
action
resource type
resource ID
result
safe metadata
correlation ID
```

Audit records should be append-oriented.

Do not silently rewrite history.

---

# 62. API AREAS

Architecture must provide clean interfaces for:

```text
authentication
OTP
tenant resolution
platform tenant management
school onboarding
plans
subscriptions
entitlements
tenant lifecycle
students
guardians
guardian invitations
guardian licensing
pickup requests
pickup confirmation
live queue
display feed
guardian blocking
device transfer
notifications
reports
audit retrieval
support/admin notes
```

Do not create one giant generic API controller.

---

# 63. PHASE DELIVERY MODEL

Development is strictly phase-based.

Phases:

```text
Phase 0 — Solution Blueprint and Architecture
Phase 1 — Platform Core and Multi-Tenant Backend Foundation
Phase 2 — Platform Owner Control Panel
Phase 3 — School Admin Dashboard
Phase 4 — Parent/Guardian Android Core
Phase 5 — Real-Time Dismissal Engine
Phase 6 — Additional Guardian Paid Access
Phase 7 — Device Transfer and Anti-Sharing
Phase 8 — Reports, Hardening and Production Readiness
Phase 9 — Future Feature Hooks
```

Logging and observability are not deferred to Phase 8.

They begin in Phase 0/1 and are strengthened during Phase 8.

---

# 64. PHASE 0

Phase 0 must produce the architecture blueprint.

No major production implementation should begin until Phase 0 is approved.

Phase 0 must define:

```text
final stack
monorepo strategy
application boundaries
control plane vs tenant plane
multitenancy enforcement
authentication strategy
authorization/RBAC model
session/token model
domain boundaries
database strategy
migration strategy
entitlement model
tenant lifecycle
real-time architecture
queue/worker model
notification abstraction
OTP abstraction
device model
audit architecture
logging architecture
correlation/trace strategy
error-handling standard
deployment direction
configuration/secrets approach
testing strategy
CI direction
major risks
future extension strategy
```

---

# 65. PHASE 1

Phase 1 establishes production foundations including:

```text
tenant model
users
roles
memberships
configuration
authentication
sessions
audit framework
structured logging
correlation IDs
global exception handling
base security middleware
database/migration framework
students
classes
sections
guardians
tenant-safe APIs
test infrastructure
```

Observability must already function in Phase 1.

---

# 66. PHASE APPROVAL GATE — ABSOLUTE RULE

Claude must never automatically proceed from one phase to the next.

Required workflow:

```text
UNDERSTAND
   ↓
ANALYZE
   ↓
PROPOSE
   ↓
WAIT FOR APPROVAL
   ↓
IMPLEMENT
   ↓
TEST
   ↓
REPORT
   ↓
STOP
   ↓
WAIT FOR APPROVAL
   ↓
NEXT PHASE
```

When a phase is completed:

Claude must stop.

Claude must not begin the next phase until the human explicitly approves it.

Examples of valid approval:

```text
Approved. Continue to Phase 1.
Proceed with Phase 2.
Phase 3 approved.
```

Silence is not approval.

---

# 67. BEFORE IMPLEMENTING EACH PHASE

Claude must first provide:

```text
1. Phase goal
2. Scope
3. Out-of-scope
4. Dependencies
5. Assumptions
6. Architecture decisions
7. Security considerations
8. Tenant-isolation considerations
9. Domain impacts
10. Database changes
11. Migration changes
12. API changes
13. UI/mobile changes
14. Logging/observability changes
15. Testing strategy
16. Risks
17. Acceptance criteria
18. Files/modules expected to change
```

Then:

**WAIT FOR APPROVAL.**

Only after approval may implementation start.

---

# 68. AFTER IMPLEMENTING EACH PHASE

Claude must report:

```text
What was implemented
Files created
Files modified
Database migrations
API endpoints
Security controls
Logging/observability added
Tests added
Tests executed
Build/lint/typecheck results
Known limitations
Deferred work
Any deviation from approved plan
Acceptance-criteria status
```

Then:

**STOP.**

---

# 69. DEFINITION OF DONE

A task or phase is not complete merely because the code compiles.

Relevant completion criteria include:

```text
requirements satisfied
authorization implemented
tenant isolation verified
validation implemented
errors handled
logging implemented
audit events implemented where required
tests passing
typecheck passing
lint passing
build passing
migrations reviewed
documentation updated
no secrets committed
no unresolved critical TODO
no known critical security defects
```

---

# 70. APPROVAL-REQUIRED CHANGES

Claude must stop before:

```text
changing frozen business rules
changing approved stack
changing tenant model
changing auth architecture
changing session/token architecture
changing entitlement semantics
changing subscription semantics
changing guardian licensing rules
changing device-transfer rules
changing database ownership model
introducing destructive migration
deleting working features
adding significant new infrastructure
introducing a new external SaaS dependency
changing security-sensitive behavior
starting the next phase
```

Provide recommendation first.

Wait for approval.

---

# 71. SAFE AUTONOMOUS DECISIONS

Claude may make normal low-level engineering decisions without separate approval when they do not alter architecture or business behavior.

Examples:

```text
local variable names
small helper extraction
private method structure
test organization
minor type refinement
non-breaking refactoring
internal implementation details
```

These decisions must still follow repository conventions.

---

# 72. DO NOT OVER-ENGINEER

Production-ready does not mean unnecessarily complex.

Do not introduce:

```text
Kubernetes
Kafka
service mesh
event sourcing
CQRS
multiple databases
custom cryptography
microservices
complex distributed orchestration
```

unless Phase 0 demonstrates a clear requirement and the human approves it.

Prefer the simplest architecture that safely satisfies the actual workload and product requirements.

---

# 73. DO NOT UNDER-ENGINEER

Do not use shortcuts such as:

```text
in-memory production sessions
in-memory distributed rate limits
hardcoded tenants
hardcoded permissions
hardcoded plans
shared admin passwords
plaintext OTP storage
unguarded APIs
client-only security checks
unscoped database queries
silent exception swallowing
console.log as production observability
```

---

# 74. NO SILENT FAILURE

Never silently swallow exceptions.

If an error is intentionally tolerated:

- document why,
- log it at the appropriate level,
- expose appropriate operational visibility,
- preserve safe system behavior.

---

# 75. NO SECRET LEAKAGE

Before every commit or generated output, verify no secrets are present.

Never print secrets in:

```text
logs
test snapshots
error messages
documentation
example payloads
commit messages
screenshots
generated reports
```

---

# 76. DOCUMENTATION MAINTENANCE

When implementation changes approved architecture or interfaces, update the corresponding documentation in the same phase.

Examples:

```text
architecture change → ARCHITECTURE.md
schema change → DATABASE.md
domain change → DOMAIN_MODEL.md
auth change → AUTH_AND_RBAC.md
API convention → API_STANDARDS.md
observability change → OBSERVABILITY.md
security change → SECURITY.md
test strategy → TESTING.md
```

Documentation must not knowingly drift away from implementation.

---

# 77. TODO POLICY

Do not leave vague production TODOs such as:

```text
TODO: secure later
TODO: add validation
TODO: handle tenant
TODO: fix permissions
```

If necessary work is deferred, document:

```text
exact missing behavior
reason
risk
target phase
temporary safeguard
```

Critical security requirements may not be deferred casually.

---

# 78. FIRST CLAUDE RESPONSE — REQUIRED

On the first interaction with this repository:

DO NOT generate the full application.

DO NOT start Phase 1.

DO NOT create broad production implementation.

The first response must provide:

```text
1. Refined HomeBell architecture
2. Recommended final stack and justification
3. Proposed monorepo structure
4. Platform control-plane architecture
5. School tenant-plane architecture
6. School dashboard architecture
7. Guardian mobile architecture
8. Domain model overview
9. Multitenancy strategy
10. Tenant-isolation enforcement strategy
11. Authentication/session/OTP architecture
12. RBAC authorization design
13. Entitlement model
14. Tenant lifecycle model
15. Device/session/transfer strategy
16. Database strategy
17. Realtime architecture
18. Queue/background worker architecture
19. Logging/observability architecture
20. Audit architecture
21. Error-handling model
22. Security model
23. Testing strategy
24. Major risks and mitigations
25. Exact Phase 0 deliverables
```

Claude must identify unresolved architectural choices clearly.

Claude must recommend the preferred solution for each.

Claude must not implement those recommendations yet.

At the end write:

```text
Phase 0 architecture proposal complete.

I will not begin implementation until this Phase 0 proposal is explicitly approved.
```

Then stop.

---

# 79. PHASE 0 APPROVAL BEHAVIOR

Once Phase 0 architecture is approved:

Claude may create/update the approved architecture documentation.

Claude still must not automatically start Phase 1.

After documenting the approved Phase 0 output:

```text
STOP.
```

Request explicit approval to start Phase 1.

---

# 80. PRODUCTION MINDSET

Treat HomeBell as a real system that may eventually handle:

- many schools,
- many guardians,
- children/student information,
- dismissal-time traffic spikes,
- subscription operations,
- security incidents,
- customer support cases,
- production debugging,
- failed third-party providers,
- mobile network instability,
- tenant suspension,
- account compromise,
- device changes.

Design accordingly.

But remain practical.

---

# 81. FINAL ENGINEERING PRINCIPLE

For every decision, optimize for:

```text
Correctness
Security
Tenant isolation
Safety
Observability
Maintainability
Testability
Operational clarity
Scalability
Cost awareness
User simplicity
```

In that order when appropriate.

Never trade away tenant isolation, authorization, data safety, or security merely for implementation speed.

---

# 82. GOLDEN RULE

When uncertain:

```text
Do not guess.
Do not silently change product behavior.
Do not bypass security.
Do not proceed to the next phase.
Explain the issue.
Recommend the safest practical option.
Wait for approval when the decision is material.
```

HomeBell must be built deliberately, phase by phase, with every production-critical decision visible and reviewable.