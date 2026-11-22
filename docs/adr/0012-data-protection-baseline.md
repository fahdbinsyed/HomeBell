# ADR-0012: Target market, data protection, retention

- **Status**: **Proposed — awaiting the product owner's target country / hosting region**
- **Date**: 2026-11-22

## Context

Student and guardian data is regulated differently per country (e.g. FERPA/COPPA and state student-privacy
laws in the US, GDPR/UK GDPR in Europe, PDPL in Saudi Arabia/UAE, local data-protection laws elsewhere).
The launch market has not been decided yet.

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

1. Launch country/countries. 2. Hosting region/cloud. 3. Whether parental consent must be collected by
   HomeBell or is covered by the school's enrolment consent. 4. Any mandated retention periods.
