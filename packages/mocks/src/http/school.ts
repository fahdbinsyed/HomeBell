import type {
  CooldownOverrideRequest,
  CreateClassRequest,
  CreateGuardianRequest,
  CreateSectionRequest,
  CreateStaffInvitationRequest,
  CreateStudentRequest,
  DashboardOverview,
  GrantSeatsRequest,
  GuardianLinkInput,
  GuardianStateChangeRequest,
  ImportJob,
  ImportRow,
  NoteRequest,
  PairDisplayRequest,
  ResolveExceptionRequest,
  SentOutBulkRequest,
  StaffCancelRequest,
  TenantSettings,
  TenantSubscriptionView,
  UpdateClassRequest,
  UpdateDisplayRequest,
  UpdateGuardianRequest,
  UpdateSectionRequest,
  UpdateStaffMemberRequest,
  UpdateStudentRequest,
} from '@homebell/contracts';
import { http } from 'msw';
import type { GuardianRecord, PickupRecord, StudentRecord } from '../db/types';
import { sendOut, transition } from '../dismissal';
import {
  actor,
  auditDto,
  classDto,
  cooldownOverrideDto,
  displayDto,
  guardianDto,
  linkSummaries,
  openPositions,
  pickupDetail,
  queueItem,
  seatDto,
  staffDto,
  studentDto,
  transferDto,
} from '../mappers';
import { effectiveGuardianState, OPEN_STATES } from '../rules/eligibility';
import { hasFeature, limitOf, resolveEntitlements } from '../rules/entitlements';
import { OPERATIONAL_MODE } from '../rules/lifecycle';
import { permissionsForSchoolRole } from '../rules/permissions';
import { revokeSession } from './auth';
import { csvResponse, toCsv } from './csv';
import {
  actorOf,
  body,
  fail,
  handle,
  idempotent,
  inRange,
  invalid,
  json,
  matches,
  noContent,
  page,
  q,
  requireStaff,
  type MockContext,
} from './context';

const T = '*/v1/t/:tenantId';

export function schoolHandlers(ctx: MockContext) {
  const db = ctx.db;
  const tid = (params: Record<string, unknown>) => params.tenantId as string;
  const student = (tenantId: string, id: string): StudentRecord =>
    db.state.students.find((s) => s.id === id && s.tenantId === tenantId) ?? fail('NOT_FOUND');
  const guardian = (tenantId: string, id: string): GuardianRecord =>
    db.state.guardians.find((g) => g.id === id && g.tenantId === tenantId) ?? fail('NOT_FOUND');
  const pickup = (tenantId: string, id: string): PickupRecord =>
    db.state.pickups.find((p) => p.id === id && p.tenantId === tenantId) ?? fail('NOT_FOUND');
  const canSeeRestricted = (s: ReturnType<typeof requireStaff>, tenantId: string) => {
    const m = db.state.memberships.find((x) => x.userId === s.userId && x.tenantId === tenantId);
    return !!m && permissionsForSchoolRole(m.role).includes('school.students.write');
  };

  /** Find or create the guardian profile for a phone in this tenant (primary provisioning, ADR-0007). */
  const ensurePrimaryGuardian = (
    tenantId: string,
    fullName: string,
    phone: string,
  ): GuardianRecord => {
    const existing = db.state.guardians.find((g) => g.tenantId === tenantId && g.phone === phone);
    if (existing) return existing;
    let user = db.state.users.find((u) => u.phone === phone);
    if (!user) {
      user = {
        id: db.id(),
        fullName,
        email: null,
        phone,
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
    const activeElsewhere = db.state.guardians.some(
      (g) => g.userId === user.id && g.state === 'active',
    );
    const g: GuardianRecord = {
      id: db.id(),
      tenantId,
      userId: user.id,
      kind: 'primary',
      fullName,
      phone,
      state: activeElsewhere ? 'active' : 'pending_activation',
      stateReason: null,
      stateChangedAt: null,
      invitedByGuardianId: null,
      seatId: null,
      validityMode: null,
      validFrom: activeElsewhere ? db.nowIso() : null,
      validUntil: null,
      durationDays: null,
      activatedAt: activeElsewhere ? db.nowIso() : null,
      lastActiveAt: null,
      createdAt: db.nowIso(),
    };
    db.state.guardians.push(g);
    return g;
  };

  const setGuardianState = (
    tenantId: string,
    id: string,
    to: GuardianRecord['state'],
    allowed: GuardianRecord['state'][],
    b: GuardianStateChangeRequest,
    s: ReturnType<typeof requireStaff>,
    action:
      'guardian.blocked' | 'guardian.unblocked' | 'guardian.deactivated' | 'guardian.reactivated',
  ) => {
    const g = guardian(tenantId, id);
    const current = effectiveGuardianState(db, g);
    if (!allowed.includes(current)) return fail('CONFLICT', `Guardian is ${current}`);
    if (!b.reason || b.reason.trim().length < 3) return invalid('reason', 'A reason is required');
    g.state = to === 'active' && !g.activatedAt ? 'pending_activation' : to;
    g.stateReason = to === 'active' ? null : b.reason;
    g.stateChangedAt = db.nowIso();
    if (to === 'deactivated')
      for (const sess of db.state.sessions.filter(
        (x) =>
          x.userId === g.userId &&
          x.kind === 'guardian' &&
          !x.revokedAt &&
          !db.state.guardians.some(
            (o) => o.userId === g.userId && o.id !== g.id && o.state === 'active',
          ),
      ))
        revokeSession(db, sess, 'account_deactivated');
    db.audit({
      tenantId,
      action,
      outcome: 'success',
      actor: actorOf(ctx, s),
      targetType: 'guardian',
      targetId: g.id,
      targetLabel: g.fullName,
      reasonCode: b.reason,
      data: { note: b.note ?? null },
    });
    db.emit(
      {
        eventId: db.id(),
        type: 'guardian.access.changed',
        version: 1,
        tenantId,
        occurredAt: db.nowIso(),
        data: {
          tenantId,
          guardianId: g.id,
          state: effectiveGuardianState(db, g),
          reasonCode: b.reason,
        },
      },
      { kind: 'user', userId: g.userId },
    );
    db.touch();
    return json(guardianDto(db, g, true));
  };

  const today = (tenantId: string, url: URL) => q(url, 'queueDate') ?? db.today(tenantId);

  return [
    // ── overview, entitlements, subscription, settings ────────
    http.get(
      `${T}/overview`,
      handle(({ request, params }) => {
        const tenantId = tid(params);
        requireStaff(ctx, request, tenantId, 'school.queue.read');
        const queueDate = today(tenantId, new URL(request.url));
        const p = db.state.pickups.filter(
          (x) => x.tenantId === tenantId && x.queueDate === queueDate,
        );
        const count = (s: PickupRecord['state']) => p.filter((x) => x.state === s).length;
        const acks = p
          .filter((x) => x.acknowledgedAt)
          .map((x) => (Date.parse(x.acknowledgedAt!) - Date.parse(x.requestedAt)) / 60_000)
          .sort((a, b) => a - b);
        const st = db.state.students.filter((x) => x.tenantId === tenantId);
        const gs = db.state.guardians
          .filter((x) => x.tenantId === tenantId)
          .map((g) => ({ g, state: effectiveGuardianState(db, g) }));
        const ds = db.state.displays
          .filter((d) => d.tenantId === tenantId && d.state === 'active')
          .map((d) => displayDto(db, d));
        const transfers = db.state.transfers.filter(
          (x) => x.at > db.addDays(-7) && gs.some(({ g }) => g.userId === x.userId),
        );
        const o: DashboardOverview = {
          queueDate,
          requests: {
            total: p.length,
            requested: count('requested'),
            sentOut: count('sent_out'),
            acknowledged: count('acknowledged'),
            cancelled: count('cancelled'),
            exception: count('exception'),
            resolved: count('resolved'),
          },
          unresolved:
            count('exception') + p.filter((x) => x.state === 'sent_out' && x.reminderSentAt).length,
          medianMinutesToAcknowledge: acks.length
            ? Math.round(acks[Math.floor(acks.length / 2)]! * 10) / 10
            : null,
          students: {
            active: st.filter((x) => x.status === 'active').length,
            inactive: st.filter((x) => x.status === 'inactive').length,
            onHold: st.filter((x) => x.status === 'active' && x.dismissalEligibility === 'hold')
              .length,
          },
          guardians: {
            active: gs.filter((x) => x.state === 'active').length,
            pendingActivation: gs.filter((x) => x.state === 'pending_activation').length,
            blocked: gs.filter((x) => x.state === 'blocked').length,
            deactivated: gs.filter((x) => x.state === 'deactivated').length,
            additionalActive: gs.filter((x) => x.state === 'active' && x.g.kind === 'additional')
              .length,
          },
          displays: { online: ds.filter((d) => d.online).length, total: ds.length },
          deviceTransfersLast7Days: transfers.length,
          suspiciousTransfersLast7Days: transfers.filter((x) => x.suspicious).length,
          generatedAt: db.nowIso(),
        };
        return json(o);
      }),
    ),
    http.get(
      `${T}/entitlements`,
      handle(({ request, params }) => {
        requireStaff(ctx, request, tid(params), 'school.queue.read');
        return json(resolveEntitlements(db, tid(params)));
      }),
    ),
    http.get(
      `${T}/subscription`,
      handle(({ request, params }) => {
        const tenantId = tid(params);
        requireStaff(ctx, request, tenantId, 'school.subscription.read');
        const t = db.tenant(tenantId)!;
        const sub = db.state.subscriptions.find((x) => x.tenantId === tenantId);
        const pv = sub && db.state.planVersions.find((v) => v.id === sub.planVersionId);
        const v: TenantSubscriptionView = {
          state: t.state,
          operationalMode: OPERATIONAL_MODE[t.state],
          planName: pv?.planName ?? null,
          expiresAt: t.expiresAt,
          daysUntilExpiry: t.expiresAt
            ? Math.ceil((Date.parse(t.expiresAt) - db.now().getTime()) / 86_400_000)
            : null,
          termStartDate: t.termStartDate,
          termEndDate: t.termEndDate,
          limits: resolveEntitlements(db, tenantId).limits,
        };
        return json(v);
      }),
    ),
    http.get(
      `${T}/settings`,
      handle(({ request, params }) => {
        requireStaff(ctx, request, tid(params), 'school.settings.read');
        const t = db.tenant(tid(params))!;
        return json(t.settings, 200, { ETag: `"${t.updatedAt}"` });
      }),
    ),
    http.put(
      `${T}/settings`,
      handle(async ({ request, params }) => {
        const tenantId = tid(params);
        const s = requireStaff(ctx, request, tenantId, 'school.settings.write', true);
        const t = db.tenant(tenantId)!;
        const ifMatch = request.headers.get('If-Match');
        if (ifMatch && ifMatch !== `"${t.updatedAt}"`) return fail('PRECONDITION_FAILED');
        const b = await body<TenantSettings>(request);
        for (const w of b.dismissal.windows)
          if (w.closesAt <= w.opensAt)
            return invalid('dismissal.windows', 'Each window must close after it opens');
        if (b.locationRule.enabled && !hasFeature(db, tenantId, 'dismissal.location_rule'))
          return fail('FEATURE_NOT_ENTITLED', undefined, { feature: 'dismissal.location_rule' });
        if (b.locationRule.enabled && !b.locationRule.center)
          return invalid(
            'locationRule.center',
            'Set the school location to enable the location rule',
          );
        t.settings = b;
        t.updatedAt = db.nowIso();
        db.audit({
          tenantId,
          action: 'settings.updated',
          outcome: 'success',
          actor: actorOf(ctx, s),
        });
        db.touch();
        return json(t.settings, 200, { ETag: `"${t.updatedAt}"` });
      }),
    ),

    // ── classes & sections ───────────────────────────────────
    http.get(
      `${T}/classes`,
      handle(({ request, params }) => {
        requireStaff(ctx, request, tid(params), 'school.students.read');
        return json({
          items: db.state.classes
            .filter((c) => c.tenantId === tid(params))
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((c) => classDto(db, c)),
        });
      }),
    ),
    http.post(
      `${T}/classes`,
      handle(async ({ request, params }) => {
        const tenantId = tid(params);
        requireStaff(ctx, request, tenantId, 'school.students.write', true);
        const b = await body<CreateClassRequest>(request);
        if (!b.name?.trim()) return invalid('name', 'Name is required');
        if (
          db.state.classes.some(
            (c) => c.tenantId === tenantId && c.name.toLowerCase() === b.name.trim().toLowerCase(),
          )
        )
          return fail('CONFLICT', 'A class with this name exists');
        const c = {
          id: db.id(),
          tenantId,
          name: b.name.trim(),
          gradeLevel: b.gradeLevel ?? null,
          sortOrder: b.sortOrder ?? 0,
        };
        db.state.classes.push(c);
        db.touch();
        return json(classDto(db, c), 201);
      }),
    ),
    http.patch(
      `${T}/classes/:classId`,
      handle(async ({ request, params }) => {
        requireStaff(ctx, request, tid(params), 'school.students.write', true);
        const c =
          db.state.classes.find((x) => x.id === params.classId && x.tenantId === tid(params)) ??
          fail('NOT_FOUND');
        Object.assign(c, await body<UpdateClassRequest>(request));
        db.touch();
        return json(classDto(db, c));
      }),
    ),
    http.delete(
      `${T}/classes/:classId`,
      handle(({ request, params }) => {
        requireStaff(ctx, request, tid(params), 'school.students.write', true);
        const c =
          db.state.classes.find((x) => x.id === params.classId && x.tenantId === tid(params)) ??
          fail('NOT_FOUND');
        if (db.state.students.some((s) => s.classId === c.id)) return fail('CLASS_NOT_EMPTY');
        db.state.classes = db.state.classes.filter((x) => x.id !== c.id);
        db.state.sections = db.state.sections.filter((x) => x.classId !== c.id);
        db.touch();
        return noContent();
      }),
    ),
    http.post(
      `${T}/classes/:classId/sections`,
      handle(async ({ request, params }) => {
        requireStaff(ctx, request, tid(params), 'school.students.write', true);
        const c =
          db.state.classes.find((x) => x.id === params.classId && x.tenantId === tid(params)) ??
          fail('NOT_FOUND');
        const b = await body<CreateSectionRequest>(request);
        if (!b.name?.trim()) return invalid('name', 'Name is required');
        const sec = { id: db.id(), tenantId: c.tenantId, classId: c.id, name: b.name.trim() };
        db.state.sections.push(sec);
        db.touch();
        return json({ ...sec, studentCount: 0 }, 201);
      }),
    ),
    http.patch(
      `${T}/sections/:sectionId`,
      handle(async ({ request, params }) => {
        requireStaff(ctx, request, tid(params), 'school.students.write', true);
        const sec =
          db.state.sections.find((x) => x.id === params.sectionId && x.tenantId === tid(params)) ??
          fail('NOT_FOUND');
        sec.name = (await body<UpdateSectionRequest>(request)).name;
        db.touch();
        return json({
          id: sec.id,
          classId: sec.classId,
          name: sec.name,
          studentCount: db.state.students.filter((s) => s.sectionId === sec.id).length,
        });
      }),
    ),
    http.delete(
      `${T}/sections/:sectionId`,
      handle(({ request, params }) => {
        requireStaff(ctx, request, tid(params), 'school.students.write', true);
        const sec =
          db.state.sections.find((x) => x.id === params.sectionId && x.tenantId === tid(params)) ??
          fail('NOT_FOUND');
        if (db.state.students.some((s) => s.sectionId === sec.id)) return fail('CLASS_NOT_EMPTY');
        db.state.sections = db.state.sections.filter((x) => x.id !== sec.id);
        db.touch();
        return noContent();
      }),
    ),

    // ── students ─────────────────────────────────────────────
    http.get(
      `${T}/students`,
      handle(({ request, params }) => {
        const tenantId = tid(params);
        const s = requireStaff(ctx, request, tenantId, 'school.students.read');
        const url = new URL(request.url);
        const rows = db.state.students
          .filter(
            (x) =>
              x.tenantId === tenantId &&
              matches(
                q(url, 'q'),
                x.firstName,
                x.lastName,
                `${x.firstName} ${x.lastName}`,
                x.externalRef,
              ) &&
              (!q(url, 'classId') || x.classId === q(url, 'classId')) &&
              (!q(url, 'sectionId') || x.sectionId === q(url, 'sectionId')) &&
              (!q(url, 'status') || x.status === q(url, 'status')) &&
              (!q(url, 'eligibility') || x.dismissalEligibility === q(url, 'eligibility')),
          )
          .sort(
            (a, b) =>
              a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName),
          )
          .map((x) => studentDto(db, x, canSeeRestricted(s, tenantId)));
        return json(page(rows, url));
      }),
    ),
    http.post(
      `${T}/students`,
      handle(async ({ request, params }) => {
        const tenantId = tid(params);
        const s = requireStaff(ctx, request, tenantId, 'school.students.write', true);
        const b = await body<CreateStudentRequest>(request);
        if (!b.firstName?.trim()) return invalid('firstName', 'First name is required');
        if (!b.lastName?.trim()) return invalid('lastName', 'Last name is required');
        if (!db.state.classes.some((c) => c.id === b.classId && c.tenantId === tenantId))
          return invalid('classId', 'Choose a class');
        if (!/^\+[1-9]\d{6,14}$/.test(b.primaryGuardian.phone))
          return invalid(
            'primaryGuardian.phone',
            'Phone must be in international format, e.g. +15551234567',
          );
        const limit = limitOf(db, tenantId, 'students.max');
        if (limit?.value !== null && limit?.value !== undefined && (limit.used ?? 0) >= limit.value)
          return fail('LIMIT_EXCEEDED', undefined, {
            limit: 'students.max',
            value: limit.value,
            used: limit.used,
          });
        if (
          b.externalRef &&
          db.state.students.some((x) => x.tenantId === tenantId && x.externalRef === b.externalRef)
        )
          return fail('CONFLICT', 'Student number already in use');
        const st: StudentRecord = {
          id: db.id(),
          tenantId,
          externalRef: b.externalRef ?? null,
          firstName: b.firstName.trim(),
          lastName: b.lastName.trim(),
          preferredName: b.preferredName ?? null,
          classId: b.classId,
          sectionId: b.sectionId ?? null,
          status: 'active',
          dismissalEligibility: b.dismissalEligibility ?? 'eligible',
          notes: b.notes ?? null,
          restrictionsNote: b.restrictionsNote ?? null,
          createdAt: db.nowIso(),
          updatedAt: db.nowIso(),
        };
        db.state.students.push(st);
        const g = ensurePrimaryGuardian(
          tenantId,
          b.primaryGuardian.fullName,
          b.primaryGuardian.phone,
        );
        db.state.links.push({
          id: db.id(),
          tenantId,
          guardianId: g.id,
          studentId: st.id,
          relationship: b.primaryGuardian.relationship,
          isPrimary: true,
          removedAt: null,
        });
        db.audit({
          tenantId,
          action: 'student.created',
          outcome: 'success',
          actor: actorOf(ctx, s),
          targetType: 'student',
          targetId: st.id,
          targetLabel: `${st.firstName} ${st.lastName}`,
        });
        db.touch();
        return json(studentDto(db, st, true), 201);
      }),
    ),
    http.get(
      `${T}/students/:studentId`,
      handle(({ request, params }) => {
        const tenantId = tid(params);
        const s = requireStaff(ctx, request, tenantId, 'school.students.read');
        const st = student(tenantId, params.studentId as string);
        return json(studentDto(db, st, canSeeRestricted(s, tenantId)), 200, {
          ETag: `"${st.updatedAt}"`,
        });
      }),
    ),
    http.patch(
      `${T}/students/:studentId`,
      handle(async ({ request, params }) => {
        const tenantId = tid(params);
        const s = requireStaff(ctx, request, tenantId, 'school.students.write', true);
        const st = student(tenantId, params.studentId as string);
        const ifMatch = request.headers.get('If-Match');
        if (ifMatch && ifMatch !== `"${st.updatedAt}"`) return fail('PRECONDITION_FAILED');
        const b = await body<UpdateStudentRequest>(request);
        Object.assign(st, Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined)));
        st.updatedAt = db.nowIso();
        db.audit({
          tenantId,
          action: 'student.updated',
          outcome: 'success',
          actor: actorOf(ctx, s),
          targetType: 'student',
          targetId: st.id,
          targetLabel: `${st.firstName} ${st.lastName}`,
        });
        db.touch();
        return json(studentDto(db, st, true), 200, { ETag: `"${st.updatedAt}"` });
      }),
    ),
    ...(['deactivate', 'reactivate'] as const).map((verb) =>
      http.post(
        `${T}/students/:studentId/${verb}`,
        handle(async ({ request, params }) => {
          const tenantId = tid(params);
          const s = requireStaff(ctx, request, tenantId, 'school.students.write', true);
          const st = student(tenantId, params.studentId as string);
          const b = await body<NoteRequest>(request).catch(() => ({}) as NoteRequest);
          if (verb === 'reactivate') {
            const limit = limitOf(db, tenantId, 'students.max');
            if (limit?.value != null && (limit.used ?? 0) >= limit.value)
              return fail('LIMIT_EXCEEDED', undefined, {
                limit: 'students.max',
                value: limit.value,
              });
          }
          st.status = verb === 'deactivate' ? 'inactive' : 'active';
          st.updatedAt = db.nowIso();
          if (verb === 'deactivate')
            db.audit({
              tenantId,
              action: 'student.deactivated',
              outcome: 'success',
              actor: actorOf(ctx, s),
              targetType: 'student',
              targetId: st.id,
              targetLabel: `${st.firstName} ${st.lastName}`,
              data: { note: b.note ?? null },
            });
          db.touch();
          return json(studentDto(db, st, true));
        }),
      ),
    ),
    http.get(
      `${T}/students/:studentId/guardians`,
      handle(({ request, params }) => {
        requireStaff(ctx, request, tid(params), 'school.students.read');
        student(tid(params), params.studentId as string);
        return json({ items: linkSummaries(db, params.studentId as string) });
      }),
    ),

    // ── imports ──────────────────────────────────────────────
    http.get(
      `${T}/imports/template`,
      handle(({ request, params }) => {
        requireStaff(ctx, request, tid(params), 'school.imports.write');
        return csvResponse(
          'student_external_ref,student_first_name,student_last_name,class,section,guardian_full_name,guardian_phone,guardian_relationship\nS2001,Amina,Okafor,Grade 1,A,Ngozi Okafor,+15551230001,mother\n',
          'homebell-students-template.csv',
        );
      }),
    ),
    http.post(
      `${T}/imports`,
      handle(async ({ request, params }) => {
        const tenantId = tid(params);
        const s = requireStaff(ctx, request, tenantId, 'school.imports.write', true);
        if (!hasFeature(db, tenantId, 'imports.csv'))
          return fail('FEATURE_NOT_ENTITLED', undefined, { feature: 'imports.csv' });
        // Typed structurally: React Native's FormData typings lack `get` (this file also compiles in the app).
        const form = (await request.formData()) as unknown as { get(name: string): unknown };
        const file = form.get('file') as
          { size: number; name?: string; text(): Promise<string> } | string | null;
        if (!file || typeof file === 'string')
          return fail('IMPORT_INVALID_FILE', 'Attach a CSV file');
        if (file.size > 5 * 1024 * 1024)
          return fail('PAYLOAD_TOO_LARGE', undefined, { maxBytes: 5 * 1024 * 1024 });
        const text: string = await file.text();
        const lines: string[] = text.split(/\r?\n/).filter((l: string) => l.trim());
        const header: string[] =
          lines[0]?.split(',').map((h: string) => h.trim().toLowerCase()) ?? [];
        const required = [
          'student_first_name',
          'student_last_name',
          'class',
          'guardian_full_name',
          'guardian_phone',
          'guardian_relationship',
        ];
        if (!required.every((r) => header.includes(r)))
          return fail(
            'IMPORT_INVALID_FILE',
            `Missing columns: ${required.filter((r) => !header.includes(r)).join(', ')}`,
          );
        const classes = db.state.classes.filter((c) => c.tenantId === tenantId);
        const rels = [
          'mother',
          'father',
          'parent',
          'step_parent',
          'legal_guardian',
          'grandparent',
          'sibling',
          'aunt_uncle',
          'spouse',
          'driver',
          'nanny',
          'family_friend',
          'other',
        ];
        let studentsToCreate = 0,
          studentsToUpdate = 0,
          guardiansToCreate = 0,
          guardiansToLink = 0;
        const rows: ImportRow[] = lines.slice(1).map((line: string, i: number) => {
          const cells: string[] = line.split(',').map((c: string) => c.trim());
          const data: Record<string, string | null> = Object.fromEntries(
            header.map((h: string, k: number) => [h, cells[k] ?? null]),
          );
          const messages: ImportRow['messages'] = [];
          for (const r of required)
            if (!data[r])
              messages.push({ field: r, code: 'required', message: `${r} is required` });
          if (data.guardian_phone && !/^\+[1-9]\d{6,14}$/.test(data.guardian_phone))
            messages.push({
              field: 'guardian_phone',
              code: 'invalid_format',
              message: 'Use international format, e.g. +15551234567',
            });
          if (
            data.class &&
            !classes.some((c) => c.name.toLowerCase() === data.class!.toLowerCase())
          )
            messages.push({
              field: 'class',
              code: 'unknown_class',
              message: `Class "${data.class}" does not exist`,
            });
          if (
            data.guardian_relationship &&
            !rels.includes(data.guardian_relationship.toLowerCase())
          )
            messages.push({
              field: 'guardian_relationship',
              code: 'invalid_value',
              message: `Use one of: ${rels.join(', ')}`,
            });
          const existing = data.student_external_ref
            ? db.state.students.find(
                (x) => x.tenantId === tenantId && x.externalRef === data.student_external_ref,
              )
            : undefined;
          const warnings: ImportRow['messages'] = existing
            ? [
                {
                  field: 'student_external_ref',
                  code: 'will_update',
                  message: 'Existing student will be updated',
                },
              ]
            : [];
          if (!messages.length) {
            if (existing) studentsToUpdate++;
            else studentsToCreate++;
            if (
              db.state.guardians.some(
                (g) => g.tenantId === tenantId && g.phone === data.guardian_phone,
              )
            )
              guardiansToLink++;
            else guardiansToCreate++;
          }
          return {
            rowNumber: i + 2,
            status: messages.length ? 'error' : warnings.length ? 'warning' : 'valid',
            data,
            messages: [...messages, ...warnings],
          };
        });
        const max = limitOf(db, tenantId, 'imports.max_rows')?.value;
        if (max != null && rows.length > max)
          return fail('LIMIT_EXCEEDED', undefined, { limit: 'imports.max_rows', value: max });
        const job: ImportJob = {
          id: db.id(),
          type: 'students_with_guardians',
          status: 'validated',
          fileName: file.name ?? 'import.csv',
          createdAt: db.nowIso(),
          createdBy: actor(actorOf(ctx, s)),
          committedAt: null,
          failureReason: null,
          summary: {
            totalRows: rows.length,
            validRows: rows.filter((r) => r.status === 'valid').length,
            warningRows: rows.filter((r) => r.status === 'warning').length,
            errorRows: rows.filter((r) => r.status === 'error').length,
            studentsToCreate,
            studentsToUpdate,
            guardiansToCreate,
            guardiansToLink,
          },
        };
        db.state.imports.push({ job, tenantId, rows });
        db.touch();
        return json(job, 202);
      }),
    ),
    http.get(
      `${T}/imports/:importId`,
      handle(({ request, params }) => {
        requireStaff(ctx, request, tid(params), 'school.imports.write');
        const rec =
          db.state.imports.find(
            (x) => x.job.id === params.importId && x.tenantId === tid(params),
          ) ?? fail('NOT_FOUND');
        return json(rec.job);
      }),
    ),
    http.get(
      `${T}/imports/:importId/rows`,
      handle(({ request, params }) => {
        requireStaff(ctx, request, tid(params), 'school.imports.write');
        const rec =
          db.state.imports.find(
            (x) => x.job.id === params.importId && x.tenantId === tid(params),
          ) ?? fail('NOT_FOUND');
        const url = new URL(request.url);
        return json(
          page(
            rec.rows.filter((r) => !q(url, 'status') || r.status === q(url, 'status')),
            url,
            50,
          ),
        );
      }),
    ),
    http.post(
      `${T}/imports/:importId/commit`,
      handle(({ request, params }) => {
        const tenantId = tid(params);
        const s = requireStaff(ctx, request, tenantId, 'school.imports.write', true);
        return idempotent(ctx, request, `t:${tenantId}`, (raw) => {
          const rec =
            db.state.imports.find((x) => x.job.id === params.importId && x.tenantId === tenantId) ??
            fail('NOT_FOUND');
          if (rec.job.status === 'completed') return fail('IMPORT_ALREADY_COMMITTED');
          if (rec.job.status !== 'validated') return fail('IMPORT_NOT_VALIDATED');
          const skip = raw ? (JSON.parse(raw) as { skipErrorRows?: boolean }).skipErrorRows : false;
          if (rec.job.summary.errorRows > 0 && !skip)
            return fail('IMPORT_HAS_ERRORS', `${rec.job.summary.errorRows} rows have errors`);
          for (const r of rec.rows.filter((x) => x.status !== 'error')) {
            const d = r.data as Record<string, string>;
            const cls = db.state.classes.find(
              (c) => c.tenantId === tenantId && c.name.toLowerCase() === d.class!.toLowerCase(),
            )!;
            const sec = d.section
              ? db.state.sections.find(
                  (x) => x.classId === cls.id && x.name.toLowerCase() === d.section!.toLowerCase(),
                )
              : undefined;
            let st = d.student_external_ref
              ? db.state.students.find(
                  (x) => x.tenantId === tenantId && x.externalRef === d.student_external_ref,
                )
              : undefined;
            if (st)
              Object.assign(st, {
                firstName: d.student_first_name,
                lastName: d.student_last_name,
                classId: cls.id,
                sectionId: sec?.id ?? null,
                updatedAt: db.nowIso(),
              });
            else {
              st = {
                id: db.id(),
                tenantId,
                externalRef: d.student_external_ref || null,
                firstName: d.student_first_name!,
                lastName: d.student_last_name!,
                preferredName: null,
                classId: cls.id,
                sectionId: sec?.id ?? null,
                status: 'active',
                dismissalEligibility: 'eligible',
                notes: null,
                restrictionsNote: null,
                createdAt: db.nowIso(),
                updatedAt: db.nowIso(),
              };
              db.state.students.push(st);
            }
            const g = ensurePrimaryGuardian(tenantId, d.guardian_full_name!, d.guardian_phone!);
            if (
              !db.state.links.some(
                (l) => l.guardianId === g.id && l.studentId === st!.id && !l.removedAt,
              )
            ) {
              const hasPrimary = db.state.links.some(
                (l) => l.studentId === st!.id && l.isPrimary && !l.removedAt,
              );
              db.state.links.push({
                id: db.id(),
                tenantId,
                guardianId: g.id,
                studentId: st.id,
                relationship: d.guardian_relationship!.toLowerCase() as never,
                isPrimary: !hasPrimary,
                removedAt: null,
              });
            }
          }
          rec.job.status = 'completed';
          rec.job.committedAt = db.nowIso();
          db.audit({
            tenantId,
            action: 'import.committed',
            outcome: 'success',
            actor: actorOf(ctx, s),
            targetLabel: rec.job.fileName,
            data: { ...rec.job.summary },
          });
          db.touch();
          return json(rec.job, 202);
        });
      }),
    ),

    // ── guardians (school-side) ──────────────────────────────
    http.get(
      `${T}/guardians`,
      handle(({ request, params }) => {
        const tenantId = tid(params);
        const s = requireStaff(ctx, request, tenantId, 'school.guardians.read');
        const url = new URL(request.url);
        const withPhone = db.state.memberships.some(
          (m) =>
            m.userId === s.userId &&
            m.tenantId === tenantId &&
            permissionsForSchoolRole(m.role).includes('school.guardians.write'),
        );
        const rows = db.state.guardians
          .filter((g) => g.tenantId === tenantId)
          .map((g) => guardianDto(db, g, withPhone))
          .filter(
            (g) =>
              matches(q(url, 'q'), g.fullName, g.phone, g.maskedPhone.slice(-4)) &&
              (!q(url, 'state') || g.state === q(url, 'state')) &&
              (!q(url, 'kind') || g.kind === q(url, 'kind')) &&
              (!q(url, 'studentId') ||
                g.students.some((x) => x.studentId === q(url, 'studentId'))) &&
              (url.searchParams.get('suspiciousOnly') !== 'true' ||
                (g.suspiciousTransfersLast30Days ?? 0) > 0),
          )
          .sort((a, b) => a.fullName.localeCompare(b.fullName));
        return json(page(rows, url));
      }),
    ),
    http.post(
      `${T}/guardians`,
      handle(async ({ request, params }) => {
        const tenantId = tid(params);
        const s = requireStaff(ctx, request, tenantId, 'school.guardians.write', true);
        const b = await body<CreateGuardianRequest>(request);
        if (!/^\+[1-9]\d{6,14}$/.test(b.phone))
          return invalid('phone', 'Phone must be in international format');
        if (db.state.guardians.some((g) => g.tenantId === tenantId && g.phone === b.phone))
          return fail('GUARDIAN_PHONE_IN_USE');
        for (const l of b.links) {
          student(tenantId, l.studentId);
          if (
            l.isPrimary &&
            db.state.links.some((x) => x.studentId === l.studentId && x.isPrimary && !x.removedAt)
          )
            return fail('PRIMARY_GUARDIAN_EXISTS');
        }
        const g = ensurePrimaryGuardian(tenantId, b.fullName, b.phone);
        for (const l of b.links)
          db.state.links.push({
            id: db.id(),
            tenantId,
            guardianId: g.id,
            studentId: l.studentId,
            relationship: l.relationship,
            isPrimary: l.isPrimary,
            removedAt: null,
          });
        db.audit({
          tenantId,
          action: 'guardian.created',
          outcome: 'success',
          actor: actorOf(ctx, s),
          targetType: 'guardian',
          targetId: g.id,
          targetLabel: g.fullName,
        });
        db.touch();
        return json(guardianDto(db, g, true), 201);
      }),
    ),
    http.get(
      `${T}/guardians/:guardianId`,
      handle(({ request, params }) => {
        const tenantId = tid(params);
        const s = requireStaff(ctx, request, tenantId, 'school.guardians.read');
        const withPhone = db.state.memberships.some(
          (m) =>
            m.userId === s.userId &&
            m.tenantId === tenantId &&
            permissionsForSchoolRole(m.role).includes('school.guardians.write'),
        );
        return json(guardianDto(db, guardian(tenantId, params.guardianId as string), withPhone));
      }),
    ),
    http.patch(
      `${T}/guardians/:guardianId`,
      handle(async ({ request, params }) => {
        const tenantId = tid(params);
        const s = requireStaff(ctx, request, tenantId, 'school.guardians.write', true);
        const g = guardian(tenantId, params.guardianId as string);
        const b = await body<UpdateGuardianRequest>(request);
        if (b.phone && b.phone !== g.phone) {
          if (!/^\+[1-9]\d{6,14}$/.test(b.phone))
            return invalid('phone', 'Phone must be in international format');
          if (db.state.guardians.some((x) => x.tenantId === tenantId && x.phone === b.phone))
            return fail('GUARDIAN_PHONE_IN_USE');
          g.phone = b.phone;
        }
        if (b.fullName) g.fullName = b.fullName;
        db.audit({
          tenantId,
          action: 'guardian.updated',
          outcome: 'success',
          actor: actorOf(ctx, s),
          targetType: 'guardian',
          targetId: g.id,
          targetLabel: g.fullName,
          data: { phoneChanged: !!b.phone },
        });
        db.touch();
        return json(guardianDto(db, g, true));
      }),
    ),
    http.post(
      `${T}/guardians/:guardianId/block`,
      handle(async ({ request, params }) =>
        setGuardianState(
          tid(params),
          params.guardianId as string,
          'blocked',
          ['active', 'pending_activation'],
          await body(request),
          requireStaff(ctx, request, tid(params), 'school.guardians.block', true),
          'guardian.blocked',
        ),
      ),
    ),
    http.post(
      `${T}/guardians/:guardianId/unblock`,
      handle(async ({ request, params }) =>
        setGuardianState(
          tid(params),
          params.guardianId as string,
          'active',
          ['blocked'],
          await body(request),
          requireStaff(ctx, request, tid(params), 'school.guardians.block', true),
          'guardian.unblocked',
        ),
      ),
    ),
    http.post(
      `${T}/guardians/:guardianId/deactivate`,
      handle(async ({ request, params }) =>
        setGuardianState(
          tid(params),
          params.guardianId as string,
          'deactivated',
          ['active', 'blocked', 'pending_activation', 'expired'],
          await body(request),
          requireStaff(ctx, request, tid(params), 'school.guardians.block', true),
          'guardian.deactivated',
        ),
      ),
    ),
    http.post(
      `${T}/guardians/:guardianId/reactivate`,
      handle(async ({ request, params }) =>
        setGuardianState(
          tid(params),
          params.guardianId as string,
          'active',
          ['deactivated'],
          await body(request),
          requireStaff(ctx, request, tid(params), 'school.guardians.block', true),
          'guardian.reactivated',
        ),
      ),
    ),
    http.post(
      `${T}/guardians/:guardianId/links`,
      handle(async ({ request, params }) => {
        const tenantId = tid(params);
        requireStaff(ctx, request, tenantId, 'school.guardians.write', true);
        const g = guardian(tenantId, params.guardianId as string);
        const b = await body<GuardianLinkInput>(request);
        student(tenantId, b.studentId);
        if (
          db.state.links.some(
            (l) => l.guardianId === g.id && l.studentId === b.studentId && !l.removedAt,
          )
        )
          return fail('CONFLICT', 'Already linked');
        if (
          b.isPrimary &&
          db.state.links.some((l) => l.studentId === b.studentId && l.isPrimary && !l.removedAt)
        )
          return fail('PRIMARY_GUARDIAN_EXISTS');
        db.state.links.push({
          id: db.id(),
          tenantId,
          guardianId: g.id,
          studentId: b.studentId,
          relationship: b.relationship,
          isPrimary: b.isPrimary,
          removedAt: null,
        });
        db.touch();
        return json(guardianDto(db, g, true));
      }),
    ),
    http.delete(
      `${T}/guardians/:guardianId/links/:studentId`,
      handle(({ request, params }) => {
        const tenantId = tid(params);
        requireStaff(ctx, request, tenantId, 'school.guardians.write', true);
        const l =
          db.state.links.find(
            (x) =>
              x.tenantId === tenantId &&
              x.guardianId === params.guardianId &&
              x.studentId === params.studentId &&
              !x.removedAt,
          ) ?? fail('NOT_FOUND');
        if (l.isPrimary) return fail('PRIMARY_GUARDIAN_REQUIRED');
        l.removedAt = db.nowIso();
        db.touch();
        return noContent();
      }),
    ),
    http.get(
      `${T}/guardians/:guardianId/devices`,
      handle(({ request, params }) => {
        const tenantId = tid(params);
        requireStaff(ctx, request, tenantId, 'school.guardians.read');
        const g = guardian(tenantId, params.guardianId as string);
        const active = db.state.devices.find((d) => d.userId === g.userId && d.state === 'active');
        const overrides = db.state.cooldownOverrides.filter((o) => o.userId === g.userId);
        const dto = guardianDto(db, g, false);
        return json({
          activeDevice: active ? dto.activeDevice : null,
          nextTransferAllowedAt: dto.nextTransferAllowedAt,
          transfers: db.state.transfers
            .filter((t) => t.userId === g.userId)
            .sort((a, b) => b.at.localeCompare(a.at))
            .map((t) => transferDto(db, t)),
          overrides: overrides.map((o) => cooldownOverrideDto(db, o)),
          remainingSchoolOverridesThisTerm: Math.max(
            0,
            2 -
              overrides.filter((o) => o.grantedByKind === 'school' && o.tenantId === tenantId)
                .length,
          ),
        });
      }),
    ),
    http.post(
      `${T}/guardians/:guardianId/cooldown-overrides`,
      handle(async ({ request, params }) => {
        const tenantId = tid(params);
        const s = requireStaff(ctx, request, tenantId, 'school.devices.override', true);
        const g = guardian(tenantId, params.guardianId as string);
        const b = await body<CooldownOverrideRequest>(request);
        if (!b.note?.trim()) return invalid('note', 'A note is required');
        const used = db.state.cooldownOverrides.filter(
          (o) => o.userId === g.userId && o.grantedByKind === 'school' && o.tenantId === tenantId,
        ).length;
        if (used >= 2) return fail('COOLDOWN_OVERRIDE_LIMIT_REACHED');
        const o = {
          id: db.id(),
          userId: g.userId,
          tenantId,
          reasonCode: b.reasonCode,
          note: b.note.trim(),
          grantedBy: actorOf(ctx, s),
          grantedByKind: 'school' as const,
          createdAt: db.nowIso(),
          expiresAt: db.addDays(1),
          usedAt: null,
        };
        db.state.cooldownOverrides.push(o);
        db.audit({
          tenantId,
          action: 'device.cooldown_overridden',
          outcome: 'success',
          actor: o.grantedBy,
          targetType: 'guardian',
          targetId: g.id,
          targetLabel: g.fullName,
          reasonCode: b.reasonCode,
        });
        db.touch();
        return json(cooldownOverrideDto(db, o), 201);
      }),
    ),
    http.post(
      `${T}/guardians/:guardianId/send-welcome`,
      handle(({ request, params }) => {
        requireStaff(ctx, request, tid(params), 'school.guardians.write', true);
        guardian(tid(params), params.guardianId as string);
        return new Response(null, { status: 202 });
      }),
    ),
    http.post(
      `${T}/license-seats/grants`,
      handle(({ request, params }) => {
        const tenantId = tid(params);
        const s = requireStaff(ctx, request, tenantId, 'school.guardians.write', true);
        return idempotent(ctx, request, `t:${tenantId}`, (raw) => {
          const b = JSON.parse(raw) as GrantSeatsRequest;
          if (!hasFeature(db, tenantId, 'guardians.school_granted_seats'))
            return fail('FEATURE_NOT_ENTITLED', undefined, {
              feature: 'guardians.school_granted_seats',
            });
          const g = guardian(tenantId, b.primaryGuardianId);
          if (g.kind !== 'primary')
            return fail('FORBIDDEN', 'Seats can only be granted to primary guardians');
          const t = db.tenant(tenantId)!;
          const items = Array.from({ length: b.count }, () => {
            const seat = {
              id: db.id(),
              tenantId,
              ownerGuardianId: g.id,
              source: 'school_grant' as const,
              state: 'available' as const,
              termEndsAt: `${t.termEndDate}T23:59:59.000Z`,
              reassignmentsUsed: 0,
              assignedGuardianId: null,
              createdAt: db.nowIso(),
            };
            db.state.seats.push(seat);
            return seatDto(seat);
          });
          db.audit({
            tenantId,
            action: 'seat.granted',
            outcome: 'success',
            actor: actorOf(ctx, s),
            targetType: 'guardian',
            targetId: g.id,
            targetLabel: g.fullName,
            data: { count: b.count, note: b.note },
          });
          db.touch();
          return json({ items }, 201);
        });
      }),
    ),

    // ── staff ────────────────────────────────────────────────
    http.get(
      `${T}/staff`,
      handle(({ request, params }) => {
        const tenantId = tid(params);
        requireStaff(ctx, request, tenantId, 'school.staff.manage');
        return json({
          members: db.state.memberships
            .filter((m) => m.tenantId === tenantId)
            .map((m) => staffDto(db, m))
            .sort((a, b) => a.fullName.localeCompare(b.fullName)),
          pendingInvitations: db.state.staffInvitations
            .filter((i) => i.tenantId === tenantId && i.status === 'pending')
            .map((i) => ({
              id: i.id,
              email: i.email,
              fullName: i.fullName,
              role: i.role ?? 'school.front_desk',
              expiresAt: i.expiresAt,
              invitedBy: actor(i.invitedBy),
              createdAt: i.createdAt,
            })),
        });
      }),
    ),
    http.post(
      `${T}/staff-invitations`,
      handle(async ({ request, params }) => {
        const tenantId = tid(params);
        const s = requireStaff(ctx, request, tenantId, 'school.staff.manage', true);
        const b = await body<CreateStaffInvitationRequest>(request);
        if (!/^\S+@\S+\.\S+$/.test(b.email)) return invalid('email', 'Enter a valid email');
        const existing = db.state.users.find((u) => u.email === b.email);
        if (
          existing &&
          db.state.memberships.some((m) => m.userId === existing.id && m.tenantId === tenantId)
        )
          return fail('CONFLICT', 'Already a staff member');
        const limit = limitOf(db, tenantId, 'staff.max');
        if (limit?.value != null && (limit.used ?? 0) >= limit.value)
          return fail('LIMIT_EXCEEDED', undefined, { limit: 'staff.max', value: limit.value });
        const inv = {
          id: db.id(),
          tenantId,
          email: b.email,
          fullName: b.fullName,
          role: b.role,
          platformRoles: [],
          token: db.token('staffinv'),
          expiresAt: db.addDays(7),
          invitedBy: actorOf(ctx, s),
          createdAt: db.nowIso(),
          status: 'pending' as const,
        };
        db.state.staffInvitations.push(inv);
        db.audit({
          tenantId,
          action: 'staff.invited',
          outcome: 'success',
          actor: inv.invitedBy,
          targetLabel: b.email,
          data: { role: b.role },
        });
        db.touch();
        return json(
          {
            id: inv.id,
            email: inv.email,
            fullName: inv.fullName,
            role: inv.role,
            expiresAt: inv.expiresAt,
            invitedBy: actor(inv.invitedBy),
            createdAt: inv.createdAt,
          },
          201,
        );
      }),
    ),
    http.delete(
      `${T}/staff-invitations/:invitationId`,
      handle(({ request, params }) => {
        requireStaff(ctx, request, tid(params), 'school.staff.manage', true);
        const inv =
          db.state.staffInvitations.find(
            (i) =>
              i.id === params.invitationId && i.tenantId === tid(params) && i.status === 'pending',
          ) ?? fail('NOT_FOUND');
        inv.status = 'revoked';
        db.touch();
        return noContent();
      }),
    ),
    http.patch(
      `${T}/staff/:membershipId`,
      handle(async ({ request, params }) => {
        const tenantId = tid(params);
        const s = requireStaff(ctx, request, tenantId, 'school.staff.manage', true);
        const m =
          db.state.memberships.find(
            (x) => x.id === params.membershipId && x.tenantId === tenantId,
          ) ?? fail('NOT_FOUND');
        const b = await body<UpdateStaffMemberRequest>(request);
        const admins = db.state.memberships.filter(
          (x) => x.tenantId === tenantId && x.role === 'school.admin' && x.status === 'active',
        );
        if (m.role === 'school.admin' && b.role !== 'school.admin' && admins.length <= 1)
          return fail('CONFLICT', 'A school must keep at least one admin');
        m.role = b.role;
        db.audit({
          tenantId,
          action: 'staff.role_changed',
          outcome: 'success',
          actor: actorOf(ctx, s),
          targetLabel: db.user(m.userId)?.fullName ?? null,
          data: { role: b.role },
        });
        db.touch();
        return json(staffDto(db, m));
      }),
    ),
    ...(['deactivate', 'reactivate'] as const).map((verb) =>
      http.post(
        `${T}/staff/:membershipId/${verb}`,
        handle(({ request, params }) => {
          const tenantId = tid(params);
          const s = requireStaff(ctx, request, tenantId, 'school.staff.manage', true);
          const m =
            db.state.memberships.find(
              (x) => x.id === params.membershipId && x.tenantId === tenantId,
            ) ?? fail('NOT_FOUND');
          if (verb === 'deactivate') {
            if (m.userId === s.userId) return fail('CONFLICT', 'You cannot deactivate yourself');
            if (
              m.role === 'school.admin' &&
              db.state.memberships.filter(
                (x) =>
                  x.tenantId === tenantId && x.role === 'school.admin' && x.status === 'active',
              ).length <= 1
            )
              return fail('CONFLICT', 'A school must keep at least one admin');
            m.status = 'deactivated';
            db.audit({
              tenantId,
              action: 'staff.deactivated',
              outcome: 'success',
              actor: actorOf(ctx, s),
              targetLabel: db.user(m.userId)?.fullName ?? null,
            });
          } else m.status = 'active';
          db.touch();
          return json(staffDto(db, m));
        }),
      ),
    ),

    // ── live queue ───────────────────────────────────────────
    http.get(
      `${T}/queue`,
      handle(({ request, params }) => {
        const tenantId = tid(params);
        requireStaff(ctx, request, tenantId, 'school.queue.read');
        const url = new URL(request.url);
        const queueDate = today(tenantId, url);
        const states = url.searchParams.getAll('state');
        const positions = openPositions(db, tenantId, queueDate);
        const items = db.state.pickups
          .filter(
            (p) =>
              p.tenantId === tenantId &&
              p.queueDate === queueDate &&
              (!states.length || states.includes(p.state)),
          )
          .map((p) => queueItem(db, p, positions))
          .filter(
            (i) =>
              (!q(url, 'classId') || i.student.classId === q(url, 'classId')) &&
              matches(q(url, 'q'), i.student.firstName, i.student.lastName, i.guardian.fullName),
          )
          .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
        return json({
          tenantId,
          queueDate,
          seq: db.latestSeq(tenantId, queueDate),
          items,
          sentOutStepEnabled:
            db.tenant(tenantId)!.settings.dismissal.sentOutStepEnabled &&
            hasFeature(db, tenantId, 'dismissal.sent_out_step'),
          followUpAfterMinutes:
            db.tenant(tenantId)!.settings.dismissal.timeouts.requestedStaleMinutes,
          generatedAt: db.nowIso(),
        });
      }),
    ),
    http.get(
      `${T}/queue/events`,
      handle(({ request, params }) => {
        const tenantId = tid(params);
        requireStaff(ctx, request, tenantId, 'school.queue.read');
        const url = new URL(request.url);
        const queueDate = today(tenantId, url);
        const after = Number(url.searchParams.get('afterSeq') ?? 0);
        const events = db.state.queueEvents.filter(
          (e) => e.tenantId === tenantId && e.queueDate === queueDate && e.seq > after,
        );
        const latestSeq = db.latestSeq(tenantId, queueDate);
        if (events.length > 500 || (after > 0 && events.length && events[0]!.seq !== after + 1))
          return fail('QUEUE_CATCHUP_GAP_TOO_LARGE', undefined, { latestSeq });
        const positions = openPositions(db, tenantId, queueDate);
        return json({
          events: events.map((e) => {
            const p = db.state.pickups.find((x) => x.id === e.pickupId);
            return {
              eventId: e.eventId,
              type: e.type,
              version: 1 as const,
              tenantId,
              queueDate,
              seq: e.seq,
              occurredAt: e.occurredAt,
              data: p
                ? { item: { ...queueItem(db, p, positions), seq: e.seq } }
                : { reason: 'resync_required' },
            };
          }),
          latestSeq,
          hasMore: false,
        });
      }),
    ),
    http.get(
      `${T}/pickup-requests/:requestId`,
      handle(({ request, params }) => {
        requireStaff(ctx, request, tid(params), 'school.queue.read');
        return json(pickupDetail(db, pickup(tid(params), params.requestId as string)));
      }),
    ),
    http.post(
      `${T}/pickup-requests/:requestId/sent-out`,
      handle(({ request, params }) => {
        const tenantId = tid(params);
        const s = requireStaff(ctx, request, tenantId, 'school.queue.dispatch', true);
        return idempotent(ctx, request, `t:${tenantId}`, () => {
          const p = pickup(tenantId, params.requestId as string);
          if (
            !db.tenant(tenantId)!.settings.dismissal.sentOutStepEnabled ||
            !hasFeature(db, tenantId, 'dismissal.sent_out_step')
          )
            return fail('SENT_OUT_STEP_DISABLED');
          if (p.state === 'sent_out')
            return json(queueItem(db, p, openPositions(db, tenantId, p.queueDate)));
          if (p.state !== 'requested')
            return fail(
              p.closedAt ? 'PICKUP_REQUEST_CLOSED' : 'INVALID_PICKUP_TRANSITION',
              undefined,
              { currentState: p.state },
            );
          sendOut(db, p, actorOf(ctx, s));
          return json(queueItem(db, p, openPositions(db, tenantId, p.queueDate)));
        });
      }),
    ),
    http.post(
      `${T}/pickup-requests/sent-out`,
      handle(({ request, params }) => {
        const tenantId = tid(params);
        const s = requireStaff(ctx, request, tenantId, 'school.queue.dispatch', true);
        return idempotent(ctx, request, `t:${tenantId}`, (raw) => {
          const b = JSON.parse(raw) as SentOutBulkRequest;
          if (
            !db.tenant(tenantId)!.settings.dismissal.sentOutStepEnabled ||
            !hasFeature(db, tenantId, 'dismissal.sent_out_step')
          )
            return fail('SENT_OUT_STEP_DISABLED');
          const succeeded: string[] = [];
          const failed: Array<{
            id: string;
            code: 'NOT_FOUND' | 'INVALID_PICKUP_TRANSITION';
            detail?: string;
          }> = [];
          for (const id of b.requestIds) {
            const p = db.state.pickups.find((x) => x.id === id && x.tenantId === tenantId);
            if (!p) failed.push({ id, code: 'NOT_FOUND' });
            else if (p.state === 'sent_out') succeeded.push(id);
            else if (p.state !== 'requested')
              failed.push({
                id,
                code: 'INVALID_PICKUP_TRANSITION',
                detail: `Request is ${p.state}`,
              });
            else {
              sendOut(db, p, actorOf(ctx, s));
              succeeded.push(id);
            }
          }
          return json({ succeeded, failed });
        });
      }),
    ),
    http.post(
      `${T}/pickup-requests/:requestId/cancel`,
      handle(async ({ request, params }) => {
        const tenantId = tid(params);
        const s = requireStaff(ctx, request, tenantId, 'school.queue.dispatch', true);
        const p = pickup(tenantId, params.requestId as string);
        const b = await body<StaffCancelRequest>(request);
        if (!b.reason || b.reason.trim().length < 3)
          return invalid('reason', 'A reason is required');
        if (!(OPEN_STATES as readonly string[]).includes(p.state))
          return fail('PICKUP_REQUEST_CLOSED', undefined, { currentState: p.state });
        transition(db, p, {
          to: 'cancelled',
          actorType: 'staff',
          actor: actorOf(ctx, s),
          reason: b.reason.trim(),
        });
        return json(queueItem(db, p, openPositions(db, tenantId, p.queueDate)));
      }),
    ),
    http.post(
      `${T}/pickup-requests/:requestId/resolve`,
      handle(async ({ request, params }) => {
        const tenantId = tid(params);
        const s = requireStaff(ctx, request, tenantId, 'school.queue.resolve', true);
        const p = pickup(tenantId, params.requestId as string);
        const b = await body<ResolveExceptionRequest>(request);
        if (p.state !== 'exception')
          return fail('INVALID_PICKUP_TRANSITION', 'Only exceptions can be resolved', {
            currentState: p.state,
          });
        if (!b.note?.trim()) return invalid('note', 'Add a note describing the follow-up');
        transition(
          db,
          p,
          { to: 'resolved', actorType: 'staff', actor: actorOf(ctx, s), reason: b.note.trim() },
          (x) => (x.resolution = b.resolution),
        );
        return json(queueItem(db, p, openPositions(db, tenantId, p.queueDate)));
      }),
    ),

    // ── displays (school-side) ───────────────────────────────
    http.get(
      `${T}/displays`,
      handle(({ request, params }) => {
        requireStaff(ctx, request, tid(params), 'school.displays.manage');
        return json({
          items: db.state.displays
            .filter((d) => d.tenantId === tid(params))
            .map((d) => displayDto(db, d)),
        });
      }),
    ),
    http.post(
      `${T}/displays/pair`,
      handle(async ({ request, params }) => {
        const tenantId = tid(params);
        const s = requireStaff(ctx, request, tenantId, 'school.displays.manage', true);
        const b = await body<PairDisplayRequest>(request);
        const code = b.pairingCode.toUpperCase().replace(/[^0-9A-Z]/g, '');
        const ps = db.state.pairingSessions.find((x) => x.code === code);
        if (!ps) return fail('PAIRING_CODE_INVALID');
        if (ps.status !== 'pending' || ps.expiresAt < db.nowIso())
          return fail('PAIRING_CODE_EXPIRED');
        if (!hasFeature(db, tenantId, 'dismissal.display'))
          return fail('FEATURE_NOT_ENTITLED', undefined, { feature: 'dismissal.display' });
        const limit = limitOf(db, tenantId, 'displays.max');
        if (limit?.value != null && (limit.used ?? 0) >= limit.value)
          return fail('DISPLAY_LIMIT_REACHED', undefined, { limit: limit.value });
        const d = {
          id: db.id(),
          tenantId,
          name: b.name.trim(),
          zone: b.zone ?? null,
          state: 'active' as const,
          token: db.token('disp'),
          pairedAt: db.nowIso(),
          pairedBy: actorOf(ctx, s),
          lastHeartbeatAt: db.nowIso(),
          appVersion: null,
        };
        db.state.displays.push(d);
        ps.status = 'paired';
        ps.displayId = d.id;
        db.audit({
          tenantId,
          action: 'display.paired',
          outcome: 'success',
          actor: d.pairedBy,
          targetType: 'display',
          targetId: d.id,
          targetLabel: d.name,
        });
        db.touch();
        return json(displayDto(db, d), 201);
      }),
    ),
    http.patch(
      `${T}/displays/:displayId`,
      handle(async ({ request, params }) => {
        requireStaff(ctx, request, tid(params), 'school.displays.manage', true);
        const d =
          db.state.displays.find((x) => x.id === params.displayId && x.tenantId === tid(params)) ??
          fail('NOT_FOUND');
        const b = await body<UpdateDisplayRequest>(request);
        if (b.name) d.name = b.name;
        if (b.zone !== undefined) d.zone = b.zone;
        db.touch();
        return json(displayDto(db, d));
      }),
    ),
    http.post(
      `${T}/displays/:displayId/revoke`,
      handle(({ request, params }) => {
        const tenantId = tid(params);
        const s = requireStaff(ctx, request, tenantId, 'school.displays.manage', true);
        const d =
          db.state.displays.find((x) => x.id === params.displayId && x.tenantId === tenantId) ??
          fail('NOT_FOUND');
        d.state = 'revoked';
        db.audit({
          tenantId,
          action: 'display.revoked',
          outcome: 'success',
          actor: actorOf(ctx, s),
          targetType: 'display',
          targetId: d.id,
          targetLabel: d.name,
        });
        db.emit(
          {
            eventId: db.id(),
            type: 'display.revoked',
            version: 1,
            tenantId,
            occurredAt: db.nowIso(),
            data: { displayId: d.id },
          },
          { kind: 'tenant-display', tenantId },
        );
        db.touch();
        return json(displayDto(db, d));
      }),
    ),

    // ── reports & audit ──────────────────────────────────────
    http.get(
      `${T}/reports/:report`,
      handle(({ request, params }) => {
        const tenantId = tid(params);
        const url = new URL(request.url);
        const csv = q(url, 'format') === 'csv';
        requireStaff(ctx, request, tenantId, csv ? 'school.reports.export' : 'school.reports.read');
        if (csv && !hasFeature(db, tenantId, 'reports.export'))
          return fail('FEATURE_NOT_ENTITLED', undefined, { feature: 'reports.export' });
        const from = q(url, 'from'),
          to = q(url, 'to');
        const report = params.report as string;
        const pickupRow = (p: PickupRecord) => {
          const st = db.state.students.find((x) => x.id === p.studentId)!;
          const g = db.state.guardians.find((x) => x.id === p.guardianId)!;
          return {
            requestId: p.id,
            queueDate: p.queueDate,
            studentName: `${st.firstName} ${st.lastName}`,
            className: db.state.classes.find((c) => c.id === st.classId)?.name ?? '—',
            guardianName: g.fullName,
            guardianKind: g.kind,
            state: p.state,
            requestedAt: p.requestedAt,
            sentOutAt: p.sentOutAt,
            acknowledgedAt: p.acknowledgedAt,
            minutesToAcknowledge: p.acknowledgedAt
              ? Math.round((Date.parse(p.acknowledgedAt) - Date.parse(p.requestedAt)) / 6000) / 10
              : null,
            resolution: p.resolution,
          };
        };
        const inScope = db.state.pickups.filter(
          (p) => p.tenantId === tenantId && inRange(`${p.queueDate}T00:00:00Z`, from, to),
        );
        if (report === 'pickups' || report === 'unresolved') {
          let rows = inScope;
          if (report === 'unresolved')
            rows = rows.filter(
              (p) =>
                p.state === 'exception' ||
                (url.searchParams.get('includeResolved') !== 'false' && p.state === 'resolved'),
            );
          rows = rows.filter(
            (p) =>
              (!q(url, 'state') || p.state === q(url, 'state')) &&
              (!q(url, 'guardianId') || p.guardianId === q(url, 'guardianId')) &&
              (!q(url, 'classId') ||
                db.state.students.find((s) => s.id === p.studentId)?.classId === q(url, 'classId')),
          );
          const mapped = rows
            .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))
            .map(pickupRow);
          if (csv)
            return csvResponse(
              toCsv(
                [
                  'queueDate',
                  'studentName',
                  'className',
                  'guardianName',
                  'guardianKind',
                  'state',
                  'requestedAt',
                  'sentOutAt',
                  'acknowledgedAt',
                  'minutesToAcknowledge',
                  'resolution',
                ],
                mapped,
              ),
              `${report}.csv`,
            );
          const acks = mapped
            .map((r) => r.minutesToAcknowledge)
            .filter((x): x is number => x !== null)
            .sort((a, b) => a - b);
          return json({
            ...page(mapped, url, 50),
            totals: {
              requests: rows.length,
              acknowledged: rows.filter((p) => p.state === 'acknowledged').length,
              cancelled: rows.filter((p) => p.state === 'cancelled').length,
              exceptions: rows.filter((p) => p.state === 'exception').length,
              resolved: rows.filter((p) => p.state === 'resolved').length,
              medianMinutesToAcknowledge: acks.length ? acks[Math.floor(acks.length / 2)]! : null,
            },
          });
        }
        if (report === 'guardian-activity') {
          const rows = db.state.guardians
            .filter(
              (g) => g.tenantId === tenantId && (!q(url, 'kind') || g.kind === q(url, 'kind')),
            )
            .map((g) => {
              const ps = inScope.filter((p) => p.guardianId === g.id);
              return {
                guardianId: g.id,
                fullName: g.fullName,
                kind: g.kind,
                state: effectiveGuardianState(db, g),
                requests: ps.length,
                acknowledged: ps.filter((p) => p.state === 'acknowledged').length,
                unresolved: ps.filter((p) => p.state === 'exception').length,
                lastActiveAt: g.lastActiveAt,
              };
            })
            .sort((a, b) => b.requests - a.requests || a.fullName.localeCompare(b.fullName));
          if (csv)
            return csvResponse(
              toCsv(
                [
                  'fullName',
                  'kind',
                  'state',
                  'requests',
                  'acknowledged',
                  'unresolved',
                  'lastActiveAt',
                ],
                rows,
              ),
              'guardian-activity.csv',
            );
          return json(page(rows, url, 50));
        }
        if (report === 'device-transfers') {
          const gs = db.state.guardians.filter((g) => g.tenantId === tenantId);
          const rows = db.state.transfers
            .filter(
              (t) =>
                gs.some((g) => g.userId === t.userId) &&
                inRange(t.at, from, to) &&
                (url.searchParams.get('suspiciousOnly') !== 'true' || t.suspicious),
            )
            .sort((a, b) => b.at.localeCompare(a.at))
            .map((t) => {
              const g = gs.find((x) => x.userId === t.userId)!;
              return { guardianId: g.id, guardianName: g.fullName, transfer: transferDto(db, t) };
            });
          if (csv)
            return csvResponse(
              toCsv(
                ['guardianName', 'at', 'from', 'to', 'viaOverride', 'suspicious'],
                rows.map((r) => ({
                  guardianName: r.guardianName,
                  at: r.transfer.at,
                  from: r.transfer.fromDevice?.model ?? '',
                  to: r.transfer.toDevice.model,
                  viaOverride: r.transfer.viaOverride,
                  suspicious: r.transfer.suspicious,
                })),
              ),
              'device-transfers.csv',
            );
          return json(page(rows, url, 50));
        }
        if (report === 'usage') {
          const start = from ?? db.today(tenantId).slice(0, 8) + '01';
          const end = to ?? db.today(tenantId);
          const days: Array<{
            date: string;
            requests: number;
            acknowledged: number;
            exceptions: number;
            activeGuardians: number;
            otpSent: number;
          }> = [];
          for (
            let d = new Date(`${start}T12:00:00Z`);
            d.toISOString().slice(0, 10) <= end && days.length < 92;
            d = new Date(d.getTime() + 86_400_000)
          ) {
            const date = d.toISOString().slice(0, 10);
            const ps = inScope.filter((p) => p.queueDate === date);
            days.push({
              date,
              requests: ps.length,
              acknowledged: ps.filter((p) => p.state === 'acknowledged').length,
              exceptions: ps.filter((p) => p.state === 'exception' || p.state === 'resolved')
                .length,
              activeGuardians: new Set(ps.map((p) => p.guardianId)).size,
              otpSent: 0,
            });
          }
          if (csv)
            return csvResponse(
              toCsv(
                ['date', 'requests', 'acknowledged', 'exceptions', 'activeGuardians', 'otpSent'],
                days,
              ),
              'usage.csv',
            );
          return json({ from: start, to: end, days });
        }
        return fail('NOT_FOUND');
      }),
    ),
    http.get(
      `${T}/audit-logs`,
      handle(({ request, params }) => {
        const tenantId = tid(params);
        requireStaff(ctx, request, tenantId, 'school.audit.read');
        const url = new URL(request.url);
        const rows = db.state.audit
          .filter(
            (a) =>
              a.tenantId === tenantId &&
              (!q(url, 'action') || a.action === q(url, 'action')) &&
              (!q(url, 'actorId') || a.actor.id === q(url, 'actorId')) &&
              (!q(url, 'targetId') || a.targetId === q(url, 'targetId')) &&
              inRange(a.occurredAt, q(url, 'from'), q(url, 'to')),
          )
          .map((a) => auditDto(db, a));
        return json(page(rows, url, 50));
      }),
    ),
  ];
}
