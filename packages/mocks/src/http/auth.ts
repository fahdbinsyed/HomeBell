import type {
  DeviceConflictTokenRequest,
  DeviceInfo,
  DeviceTransferResult,
  MfaEnrollConfirmRequest,
  MfaEnrollStartRequest,
  MfaVerifyRequest,
  OtpChallenge,
  OtpResendRequest,
  OtpSendRequest,
  OtpVerifyRequest,
  OtpVerifyResult,
  PasswordForgotRequest,
  PasswordResetRequest,
  RealtimeTicketRequest,
  RefreshRequest,
  StaffInvitationAcceptRequest,
  StaffLoginRequest,
  StaffLoginResult,
  TokenPair,
} from '@homebell/contracts';
import { http } from 'msw';
import type { MockDb } from '../db/db';
import type { OtpChallengeRecord, SessionRecord, UserRecord } from '../db/types';
import { DEMO } from '../db/seed';
import {
  deviceSummary,
  guardianProfiles,
  maskPhone,
  meDto,
  nextTransferAllowedAt,
  transferDto,
} from '../mappers';
import { hasFeature } from '../rules/entitlements';
import {
  body,
  fail,
  findSession,
  handle,
  json,
  noContent,
  requireSession,
  type MockContext,
} from './context';

const OTP = {
  ttlMin: 5,
  resendSec: 60,
  maxSendsPer15: 3,
  maxAttempts: 5,
  lockAfterDead: 3,
  lockMin: 30,
};

interface Pending {
  mfa: Map<string, { userId: string; audience: 'school' | 'platform'; expiresAt: number }>;
  conflicts: Map<
    string,
    { userId: string; deviceId: string; device: DeviceInfo; expiresAt: number; used: boolean }
  >;
  failedLogins: Map<string, number>;
}
const pendingByCtx = new WeakMap<MockContext, Pending>();
const pendingOf = (ctx: MockContext): Pending => {
  let p = pendingByCtx.get(ctx);
  if (!p)
    pendingByCtx.set(ctx, (p = { mfa: new Map(), conflicts: new Map(), failedLogins: new Map() }));
  return p;
};

export function issueSession(
  ctx: MockContext,
  request: Request,
  user: UserRecord,
  kind: SessionRecord['kind'],
  opts: {
    scope?: SessionRecord['scope'];
    deviceId?: string | null;
    supportTenantId?: string | null;
    minutes?: number;
  } = {},
): { session: SessionRecord; tokens: TokenPair } {
  const db = ctx.db;
  const session: SessionRecord = {
    id: db.id(),
    userId: user.id,
    kind,
    scope: opts.scope ?? 'full',
    deviceId: opts.deviceId ?? null,
    accessToken: db.token('at'),
    refreshToken: db.token('rt'),
    accessExpiresAt: db.addMinutes(10),
    refreshExpiresAt: db.addMinutes(opts.minutes ?? (kind === 'guardian' ? 60 * 24 * 60 : 60 * 12)),
    supportTenantId: opts.supportTenantId ?? null,
    revokedAt: null,
  };
  db.state.sessions.push(session);
  user.lastLoginAt = db.nowIso();
  // Web apps (no Authorization header) get the simulated BFF session.
  if (kind !== 'guardian' && !request.headers.get('Authorization')) {
    ctx.webSessionId = session.id;
    ctx.onWebSessionChange?.(session.id);
  }
  db.touch();
  return { session, tokens: tokensOf(session) };
}

const tokensOf = (s: SessionRecord): TokenPair => ({
  accessToken: s.accessToken,
  accessTokenExpiresAt: s.accessExpiresAt,
  refreshToken: s.refreshToken,
  refreshTokenExpiresAt: s.refreshExpiresAt,
  sessionId: s.id,
  scope: s.scope,
});

export function revokeSession(
  db: MockDb,
  s: SessionRecord,
  reason: 'logout' | 'device_transfer' | 'admin_action' | 'account_deactivated',
): void {
  if (s.revokedAt) return;
  s.revokedAt = db.nowIso();
  db.emit(
    {
      eventId: db.id(),
      type: 'session.revoked',
      version: 1,
      occurredAt: db.nowIso(),
      data: { sessionId: s.id, reason },
    },
    { kind: 'session', sessionId: s.id },
  );
}

function challengeDto(db: MockDb, c: OtpChallengeRecord, remainingSends: number): OtpChallenge {
  return {
    challengeId: c.id,
    purpose: c.purpose,
    channel: 'sms',
    maskedPhone: maskPhone(c.phone),
    codeLength: 6,
    expiresAt: c.expiresAt,
    resendAvailableAt: new Date(Date.parse(c.lastSentAt) + OTP.resendSec * 1000).toISOString(),
    remainingSends,
  };
}

/** Shared OTP send logic (login + invitation). Anti-enumeration: same response for unknown phones. */
export function sendOtp(
  ctx: MockContext,
  phone: string,
  purpose: OtpChallengeRecord['purpose'],
  invitationId: string | null = null,
): OtpChallenge {
  const db = ctx.db;
  if (!/^\+[1-9]\d{6,14}$/.test(phone)) return fail('VALIDATION_FAILED', 'Phone must be E.164');
  if (!phone.startsWith('+1')) return fail('PHONE_NOT_SUPPORTED');
  const since15 = db.addMinutes(-15);
  const recent = db.state.otpChallenges.filter((c) => c.phone === phone && c.createdAt > since15);
  const dead = db.state.otpChallenges.filter(
    (c) => c.phone === phone && c.status === 'dead' && c.createdAt > db.addMinutes(-OTP.lockMin),
  );
  if (dead.length >= OTP.lockAfterDead)
    return fail('OTP_LOCKED', undefined, { lockedUntil: db.addMinutes(OTP.lockMin) });
  if (
    recent.length >= OTP.maxSendsPer15 ||
    (ctx.scenario.flags?.otpResendLimit && recent.length >= 1)
  ) {
    return fail('OTP_SEND_LIMIT_REACHED', undefined, { retryAfterSeconds: 15 * 60 });
  }
  const c: OtpChallengeRecord = {
    id: db.id(),
    phone,
    purpose,
    code: DEMO.otpCode,
    attempts: 0,
    createdAt: db.nowIso(),
    expiresAt: db.addMinutes(OTP.ttlMin),
    lastSentAt: db.nowIso(),
    status: 'pending',
    invitationId,
  };
  db.state.otpChallenges.push(c);
  db.audit({
    tenantId: null,
    action: 'otp.sent',
    outcome: 'success',
    actor: { type: 'system', id: null, displayName: 'OTP' },
    data: { phone: maskPhone(phone), purpose },
  });
  db.touch();
  return challengeDto(db, c, OTP.maxSendsPer15 - recent.length - 1);
}

/** Validates a code; throws the right OTP error, or returns the verified challenge. */
export function checkOtp(ctx: MockContext, challengeId: string, code: string): OtpChallengeRecord {
  const db = ctx.db;
  const c = db.state.otpChallenges.find((x) => x.id === challengeId);
  if (!c) return fail('OTP_CHALLENGE_NOT_FOUND');
  if (ctx.scenario.flags?.otpLocked)
    return fail('OTP_LOCKED', undefined, { lockedUntil: db.addMinutes(OTP.lockMin) });
  if (c.status === 'dead' || c.attempts >= OTP.maxAttempts) return fail('OTP_ATTEMPTS_EXCEEDED');
  if (c.status === 'verified') return fail('OTP_EXPIRED', 'Code already used');
  if (c.expiresAt < db.nowIso()) return fail('OTP_EXPIRED');
  if (code !== c.code) {
    c.attempts++;
    db.audit({
      tenantId: null,
      action: 'otp.failed',
      outcome: 'failed',
      actor: { type: 'system', id: null, displayName: 'OTP' },
      data: { phone: maskPhone(c.phone) },
    });
    if (c.attempts >= OTP.maxAttempts) {
      c.status = 'dead';
      db.touch();
      return fail('OTP_ATTEMPTS_EXCEEDED');
    }
    db.touch();
    return fail('OTP_INVALID', undefined, { remainingAttempts: OTP.maxAttempts - c.attempts });
  }
  c.status = 'verified';
  db.audit({
    tenantId: null,
    action: 'otp.verified',
    outcome: 'success',
    actor: { type: 'system', id: null, displayName: 'OTP' },
    data: { phone: maskPhone(c.phone) },
  });
  return c;
}

/** After a successful OTP: device conflict or sign-in on this device. */
export function completeGuardianSignIn(
  ctx: MockContext,
  request: Request,
  user: UserRecord,
  device: DeviceInfo,
): OtpVerifyResult {
  const db = ctx.db;
  const deviceId = request.headers.get('X-Device-Id') ?? fail('DEVICE_ID_REQUIRED');
  const active = db.state.devices.find((d) => d.userId === user.id && d.state === 'active');
  if (active && active.id !== deviceId) {
    const conflictToken = db.token('conflict');
    pendingOf(ctx).conflicts.set(conflictToken, {
      userId: user.id,
      deviceId,
      device,
      expiresAt: Date.now() + 5 * 60_000,
      used: false,
    });
    const cooldown = nextTransferAllowedAt(db, user.id);
    const override = db.state.cooldownOverrides.find(
      (o) => o.userId === user.id && !o.usedAt && o.expiresAt > db.nowIso(),
    );
    const isPrimary = db.state.guardians.some(
      (g) =>
        g.userId === user.id &&
        g.kind === 'primary' &&
        g.state === 'active' &&
        hasFeature(db, g.tenantId, 'guardians.additional_purchase'),
    );
    return {
      outcome: 'device_conflict',
      conflict: {
        conflictToken,
        expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
        activeDevice: deviceSummary(active),
        transfer: {
          allowed: !cooldown || !!override,
          cooldownEndsAt: cooldown,
          overrideActive: !!override,
        },
        purchase: { available: isPrimary },
      },
    };
  }
  if (!active) {
    db.state.devices.push({
      id: deviceId,
      userId: user.id,
      platform: device.platform,
      model: device.model,
      state: 'active',
      activatedAt: db.nowIso(),
      lastSeenAt: db.nowIso(),
    });
    db.audit({
      tenantId: null,
      action: 'device.registered',
      outcome: 'success',
      actor: { type: 'user', id: user.id, displayName: user.fullName },
      data: { platform: device.platform, model: device.model },
    });
  }
  const activated = activatePendingPrimaryProfiles(db, user.id);
  const { session, tokens } = issueSession(ctx, request, user, 'guardian', { deviceId });
  return { outcome: 'authenticated', tokens, me: meDto(db, session), activatedProfiles: activated };
}

function activatePendingPrimaryProfiles(db: MockDb, userId: string) {
  const changed: string[] = [];
  for (const g of db.state.guardians.filter(
    (x) => x.userId === userId && x.state === 'pending_activation' && x.kind === 'primary',
  )) {
    g.state = 'active';
    g.activatedAt = db.nowIso();
    g.validFrom = db.nowIso();
    changed.push(g.id);
  }
  return guardianProfiles(db, userId).filter((p) => changed.includes(p.guardianId));
}

export function authHandlers(ctx: MockContext) {
  const db = ctx.db;
  const pending = pendingOf(ctx);

  const staffLogin = (
    request: Request,
    user: UserRecord,
    audience: 'school' | 'platform',
  ): StaffLoginResult => {
    if (audience === 'platform' || user.mfaEnabled) {
      const token = db.token('mfa');
      pending.mfa.set(token, { userId: user.id, audience, expiresAt: Date.now() + 5 * 60_000 });
      if (!user.mfaEnabled)
        return {
          status: 'mfa_enrollment_required',
          enrollmentToken: token,
          expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
        };
      return {
        status: 'mfa_required',
        mfaToken: token,
        expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      };
    }
    const { session, tokens } = issueSession(ctx, request, user, 'staff');
    db.audit({
      tenantId: null,
      action: 'auth.login',
      outcome: 'success',
      actor: { type: 'user', id: user.id, displayName: user.fullName },
    });
    return { status: 'authenticated', tokens, me: meDto(db, session) };
  };

  const takeMfa = (token: string) => {
    const p = pending.mfa.get(token);
    if (!p || p.expiresAt < Date.now())
      return fail('UNAUTHENTICATED', 'MFA step expired — sign in again');
    return p;
  };

  return [
    http.post(
      '*/v1/auth/staff/login',
      handle(async ({ request }) => {
        const b = await body<StaffLoginRequest>(request);
        const audience = b.audience ?? 'school';
        const key = b.email.toLowerCase();
        if ((pending.failedLogins.get(key) ?? 0) >= 5)
          return fail('ACCOUNT_LOCKED', undefined, { lockedUntil: db.addMinutes(15) });
        const user = db.state.users.find(
          (u) => u.email?.toLowerCase() === key && u.password === b.password,
        );
        const allowed =
          user &&
          (audience === 'platform'
            ? user.platformRoles.length > 0 && user.platformStatus === 'active'
            : db.state.memberships.some((m) => m.userId === user.id && m.status === 'active'));
        if (!user || !allowed) {
          pending.failedLogins.set(key, (pending.failedLogins.get(key) ?? 0) + 1);
          db.audit({
            tenantId: null,
            action: 'auth.login_failed',
            outcome: 'failed',
            actor: { type: 'system', id: null, displayName: key },
          });
          return fail('INVALID_CREDENTIALS');
        }
        pending.failedLogins.delete(key);
        return json(staffLogin(request, user, audience));
      }),
    ),

    http.post(
      '*/v1/auth/staff/mfa/verify',
      handle(async ({ request }) => {
        const b = await body<MfaVerifyRequest>(request);
        const p = takeMfa(b.mfaToken);
        if (b.code !== DEMO.mfaCode && b.code !== 'ABCD-1234')
          return fail('MFA_INVALID', undefined, { remainingAttempts: 4 });
        pending.mfa.delete(b.mfaToken);
        const user = db.user(p.userId)!;
        const { session, tokens } = issueSession(
          ctx,
          request,
          user,
          p.audience === 'platform' ? 'platform' : 'staff',
        );
        db.audit({
          tenantId: null,
          action: 'auth.login',
          outcome: 'success',
          actor: { type: 'user', id: user.id, displayName: user.fullName },
        });
        return json({ status: 'authenticated', tokens, me: meDto(db, session) });
      }),
    ),

    http.post(
      '*/v1/auth/staff/mfa/enroll',
      handle(async ({ request }) => {
        const b = await body<MfaEnrollStartRequest>(request);
        takeMfa(b.enrollmentToken);
        return json({
          enrollmentId: db.id(),
          secret: 'JBSWY3DPEHPK3PXP',
          otpauthUri: 'otpauth://totp/HomeBell:demo?secret=JBSWY3DPEHPK3PXP&issuer=HomeBell',
        });
      }),
    ),

    http.post(
      '*/v1/auth/staff/mfa/enroll/confirm',
      handle(async ({ request }) => {
        const b = await body<MfaEnrollConfirmRequest>(request);
        const p = takeMfa(b.enrollmentToken);
        if (b.code !== DEMO.mfaCode) return fail('MFA_INVALID');
        pending.mfa.delete(b.enrollmentToken);
        const user = db.user(p.userId)!;
        user.mfaEnabled = true;
        const { session, tokens } = issueSession(
          ctx,
          request,
          user,
          p.audience === 'platform' ? 'platform' : 'staff',
        );
        db.audit({
          tenantId: null,
          action: 'auth.mfa_enrolled',
          outcome: 'success',
          actor: { type: 'user', id: user.id, displayName: user.fullName },
        });
        return json({
          tokens,
          me: meDto(db, session),
          recoveryCodes: ['ABCD-1234', 'EFGH-5678', 'JKMN-9012', 'PQRS-3456'],
        });
      }),
    ),

    http.post(
      '*/v1/auth/staff/password/forgot',
      handle(async ({ request }) => {
        await body<PasswordForgotRequest>(request);
        return noContent();
      }),
    ),

    http.post(
      '*/v1/auth/staff/password/reset',
      handle(async ({ request }) => {
        const b = await body<PasswordResetRequest>(request);
        if (b.token !== 'reset_demo')
          return fail('STAFF_INVITATION_INVALID', 'Reset link invalid or expired');
        if (b.newPassword.length < 12) return fail('PASSWORD_POLICY_VIOLATION');
        return noContent();
      }),
    ),

    http.post(
      '*/v1/auth/staff/invitations/preview',
      handle(async ({ request }) => {
        const b = await body<{ token: string }>(request);
        const inv = db.state.staffInvitations.find(
          (i) => i.token === b.token && i.status === 'pending' && i.expiresAt > db.nowIso(),
        );
        if (!inv) return fail('STAFF_INVITATION_INVALID');
        return json({
          email: inv.email,
          tenantName: inv.tenantId ? db.tenant(inv.tenantId)!.name : 'HomeBell Platform',
          role: inv.role ?? 'school.admin',
          expiresAt: inv.expiresAt,
          accountExists: db.state.users.some((u) => u.email === inv.email),
        });
      }),
    ),

    http.post(
      '*/v1/auth/staff/invitations/accept',
      handle(async ({ request }) => {
        const b = await body<StaffInvitationAcceptRequest>(request);
        const inv = db.state.staffInvitations.find(
          (i) => i.token === b.token && i.status === 'pending' && i.expiresAt > db.nowIso(),
        );
        if (!inv) return fail('STAFF_INVITATION_INVALID');
        let user = db.state.users.find((u) => u.email === inv.email);
        if (!user) {
          if (!b.password || b.password.length < 12)
            return fail('PASSWORD_POLICY_VIOLATION', 'Choose a password of at least 12 characters');
          user = {
            id: db.id(),
            fullName: b.fullName ?? inv.fullName,
            email: inv.email,
            phone: null,
            password: b.password,
            platformRoles: inv.platformRoles,
            platformStatus: 'active',
            mfaEnabled: false,
            locale: 'en',
            termsVersion: null,
            lastLoginAt: null,
          };
          db.state.users.push(user);
        } else if (user.password === null) {
          // Invited account that has never set a password (e.g. platform user invitation).
          if (!b.password || b.password.length < 12)
            return fail('PASSWORD_POLICY_VIOLATION', 'Choose a password of at least 12 characters');
          user.password = b.password;
          if (b.fullName) user.fullName = b.fullName;
          user.platformStatus = 'active';
        } else if (user.password !== b.password) {
          return fail('INVALID_CREDENTIALS');
        }
        if (inv.tenantId && inv.role)
          db.state.memberships.push({
            id: db.id(),
            userId: user.id,
            tenantId: inv.tenantId,
            role: inv.role,
            status: 'active',
          });
        if (inv.platformRoles.length)
          user.platformRoles = [...new Set([...user.platformRoles, ...inv.platformRoles])];
        inv.status = 'accepted';
        db.touch();
        return json(staffLogin(request, user, inv.tenantId ? 'school' : 'platform'));
      }),
    ),

    // ── guardian OTP ─────────────────────────────────────────
    http.post(
      '*/v1/auth/otp/send',
      handle(async ({ request }) => {
        if (!request.headers.get('X-Device-Id')) return fail('DEVICE_ID_REQUIRED');
        const b = await body<OtpSendRequest>(request);
        return json(sendOtp(ctx, b.phone, b.purpose), 202);
      }),
    ),

    http.post(
      '*/v1/auth/otp/resend',
      handle(async ({ request }) => {
        const b = await body<OtpResendRequest>(request);
        const c = db.state.otpChallenges.find(
          (x) => x.id === b.challengeId && x.status === 'pending',
        );
        if (!c) return fail('OTP_CHALLENGE_NOT_FOUND');
        const availableAt = Date.parse(c.lastSentAt) + OTP.resendSec * 1000;
        if (ctx.scenario.flags?.otpResendLimit)
          return fail('OTP_SEND_LIMIT_REACHED', undefined, { retryAfterSeconds: 15 * 60 });
        if (availableAt > db.now().getTime())
          return fail('OTP_RESEND_TOO_SOON', undefined, {
            resendAvailableAt: new Date(availableAt).toISOString(),
            retryAfterSeconds: Math.ceil((availableAt - db.now().getTime()) / 1000),
          });
        const sends = db.state.otpChallenges.filter(
          (x) => x.phone === c.phone && x.createdAt > db.addMinutes(-15),
        ).length;
        if (sends >= OTP.maxSendsPer15)
          return fail('OTP_SEND_LIMIT_REACHED', undefined, { retryAfterSeconds: 15 * 60 });
        c.lastSentAt = db.nowIso();
        c.expiresAt = db.addMinutes(OTP.ttlMin);
        db.touch();
        return json(challengeDto(db, c, Math.max(0, OTP.maxSendsPer15 - sends - 1)), 202);
      }),
    ),

    http.post(
      '*/v1/auth/otp/verify',
      handle(async ({ request }) => {
        if (!request.headers.get('X-Device-Id')) return fail('DEVICE_ID_REQUIRED');
        const b = await body<OtpVerifyRequest>(request);
        const c = checkOtp(ctx, b.challengeId, b.code);
        const user = db.state.users.find((u) => u.phone === c.phone);
        const profiles = user
          ? db.state.guardians.filter(
              (g) =>
                g.userId === user.id &&
                !(g.kind === 'additional' && g.state === 'pending_activation'),
            )
          : [];
        db.touch();
        if (!user || profiles.length === 0) return json<OtpVerifyResult>({ outcome: 'no_account' });
        return json(completeGuardianSignIn(ctx, request, user, b.device));
      }),
    ),

    http.post(
      '*/v1/auth/device-transfer',
      handle(async ({ request }) => {
        const b = await body<DeviceConflictTokenRequest>(request);
        const p = pending.conflicts.get(b.conflictToken);
        if (!p || p.used || p.expiresAt < Date.now()) return fail('DEVICE_CONFLICT_TOKEN_INVALID');
        const cooldown = nextTransferAllowedAt(db, p.userId);
        const override = db.state.cooldownOverrides.find(
          (o) => o.userId === p.userId && !o.usedAt && o.expiresAt > db.nowIso(),
        );
        const user = db.user(p.userId)!;
        if (cooldown && !override) {
          db.audit({
            tenantId: null,
            action: 'device.transfer_denied',
            outcome: 'denied',
            actor: { type: 'user', id: user.id, displayName: user.fullName },
            reasonCode: 'cooldown',
          });
          return fail('DEVICE_TRANSFER_COOLDOWN', undefined, { cooldownEndsAt: cooldown });
        }
        p.used = true;
        if (override) override.usedAt = db.nowIso();
        const old = db.state.devices.filter((d) => d.userId === p.userId && d.state === 'active');
        for (const d of old) d.state = 'transferred_out';
        for (const s of db.state.sessions.filter(
          (x) => x.userId === p.userId && x.kind === 'guardian' && !x.revokedAt,
        ))
          revokeSession(db, s, 'device_transfer');
        db.state.devices.push({
          id: p.deviceId,
          userId: p.userId,
          platform: p.device.platform,
          model: p.device.model,
          state: 'active',
          activatedAt: db.nowIso(),
          lastSeenAt: db.nowIso(),
        });
        const transfer = {
          id: db.id(),
          userId: p.userId,
          fromDeviceId: old[0]?.id ?? null,
          toDeviceId: p.deviceId,
          at: db.nowIso(),
          viaOverride: !!override,
          suspicious: !!override,
        };
        db.state.transfers.push(transfer);
        for (const g of db.state.guardians.filter((x) => x.userId === p.userId)) {
          db.audit({
            tenantId: g.tenantId,
            action: 'device.transferred',
            outcome: 'success',
            actor: { type: 'user', id: user.id, displayName: user.fullName },
            targetType: 'guardian',
            targetId: g.id,
            targetLabel: g.fullName,
            data: { viaOverride: !!override },
          });
        }
        db.state.notifications.unshift({
          id: db.id(),
          userId: p.userId,
          tenantId: null,
          type: 'device_transferred',
          title: 'Account moved to this phone',
          body: `Your HomeBell account is now active on ${p.device.model}. The previous phone was signed out.`,
          data: {},
          createdAt: db.nowIso(),
          readAt: null,
        });
        activatePendingPrimaryProfiles(db, p.userId);
        const { session, tokens } = issueSession(ctx, request, user, 'guardian', {
          deviceId: p.deviceId,
        });
        const result: DeviceTransferResult = {
          tokens,
          me: meDto(db, session),
          transfer: transferDto(db, transfer),
        };
        return json(result);
      }),
    ),

    http.post(
      '*/v1/auth/device-conflict/limited-session',
      handle(async ({ request }) => {
        const b = await body<DeviceConflictTokenRequest>(request);
        const p = pending.conflicts.get(b.conflictToken);
        if (!p || p.used || p.expiresAt < Date.now()) return fail('DEVICE_CONFLICT_TOKEN_INVALID');
        const isPrimary = db.state.guardians.some(
          (g) => g.userId === p.userId && g.kind === 'primary' && g.state === 'active',
        );
        if (!isPrimary)
          return fail('FORBIDDEN', 'Only primary guardians can buy additional guardian access');
        p.used = true;
        const { tokens } = issueSession(ctx, request, db.user(p.userId)!, 'guardian', {
          scope: 'guardian.license_purchase',
          deviceId: p.deviceId,
          minutes: 30,
        });
        return json(tokens);
      }),
    ),

    http.post(
      '*/v1/auth/refresh',
      handle(async ({ request }) => {
        const b = await body<RefreshRequest>(request);
        const s = db.state.sessions.find((x) => x.refreshToken === b.refreshToken);
        if (!s || s.refreshExpiresAt < db.nowIso()) return fail('REFRESH_TOKEN_INVALID');
        if (s.revokedAt) return fail(s.deviceId ? 'DEVICE_REVOKED' : 'SESSION_REVOKED');
        s.accessToken = db.token('at');
        s.refreshToken = db.token('rt');
        s.accessExpiresAt = db.addMinutes(10);
        db.touch();
        return json(tokensOf(s));
      }),
    ),

    http.post(
      '*/v1/auth/logout',
      handle(({ request }) => {
        const s = findSession(ctx, request);
        if (!s) return fail('UNAUTHENTICATED');
        revokeSession(db, s, 'logout');
        if (ctx.webSessionId === s.id) {
          ctx.webSessionId = null;
          ctx.onWebSessionChange?.(null);
        }
        db.audit({
          tenantId: null,
          action: 'auth.logout',
          outcome: 'success',
          actor: { type: 'user', id: s.userId, displayName: db.user(s.userId)?.fullName ?? '' },
        });
        db.touch();
        return noContent();
      }),
    ),

    http.get(
      '*/v1/auth/me',
      handle(({ request }) => json(meDto(db, requireSession(ctx, request)))),
    ),

    http.post(
      '*/v1/auth/realtime-tickets',
      handle(async ({ request }) => {
        requireSession(ctx, request);
        const b = await body<RealtimeTicketRequest>(request);
        return json({
          ticket: db.token('rt_ticket'),
          expiresAt: db.addMinutes(1),
          hubUrl: `/hubs/${b.hub}`,
        });
      }),
    ),
  ];
}
