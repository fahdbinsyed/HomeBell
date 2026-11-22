# Domain Model

`(T)` = tenant-owned (`tenant_id`, RLS). `(G)` = global. `(C)` = control plane.

## Platform (C)

- **Tenant** — id, slug, name, legalName, region, timezone, countryCode, state (`TenantLifecycleState`),
  previousOperationalState, expiresAt, dataPlacement, placementKey, termStart/termEnd, createdAt.
- **TenantLifecycleHistory** — tenantId, action, fromState, toState, reasonCode, note, actorId, at.
- **SubscriptionPlan** — id, code, name, description, isPublic.
- **PlanVersion** — id, planId, version, status (draft|published|retired), priceMinor, currency=USD,
  billingPeriod=annual, features{}, limits{}.
- **TenantSubscription** — id, tenantId, planVersionId, startsAt, endsAt, billingReference (free text —
  invoice/PO; no payment integration), status.
- **EntitlementOverride** — id, tenantId, key, kind (feature|limit), value, reasonCode, note, expiresAt,
  createdBy, revokedAt, revokedBy.
- **FeatureFlag** — key, enabledByDefault, tenantAllowList[], tenantDenyList[].
- **SupportNote** — id, tenantId, category, body, refundStatus?, pinned, authorId, createdAt (append-only).
- **SupportSession** — id, platformUserId, tenantId, reason, startedAt, expiresAt, endedAt.

## Identity (G)

- **UserAccount** — id, kind flags (staff/guardian/platform), email?, phone?, fullName, locale, status,
  termsVersion, termsAcceptedAt.
- **PlatformRoleAssignment** — userId, role.
- **Credential / MfaFactor** — staff/platform only.
- **Session** — id, userId, kind, deviceRegistrationId?, scopes, createdAt, lastSeenAt, expiresAt,
  revokedAt, revokeReason.
- **DeviceRegistration** — id, userId, installId, platform, model, osVersion, appVersion, state,
  activatedAt, lastSeenAt, publicKey? (future), attestationStatus? (future).
- **DeviceTransfer** — id, userId, fromDeviceId, toDeviceId, at, viaOverrideId?, suspicious.
- **CooldownOverride** — id, userId, grantedBy, grantedByKind (school|platform), tenantId?, reasonCode,
  note, expiresAt, usedAt.
- **OtpChallenge / OtpLog** — phoneHash, purpose, codeHash, attempts, expiresAt, status, ip, deviceId.

## Schools (T)

- **TenantMembership** — userId, tenantId, role, status, invitedBy.
- **StaffInvitation** — email, role, tokenHash, expiresAt, status.
- **Class** — name, gradeLevel, sortOrder. **Section** — classId, name.
- **Student** — externalRef, firstName, lastName, preferredName?, classId, sectionId, status
  (active|inactive), dismissalEligibility (eligible|hold|not_eligible), restrictionsNote (restricted),
  notes, campusId? (future).
- **TenantSettings** — dismissal windows, timeouts, location rule, sent-out step, display privacy,
  branding, notifications, staffMfaRequired.
- **DisplayDevice** — name, zone?, state, tokenHash, lastHeartbeatAt, pairedBy.
- **ImportJob** — type, status, fileRef, rowCounts, errors.

## Guardians (T)

- **Guardian** — userId (global), tenantId, kind (primary|additional), fullName, phone, state,
  invitedByGuardianId?, licenseSeatId?, validityMode, validFrom, validUntil, durationDays, blockedReason.
- **GuardianStudentLink** — guardianId, studentId, relationship, isPrimary, createdAt, removedAt.
- **PrimaryGuardianEntitlement** — studentId, guardianId, source (school_license) — 1 per licensed child.
- **LicenseSeat** — ownerGuardianId (primary), source (purchase|school_grant|platform_grant), state,
  termEndsAt, reassignmentsUsed, purchaseRecordId?.
- **GuardianInvitation** — seatId, createdByGuardianId, fullName, phone, relationship, studentIds,
  validity, codeHash, expiresAt, state, redeemedByUserId.

## Dismissal (T)

- **PickupRequest** — id, queueDate, studentId, guardianId, state, requestedAt, sentOutAt, sentOutBy,
  acknowledgedAt, cancelledAt, exceptionAt, resolvedAt, resolution, stale, note, location?,
  idempotencyKey.
- **PickupStatusHistory** — requestId, fromState, toState, actorType, actorId, at, reason.
- **PickupAcknowledgment** — requestId, guardianId, deviceId, at, viaSentOut.
- **QueueEvent** — tenantId, queueDate, seq, type, payload, at.

## Billing (T)

- **PurchaseIntent** — guardianId, provider (`google_play`|`apple_app_store`), productId,
  obfuscatedAccountId (Play), appAccountToken (Apple), status, expiresAt.
- **PurchaseRecord** — provider, orderId, purchaseTokenHash, state (verified|acknowledged|voided),
  verifiedAt, rawProviderStatus.

## Notifications (T)

- **Notification** — userId, type, title, body, data, readAt. **PushToken** — userId, deviceId, provider,
  token.

## Audit (C/T)

- **AuditLog** — see 07-audit-outbox-workers.

## Future-ready (modelled, unused in MVP)

- **Campus** (T) — name, timezone, geofence. **AnnouncementTemplate** (audio). **VerificationMethod** (QR).
