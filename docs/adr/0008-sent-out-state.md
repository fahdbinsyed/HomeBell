# ADR-0008: Optional one-click "sent out" dispatcher state

- **Status**: Accepted (open decision 4)
- **Date**: 2026-11-22

## Decision

- Dispatchers mark requests **sent out** with one dashboard click (single or bulk). No scanning.
- Enabled by default; tenant setting `sentOutStepEnabled` + feature `dismissal.sent_out_step`.
- Guardians may confirm pickup from `requested` directly (child already handed over before the click);
  the acknowledgment records `viaSentOut = false` so reports show which path happened.
- If the step is disabled, the flow is `requested → acknowledged`, and timeouts run from `requestedAt`.

## Consequences

Endpoints `POST /v1/t/{tenantId}/pickup-requests/{id}/sent-out` and `/pickup-requests/sent-out` (bulk),
both idempotent. UI copy must say "sent out", never "released"/"verified".
