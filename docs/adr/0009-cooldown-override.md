# ADR-0009: Transfer cooldown override for lost devices

- **Status**: Accepted (open decision 5)
- **Date**: 2026-11-22

## Decision

- **School admin** may override for guardians of their tenant, **max 2 per guardian per term**
  (`COOLDOWN_OVERRIDE_LIMIT_REACHED` beyond that). **Platform support** may override without that limit.
- Override requires `reasonCode` (`lost_device`, `stolen_device`, `device_replaced`, `other`) and a note.
- It creates a single-use `CooldownOverride` valid 24 h. The guardian must still pass OTP on the new device
  (the normal login OTP); the override only lifts the cooldown check.
- Audited as `device.cooldown_overridden` (actor, reason, note); the resulting `DeviceTransfer` is flagged
  `suspicious = true` and appears in school and platform suspicious-activity views. The cooldown restarts
  from the new transfer.

## Consequences

Endpoints: `POST /v1/t/{tenantId}/guardians/{guardianId}/cooldown-overrides` and
`POST /v1/platform/accounts/{userId}/cooldown-overrides`.
