import type {
  CompletePurchaseRequest,
  CreateGuardianInvitationRequest,
  CreatePickupRequest,
  CreatePickupResult,
  CreatePurchaseIntentRequest,
  ErrorCode,
  GuardianCancelRequest,
  GuardianProfileUpdate,
  InvitationLookupRequest,
  InvitationOtpRequest,
  InvitationRedeemRequest,
  MarkNotificationsReadRequest,
  OtpVerifyResult,
  PushTokenRegistration,
  TermsAcceptanceRequest,
  UpdateAdditionalGuardianRequest,
} from '@homebell/contracts';
import { http } from 'msw';
import type { GuardianRecord, InvitationRecord, PickupRecord } from '../db/types';
import { acknowledge, createPickup, returnSeat, transition } from '../dismissal';
import {
  additionalGuardian,
  childSummaries,
  deviceSummary,
  guardianPickup,
  guardianTenantContexts,
  maskPhone,
  meDto,
  nextTransferAllowedAt,
  notificationDto,
  seatDto,
  transferDto,
  CURRENT_TERMS,
} from '../mappers';
import {
  distanceMeters,
  guardianRejection,
  OPEN_STATES,
  studentRejection,
} from '../rules/eligibility';
import { hasFeature, limitOf } from '../rules/entitlements';
import { computeValidity } from '../rules/validity';
import { checkOtp, completeGuardianSignIn, sendOtp } from './auth';
import {
  actorOf,
  body,
  fail,
  handle,
  idempotent,
  inRange,
  invalid,
  json,
  noContent,
  page,
  q,
  requireGuardian,
  type MockContext,
} from './context';

export function guardianHandlers(ctx: MockContext) {
  const db = ctx.db;
  const M = '*/v1/me';

  const profiles = (userId: string) => db.state.guardians.filter((g) => g.userId === userId);
  const primaryIn = (userId: string, tenantId: string): GuardianRecord => {
    const g = profiles(userId).find((x) => x.tenantId === tenantId && x.kind === 'primary');
    if (!g) return fail('FORBIDDEN', 'Only the primary guardian can manage additional guardians');
    if (g.state !== 'active')
      return fail(g.state === 'blocked' ? 'GUARDIAN_BLOCKED' : 'GUARDIAN_DEACTIVATED');
    return g;
  };
  const myPickup = (userId: string, id: string): PickupRecord => {
    const p = db.state.pickups.find((x) => x.id === id);
    const linked =
      p &&
      db.state.links.some(
        (l) =>
          l.studentId === p.studentId &&
          !l.removedAt &&
          profiles(userId).some((g) => g.id === l.guardianId),
      );
    return p && linked ? p : fail('NOT_FOUND');
  };
  const managed = (userId: string, guardianId: string): GuardianRecord => {
    const g = db.state.guardians.find((x) => x.id === guardianId && x.kind === 'additional');
    const owner = g && db.state.guardians.find((x) => x.id === g.invitedByGuardianId);
    return g && owner?.userId === userId ? g : fail('NOT_FOUND');
  };
  const invitationCreatedDto = (g: GuardianRecord, inv: InvitationRecord) => ({
    guardian: additionalGuardian(db, g),
    code: inv.code,
    deepLink: `https://homebell.app/invite/${inv.code}`,
    expiresAt: inv.expiresAt,
  });

  return [
    http.get(
      `${M}/profile`,
      handle(({ request }) => json(meDto(db, requireGuardian(ctx, request, true)))),
    ),
    http.patch(
      `${M}/profile`,
      handle(async ({ request }) => {
        const s = requireGuardian(ctx, request);
        const b = await body<GuardianProfileUpdate>(request);
        const u = db.user(s.userId)!;
        if (b.fullName !== undefined) {
          if (!b.fullName.trim()) return invalid('fullName', 'Name cannot be empty');
          u.fullName = b.fullName.trim();
        }
        if (b.locale) u.locale = b.locale;
        db.touch();
        return json(meDto(db, s));
      }),
    ),
    http.post(
      `${M}/terms-acceptance`,
      handle(async ({ request }) => {
        const s = requireGuardian(ctx, request, true);
        const b = await body<TermsAcceptanceRequest>(request);
        if (b.termsVersion !== CURRENT_TERMS)
          return invalid('termsVersion', 'Please review the latest terms');
        db.user(s.userId)!.termsVersion = b.termsVersion;
        db.touch();
        return noContent();
      }),
    ),
    http.get(
      `${M}/children`,
      handle(({ request }) => {
        const s = requireGuardian(ctx, request);
        return json({
          items: childSummaries(db, s.userId),
          tenants: guardianTenantContexts(db, s.userId),
        });
      }),
    ),
    http.get(
      `${M}/pickup-requests`,
      handle(({ request }) => {
        const s = requireGuardian(ctx, request);
        const url = new URL(request.url);
        const studentIds = new Set(
          db.state.links
            .filter((l) => profiles(s.userId).some((g) => g.id === l.guardianId))
            .map((l) => l.studentId),
        );
        const rows = db.state.pickups
          .filter(
            (p) =>
              studentIds.has(p.studentId) &&
              (!q(url, 'tenantId') || p.tenantId === q(url, 'tenantId')) &&
              (!q(url, 'studentId') || p.studentId === q(url, 'studentId')) &&
              inRange(`${p.queueDate}T00:00:00Z`, q(url, 'from'), q(url, 'to')),
          )
          .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))
          .map((p) => guardianPickup(db, p, s.userId));
        return json(page(rows, url));
      }),
    ),
    http.post(
      `${M}/pickup-requests`,
      handle(({ request }) => {
        const s = requireGuardian(ctx, request);
        return idempotent(ctx, request, `u:${s.userId}`, (raw) => {
          const b = JSON.parse(raw) as CreatePickupRequest;
          const g = profiles(s.userId).find((x) => x.tenantId === b.tenantId) ?? fail('NOT_FOUND');
          const guardianCode = guardianRejection(db, g);
          if (guardianCode) return fail(guardianCode);
          const t = db.tenant(b.tenantId)!;
          const rule = t.settings.locationRule;
          if (rule.enabled && hasFeature(db, t.id, 'dismissal.location_rule')) {
            if (!b.location) return fail('LOCATION_REQUIRED');
            if (b.location.accuracyMeters > rule.maxAccuracyMeters)
              return fail(
                'LOCATION_REQUIRED',
                'Location is not accurate enough — move outdoors and retry',
              );
            if (rule.center) {
              const d = distanceMeters(b.location, rule.center);
              if (d > rule.radiusMeters)
                return fail('OUTSIDE_PICKUP_ZONE', undefined, { distanceMeters: Math.round(d) });
            }
          }
          const result: CreatePickupResult = { created: [], rejected: [] };
          const u = db.user(s.userId)!;
          for (const studentId of [...new Set(b.studentIds)]) {
            const st = db.state.students.find(
              (x) => x.id === studentId && x.tenantId === b.tenantId,
            );
            const linked =
              st &&
              db.state.links.some(
                (l) => l.guardianId === g.id && l.studentId === studentId && !l.removedAt,
              );
            if (!st || !linked) {
              result.rejected.push({
                studentId,
                code: 'GUARDIAN_NOT_LINKED',
                existingRequestId: null,
              });
              continue;
            }
            const open = db.state.pickups.find(
              (p) =>
                p.studentId === studentId &&
                p.queueDate === db.today(b.tenantId) &&
                (OPEN_STATES as readonly string[]).includes(p.state),
            );
            if (open || ctx.scenario.flags?.duplicatePickup) {
              result.rejected.push({
                studentId,
                code: 'DUPLICATE_ACTIVE_REQUEST',
                existingRequestId: open?.id ?? null,
                detail: 'An open request already exists for today',
              });
              continue;
            }
            const code = studentRejection(db, st);
            if (code) {
              db.audit({
                tenantId: b.tenantId,
                action: 'pickup.request_rejected',
                outcome: 'denied',
                actor: { type: 'user', id: u.id, displayName: u.fullName },
                targetType: 'student',
                targetId: st.id,
                reasonCode: code,
              });
              result.rejected.push({ studentId, code, existingRequestId: null });
              continue;
            }
            const p = createPickup(db, {
              tenantId: b.tenantId,
              studentId,
              guardianId: g.id,
              note: b.note?.trim() || null,
              actor: { type: 'user', id: u.id, displayName: u.fullName },
            });
            result.created.push(guardianPickup(db, p, s.userId));
          }
          g.lastActiveAt = db.nowIso();
          if (!result.created.length && result.rejected.length) {
            const first = result.rejected[0]!.code as ErrorCode;
            const allSame = result.rejected.every((r) => r.code === first);
            return fail(allSame ? first : 'STUDENT_NOT_ELIGIBLE', 'No request could be created', {
              rejected: result.rejected,
            });
          }
          return json(result, 201);
        });
      }),
    ),
    http.get(
      `${M}/pickup-requests/:requestId`,
      handle(({ request, params }) => {
        const s = requireGuardian(ctx, request);
        return json(guardianPickup(db, myPickup(s.userId, params.requestId as string), s.userId));
      }),
    ),
    http.post(
      `${M}/pickup-requests/:requestId/acknowledge`,
      handle(({ request, params }) => {
        const s = requireGuardian(ctx, request);
        return idempotent(ctx, request, `u:${s.userId}`, () => {
          const p = myPickup(s.userId, params.requestId as string);
          if (p.state === 'acknowledged') return json(guardianPickup(db, p, s.userId));
          if (p.state === 'cancelled' || p.state === 'resolved')
            return fail('PICKUP_REQUEST_CLOSED', undefined, { currentState: p.state });
          const g = profiles(s.userId).find((x) => x.tenantId === p.tenantId)!;
          const code = guardianRejection(db, g);
          if (code && code !== 'TENANT_NOT_OPERATIONAL') return fail(code);
          acknowledge(db, p, g.id, actorOf(ctx, s));
          return json(guardianPickup(db, p, s.userId));
        });
      }),
    ),
    http.post(
      `${M}/pickup-requests/:requestId/cancel`,
      handle(async ({ request, params }) => {
        const s = requireGuardian(ctx, request);
        const p = myPickup(s.userId, params.requestId as string);
        const b = await body<GuardianCancelRequest>(request).catch(
          () => ({}) as GuardianCancelRequest,
        );
        if (p.state !== 'requested')
          return fail(
            'INVALID_PICKUP_TRANSITION',
            p.state === 'sent_out'
              ? 'Your child has already been sent out — confirm pickup instead'
              : undefined,
            { currentState: p.state },
          );
        if (db.state.guardians.find((g) => g.id === p.guardianId)?.userId !== s.userId)
          return fail('FORBIDDEN', 'Only the guardian who requested pickup can cancel it');
        transition(db, p, {
          to: 'cancelled',
          actorType: 'guardian',
          actor: actorOf(ctx, s),
          reason: b.reason ?? null,
        });
        return json(guardianPickup(db, p, s.userId));
      }),
    ),
    http.get(
      `${M}/device`,
      handle(({ request }) => {
        const s = requireGuardian(ctx, request, true);
        const d = db.state.devices.find((x) => x.id === s.deviceId);
        const transfers = db.state.transfers
          .filter((t) => t.userId === s.userId)
          .sort((a, b) => b.at.localeCompare(a.at));
        return json({
          currentDevice: d
            ? deviceSummary(d)
            : {
                deviceId: s.deviceId ?? '',
                platform: 'android',
                model: 'This device',
                state: 'active',
                activatedAt: db.nowIso(),
                lastSeenAt: db.nowIso(),
              },
          isActiveDevice: d?.state === 'active',
          lastTransferAt: transfers[0]?.at ?? null,
          nextTransferAllowedAt: nextTransferAllowedAt(db, s.userId),
          transferHistory: transfers.map((t) => transferDto(db, t)),
        });
      }),
    ),
    http.post(
      `${M}/push-tokens`,
      handle(async ({ request }) => {
        requireGuardian(ctx, request, true);
        const b = await body<PushTokenRegistration>(request);
        if (!b.token) return invalid('token', 'Token is required');
        return noContent();
      }),
    ),
    http.delete(
      `${M}/push-tokens/current`,
      handle(({ request }) => {
        requireGuardian(ctx, request, true);
        return noContent();
      }),
    ),
    http.get(
      `${M}/notifications`,
      handle(({ request }) => {
        const s = requireGuardian(ctx, request);
        const url = new URL(request.url);
        const mine = db.state.notifications.filter((n) => n.userId === s.userId);
        const rows = mine
          .filter((n) => url.searchParams.get('unreadOnly') !== 'true' || !n.readAt)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .map(notificationDto);
        return json({ ...page(rows, url), unreadCount: mine.filter((n) => !n.readAt).length });
      }),
    ),
    http.post(
      `${M}/notifications/read`,
      handle(async ({ request }) => {
        const s = requireGuardian(ctx, request);
        const b = await body<MarkNotificationsReadRequest>(request);
        for (const n of db.state.notifications.filter(
          (x) => x.userId === s.userId && !x.readAt && (b.all || b.ids?.includes(x.id)),
        ))
          n.readAt = db.nowIso();
        db.touch();
        return noContent();
      }),
    ),

    // ── licensing (primary guardian) ─────────────────────────
    http.get(
      `${M}/license-seats`,
      handle(({ request }) => {
        const s = requireGuardian(ctx, request, true);
        const tenantId = q(new URL(request.url), 'tenantId');
        const mine = profiles(s.userId)
          .filter((g) => g.kind === 'primary')
          .map((g) => g.id);
        return json({
          items: db.state.seats
            .filter(
              (x) => mine.includes(x.ownerGuardianId) && (!tenantId || x.tenantId === tenantId),
            )
            .map(seatDto),
        });
      }),
    ),
    http.post(
      `${M}/license-purchases`,
      handle(({ request }) => {
        const s = requireGuardian(ctx, request, true);
        return idempotent(ctx, request, `u:${s.userId}`, (raw) => {
          const b = JSON.parse(raw) as CreatePurchaseIntentRequest;
          const g = primaryIn(s.userId, b.tenantId);
          if (!hasFeature(db, b.tenantId, 'guardians.additional_purchase'))
            return fail('FEATURE_NOT_ENTITLED', undefined, {
              feature: 'guardians.additional_purchase',
            });
          const t = db.tenant(b.tenantId)!;
          const intent = {
            id: db.id(),
            tenantId: b.tenantId,
            guardianId: g.id,
            userId: s.userId,
            provider: b.provider,
            productId: 'guardian_seat_term',
            expiresAt: db.addMinutes(30),
            state: 'open' as const,
            seatId: null,
          };
          db.state.purchaseIntents.push(intent);
          db.touch();
          return json(
            {
              intentId: intent.id,
              provider: b.provider,
              productId: intent.productId,
              obfuscatedAccountId:
                b.provider === 'google_play' ? `acc_${s.userId.slice(-12)}` : null,
              obfuscatedProfileId:
                b.provider === 'google_play' ? `int_${intent.id.slice(-12)}` : null,
              appAccountToken: b.provider === 'apple_app_store' ? intent.id : null,
              displayPrice: { amountMinor: 1999, currency: 'USD' },
              seatTermEndsAt: `${t.termEndDate}T23:59:59.000Z`,
              expiresAt: intent.expiresAt,
            },
            201,
          );
        });
      }),
    ),
    http.post(
      `${M}/license-purchases/:intentId/complete`,
      handle(({ request, params }) => {
        const s = requireGuardian(ctx, request, true);
        return idempotent(ctx, request, `u:${s.userId}`, (raw) => {
          const b = JSON.parse(raw) as CompletePurchaseRequest;
          const intent =
            db.state.purchaseIntents.find(
              (x) => x.id === params.intentId && x.userId === s.userId,
            ) ?? fail('NOT_FOUND');
          if (intent.state === 'verified')
            return fail('PURCHASE_ALREADY_PROCESSED', undefined, { seatId: intent.seatId });
          if (intent.expiresAt < db.nowIso()) return fail('PURCHASE_INTENT_EXPIRED');
          // Mock store verification: tokens starting with "pending" are pending, "invalid" fail.
          if (b.purchaseToken.startsWith('invalid')) return fail('PURCHASE_VERIFICATION_FAILED');
          if (b.purchaseToken.startsWith('pending')) return json({ state: 'pending', seat: null });
          const t = db.tenant(intent.tenantId)!;
          const seat = {
            id: db.id(),
            tenantId: intent.tenantId,
            ownerGuardianId: intent.guardianId,
            source: 'purchase' as const,
            state: 'available' as const,
            termEndsAt: `${t.termEndDate}T23:59:59.000Z`,
            reassignmentsUsed: 0,
            assignedGuardianId: null,
            createdAt: db.nowIso(),
          };
          db.state.seats.push(seat);
          intent.state = 'verified';
          intent.seatId = seat.id;
          db.audit({
            tenantId: intent.tenantId,
            action: 'seat.purchased',
            outcome: 'success',
            actor: actorOf(ctx, s),
            data: { provider: intent.provider },
          });
          db.touch();
          return json({ state: 'verified', seat: seatDto(seat) });
        });
      }),
    ),
    http.get(
      `${M}/guardians`,
      handle(({ request }) => {
        const s = requireGuardian(ctx, request, true);
        const tenantId = q(new URL(request.url), 'tenantId');
        const mine = profiles(s.userId)
          .filter((g) => g.kind === 'primary')
          .map((g) => g.id);
        return json({
          items: db.state.guardians
            .filter(
              (g) =>
                g.kind === 'additional' &&
                g.invitedByGuardianId &&
                mine.includes(g.invitedByGuardianId) &&
                (!tenantId || g.tenantId === tenantId),
            )
            .map((g) => additionalGuardian(db, g)),
        });
      }),
    ),
    http.post(
      `${M}/guardian-invitations`,
      handle(({ request }) => {
        const s = requireGuardian(ctx, request, true);
        return idempotent(ctx, request, `u:${s.userId}`, (raw) => {
          const b = JSON.parse(raw) as CreateGuardianInvitationRequest;
          const owner = primaryIn(s.userId, b.tenantId);
          const seat = db.state.seats.find(
            (x) => x.id === b.seatId && x.ownerGuardianId === owner.id,
          );
          if (!seat || seat.state !== 'available') return fail('NO_AVAILABLE_SEAT');
          if (seat.reassignmentsUsed >= 5) return fail('SEAT_REASSIGNMENT_LIMIT');
          if (!/^\+[1-9]\d{6,14}$/.test(b.phone))
            return invalid('phone', 'Phone must be in international format');
          const me = db.user(s.userId)!;
          if (
            b.phone === me.phone ||
            db.state.guardians.some(
              (g) =>
                g.tenantId === b.tenantId &&
                g.phone === b.phone &&
                g.state !== 'revoked' &&
                g.state !== 'expired',
            )
          )
            return fail('GUARDIAN_PHONE_IN_USE');
          if (!b.fullName?.trim()) return invalid('fullName', 'Name is required');
          const myStudents = db.state.links
            .filter((l) => l.guardianId === owner.id && !l.removedAt)
            .map((l) => l.studentId);
          if (!b.studentIds.length || b.studentIds.some((id) => !myStudents.includes(id)))
            return fail('GUARDIAN_NOT_LINKED');
          const max = limitOf(db, b.tenantId, 'additional_guardians.max_per_student')?.value;
          for (const studentId of b.studentIds) {
            const count = db.state.links.filter(
              (l) =>
                l.studentId === studentId &&
                !l.isPrimary &&
                !l.removedAt &&
                ['active', 'pending_activation'].includes(
                  db.state.guardians.find((g) => g.id === l.guardianId)?.state ?? '',
                ),
            ).length;
            if (max != null && count >= max)
              return fail('ADDITIONAL_GUARDIAN_LIMIT_REACHED', undefined, { limit: max });
          }
          const validity = computeValidity(db, b.validity, seat.termEndsAt);
          if (!validity) return fail('INVALID_VALIDITY_WINDOW');
          let user = db.state.users.find((u) => u.phone === b.phone);
          if (!user) {
            user = {
              id: db.id(),
              fullName: b.fullName.trim(),
              email: null,
              phone: b.phone,
              password: null,
              platformRoles: [],
              platformStatus: 'active',
              mfaEnabled: false,
              locale: 'en',
              termsVersion: null,
              lastLoginAt: null,
            };
            db.state.users.push(user);
          }
          const g: GuardianRecord = {
            id: db.id(),
            tenantId: b.tenantId,
            userId: user.id,
            kind: 'additional',
            fullName: b.fullName.trim(),
            phone: b.phone,
            state: 'pending_activation',
            stateReason: null,
            stateChangedAt: null,
            invitedByGuardianId: owner.id,
            seatId: seat.id,
            validityMode: b.validity.mode,
            validFrom: null,
            validUntil: b.validity.mode === 'valid_until_date' ? validity.validUntil : null,
            durationDays: validity.durationDays,
            activatedAt: null,
            lastActiveAt: null,
            createdAt: db.nowIso(),
          };
          db.state.guardians.push(g);
          for (const studentId of b.studentIds)
            db.state.links.push({
              id: db.id(),
              tenantId: b.tenantId,
              guardianId: g.id,
              studentId,
              relationship: b.relationship,
              isPrimary: false,
              removedAt: null,
            });
          seat.state = 'assigned';
          seat.assignedGuardianId = g.id;
          seat.reassignmentsUsed += 1;
          const inv: InvitationRecord = {
            id: db.id(),
            tenantId: b.tenantId,
            seatId: seat.id,
            guardianId: g.id,
            createdByGuardianId: owner.id,
            fullName: g.fullName,
            phone: b.phone,
            relationship: b.relationship,
            studentIds: b.studentIds,
            code: db.crockford(10),
            expiresAt: db.addDays(3),
            state: 'pending',
            createdAt: db.nowIso(),
            redeemedAt: null,
          };
          db.state.invitations.push(inv);
          db.audit({
            tenantId: b.tenantId,
            action: 'invitation.created',
            outcome: 'success',
            actor: actorOf(ctx, s),
            targetType: 'guardian',
            targetId: g.id,
            targetLabel: g.fullName,
            data: { validity: b.validity.mode },
          });
          db.touch();
          return json(invitationCreatedDto(g, inv), 201);
        });
      }),
    ),
    http.patch(
      `${M}/guardians/:guardianId`,
      handle(async ({ request, params }) => {
        const s = requireGuardian(ctx, request);
        const g = managed(s.userId, params.guardianId as string);
        const b = await body<UpdateAdditionalGuardianRequest>(request);
        if (b.validity) {
          const seat = db.state.seats.find((x) => x.id === g.seatId);
          const v =
            seat &&
            computeValidity(
              db,
              b.validity,
              seat.termEndsAt,
              g.validFrom ? new Date(g.validFrom) : db.now(),
            );
          if (!v) return fail('INVALID_VALIDITY_WINDOW');
          g.validityMode = b.validity.mode;
          g.validUntil =
            g.activatedAt || b.validity.mode === 'valid_until_date' ? v.validUntil : null;
          g.durationDays = v.durationDays;
          if (g.state === 'expired' && g.validUntil && g.validUntil > db.nowIso())
            g.state = 'active';
        }
        if (b.studentIds) {
          const owner = db.state.guardians.find((x) => x.id === g.invitedByGuardianId)!;
          const allowed = db.state.links
            .filter((l) => l.guardianId === owner.id && !l.removedAt)
            .map((l) => l.studentId);
          if (b.studentIds.some((id) => !allowed.includes(id))) return fail('GUARDIAN_NOT_LINKED');
          const rel = db.state.links.find((l) => l.guardianId === g.id)?.relationship ?? 'other';
          for (const l of db.state.links.filter(
            (x) => x.guardianId === g.id && !x.removedAt && !b.studentIds!.includes(x.studentId),
          ))
            l.removedAt = db.nowIso();
          for (const id of b.studentIds)
            if (
              !db.state.links.some(
                (l) => l.guardianId === g.id && l.studentId === id && !l.removedAt,
              )
            )
              db.state.links.push({
                id: db.id(),
                tenantId: g.tenantId,
                guardianId: g.id,
                studentId: id,
                relationship: rel,
                isPrimary: false,
                removedAt: null,
              });
        }
        db.audit({
          tenantId: g.tenantId,
          action: 'guardian.updated',
          outcome: 'success',
          actor: actorOf(ctx, s),
          targetType: 'guardian',
          targetId: g.id,
          targetLabel: g.fullName,
        });
        db.touch();
        return json(additionalGuardian(db, g));
      }),
    ),
    http.post(
      `${M}/guardians/:guardianId/revoke`,
      handle(({ request, params }) => {
        const s = requireGuardian(ctx, request);
        const g = managed(s.userId, params.guardianId as string);
        if (g.state === 'revoked') return fail('CONFLICT', 'Already revoked');
        g.state = 'revoked';
        g.stateReason = 'Revoked by primary guardian';
        g.stateChangedAt = db.nowIso();
        for (const inv of db.state.invitations.filter(
          (i) => i.guardianId === g.id && i.state === 'pending',
        ))
          inv.state = 'revoked';
        returnSeat(db, g.seatId);
        db.audit({
          tenantId: g.tenantId,
          action: 'guardian.revoked',
          outcome: 'success',
          actor: actorOf(ctx, s),
          targetType: 'guardian',
          targetId: g.id,
          targetLabel: g.fullName,
        });
        db.emit(
          {
            eventId: db.id(),
            type: 'guardian.access.changed',
            version: 1,
            tenantId: g.tenantId,
            occurredAt: db.nowIso(),
            data: {
              tenantId: g.tenantId,
              guardianId: g.id,
              state: 'revoked',
              reasonCode: 'revoked_by_primary',
            },
          },
          { kind: 'user', userId: g.userId },
        );
        db.touch();
        return json(additionalGuardian(db, g));
      }),
    ),
    http.post(
      `${M}/guardians/:guardianId/invitation/resend`,
      handle(({ request, params }) => {
        const s = requireGuardian(ctx, request);
        const g = managed(s.userId, params.guardianId as string);
        const inv = db.state.invitations
          .filter((i) => i.guardianId === g.id)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
        if (
          !inv ||
          inv.state === 'redeemed' ||
          inv.state === 'revoked' ||
          g.state !== 'pending_activation'
        )
          return fail('CONFLICT', 'This invitation can no longer be resent');
        inv.code = db.crockford(10);
        inv.state = 'pending';
        inv.expiresAt = db.addDays(3);
        db.audit({
          tenantId: g.tenantId,
          action: 'invitation.resent',
          outcome: 'success',
          actor: actorOf(ctx, s),
          targetLabel: g.fullName,
        });
        db.touch();
        return json(invitationCreatedDto(g, inv));
      }),
    ),

    // ── invitation redemption (unauthenticated) ──────────────
    http.post(
      '*/v1/invitations/lookup',
      handle(async ({ request }) => {
        if (!request.headers.get('X-Device-Id')) return fail('DEVICE_ID_REQUIRED');
        const b = await body<InvitationLookupRequest>(request);
        const code = b.code.toUpperCase().replace(/[^0-9A-Z]/g, '');
        const inv = db.state.invitations.find((i) => i.code === code);
        if (!inv) return fail('INVITATION_NOT_FOUND');
        if (inv.state === 'redeemed') return fail('INVITATION_ALREADY_USED');
        if (inv.state === 'revoked') return fail('INVITATION_REVOKED');
        if (inv.state === 'expired' || inv.expiresAt < db.nowIso())
          return fail('INVITATION_EXPIRED');
        const inviter = db.state.guardians.find((g) => g.id === inv.createdByGuardianId)!;
        const g = db.state.guardians.find((x) => x.id === inv.guardianId)!;
        return json({
          invitationId: inv.id,
          tenantName: db.tenant(inv.tenantId)!.name,
          inviterFirstName: inviter.fullName.split(' ')[0]!,
          maskedPhone: maskPhone(inv.phone),
          studentFirstNames: inv.studentIds.map(
            (id) => db.state.students.find((s) => s.id === id)?.firstName ?? '',
          ),
          relationship: inv.relationship,
          validity: {
            mode: g.validityMode ?? 'permanent',
            validFrom: null,
            validUntil: g.validUntil,
            durationDays: g.durationDays,
          },
          expiresAt: inv.expiresAt,
        });
      }),
    ),
    http.post(
      '*/v1/invitations/:invitationId/otp',
      handle(async ({ request, params }) => {
        if (!request.headers.get('X-Device-Id')) return fail('DEVICE_ID_REQUIRED');
        const b = await body<InvitationOtpRequest>(request);
        const inv =
          db.state.invitations.find(
            (i) =>
              i.id === params.invitationId &&
              i.code === b.code.toUpperCase().replace(/[^0-9A-Z]/g, ''),
          ) ?? fail('NOT_FOUND');
        if (inv.state !== 'pending' || inv.expiresAt < db.nowIso())
          return fail(inv.state === 'redeemed' ? 'INVITATION_ALREADY_USED' : 'INVITATION_EXPIRED');
        if (b.phone !== inv.phone) return fail('INVITATION_PHONE_MISMATCH');
        return json(sendOtp(ctx, inv.phone, 'invitation_redeem', inv.id), 202);
      }),
    ),
    http.post(
      '*/v1/invitations/:invitationId/redeem',
      handle(({ request, params }) => {
        if (!request.headers.get('X-Device-Id')) return fail('DEVICE_ID_REQUIRED');
        return idempotent(ctx, request, `inv:${params.invitationId as string}`, (raw) => {
          const b = JSON.parse(raw) as InvitationRedeemRequest;
          const inv =
            db.state.invitations.find((i) => i.id === params.invitationId) ?? fail('NOT_FOUND');
          if (inv.state === 'redeemed') return fail('INVITATION_ALREADY_USED');
          if (inv.state !== 'pending' || inv.expiresAt < db.nowIso())
            return fail('INVITATION_EXPIRED');
          const c = checkOtp(ctx, b.challengeId, b.otpCode);
          if (c.invitationId !== inv.id || c.phone !== inv.phone)
            return fail('INVITATION_PHONE_MISMATCH');
          const g = db.state.guardians.find((x) => x.id === inv.guardianId)!;
          const user = db.user(g.userId)!;
          if (b.fullName?.trim()) {
            user.fullName = b.fullName.trim();
            g.fullName = user.fullName;
          }
          if (b.termsVersion) user.termsVersion = b.termsVersion;
          inv.state = 'redeemed';
          inv.redeemedAt = db.nowIso();
          g.state = 'active';
          g.activatedAt = db.nowIso();
          const seat = db.state.seats.find((s) => s.id === g.seatId);
          const v = computeValidity(
            db,
            {
              mode: g.validityMode ?? 'permanent',
              durationDays: g.durationDays ?? undefined,
              validUntil: g.validUntil?.slice(0, 10),
            },
            seat?.termEndsAt ?? db.addDays(365),
          );
          g.validFrom = v?.validFrom ?? db.nowIso();
          g.validUntil = v?.validUntil ?? null;
          const owner = db.state.guardians.find((x) => x.id === inv.createdByGuardianId)!;
          db.state.notifications.unshift({
            id: db.id(),
            userId: owner.userId,
            tenantId: inv.tenantId,
            type: 'invitation_redeemed',
            title: `${g.fullName.split(' ')[0]} accepted your invitation`,
            body: `${g.fullName} can now request pickup.`,
            data: { guardianId: g.id },
            createdAt: db.nowIso(),
            readAt: null,
          });
          db.audit({
            tenantId: inv.tenantId,
            action: 'invitation.redeemed',
            outcome: 'success',
            actor: { type: 'user', id: user.id, displayName: user.fullName },
            targetType: 'guardian',
            targetId: g.id,
            targetLabel: g.fullName,
          });
          db.touch();
          const result: OtpVerifyResult = completeGuardianSignIn(ctx, request, user, b.device);
          return json(result);
        });
      }),
    ),
  ];
}
