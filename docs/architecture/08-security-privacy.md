# Security and Privacy

## 1. Threat model (top risks)

| Threat                                    | Control                                                                                                                                                                                                                                                                                                |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Cross-tenant data access                  | path-scoped tenant + membership check + EF filters + Postgres RLS + isolation test suite; 404 for foreign IDs                                                                                                                                                                                          |
| Credential sharing between family members | one active device per account, transfer cooldown, paid separate accounts, audit + suspicious flags                                                                                                                                                                                                     |
| SMS pumping / OTP cost abuse              | per-phone/IP/device limits, prefix allowlist, daily budget circuit breaker, CAPTCHA-free design with progressive friction (lockouts)                                                                                                                                                                   |
| OTP brute force                           | 6 digits, 5 attempts, 5 min TTL, lockouts, hashed codes                                                                                                                                                                                                                                                |
| Account enumeration                       | identical `otp/send` responses; invitation lookup rate-limited and returns only masked data                                                                                                                                                                                                            |
| Stolen refresh token                      | rotation + reuse detection, device binding (`X-Device-Id` must match session)                                                                                                                                                                                                                          |
| Display screen data exposure              | separate origin, display-only token, privacy-reduced payload, revocable, no PII beyond first name + last initial                                                                                                                                                                                       |
| Insider/support misuse                    | read-only time-boxed support sessions with reason, banner, full audit                                                                                                                                                                                                                                  |
| Duplicate/replayed writes                 | `Idempotency-Key`, unique partial indexes, optimistic concurrency                                                                                                                                                                                                                                      |
| Web XSS → token theft                     | BFF: tokens never in the browser; strict CSP; `__Host-` cookies                                                                                                                                                                                                                                        |
| Payment fraud                             | server-side verification on both stores (Google Play Developer API; App Store Server API + JWS chain check), account binding (`obfuscatedAccountId` / `appAccountToken`), acknowledge/finish only after verification, store refund notifications (RTDN / App Store Server Notifications V2) void seats |

## 2. API rate limiting (ASP.NET Core RateLimiter, Redis-backed partitions)

| Policy              | Partition           | Limit                       |
| ------------------- | ------------------- | --------------------------- |
| `otp-send`          | phone + IP + device | see 03-identity (OTP table) |
| `auth`              | IP                  | 20 / min                    |
| `invitation-lookup` | IP + device         | 10 / 10 min                 |
| `pairing`           | IP                  | 10 / 10 min                 |
| `guardian-write`    | user                | 30 / min                    |
| `staff-default`     | user                | 300 / min                   |
| `display-feed`      | display             | 60 / min                    |
| `platform`          | user                | 300 / min                   |

Responses: `429 RATE_LIMITED` with `Retry-After`.

## 3. Transport and headers

TLS 1.2+ only, HSTS, CSP (`default-src 'self'`, connect-src API + realtime origins), `X-Content-Type-Options`,
`Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` restrictive. CORS: API accepts only
the BFF server origins (web) and no browser origins for guardian endpoints (mobile is not a browser).

## 4. Secrets

No secrets in the repo. Local dev: `dotnet user-secrets` and `.env.local` (git-ignored). Deployed:
managed secret store. Signing keys rotated; JWKS supports multiple active keys.

## 5. Privacy (provisional — ADR-0012 awaits target-market decision)

- **Roles**: the school is the **data controller**; HomeBell/neuXplus is the **processor** (DPA per tenant).
- **Children are not users.** No child accounts, no child phone numbers, no child photos in MVP.
- **Data minimisation**: student = first/last name, class/section, external ref, status, notes/restrictions
  (restricted visibility). Guardian = name, phone, relationship.
- **Display** shows first name + last initial (configurable to initials only) + class label.
- **Consent/terms** acceptance recorded on guardian activation (`termsVersion`, `acceptedAt`).
- **Residency**: `Tenant.region` pins hosting region; data placement per region from day one.
- **Default retention (configurable per tenant within platform bounds)**:

| Data                       | Retention                                                         |
| -------------------------- | ----------------------------------------------------------------- |
| Pickup requests + history  | current term + 1 year                                             |
| Audit logs                 | 3 years                                                           |
| OTP logs                   | 90 days                                                           |
| Revoked sessions / devices | 90 days after revocation                                          |
| Notifications              | 90 days                                                           |
| Import files               | 30 days                                                           |
| Offboarded tenant data     | purged 90 days after `start_offboarding` (export available first) |

- **Subject requests**: school admin can export/delete a guardian's personal data (pickup history is
  pseudonymised, not deleted, where required for accountability).
- **Logs**: no OTP codes, tokens, or full phone numbers in logs; phones masked to country code + last 4 digits (`+CC•••••4567`).
