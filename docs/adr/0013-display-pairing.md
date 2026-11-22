# ADR-0013: Display screen pairing and display tokens

- **Status**: Accepted (open decision 9)
- **Date**: 2026-11-22

## Decision

1. Display app calls `POST /v1/display/pairing-sessions` → shows an 8-character code (Crockford base32)
   and a QR containing it; valid 10 minutes.
2. School admin enters the code in the dashboard (`POST /v1/t/{tenantId}/displays/pair`) with a name and
   optional zone.
3. The display polls `GET /v1/display/pairing-sessions/{id}` (with its `pollSecret`) and receives a
   **display token once**: opaque, scope `display:read`, bound to tenant (+zone), stored hashed server-side.
4. Token rotates every 30 days via `POST /v1/display/heartbeat` (response may carry `rotatedToken`).
   Revocation from the dashboard disconnects the display (`display.revoked`).
5. Display payloads are privacy-reduced server-side (first name + last initial or initials, class label,
   status, time). Limit `displays.max` per plan.

## Consequences

Display app runs on its own origin; tokens never grant access to any other endpoint.
