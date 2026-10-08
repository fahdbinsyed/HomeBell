# Phase 1 migration review

These migrations are ordered and run explicitly using `scripts/migrate.mjs`. The API never creates schema or runs migrations at startup. Runtime database roles must exist before applying migration 0; setup scripts create them with random credentials and no superuser/RLS-bypass privileges.

| Migration     | Forward change                                                                           | Compatibility and locking                                                                                                                                |
| ------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1780000000000 | Schemas, tenant catalog, identity/session/device primitives, permissions, RLS and grants | Initial empty database; creates objects. No existing business rows to backfill.                                                                          |
| 1780000000001 | Class/section/student/guardian/link tables, composite constraints and tenant policies    | Additive; no table rewrite of existing business data.                                                                                                    |
| 1780000000002 | Audit, idempotency and outbox                                                            | Additive. Mutation evidence is committed with domain changes.                                                                                            |
| 1780000000003 | Explicit database-operator audit identity                                                | Brief lock on control audit table to add columns/check and permit null user ID only for a named operator; existing user audit rows retain their meaning. |

Local development and test databases have received all four migrations. The initial migration sources received formatting-only normalization during initial local setup; no applied SQL behavior was revised. Treat these files as frozen from this handoff. Future changes require new migration files.

No down migration drops data automatically. Review forward repair or backup restoration before recovery. On larger/production databases, separately measure locking and validation time, apply lock/statement timeouts, test old/new application compatibility and define backup recovery before deployment. No production migration has been attempted.

RLS uses both `USING` and `WITH CHECK`, forced on tenant-owned tables. The runtime is not the owner. Migration administrators may bypass RLS only for controlled setup/migrations; runtime tests deliberately use the restricted roles. Audit tables grant insert/select only; ordinary runtime roles cannot rewrite evidence.
