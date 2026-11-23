# Architecture Decision Records

Format: [0000-template.md](0000-template.md). Status values: `Proposed`, `Accepted`, `Superseded by ADR-NNNN`.
A contract change that is not purely additive **must** have an ADR.

| ADR                                                | Title                                                                        | Status                                |
| -------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------- |
| [0001](0001-approved-stack.md)                     | Approved technology stack                                                    | Accepted                              |
| [0002](0002-modular-monolith-and-outbox.md)        | Modular monolith, transactional outbox, RabbitMQ deferred                    | Accepted                              |
| [0003](0003-multitenancy-shared-schema-rls.md)     | Shared-schema multitenancy with PostgreSQL RLS                               | Accepted                              |
| [0004](0004-contract-first-workflow.md)            | Contract-first workflow and code generation                                  | Accepted                              |
| [0005](0005-additional-guardian-payment.md)        | Additional guardian payment: Google Play Billing + Apple IAP + granted seats | Accepted                              |
| [0006](0006-global-guardian-identity.md)           | One global guardian account, per-tenant guardian profiles                    | Accepted                              |
| [0007](0007-primary-guardian-provisioning.md)      | Primary guardian provisioning by school import + OTP activation              | Accepted                              |
| [0008](0008-sent-out-state.md)                     | Optional one-click "sent out" dispatcher state                               | Accepted                              |
| [0009](0009-cooldown-override.md)                  | Transfer cooldown override for lost devices                                  | Accepted                              |
| [0010](0010-additional-guardian-device-rule.md)    | One active device for additional guardians                                   | Accepted                              |
| [0011](0011-license-seats-and-validity-modes.md)   | License seats and validity modes                                             | Accepted                              |
| [0012](0012-data-protection-baseline.md)           | Target market, data protection, retention                                    | **Proposed — awaiting target market** |
| [0013](0013-display-pairing.md)                    | Display screen pairing and display tokens                                    | Accepted                              |
| [0014](0014-unresolved-acknowledgment-timeouts.md) | Unresolved acknowledgment timeouts and escalation                            | Accepted                              |
| [0015](0015-toolchain-versions.md)                 | Toolchain versions (Node, pnpm, .NET, TypeScript)                            | Accepted                              |
| [0016](0016-web-bff-authentication.md)             | Backend-for-frontend authentication for web apps                             | Accepted                              |
| [0017](0017-mobile-platform-strategy.md)           | Mobile platform strategy — Android and iOS in the MVP                        | Accepted                              |
| [0018](0018-mock-transport.md)                     | Mock transport — MSW handlers behind an injected fetch                       | Accepted                              |
