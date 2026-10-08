# HomeBell — Final Corrected Phase-by-Phase Claude Build Prompt

You are a principal software architect, senior full-stack engineer, senior mobile architect, senior SaaS product designer, multitenant platform lead, and security-conscious engineering manager.

Your task is to help build **HomeBell**, a production-grade, multi-tenant school pickup and dismissal SaaS platform.

Build this with serious SaaS quality, but keep it practical, maintainable, cost-conscious, scalable, secure, and ready for phased delivery.

Important working rules:
- Work **phase by phase**.
- At the start of every phase, restate the phase goal, scope, assumptions, dependencies, risks, and acceptance criteria.
- Do not jump into coding everything at once.
- Before implementation of each phase, explain the architecture, modules, folder structure changes, and why they are needed.
- Prefer clean, production-grade architecture over demo shortcuts.
- Keep tenant isolation, auditability, rate limiting, security, and operational control as first-class concerns.
- Keep the design future-ready for iOS, optional audio announcements, optional stronger verification, and enterprise expansion.
- When multiple implementation choices exist, recommend the best one and proceed.
- Generate production-oriented code, not tutorial/demo code.

---

## 1) Product Name

**HomeBell**

Optional endorsement:
**Powered by neuXplus**

---

## 2) Product Summary

HomeBell is a multi-tenant school pickup and dismissal management platform.

It helps schools and families manage student pickup through:
- parent/guardian pickup requests from a mobile app,
- real-time school dismissal queue visibility,
- guardian access management,
- pickup confirmation after physical handoff,
- school-level monitoring and reports,
- platform-owner control over schools, subscriptions, and tenant lifecycle.

This is a **school-paid SaaS** model with **additional paid guardian access** for extra parents/delegates.

---

## 3) Final Frozen Business Rules

These rules are final unless a safer internal implementation detail is required.

### 3.1 School Subscription Model
- The **school** is the main paying customer.
- The school pays an **annual subscription** in **USD**.
- The school subscription includes:
  - school web dashboard access,
  - school display queue access,
  - internal school staff usage according to roles,
  - one **primary guardian mobile account per licensed child**.

### 3.2 Additional Guardian Licensing
- One child includes one **primary guardian** account.
- If another parent, spouse, driver, or other delegate wants app access for the same child, that is a **paid additional guardian license**.
- The **primary guardian** adds and pays for the extra guardian inside the app.
- The invited guardian receives a **separate account**.
- Shared credentials are not allowed.
- School approval is **not required** for invited guardian activation.
- However, the school can later **block or deactivate** any guardian.

### 3.3 Device Sharing and Anti-Abuse
- One primary guardian included account = **one active device at a time**.
- If that account is used on a new device, show two options:
  1. **Transfer account to the new device**.
  2. **Buy an additional guardian license**.
- If transfer happens:
  - old device session must be revoked,
  - new device becomes active,
  - event is logged.
- Add a **30-day cooldown** for repeated transfer to prevent misuse.
- Paid additional guardians use separate accounts and separate session/device access.

### 3.4 OTP Usage Model
Use OTP for:
- first account activation,
- additional guardian invitation redemption,
- suspicious login,
- device transfer confirmation,
- critical recovery when necessary.

Do **not** require OTP on every app open.
Add rate limits, resend limits, and abuse protection.

### 3.5 Pickup Responsibility Model
MVP uses a **parent-request + parent-confirmation** flow.

Flow:
1. Guardian requests child pickup in app.
2. School sees the request in dashboard and display queue.
3. School operationally sends the child out.
4. Guardian physically receives the child.
5. Guardian confirms pickup in app.

MVP does **not** require gate-side QR scanning by staff.
MVP does **not** require teacher/security staff to scan or complete the release in the app.
Do not overclaim full physical identity-verified handoff in MVP.

### 3.6 Audio Feature Rule
- No voice/audio announcement in MVP.
- No cloud TTS in MVP.
- No browser speech in MVP.
- Architecture must stay future-ready for this feature later.

---

## 4) Platform Owner / Super Admin Control Panel (Mandatory)

This is a mandatory part of the product and must be explicitly designed and implemented.

HomeBell must include a **Platform Owner Control Panel / Super Admin Portal** separate from school dashboards.

This portal is for the SaaS owner/operator and must allow complete operational control over all school tenants.

### 4.1 Platform Control Panel Core Purpose
The platform owner must be able to:
- view all schools/tenants using HomeBell,
- create schools manually,
- activate/deactivate schools manually,
- suspend schools,
- cancel schools,
- offboard schools,
- grant free access to selected schools,
- assign trial access to selected schools,
- manually override normal subscription states,
- review tenant usage and status,
- view audit logs for admin actions,
- manage plan assignments and feature access.

### 4.2 Platform Control Panel Screens / Modules
Include modules for:
- tenant list / school list,
- tenant detail page,
- subscription/plan management,
- entitlement overrides,
- free/pilot/trial assignment,
- lifecycle actions (activate, suspend, deactivate, cancel, offboard, reinstate),
- school usage and limits,
- audit logs,
- internal notes for operational decisions,
- support tooling / safe tenant context switching if implemented.

### 4.3 Tenant Subscription / Lifecycle States
At minimum support these states:
- `draft`
- `trial`
- `pilot_free`
- `active_paid`
- `manual_override`
- `suspended`
- `deactivated`
- `cancelled`
- `offboarding`
- `expired`

### 4.4 Tenant Lifecycle Actions
Support actions such as:
- create tenant,
- activate tenant,
- start trial,
- convert trial to paid,
- grant free access,
- extend expiry,
- suspend access,
- deactivate immediately,
- cancel service,
- offboard tenant,
- reinstate tenant,
- apply or remove entitlement overrides,
- add support/admin notes.

### 4.5 Manual Refund Rule
If a school discontinues or requests money back:
- the app must **not** automatically process refunds,
- the app must **not** call payment gateway refund APIs,
- the app must **not** automate refund payout,
- refund handling is performed **manually outside the application** by the business team.

The system should only support:
- service deactivation/suspension/cancellation,
- manual notes,
- lifecycle state tracking,
- audit logs,
- refund status notes such as `refund_handled_manually` if needed.

---

## 5) Final MVP Scope

### Included in MVP
1. Multi-tenant architecture.
2. Platform owner control panel / super admin portal.
3. School onboarding and tenant creation.
4. School subscription and entitlement model.
5. Trial and free-school support.
6. Manual override support.
7. School admin dashboard.
8. Student management.
9. Guardian management.
10. Parent/guardian Android app.
11. Pickup request flow.
12. Pickup confirmation flow.
13. Live dismissal queue.
14. School display screen.
15. Additional guardian licensing flow.
16. Invitation flow.
17. OTP verification flow.
18. Device transfer and anti-sharing flow.
19. 30-day cooldown logic.
20. School guardian block/deactivate control.
21. Notifications.
22. Audit logs.
23. Reports foundation.
24. Privacy-safe display.
25. Future-ready hooks for audio, QR, and iOS later.

### Excluded from MVP
1. Staff QR scan workflow.
2. Gate-side release scanning.
3. Audio announcement.
4. Automated refund processing.
5. Full iOS release in first delivery.
6. Advanced bus module.
7. Advanced AI analytics.

---

## 6) User Roles

Implement strong RBAC.

### Platform Roles
- Super Admin
- Platform Operations Admin
- Billing/Admin Operations User
- Support/Admin Analyst (optional)

### School Roles
- School Admin
- Dispatcher / Dismissal Operator
- Front Desk / Teacher / Pickup Coordinator
- Read-only Reporting Role (optional)

### Family Roles
- Primary Guardian
- Additional Guardian

---

## 7) Functional Flow Details

### 7.1 Pickup Request
A primary guardian or active additional guardian can request pickup for linked student(s) only if:
- guardian is active,
- guardian is not blocked,
- student status allows pickup,
- school dismissal timing rules allow it,
- optional location rule passes if enabled.

After request:
- request appears in school live queue,
- request appears in display screen feed,
- request is timestamped,
- guardian sees updated status.

### 7.2 Pickup Confirmation
After physical handoff, guardian taps **Confirm Picked Up**.
System must:
- record acknowledgment,
- close or update queue status,
- keep timeline history,
- retain unresolved state if acknowledgment never happens.

### 7.3 Unresolved / Exception States
Support states such as:
- requested,
- sent out / pending acknowledgment,
- acknowledged complete,
- canceled,
- blocked guardian,
- expired access,
- exception/manual follow-up required.

---

## 8) Additional Guardian Flow

### 8.1 Add Guardian
Primary guardian can add spouse, parent, driver, grandparent, nanny, or other delegate.

Primary guardian enters:
- full name,
- mobile number,
- relationship,
- student(s) to link,
- access validity mode:
  - permanent,
  - temporary,
  - one-time,
  - valid-until-date.

### 8.2 Payment and Entitlement
After payment:
- create guardian invitation record,
- create/add entitlement record,
- generate single-use invitation token,
- optionally create deep link.

### 8.3 Invitation Redemption
Invited guardian:
- installs app,
- selects Accept Invitation,
- enters code or opens link,
- confirms invited phone number,
- receives OTP on invited number,
- verifies OTP,
- receives separate guardian account,
- becomes active for linked child/children.

### 8.4 Rules
- invitation must be single-use,
- invitation must expire,
- OTP must only go to invited number,
- invited guardian account must be separate,
- no school approval required for activation,
- school can later block/deactivate.

---

## 9) Security Model

### 9.1 Device / Session Controls
MVP must support:
- one active device for primary guardian account,
- device/session registry,
- new-device detection,
- transfer-or-buy flow,
- old session revocation,
- device transfer audit logging,
- 30-day cooldown logic,
- suspicious activity visibility.

Future-ready hooks must allow:
- Android Keystore-backed device identity,
- iOS secure storage / stronger device binding,
- cryptographic request signing later.

### 9.2 OTP Abuse Protection
Implement:
- rate limiting,
- resend limits,
- retry limits,
- temporary lockouts,
- audit logs,
- cost-control-conscious verification flow.

### 9.3 School Control
School must be able to:
- block guardian,
- deactivate guardian,
- prevent future pickup requests,
- keep history intact.

### 9.4 Audit Logging
Audit important actions, including:
- login,
- OTP send,
- OTP verify,
- pickup request,
- pickup confirmation,
- invitation create/redeem,
- device transfer,
- guardian block/deactivate,
- school admin actions,
- platform admin actions,
- subscription/plan/lifecycle changes.

---

## 10) Multi-Tenant Architecture

This must be designed as a real SaaS platform from day one.

### 10.1 Tenant Model
- one school = one tenant,
- strong tenant isolation,
- tenant-aware auth,
- tenant-aware roles,
- tenant-aware configuration,
- tenant-aware subscription/entitlement resolution,
- tenant-aware reports,
- tenant-aware live queue,
- tenant-aware display feed,
- tenant-aware audit logs.

### 10.2 Control Plane vs Tenant Plane
Clearly separate:
- platform control-plane concerns,
- tenant operational concerns.

The system must be hybrid-ready for stronger future isolation if required for larger groups.

---

## 11) School Dashboard Modules

Build these in the tenant web application.

### Dashboard Overview
- today’s total requests,
- completed pickups,
- unresolved acknowledgments,
- active students,
- active guardians,
- blocked guardians,
- key operational stats.

### Student Management
- student profile,
- class/section,
- guardian links,
- active/inactive status,
- notes/restrictions,
- dismissal eligibility.

### Guardian Management
- primary guardian,
- additional guardians,
- relation,
- phone,
- active/blocked/revoked state,
- validity details,
- linked students,
- device transfer visibility.

### Live Queue
- ordered request stream,
- guardian name,
- student name,
- class/section,
- request time,
- state,
- unresolved cases,
- filter/search.

### Public Display Screen
- privacy-safe display of queue,
- real-time updates,
- TV/monitor-ready layout,
- limited sensitive data.

### Staff and Roles
- manage school users,
- assign permissions,
- activate/deactivate staff.

### Settings
- dismissal time windows,
- optional location rule toggle,
- feature toggles,
- branding settings,
- notification settings,
- tenant subscription status visibility.

### Reports
- pickup history,
- unresolved acknowledgment report,
- guardian activity report,
- device transfer report,
- access/usage reports.

---

## 12) Parent / Guardian Mobile App Modules

Android first.
Architecture must remain extendable to iOS.

### Features
- OTP login/onboarding,
- child list,
- live status,
- request pickup,
- confirm picked up,
- request history,
- notifications,
- guardian management,
- add guardian,
- invitation status,
- transfer device flow,
- account/device status,
- blocked or expired access handling,
- profile/settings.

### UX Principles
- simple,
- large actions,
- fast interaction,
- low confusion,
- clear state messaging,
- explicit warnings for blocked/expired/device-transfer cases.

---

## 13) Real-Time Architecture Requirements

The system must handle spikes across many schools.

### Requirements
- real-time pickup request propagation,
- school-specific dashboard updates,
- display screen updates,
- parent app status updates,
- duplicate protection,
- idempotency,
- horizontal scalability,
- resilient behavior under dismissal spikes,
- async processing for secondary operations.

### Direction
Recommend and implement a practical scalable architecture using:
- stateless APIs,
- real-time connection layer,
- background workers,
- pub/sub or message-broker-based event fanout,
- retry-safe processing,
- observability and monitoring.

---

## 14) Pricing / Entitlement Architecture

### 14.1 Pricing Structure
Model the platform around:
- school annual subscription in USD,
- student-linked licensing,
- one primary guardian included per licensed child,
- additional paid guardian add-ons,
- optional future add-ons.

### 14.2 Entitlement Design
Implement a proper entitlement model so access is determined by:
- tenant plan,
- tenant lifecycle state,
- entitlement overrides,
- feature flags where appropriate,
- expiry windows,
- school license limits.

Do not hardcode paid vs free access.
Resolve entitlements centrally.

### 14.3 Free / Trial / Charity / Pilot Support
Platform control panel must support:
- trial schools,
- pilot_free schools,
- charity/free-access schools,
- manual override access,
- expiry dates,
- optional usage caps,
- internal notes and audit logs.

---

## 15) Future-Ready Hooks

Do not fully implement unless structurally needed, but keep architecture ready for:
- audio announcement later,
- QR verification later,
- dedicated staff scanning later,
- iOS app later,
- multi-campus later,
- enterprise billing later,
- multilingual support later,
- stronger cryptographic device identity later.

---

## 16) Recommended Technical Stack

Recommend the best serious-but-practical stack.
A likely good direction is:
- Backend: NestJS or equivalent robust Node.js framework
- Database: PostgreSQL
- Cache / sessions / event fanout helper: Redis
- Queue/workers: BullMQ or similar
- Web dashboard/control panel: Next.js + React
- Mobile app: React Native (preferred for faster future iOS path) or Flutter if strongly justified
- Notifications: FCM abstraction
- OTP: provider abstraction
- Billing/entitlements: provider abstraction + manual admin control support

You may choose a different stack if justified clearly.

---

## 17) Required Core Domain Entities

Design strong lifecycle-aware entities for at least:
- tenant / school,
- campus (future-ready),
- user,
- role,
- tenant membership,
- student,
- class,
- section,
- guardian,
- guardian-student link,
- primary guardian entitlement,
- additional guardian license,
- guardian invitation,
- pickup request,
- pickup status history,
- pickup acknowledgment,
- device registration,
- device transfer record,
- otp verification log,
- notification,
- subscription plan,
- plan version,
- tenant subscription,
- entitlement override,
- feature flag,
- audit log,
- support/admin note.

---

## 18) Required API Design Areas

Define clean APIs for:
- authentication,
- OTP send/verify,
- tenant resolution,
- platform admin tenant management,
- school onboarding,
- plan assignment,
- lifecycle state changes,
- student management,
- guardian management,
- guardian invitation,
- guardian entitlement,
- pickup request creation,
- pickup confirmation,
- live queue retrieval,
- display feed,
- guardian block/deactivate,
- device transfer,
- reports,
- audit retrieval,
- support/admin notes.

Use idempotency where repeated taps or retries are possible.

---

## 19) Non-Functional Requirements

Must address:
- tenant isolation,
- security,
- manual operational control,
- auditability,
- rate limiting,
- OTP cost control,
- real-time scalability,
- performance,
- observability,
- retry safety,
- maintainability,
- extensibility.

---

## 20) Product Wording Constraints

Allowed positioning:
- safer dismissal,
- smoother pickup,
- better visibility,
- better coordination,
- clearer accountability.

Avoid claiming full physical handoff identity verification in MVP.
Avoid claiming automated refunds if the system does not do that.

---

## 21) Delivery Method

Work **phase by phase**.

For **every phase**, provide:
1. goal,
2. scope,
3. dependencies,
4. assumptions,
5. architecture decisions,
6. module/folder changes,
7. database changes,
8. API contracts,
9. UI screens/components,
10. validation/security controls,
11. testing plan,
12. rollout notes,
13. acceptance criteria.

Then generate the implementation for that phase.

---

## 22) Phase Plan

### Phase 0 — Solution Blueprint and Architecture
Deliver:
- final stack recommendation,
- monorepo/project structure,
- multitenancy strategy,
- control plane vs tenant plane design,
- auth strategy,
- authorization model,
- domain boundaries,
- real-time architecture,
- queue/worker design,
- audit strategy,
- subscription/entitlement model,
- lifecycle state model,
- future feature extension plan.

### Phase 1 — Platform Core and Multi-Tenant Backend Foundation
Deliver:
- tenant/school model,
- user/role model,
- tenant membership,
- configuration framework,
- auth/session foundation,
- audit framework,
- student/class/section models,
- guardian core models,
- tenant-safe backend APIs.

### Phase 2 — Platform Owner Control Panel / Super Admin Portal
Deliver:
- platform admin login/authorization,
- school/tenant list,
- tenant detail view,
- plan assignment,
- lifecycle state management,
- trial/free/pilot/manual override controls,
- activate/suspend/deactivate/cancel/offboard actions,
- internal notes,
- admin audit visibility,
- usage and limit visibility.

### Phase 3 — School Admin Dashboard Core
Deliver:
- school onboarding flow,
- dashboard shell,
- student management,
- guardian management,
- staff/role management,
- settings,
- report foundation,
- public display foundation.

### Phase 4 — Parent/Guardian Android Core
Deliver:
- OTP login flow,
- onboarding,
- child list,
- request pickup,
- confirm picked up,
- history/status,
- blocked/inactive handling,
- notification groundwork.

### Phase 5 — Real-Time Dismissal Engine
Deliver:
- pickup request lifecycle,
- live queue engine,
- dashboard updates,
- display updates,
- guardian app status sync,
- unresolved acknowledgment workflow,
- duplicate protection,
- concurrency-safe behavior.

### Phase 6 — Additional Guardian Paid Access
Deliver:
- add guardian flow,
- entitlement/license model,
- invitation generation,
- invitation redemption,
- OTP invite verification,
- guardian-child linking,
- lifecycle states,
- school block/deactivate control.

### Phase 7 — Device Transfer and Anti-Sharing Controls
Deliver:
- active device registry,
- one-device rule,
- transfer-or-buy flow,
- old device revocation,
- cooldown enforcement,
- suspicious-transfer visibility,
- audit trail.

### Phase 8 — Reports, Hardening, and Production Readiness
Deliver:
- reporting completion,
- observability,
- OTP abuse controls,
- rate limiting,
- retry safety,
- performance review,
- security hardening,
- production readiness checklist,
- rollout plan.

### Phase 9 — Future Feature Hooks
Deliver extension-safe architecture hooks for:
- audio announcement,
- QR verification,
- iOS readiness,
- multi-campus readiness,
- enterprise billing readiness.

Implement hooks/placeholders only unless structurally required.

---

## 23) First Response Required

In your first response, do **not** generate all code immediately.

Instead provide:
1. refined final architecture,
2. recommended stack with reasons,
3. platform control panel design,
4. school dashboard design,
5. domain model overview,
6. multitenancy approach,
7. entitlement and lifecycle model,
8. auth + OTP + device strategy,
9. real-time architecture approach,
10. main risks and mitigation,
11. exactly what Phase 0 will implement.

Then wait for approval before continuing to implementation.