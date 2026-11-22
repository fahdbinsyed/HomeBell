# Identity, Auth, OTP and Devices

## 1. Identities

| Kind                            | Identifier    | Credential                              | MFA                                                        |
| ------------------------------- | ------------- | --------------------------------------- | ---------------------------------------------------------- |
| Platform user                   | email         | password (ASP.NET Core Identity hasher) | **TOTP mandatory**                                         |
| School staff                    | email         | password                                | TOTP optional, enforceable per tenant (`staffMfaRequired`) |
| Guardian (primary / additional) | phone (E.164) | OTP to phone                            | device binding acts as 2nd factor                          |
| Display                         | —             | display token from pairing              | n/a                                                        |

One `UserAccount` per person. A person may be staff in one tenant and a guardian in another.

## 2. Tokens and sessions

- **Access token**: JWT, 10 min, signed (ES256, key rotation via JWKS-style key IDs). Claims: `sub`,
  `sid` (session id), `kind` (`staff`|`guardian`|`platform`|`display`|`support`), `scp` (scopes),
  `did` (device id, guardians), `prm` (platform roles). Tenant memberships are **not** trusted from the
  token alone; they are verified server-side (cached 60 s).
- **Refresh token**: opaque 256-bit random, stored **hashed** (SHA-256) on `Session`, **rotated on every
  use**. Reuse of an already-rotated refresh token → whole session revoked (`REFRESH_TOKEN_REUSED`).
  Lifetimes: staff 12 h sliding / 7 d absolute; platform 8 h absolute; guardian 60 d sliding.
- **Revocation**: setting `Session.revokedAt` + publishing `sid` to a Redis denylist (TTL = access-token
  lifetime) so revocation takes effect within seconds on every API instance and on SignalR connect.
  Revocation pushes `session.revoked` to the device over SignalR and FCM.
- **Web (school, platform)**: Next.js BFF. Tokens live only in the Next.js server session, sent to the
  browser as `__Host-` httpOnly, Secure, SameSite=Lax cookies. Browser never sees JWTs. CSRF: SameSite +
  double-submit token on mutating BFF routes.
- **Mobile**: tokens in `expo-secure-store` (Android Keystore / iOS Keychain). Never AsyncStorage.
- **Display**: long-lived opaque display token (scope `display:read`), rotated every 30 days via the
  heartbeat response, revocable from the dashboard.

## 3. OTP

Used for: first activation (login when no session), invitation redemption, suspicious login, device
transfer, critical recovery. **Not** on every app open.

| Control             | Value (configurable)                                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Code                | 6 digits, CSPRNG, stored as HMAC-SHA256 hash, TTL 5 min                                                                                                |
| Resend spacing      | 60 s                                                                                                                                                   |
| Sends per phone     | 3 / 15 min, 5 / 24 h                                                                                                                                   |
| Verify attempts     | 5 per challenge → challenge dead                                                                                                                       |
| Lockout             | 3 dead challenges in 24 h → phone locked 30 min (`OTP_LOCKED`, `meta.lockedUntil`)                                                                     |
| Per IP / per device | 10 sends / h per IP, 5 sends / h per device install                                                                                                    |
| Country allowlist   | Only prefixes enabled for the tenant regions (`PHONE_NOT_SUPPORTED`)                                                                                   |
| Budget breaker      | Global + per-tenant daily SMS budget. When exhausted → `OTP_TEMPORARILY_UNAVAILABLE` (generic, no budget details), alert ops                           |
| Enumeration         | `otp/send` responds identically whether or not the phone is known; "no account" is revealed only after successful verification (`outcome: no_account`) |

All sends/verifies write `OtpLog` + audit events (`otp.sent`, `otp.verified`, `otp.failed`, `otp.locked`).
Provider abstraction: `IOtpSender` (SMS now; WhatsApp/voice later), `IOtpCodeStore`.

## 4. Device rule

- Each guardian account (primary **and** additional — ADR-0010) has at most **one active device**.
- Device identity (MVP, **Android and iOS**): app-generated install ID (UUID) stored in secure storage
  (Android Keystore-backed / iOS Keychain with `WHEN_UNLOCKED_THIS_DEVICE_ONLY`), sent as `X-Device-Id`,
  plus `platform` (`android`|`ios`)/model metadata. Platform difference: the Android ID is cleared on
  uninstall, while the iOS Keychain item may survive reinstall on the same phone; it never syncs or migrates
  to another phone. Either way a new phone = new device = transfer flow. Future: Keystore / Secure Enclave
  key pair with Play Integrity / App Attest; requests signed (hook: `DeviceRegistration.publicKey`,
  `attestationStatus`).
- The OTP, session, device-registration and device-transfer flows are identical on both platforms (same
  API, same screens); only the secure-storage and push adapters differ (ADR-0017).
- **Honest limitation**: on rooted/jailbroken devices an install ID can be copied. The rule is a strong
  deterrent with full audit visibility, not a cryptographic guarantee, until attestation lands.

### New-device flow

```
OTP verify (purpose=login) on device B while device A is active
  → outcome: device_conflict { conflictToken (5 min, single use), activeDevice, transfer{allowed,
     cooldownEndsAt}, purchase{available} }
  ├─ Transfer → POST /v1/auth/device-transfer {conflictToken}
  │     allowed only if no transfer in last 30 days (or valid CooldownOverride)
  │     → revoke all sessions of device A, device B active, DeviceTransfer row, audit
  │       `device.transferred`, push `session.revoked` to A, notify guardian
  └─ Buy additional license → POST /v1/auth/device-conflict/limited-session {conflictToken}
        → limited session (scope guardian.license_purchase, 30 min, device B) that can only buy a seat
          and create an invitation for a *different* phone number. The new person then redeems the
          invitation on device B under their own account.
```

### Cooldown override (ADR-0009)

School admin (≤ 2 per guardian per term) or platform support (unlimited) creates a `CooldownOverride`
(reason code + note, valid 24 h, single use). The guardian still completes OTP on the new device. Audited
as `device.cooldown_overridden`; the resulting transfer is flagged `suspicious=true` for visibility.

## 5. Authorization model

Permissions are fine-grained strings; roles are bundles. Policies combine **role → permission**,
**tenant scope**, **entitlement** (feature gate) and **tenant lifecycle gate**.

| Role                       | Key permissions                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------ |
| `platform.super_admin`     | `platform.*`                                                                               |
| `platform.ops_admin`       | `platform.tenants.*`, `platform.lifecycle.*`, `platform.notes.*`, `platform.audit.read`    |
| `platform.billing_ops`     | `platform.plans.*`, `platform.subscriptions.*`, `platform.overrides.*`, `platform.notes.*` |
| `platform.support_analyst` | `platform.tenants.read`, `platform.audit.read`, `platform.support_sessions.create`         |
| `school.admin`             | `school.*` within tenant                                                                   |
| `school.dispatcher`        | `queue.read`, `queue.dispatch`, `students.read`, `guardians.read`                          |
| `school.front_desk`        | `queue.read`, `queue.dispatch`, `students.read`                                            |
| `school.reporting`         | `reports.read`, `audit.read`                                                               |
| `guardian.primary`         | own children, pickup, guardians.manage, licenses.purchase                                  |
| `guardian.additional`      | own linked children, pickup                                                                |

The permission catalog is published in the contract (`Permission` enum) so UIs can hide actions, but the
server is the only enforcement point.
