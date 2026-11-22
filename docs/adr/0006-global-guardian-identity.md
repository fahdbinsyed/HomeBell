# ADR-0006: One global guardian account, per-tenant guardian profiles

- **Status**: Accepted (open decision 2)
- **Date**: 2026-11-22

## Context

Families often have children at different schools. Tenants must not see each other's data.

## Options

1. One account per tenant — simple isolation, but multiple logins/apps per family and duplicated OTP cost.
2. **One global `UserAccount` (phone) linked to per-tenant `Guardian` profiles.**

## Decision

Option 2. Identity (phone, sessions, devices) is global; everything school-specific (guardian state,
links, seats, invitations, pickups) lives on the per-tenant `Guardian` profile under tenant RLS. School A
can block its guardian profile without affecting School B. The one-device rule applies per `UserAccount`.

## Consequences

- `/v1/me/children` aggregates across tenants; every item carries `tenantId` + `tenantName`.
- Phone-number change is per account but initiated by a school admin for that tenant's profile; if the
  account is linked to several tenants, the change applies only after OTP on the new number and is
  audited in every affected tenant.
- A staff member who is also a parent uses separate auth kinds (email/password for staff web; phone/OTP
  for guardian app) on the same `UserAccount`.
