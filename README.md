# HomeBell

HomeBell is a production-grade multi-tenant SaaS platform for school pickup and dismissal management.

## Product Overview

HomeBell helps schools and families manage student pickup through:

- Parent/guardian pickup requests
- Real-time school dismissal queues
- Guardian access management
- Pickup confirmation
- School administration and reporting
- Platform-level tenant and subscription management

## Current Status

The project is currently in:

**Phase 2 — Platform Owner Control Panel implemented and verified locally**

The owner portal supports school onboarding, access grants and lifecycle actions, annual USD plans, aggregate usage, overrides, internal notes and scoped audit. All 54 tests pass: 10 unit, 39 database/API integration and 5 signed-OIDC browser tests. API and portal builds, type checks, lint and formatting pass. Real identity-provider configuration remains required for live sign-in. This is a local implementation, not a production deployment.

- [Phase 2 completion report](docs/PHASE_2_REPORT.md)
- [Local setup, HTTPS and identity-provider configuration](docs/LOCAL_SETUP.md)
- [Approved Phase 2 scope](docs/PHASE_2_PROPOSAL.md)
- [Phase 1 foundation report](docs/PHASE_1_REPORT.md)

From PowerShell in the project directory:

```powershell
./scripts/start-services.ps1
./scripts/dev.ps1 db:migrate
./scripts/dev.ps1 build
./scripts/dev.ps1 start
# In another terminal:
./scripts/start-portal.ps1
```

Owner portal: [https://localhost:3100](https://localhost:3100). API readiness: [http://127.0.0.1:3000/health/ready](http://127.0.0.1:3000/health/ready). The local portal certificate is self-signed; no trust root was installed. Phase 3 has not started.

## Repository Documentation

Important project documentation is located in:

- `CLAUDE.md` — Engineering rules and Claude Code operating instructions
- `docs/PRODUCT_REQUIREMENTS.md` — Founder-approved product requirements and business rules

Phase 0 blueprint:

- [Architecture and application boundaries](docs/ARCHITECTURE.md)
- [Domain model and pickup lifecycle](docs/DOMAIN_MODEL.md)
- [Database constraints, transactions, and migrations](docs/DATABASE.md)
- [API standards and proposed contracts](docs/API_STANDARDS.md)
- [Multitenancy and isolation](docs/MULTITENANCY.md)
- [Authentication, RBAC, OTP, and devices](docs/AUTH_AND_RBAC.md)
- [Entitlements and tenant lifecycle](docs/ENTITLEMENTS.md)
- [Realtime recovery and background work](docs/REALTIME.md)
- [Security](docs/SECURITY.md)
- [Observability and audit](docs/OBSERVABILITY.md)
- [Testing and quality gates](docs/TESTING.md)
- [Phase plan, approval gates, and open decisions](docs/PHASE_PLAN.md)

## Planned Technology Direction

Approved architecture direction:

- Mobile: React Native + TypeScript
- Backend: NestJS + TypeScript
- Web: Next.js + React + TypeScript
- Database: PostgreSQL
- Cache / coordination: Redis
- Background jobs: BullMQ
- Notifications: Firebase Cloud Messaging

Exact package versions, data-access tooling, and external providers remain subject to the decision gates in the phase plan.

## Development Rules

Development must follow the requirements and engineering rules defined in `CLAUDE.md`.

The project must be developed phase by phase.

Claude Code must not automatically move to the next phase without explicit approval.

## Product

**HomeBell**

Optional endorsement:

**Powered by neuXplus**

