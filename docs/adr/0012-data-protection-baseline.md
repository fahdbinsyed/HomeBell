# ADR-0012: Target market, data protection, retention

- **Status**: **Proposed — launch market decided (Saudi Arabia, 2026-11-25); cloud provider, consent and retention still open**
- **Date**: 2026-11-22

## Context

Student and guardian data is regulated differently per country (e.g. FERPA/COPPA and state student-privacy
laws in the US, GDPR/UK GDPR in Europe, PDPL in Saudi Arabia/UAE, local data-protection laws elsewhere).
Decided 2026-11-25: launch in **Saudi Arabia**, hosted **in the Kingdom** (region key `sa-central`). The
Saudi PDPL (SDAIA) therefore applies, and its rules on transferring personal data outside the Kingdom
apply too. New schools default to country `SA`, region `sa-central`, timezone `Asia/Riyadh`.

## Proposed baseline (applies until this ADR is accepted)

- School = data controller, HomeBell/neuXplus = processor; DPA per tenant.
- No child accounts; children never use the app; minimal student fields.
- `Tenant.region` + `countryCode` captured at tenant creation; hosting region pinned per tenant placement.
- Default retention: pickups term + 1 year; audit 3 years; OTP logs 90 days; revoked sessions/devices
  90 days; notifications 90 days; import files 30 days; offboarded tenants purged 90 days after
  offboarding starts.
- Guardian terms/privacy acceptance recorded at activation (`termsVersion`).
- Data-subject export/delete tooling for school admins.

## Contract impact

None blocking: region, country, retention values and consent fields are already in the contract; legal
specifics change configuration, not shapes.

## To decide

1. ~~Launch country~~ Saudi Arabia (decided). 2. ~~Hosting region~~ in-Kingdom (decided); cloud provider
   and data-centre region still to pick. 3. Whether parental consent must be collected by
   HomeBell or is covered by the school's enrolment consent. 4. Any mandated retention periods.
