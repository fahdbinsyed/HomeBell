# ADR-0004: Contract-first workflow and code generation

- **Status**: Accepted
- **Date**: 2026-11-22

## Context

The frontend is built first against mocks (Phase 1) and the backend later (Phase 2+). Without a binding
contract, the two will drift.

## Decision

- `packages/contracts/openapi/openapi.yaml` (OpenAPI 3.1, multi-file) and
  `packages/contracts/realtime/realtime.asyncapi.yaml` (AsyncAPI 3.0) are the single source of truth.
- Conventions: base path `/v1`; tenant plane `/v1/t/{tenantId}`; guardian self `/v1/me`; platform
  `/v1/platform`; display `/v1/display`. JSON camelCase; UUID IDs; RFC 3339 UTC timestamps; cursor
  pagination (`cursor`, `limit` ≤ 100 → `{items, nextCursor}`); errors are RFC 9457
  `application/problem+json` with a machine-readable `code` from the `ErrorCode` enum;
  `Idempotency-Key` on retry-prone writes; optional `If-Match` (ETag) on PATCH/PUT for concurrency.
- Generated artefacts are committed (`bundled/openapi.v1.yaml`, `src/generated/openapi.ts`); CI
  regenerates and fails on diff.
- Versioning: additive changes (new optional fields, endpoints, enum values documented as
  "clients must tolerate unknown values") stay in v1 with a minor `info.version` bump. Breaking changes
  require an ADR and a `/v2` path for the affected resources.
- Clients must treat unknown enum values gracefully (fallback rendering).

## Consequences

Neither side changes an API shape unilaterally. Backend contract tests (Phase 3) validate real responses
against the bundled spec.
