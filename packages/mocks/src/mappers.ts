/** Record → contract DTO mappers. Every handler response passes through these. */
import type {
  ActorRef,
  AdditionalGuardian,
  AuditLogEntry,
  ChildSummary,
  CooldownOverride,
  DeviceSummary,
  DeviceTransferRecord,
  Display,
  DisplayItem,
  EntitlementOverride,
  Guardian,
  GuardianLinkSummary,
  GuardianPickupRequest,
  GuardianProfileSummary,
  GuardianTenantContext,
  GuardianValidity,
  InvitationStatus,
  LicenseSeat,
  LifecycleHistoryEntry,
  Me,
  Notification,
  PickupRequestDetail,
  QueueItem,
  SchoolClass,
  SessionScope,
  StaffMember,
  Student,
  SubscriptionPlan,
  SupportNote,
  TenantDetail,
  TenantFlag,
  TenantMembershipSummary,
  TenantSubscription,
  TenantSummary,
} from '@homebell/contracts';
import type { MockDb } from './db/db';
import type {
  ActorRecord,
  DeviceRecord,
  GuardianRecord,
  PickupRecord,
  SessionRecord,
  StudentRecord,
  TenantRecord,
  TransferRecord,
} from './db/types';
import { effectiveGuardianState, OPEN_STATES, pickupEligibility } from './rules/eligibility';
import { hasFeature } from './rules/entitlements';
import { allowedActions, OPERATIONAL_MODE } from './rules/lifecycle';
import { permissionsForPlatformRoles, permissionsForSchoolRole } from './rules/permissions';

export const maskPhone = (phone: string): string => {
  const m = /^\+(1|\d{2,3})(\d*)(\d{4})$/.exec(phone);
  return m ? `+${m[1]}•••••${m[3]}` : '•••••';
};
export const actor = (a: ActorRecord): ActorRef => ({
  type: a.type,
  id: a.id,
  displayName: a.displayName,
});

// ── tenants ────────────────────────────────────────────────
export function tenantFlags(db: MockDb, t: TenantRecord): TenantFlag[] {
  const flags: TenantFlag[] = [];
  if (
    t.expiresAt &&
    t.expiresAt > db.nowIso() &&
    Date.parse(t.expiresAt) - db.now().getTime() < 14 * 86_400_000
  )
    flags.push('expiring_soon');
  if (
    db.state.transfers.some(
      (x) =>
        x.suspicious &&
        db.state.guardians.some((g) => g.userId === x.userId && g.tenantId === t.id),
    )
  )
    flags.push('suspicious_transfers');
  if (t.state === 'draft') flags.push('setup_incomplete');
  const settledIn = Date.parse(t.createdAt) < db.now().getTime() - 14 * 86_400_000;
  if (!t.lastActivityAt && t.state !== 'draft' && settledIn) flags.push('no_recent_activity');
  return flags;
}

export function tenantSummary(db: MockDb, t: TenantRecord): TenantSummary {
  const sub = db.state.subscriptions.find((s) => s.tenantId === t.id);
  const pv = sub ? db.state.planVersions.find((v) => v.id === sub.planVersionId) : undefined;
  return {
    id: t.id,
    slug: t.slug,
    name: t.name,
    state: t.state,
    operationalMode: OPERATIONAL_MODE[t.state],
    countryCode: t.countryCode,
    region: t.region,
    planName: pv?.planName ?? null,
    expiresAt: t.expiresAt,
    studentCount: db.state.students.filter((s) => s.tenantId === t.id && s.status === 'active')
      .length,
    activeGuardianCount: db.state.guardians.filter(
      (g) => g.tenantId === t.id && g.state === 'active',
    ).length,
    lastActivityAt: t.lastActivityAt,
    flags: tenantFlags(db, t),
    createdAt: t.createdAt,
  };
}

export function subscriptionDto(db: MockDb, tenantId: string): TenantSubscription | null {
  const sub = db.state.subscriptions.find((s) => s.tenantId === tenantId);
  const pv = sub && db.state.planVersions.find((v) => v.id === sub.planVersionId);
  if (!sub || !pv) return null;
  return {
    id: sub.id,
    tenantId,
    planVersion: pv,
    startsAt: sub.startsAt,
    endsAt: sub.endsAt,
    billingReference: sub.billingReference,
    createdBy: actor(sub.createdBy),
    createdAt: sub.createdAt,
  };
}

export function tenantDetail(
  db: MockDb,
  t: TenantRecord,
  actionsAllowedForCaller = true,
): TenantDetail {
  return {
    ...tenantSummary(db, t),
    legalName: t.legalName,
    timezone: t.timezone,
    termStartDate: t.termStartDate,
    termEndDate: t.termEndDate,
    dataPlacement: t.dataPlacement,
    previousOperationalState: t.previousOperationalState,
    primaryContact: t.primaryContact,
    subscription: subscriptionDto(db, t.id),
    allowedActions: actionsAllowedForCaller ? allowedActions(t.state) : [],
    updatedAt: t.updatedAt,
  };
}

export const lifecycleEntry = (
  h: MockDb['state']['lifecycleHistory'][number],
): LifecycleHistoryEntry => ({ ...h, actor: actor(h.actor) });
export const overrideDto = (o: MockDb['state']['overrides'][number]): EntitlementOverride => ({
  ...o,
  createdBy: actor(o.createdBy),
  revokedBy: o.revokedBy ? actor(o.revokedBy) : null,
});
export const noteDto = (n: MockDb['state']['notes'][number]): SupportNote => ({
  ...n,
  author: actor(n.author),
});
export const planDto = (db: MockDb, p: SubscriptionPlan): SubscriptionPlan => ({
  ...p,
  versions: db.state.planVersions
    .filter((v) => v.planId === p.id)
    .sort((a, b) => a.version - b.version),
});

// ── school ────────────────────────────────────────────────
export function classDto(db: MockDb, c: MockDb['state']['classes'][number]): SchoolClass {
  const students = db.state.students.filter((s) => s.classId === c.id && s.status === 'active');
  return {
    id: c.id,
    name: c.name,
    gradeLevel: c.gradeLevel,
    sortOrder: c.sortOrder,
    studentCount: students.length,
    sections: db.state.sections
      .filter((s) => s.classId === c.id)
      .map((s) => ({
        id: s.id,
        classId: c.id,
        name: s.name,
        studentCount: students.filter((st) => st.sectionId === s.id).length,
      })),
  };
}

export function linkSummaries(db: MockDb, studentId: string): GuardianLinkSummary[] {
  return db.state.links
    .filter((l) => l.studentId === studentId && !l.removedAt)
    .map((l) => {
      const g = db.state.guardians.find((x) => x.id === l.guardianId)!;
      return {
        guardianId: g.id,
        fullName: g.fullName,
        maskedPhone: maskPhone(g.phone),
        kind: g.kind,
        state: effectiveGuardianState(db, g),
        relationship: l.relationship,
        isPrimary: l.isPrimary,
      };
    });
}

export function studentDto(db: MockDb, s: StudentRecord, includeRestricted: boolean): Student {
  const cls = db.state.classes.find((c) => c.id === s.classId);
  const sec = db.state.sections.find((x) => x.id === s.sectionId);
  const links = linkSummaries(db, s.id);
  return {
    id: s.id,
    externalRef: s.externalRef,
    firstName: s.firstName,
    lastName: s.lastName,
    preferredName: s.preferredName,
    classId: s.classId,
    className: cls?.name ?? '—',
    sectionId: s.sectionId,
    sectionName: sec?.name ?? null,
    status: s.status,
    dismissalEligibility: s.dismissalEligibility,
    notes: s.notes,
    restrictionsNote: includeRestricted ? s.restrictionsNote : null,
    primaryGuardian: links.find((l) => l.isPrimary) ?? null,
    guardianCount: links.length,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

export function deviceSummary(d: DeviceRecord): DeviceSummary {
  return {
    deviceId: d.id,
    platform: d.platform,
    model: d.model,
    state: d.state,
    activatedAt: d.activatedAt,
    lastSeenAt: d.lastSeenAt,
  };
}
export function transferDto(db: MockDb, t: TransferRecord): DeviceTransferRecord {
  const from = t.fromDeviceId ? db.state.devices.find((d) => d.id === t.fromDeviceId) : undefined;
  const to = db.state.devices.find((d) => d.id === t.toDeviceId);
  return {
    id: t.id,
    fromDevice: from ? deviceSummary(from) : null,
    toDevice: to
      ? deviceSummary(to)
      : {
          deviceId: t.toDeviceId,
          platform: 'android',
          model: 'Unknown',
          state: 'revoked',
          activatedAt: t.at,
          lastSeenAt: null,
        },
    at: t.at,
    viaOverride: t.viaOverride,
    suspicious: t.suspicious,
  };
}
export const TRANSFER_COOLDOWN_DAYS = 30;
export function nextTransferAllowedAt(db: MockDb, userId: string): string | null {
  const last = db.state.transfers
    .filter((t) => t.userId === userId)
    .sort((a, b) => b.at.localeCompare(a.at))[0];
  if (!last) return null;
  const until = new Date(Date.parse(last.at) + TRANSFER_COOLDOWN_DAYS * 86_400_000).toISOString();
  return until > db.nowIso() ? until : null;
}

export function validityDto(g: GuardianRecord): GuardianValidity | null {
  if (!g.validityMode) return null;
  return {
    mode: g.validityMode,
    validFrom: g.validFrom,
    validUntil: g.validUntil,
    durationDays: g.durationDays,
  };
}

export function guardianDto(db: MockDb, g: GuardianRecord, includePhone: boolean): Guardian {
  const students = db.state.links
    .filter((l) => l.guardianId === g.id && !l.removedAt)
    .map((l) => {
      const s = db.state.students.find((x) => x.id === l.studentId)!;
      return {
        studentId: s.id,
        fullName: `${s.firstName} ${s.lastName}`,
        className: db.state.classes.find((c) => c.id === s.classId)?.name ?? '—',
        relationship: l.relationship,
        isPrimary: l.isPrimary,
      };
    });
  const inviter = g.invitedByGuardianId
    ? db.state.guardians.find((x) => x.id === g.invitedByGuardianId)
    : undefined;
  const device = db.state.devices.find((d) => d.userId === g.userId && d.state === 'active');
  const transfers = db.state.transfers.filter((t) => t.userId === g.userId);
  return {
    id: g.id,
    userId: g.userId,
    kind: g.kind,
    fullName: g.fullName,
    maskedPhone: maskPhone(g.phone),
    phone: includePhone ? g.phone : null,
    state: effectiveGuardianState(db, g),
    stateReason: g.stateReason,
    stateChangedAt: g.stateChangedAt,
    students,
    validity: validityDto(g),
    invitedBy: inviter ? { guardianId: inviter.id, fullName: inviter.fullName } : null,
    activatedAt: g.activatedAt,
    lastActiveAt: g.lastActiveAt,
    activeDevice: device ? deviceSummary(device) : null,
    lastTransferAt: transfers.sort((a, b) => b.at.localeCompare(a.at))[0]?.at ?? null,
    nextTransferAllowedAt: nextTransferAllowedAt(db, g.userId),
    suspiciousTransfersLast30Days: transfers.filter((t) => t.suspicious && t.at > db.addDays(-30))
      .length,
    createdAt: g.createdAt,
  };
}

export function displayDto(db: MockDb, d: MockDb['state']['displays'][number]): Display {
  const online =
    !!d.lastHeartbeatAt && d.lastHeartbeatAt > db.addMinutes(-2) && d.state === 'active';
  return {
    id: d.id,
    name: d.name,
    zone: d.zone,
    state: d.state,
    online,
    pairedAt: d.pairedAt,
    pairedBy: actor(d.pairedBy),
    lastHeartbeatAt: d.lastHeartbeatAt,
    appVersion: d.appVersion,
  };
}

export function staffDto(db: MockDb, m: MockDb['state']['memberships'][number]): StaffMember {
  const u = db.user(m.userId)!;
  return {
    membershipId: m.id,
    userId: u.id,
    fullName: u.fullName,
    email: u.email ?? '',
    role: m.role,
    status: m.status,
    mfaEnabled: u.mfaEnabled,
    lastLoginAt: u.lastLoginAt,
  };
}

// ── dismissal ─────────────────────────────────────────────
export function queueItem(db: MockDb, p: PickupRecord, openOrder?: Map<string, number>): QueueItem {
  const s = db.state.students.find((x) => x.id === p.studentId)!;
  const g = db.state.guardians.find((x) => x.id === p.guardianId)!;
  const link = db.state.links.find((l) => l.guardianId === g.id && l.studentId === s.id);
  const t = db.tenant(p.tenantId)!;
  const stale =
    p.state === 'requested' &&
    p.requestedAt < db.addMinutes(-t.settings.dismissal.timeouts.requestedStaleMinutes);
  return {
    id: p.id,
    queueDate: p.queueDate,
    seq: p.seq,
    position: openOrder?.get(p.id) ?? null,
    state: p.state,
    student: {
      id: s.id,
      firstName: s.firstName,
      lastName: s.lastName,
      preferredName: s.preferredName,
      classId: s.classId,
      className: db.state.classes.find((c) => c.id === s.classId)?.name ?? '—',
      sectionName: db.state.sections.find((x) => x.id === s.sectionId)?.name ?? null,
    },
    guardian: {
      id: g.id,
      fullName: g.fullName,
      kind: g.kind,
      relationship: link?.relationship ?? 'other',
    },
    requestedAt: p.requestedAt,
    sentOutAt: p.sentOutAt,
    sentOutBy: p.sentOutBy ? actor(p.sentOutBy) : null,
    acknowledgedAt: p.acknowledgedAt,
    closedAt: p.closedAt,
    exceptionAt: p.exceptionAt,
    resolution: p.resolution,
    stale,
    reminderSentAt: p.reminderSentAt,
    note: p.note,
    verificationMethod: 'none',
  };
}

/** 1-based positions among open requests, oldest first. */
export function openPositions(
  db: MockDb,
  tenantId: string,
  queueDate: string,
): Map<string, number> {
  const open = db.state.pickups
    .filter(
      (p) =>
        p.tenantId === tenantId &&
        p.queueDate === queueDate &&
        (OPEN_STATES as readonly string[]).includes(p.state),
    )
    .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
  return new Map(open.map((p, i) => [p.id, i + 1]));
}

export function pickupDetail(db: MockDb, p: PickupRecord): PickupRequestDetail {
  const ackGuardian = p.acknowledgedByGuardianId
    ? db.state.guardians.find((g) => g.id === p.acknowledgedByGuardianId)
    : undefined;
  return {
    ...queueItem(db, p, openPositions(db, p.tenantId, p.queueDate)),
    history: p.history.map((h) => ({ ...h, actor: h.actor ? actor(h.actor) : null })),
    acknowledgment:
      ackGuardian && p.acknowledgedAt
        ? {
            guardianId: ackGuardian.id,
            guardianName: ackGuardian.fullName,
            at: p.acknowledgedAt,
            viaSentOut: p.viaSentOut ?? false,
          }
        : null,
  };
}

const STATUS_MESSAGE: Record<PickupRecord['state'], (name: string) => string> = {
  requested: (n) =>
    `Pickup requested. The school has been told. Confirm here once ${n} is with you.`,
  sent_out: (n) => `${n} has been sent out. Tap "Confirm picked up" once you have them.`,
  acknowledged: (n) => `You confirmed ${n} was picked up.`,
  cancelled: () => 'This request was cancelled.',
  exception: () =>
    'Not confirmed yet — the school will follow up. Confirm if you already have your child.',
  resolved: () => 'The school closed this request.',
};

export function guardianPickup(
  db: MockDb,
  p: PickupRecord,
  viewerUserId: string,
): GuardianPickupRequest {
  const s = db.state.students.find((x) => x.id === p.studentId)!;
  const g = db.state.guardians.find((x) => x.id === p.guardianId)!;
  const name = s.preferredName ?? s.firstName;
  return {
    id: p.id,
    tenantId: p.tenantId,
    tenantName: db.tenant(p.tenantId)?.name ?? '',
    studentId: s.id,
    studentFirstName: name,
    state: p.state,
    requestedAt: p.requestedAt,
    requestedBy: { guardianId: g.id, fullName: g.fullName, isMe: g.userId === viewerUserId },
    sentOutAt: p.sentOutAt,
    acknowledgedAt: p.acknowledgedAt,
    closedAt: p.closedAt,
    position: openPositions(db, p.tenantId, p.queueDate).get(p.id) ?? null,
    canAcknowledge: p.state === 'requested' || p.state === 'sent_out' || p.state === 'exception',
    canCancel: p.state === 'requested' && g.userId === viewerUserId,
    statusMessage: STATUS_MESSAGE[p.state](name),
  };
}

/** One formatting rule for both DisplayItem.classLabel and DisplayFeed.classLabels. */
function displayClassLabel(
  t: { settings: { display: { showClass: boolean; showSection: boolean } } },
  cls: string | null,
  sec: string | undefined,
): string | null {
  if (!t.settings.display.showClass || !cls) return null;
  return t.settings.display.showSection && sec ? `${cls} ${sec}` : cls;
}

/** Every board row in school order: class sortOrder, then section name. */
export function displayClassLabels(db: MockDb, tenantId: string): string[] {
  const t = db.tenant(tenantId)!;
  if (!t.settings.display.showClass) return [];
  return db.state.classes
    .filter((c) => c.tenantId === tenantId)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .flatMap((c) => {
      const secs = db.state.sections
        .filter((x) => x.classId === c.id)
        .map((x) => x.name)
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      return t.settings.display.showSection && secs.length
        ? secs.map((x) => displayClassLabel(t, c.name, x)!)
        : [c.name];
    });
}

export function displayItem(db: MockDb, p: PickupRecord): DisplayItem {
  const s = db.state.students.find((x) => x.id === p.studentId)!;
  const t = db.tenant(p.tenantId)!;
  const first = s.preferredName ?? s.firstName;
  const fmt = t.settings.display.nameFormat;
  const displayName =
    fmt === 'initials'
      ? `${first[0]}.${s.lastName[0]}.`
      : fmt === 'first_name'
        ? first
        : `${first} ${s.lastName[0]}.`;
  const cls = db.state.classes.find((c) => c.id === s.classId)?.name ?? null;
  const sec = db.state.sections.find((x) => x.id === s.sectionId)?.name;
  const classLabel = displayClassLabel(t, cls, sec);
  return {
    id: p.id,
    displayName,
    classLabel,
    state: p.state === 'sent_out' ? 'sent_out' : 'requested',
    requestedAt: p.requestedAt,
    seq: p.seq,
  };
}
export const isDisplayed = (p: PickupRecord) => p.state === 'requested' || p.state === 'sent_out';

// ── guardian self ─────────────────────────────────────────
export function guardianProfiles(db: MockDb, userId: string): GuardianProfileSummary[] {
  return db.state.guardians
    .filter((g) => g.userId === userId)
    .map((g) => {
      const t = db.tenant(g.tenantId)!;
      return {
        guardianId: g.id,
        tenantId: t.id,
        tenantName: t.name,
        kind: g.kind,
        state: effectiveGuardianState(db, g),
        operationalMode: OPERATIONAL_MODE[t.state],
        validUntil: g.validUntil,
      };
    });
}

export function guardianTenantContexts(db: MockDb, userId: string): GuardianTenantContext[] {
  return db.state.guardians
    .filter((g) => g.userId === userId)
    .map((g) => {
      const t = db.tenant(g.tenantId)!;
      return {
        tenantId: t.id,
        tenantName: t.name,
        operationalMode: OPERATIONAL_MODE[t.state],
        guardianId: g.id,
        guardianState: effectiveGuardianState(db, g),
        kind: g.kind,
        validity: validityDto(g),
        canPurchaseSeats:
          g.kind === 'primary' &&
          OPERATIONAL_MODE[t.state] === 'full' &&
          hasFeature(db, t.id, 'guardians.additional_purchase'),
        logoUrl: t.settings.branding.logoUrl ?? null,
        primaryColor: t.settings.branding.primaryColor ?? null,
      };
    });
}

export function childSummaries(db: MockDb, userId: string): ChildSummary[] {
  const out: ChildSummary[] = [];
  for (const g of db.state.guardians.filter((x) => x.userId === userId)) {
    if (g.state === 'pending_activation') continue;
    for (const l of db.state.links.filter((x) => x.guardianId === g.id && !x.removedAt)) {
      const s = db.state.students.find((x) => x.id === l.studentId)!;
      const t = db.tenant(s.tenantId)!;
      const active = db.state.pickups.find(
        (p) =>
          p.studentId === s.id &&
          p.queueDate === db.localDate(t.timezone) &&
          (OPEN_STATES as readonly string[]).includes(p.state),
      );
      out.push({
        studentId: s.id,
        tenantId: t.id,
        tenantName: t.name,
        firstName: s.firstName,
        lastName: s.lastName,
        preferredName: s.preferredName,
        className: db.state.classes.find((c) => c.id === s.classId)?.name ?? '—',
        sectionName: db.state.sections.find((x) => x.id === s.sectionId)?.name ?? null,
        relationship: l.relationship,
        myRole: g.kind,
        pickup: pickupEligibility(db, g, s),
        activeRequest: active ? guardianPickup(db, active, userId) : null,
      });
    }
  }
  return out;
}

export function seatDto(s: MockDb['state']['seats'][number]): LicenseSeat {
  return { ...s, reassignmentsLimit: 5 };
}

export function invitationStatus(
  i: MockDb['state']['invitations'][number] | undefined,
): InvitationStatus | null {
  return i
    ? {
        id: i.id,
        state: i.state,
        expiresAt: i.expiresAt,
        createdAt: i.createdAt,
        redeemedAt: i.redeemedAt,
      }
    : null;
}

export function additionalGuardian(db: MockDb, g: GuardianRecord): AdditionalGuardian {
  const inv = db.state.invitations
    .filter((i) => i.guardianId === g.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const lastPickup = db.state.pickups
    .filter((p) => p.acknowledgedByGuardianId === g.id)
    .sort((a, b) => (b.acknowledgedAt ?? '').localeCompare(a.acknowledgedAt ?? ''))[0];
  return {
    guardianId: g.id,
    tenantId: g.tenantId,
    fullName: g.fullName,
    maskedPhone: maskPhone(g.phone),
    relationship: db.state.links.find((l) => l.guardianId === g.id)?.relationship ?? 'other',
    state: effectiveGuardianState(db, g),
    students: db.state.links
      .filter((l) => l.guardianId === g.id && !l.removedAt)
      .map((l) => ({
        studentId: l.studentId,
        firstName: db.state.students.find((s) => s.id === l.studentId)?.firstName ?? '',
      })),
    validity: validityDto(g) ?? {
      mode: 'permanent',
      validFrom: null,
      validUntil: null,
      durationDays: null,
    },
    seatId: g.seatId ?? '',
    invitation: invitationStatus(inv),
    activatedAt: g.activatedAt,
    lastPickupAt: lastPickup?.acknowledgedAt ?? null,
  };
}

export function meDto(db: MockDb, session: SessionRecord): Me {
  const u = db.user(session.userId)!;
  const memberships: TenantMembershipSummary[] = db.state.memberships
    .filter((m) => m.userId === u.id && m.status === 'active')
    .map((m) => {
      const t = db.tenant(m.tenantId)!;
      return {
        membershipId: m.id,
        tenantId: t.id,
        tenantName: t.name,
        tenantSlug: t.slug,
        role: m.role,
        permissions: permissionsForSchoolRole(m.role),
        tenantState: t.state,
        operationalMode: OPERATIONAL_MODE[t.state],
        timezone: t.timezone,
      };
    });
  if (session.kind === 'support' && session.supportTenantId) {
    const t = db.tenant(session.supportTenantId)!;
    memberships.splice(0, memberships.length, {
      membershipId: session.id,
      tenantId: t.id,
      tenantName: t.name,
      tenantSlug: t.slug,
      role: 'school.reporting',
      permissions: permissionsForSchoolRole('school.admin').filter((p) => p.endsWith('.read')),
      tenantState: t.state,
      operationalMode: OPERATIONAL_MODE[t.state],
      timezone: t.timezone,
    });
  }
  const scope: SessionScope = session.scope;
  return {
    userId: u.id,
    fullName: u.fullName,
    email: u.email,
    maskedPhone: u.phone ? maskPhone(u.phone) : null,
    locale: u.locale,
    session: {
      id: session.id,
      kind: session.kind,
      scope,
      deviceId: session.deviceId,
      supportTenantId: session.supportTenantId,
    },
    platformRoles: session.kind === 'platform' ? u.platformRoles : [],
    platformPermissions:
      session.kind === 'platform' ? permissionsForPlatformRoles(u.platformRoles) : [],
    memberships: session.kind === 'guardian' ? [] : memberships,
    guardianProfiles: session.kind === 'guardian' ? guardianProfiles(db, u.id) : [],
    termsAcceptanceRequired: session.kind === 'guardian' && u.termsVersion !== CURRENT_TERMS,
    currentTermsVersion: CURRENT_TERMS,
  };
}
export const CURRENT_TERMS = '2026-08';

export function cooldownOverrideDto(
  db: MockDb,
  o: MockDb['state']['cooldownOverrides'][number],
): CooldownOverride {
  const used = db.state.cooldownOverrides.filter(
    (x) => x.userId === o.userId && x.grantedByKind === 'school' && x.tenantId === o.tenantId,
  ).length;
  return {
    id: o.id,
    userId: o.userId,
    reasonCode: o.reasonCode,
    note: o.note,
    grantedBy: actor(o.grantedBy),
    createdAt: o.createdAt,
    expiresAt: o.expiresAt,
    usedAt: o.usedAt,
    remainingSchoolOverridesThisTerm: o.grantedByKind === 'school' ? Math.max(0, 2 - used) : null,
  };
}

export const auditDto = (db: MockDb, a: MockDb['state']['audit'][number]): AuditLogEntry => ({
  ...a,
  tenantName: a.tenantId ? (db.tenant(a.tenantId)?.name ?? null) : null,
  actor: actor(a.actor),
  onBehalfOf: a.onBehalfOf ? actor(a.onBehalfOf) : null,
  requestId: null,
  deviceId: null,
});

export const notificationDto = (n: MockDb['state']['notifications'][number]): Notification => ({
  id: n.id,
  type: n.type,
  tenantId: n.tenantId,
  title: n.title,
  body: n.body,
  data: n.data,
  createdAt: n.createdAt,
  readAt: n.readAt,
});
