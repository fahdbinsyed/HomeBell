# ADR-0010: One active device for additional guardians

- **Status**: Accepted (open decision 6)
- **Date**: 2026-11-22

## Decision

Additional guardians have the same one-active-device rule, transfer flow and 30-day cooldown as primary
guardians. On device conflict they are offered **transfer only** (`purchase.available = false`) because
buying a seat is a primary-guardian action. Because the rule is per `UserAccount` (ADR-0006), a person who
is primary for one child and additional for another still has one active device.

## Consequences

Consistent anti-sharing behaviour; each delegate needs their own paid seat and phone.
