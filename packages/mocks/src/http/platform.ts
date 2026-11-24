import type {
  CooldownOverrideRequest,
  CreateEntitlementOverrideRequest,
  CreatePlanRequest,
  CreatePlanVersionRequest,
  CreateSupportNoteRequest,
  CreateSupportSessionRequest,
  CreateTenantRequest,
  InvitePlatformUserRequest,
  LifecycleTransitionRequest,
  RevokeRequest,
  SchoolAdminInvitationRequest,
  SetSubscriptionRequest,
  TenantLifecycleState,
  TenantUsage,
  UpdateFeatureFlagRequest,
  UpdatePlatformUserRequest,
  UpdateTenantRequest,
} from '@homebell/contracts';
import { http } from 'msw';
import type { TenantRecord } from '../db/types';
import {
  actor,
  auditDto,
  cooldownOverrideDto,
  lifecycleEntry,
  noteDto,
  overrideDto,
  planDto,
  subscriptionDto,
  tenantDetail,
  tenantSummary,
  transferDto,
  maskPhone,
} from '../mappers';
import { resolveEntitlements } from '../rules/entitlements';
import {
  ACTIONS_REQUIRING_EXPIRY,
  ACTIONS_REQUIRING_NAME_CONFIRMATION,
  OPERATIONAL_MODE,
  TRANSITIONS,
  targetState,
} from '../rules/lifecycle';
import { permissionsForPlatformRoles } from '../rules/permissions';
import { issueSession } from './auth';
import { auditCsv } from './csv';
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
  page,
  q,
  requirePlatform,
  type MockContext,
} from './context';

export function platformHandlers(ctx: MockContext) {
  const db = ctx.db;
  const tenantOr404 = (id: string): TenantRecord => db.tenant(id) ?? fail('NOT_FOUND');
  const P = '*/v1/platform';

  const usage = (t: TenantRecord): TenantUsage => {
    const ent = resolveEntitlements(db, t.id);
    const lim = (k: string) => ent.limits.find((l) => l.key === k);
    const today = db.today(t.id);
    const pickups = db.state.pickups.filter((p) => p.tenantId === t.id);
    const guardians = db.state.guardians.filter((g) => g.tenantId === t.id);
    const seats = db.state.seats.filter((s) => s.tenantId === t.id);
    const transfers = db.state.transfers.filter(
      (x) => x.at > db.addDays(-30) && guardians.some((g) => g.userId === x.userId),
    );
    return {
      tenantId: t.id,
      asOf: db.nowIso(),
      students: { used: lim('students.max')?.used ?? 0, limit: lim('students.max')?.value ?? null },
      staff: { used: lim('staff.max')?.used ?? 0, limit: lim('staff.max')?.value ?? null },
      displays: { used: lim('displays.max')?.used ?? 0, limit: lim('displays.max')?.value ?? null },
      guardians: {
        primaryActive: guardians.filter((g) => g.kind === 'primary' && g.state === 'active').length,
        primaryPending: guardians.filter(
          (g) => g.kind === 'primary' && g.state === 'pending_activation',
        ).length,
        additionalActive: guardians.filter((g) => g.kind === 'additional' && g.state === 'active')
          .length,
        blocked: guardians.filter((g) => g.state === 'blocked').length,
        seatsAvailable: seats.filter((s) => s.state === 'available').length,
        seatsAssigned: seats.filter((s) => s.state === 'assigned').length,
      },
      pickups: {
        today: pickups.filter((p) => p.queueDate === today).length,
        last7Days: pickups.filter((p) => p.requestedAt > db.addDays(-7)).length,
        last30Days: pickups.filter((p) => p.requestedAt > db.addDays(-30)).length,
        unresolvedLast30Days: pickups.filter(
          (p) =>
            (p.state === 'exception' || p.state === 'resolved') && p.requestedAt > db.addDays(-30),
        ).length,
      },
      otp: {
        sentToday: db.state.otpChallenges.filter(
          (c) => c.createdAt.slice(0, 10) === db.nowIso().slice(0, 10),
        ).length,
        dailyBudget: lim('otp.daily_budget')?.value ?? null,
      },
      deviceTransfers: {
        last30Days: transfers.length,
        suspiciousLast30Days: transfers.filter((x) => x.suspicious).length,
      },
    };
  };

  return [
    http.get(
      `${P}/tenants`,
      handle(({ request }) => {
        requirePlatform(ctx, request, 'platform.tenants.read');
        const url = new URL(request.url);
        const states = url.searchParams.getAll('state');
        const search = q(url, 'q');
        const flag = q(url, 'flag');
        const planId = q(url, 'planId');
        const expiringBefore = q(url, 'expiringBefore');
        const sort = (q(url, 'sort') ?? 'name') as
          'name' | 'createdAt' | 'expiresAt' | 'lastActivityAt';
        const dir = q(url, 'direction') === 'desc' ? -1 : 1;
        let rows = db.state.tenants.map((t) => tenantSummary(db, t));
        rows = rows.filter(
          (t) =>
            (!states.length || states.includes(t.state)) &&
            matches(search, t.name, t.slug) &&
            (!flag || t.flags.includes(flag as never)) &&
            (!expiringBefore || (t.expiresAt && t.expiresAt < expiringBefore)),
        );
        if (planId)
          rows = rows.filter((t) => {
            const s = db.state.subscriptions.find((x) => x.tenantId === t.id);
            return (
              s && db.state.planVersions.find((v) => v.id === s.planVersionId)?.planId === planId
            );
          });
        rows.sort((a, b) => dir * String(a[sort] ?? '').localeCompare(String(b[sort] ?? '')));
        return json(page(rows, url));
      }),
    ),

    http.post(
      `${P}/tenants`,
      handle(({ request }) => {
        const s = requirePlatform(ctx, request, 'platform.tenants.write', true);
        return idempotent(ctx, request, 'platform', (raw) => {
          const b = JSON.parse(raw) as CreateTenantRequest;
          if (db.state.tenants.some((t) => t.slug === b.slug)) return fail('TENANT_SLUG_TAKEN');
          if (b.initialState === 'trial' && !b.expiresAt)
            return invalid('expiresAt', 'Trial requires an expiry date');
          if (b.termEndDate <= b.termStartDate)
            return invalid('termEndDate', 'Term must end after it starts');
          const a = actorOf(ctx, s);
          const t: TenantRecord = {
            id: db.id(),
            slug: b.slug,
            name: b.name,
            legalName: b.legalName ?? null,
            countryCode: b.countryCode,
            region: b.region,
            timezone: b.timezone,
            termStartDate: b.termStartDate,
            termEndDate: b.termEndDate,
            state: b.initialState,
            previousOperationalState: null,
            expiresAt: b.expiresAt ?? null,
            dataPlacement: 'shared',
            primaryContact: b.primaryContact,
            createdAt: db.nowIso(),
            updatedAt: db.nowIso(),
            lastActivityAt: null,
            settings: structuredClone(db.state.tenants[0]!.settings),
          };
          t.settings.branding = { displayName: b.name, logoUrl: null, primaryColor: '#1F6FEB' };
          db.state.tenants.push(t);
          db.state.lifecycleHistory.push({
            id: db.id(),
            tenantId: t.id,
            action: 'create',
            fromState: null,
            toState: t.state,
            reasonCode:
              t.state === 'trial'
                ? 'trial_requested'
                : t.state === 'pilot_free'
                  ? 'pilot_program'
                  : 'other',
            note: b.note ?? null,
            expiresAt: t.expiresAt,
            refundStatus: 'none',
            actor: a,
            at: db.nowIso(),
          });
          if (b.planVersionId)
            db.state.subscriptions.push({
              id: db.id(),
              tenantId: t.id,
              planVersionId: b.planVersionId,
              startsAt: db.nowIso(),
              endsAt: `${b.termEndDate}T23:59:59.000Z`,
              billingReference: null,
              createdBy: a,
              createdAt: db.nowIso(),
            });
          if (b.inviteSchoolAdmin !== false)
            db.state.staffInvitations.push({
              id: db.id(),
              tenantId: t.id,
              email: b.primaryContact.email,
              fullName: b.primaryContact.fullName,
              role: 'school.admin',
              platformRoles: [],
              token: db.token('staffinv'),
              expiresAt: db.addDays(7),
              invitedBy: a,
              createdAt: db.nowIso(),
              status: 'pending',
            });
          db.audit({
            tenantId: t.id,
            action: 'tenant.created',
            outcome: 'success',
            actor: a,
            targetType: 'tenant',
            targetId: t.id,
            targetLabel: t.name,
          });
          db.touch();
          return json(tenantDetail(db, t), 201);
        });
      }),
    ),

    http.get(
      `${P}/tenants/:tenantId`,
      handle(({ request, params }) => {
        const s = requirePlatform(ctx, request, 'platform.tenants.read');
        const t = tenantOr404(params.tenantId as string);
        const canAct = permissionsForPlatformRoles(db.user(s.userId)!.platformRoles).includes(
          'platform.lifecycle.write',
        );
        return json(tenantDetail(db, t, canAct), 200, { ETag: `"${t.updatedAt}"` });
      }),
    ),

    http.patch(
      `${P}/tenants/:tenantId`,
      handle(async ({ request, params }) => {
        const s = requirePlatform(ctx, request, 'platform.tenants.write', true);
        const t = tenantOr404(params.tenantId as string);
        const ifMatch = request.headers.get('If-Match');
        if (ifMatch && ifMatch !== `"${t.updatedAt}"`) return fail('PRECONDITION_FAILED');
        const b = await body<UpdateTenantRequest>(request);
        Object.assign(t, Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined)));
        t.updatedAt = db.nowIso();
        db.audit({
          tenantId: t.id,
          action: 'tenant.updated',
          outcome: 'success',
          actor: actorOf(ctx, s),
          targetType: 'tenant',
          targetId: t.id,
          targetLabel: t.name,
          data: b as Record<string, unknown>,
        });
        db.touch();
        return json(tenantDetail(db, t));
      }),
    ),

    http.post(
      `${P}/tenants/:tenantId/lifecycle-transitions`,
      handle(({ request, params }) => {
        const s = requirePlatform(ctx, request, 'platform.lifecycle.write', true);
        const t = tenantOr404(params.tenantId as string);
        return idempotent(ctx, request, `platform:${t.id}`, (raw) => {
          const b = JSON.parse(raw) as LifecycleTransitionRequest;
          if (b.expectedState !== t.state)
            return fail('LIFECYCLE_STATE_CHANGED', undefined, { currentState: t.state });
          const rule = TRANSITIONS[b.action];
          if (!rule.from.includes(t.state))
            return fail('INVALID_LIFECYCLE_TRANSITION', undefined, {
              currentState: t.state,
              allowedActions: Object.keys(TRANSITIONS).filter((a) =>
                TRANSITIONS[a as keyof typeof TRANSITIONS].from.includes(t.state),
              ),
            });
          if (ACTIONS_REQUIRING_EXPIRY.includes(b.action) && !b.expiresAt)
            return invalid('expiresAt', 'This action requires an expiry date');
          if (b.action === 'extend_expiry' && t.expiresAt && b.expiresAt! <= t.expiresAt)
            return invalid('expiresAt', 'New expiry must be later than the current one');
          if (
            ACTIONS_REQUIRING_NAME_CONFIRMATION.includes(b.action) &&
            b.confirmTenantName !== t.name
          )
            return invalid('confirmTenantName', 'Type the school name exactly to confirm');
          if (
            (b.action === 'activate' || b.action === 'convert_to_paid') &&
            !db.state.subscriptions.some((x) => x.tenantId === t.id) &&
            !b.planVersionId
          )
            return fail('PLAN_VERSION_NOT_PUBLISHED', 'Assign a published plan first');
          if (b.planVersionId) {
            const pv = db.state.planVersions.find((v) => v.id === b.planVersionId);
            if (!pv || pv.status !== 'published') return fail('PLAN_VERSION_NOT_PUBLISHED');
            const existing = db.state.subscriptions.find((x) => x.tenantId === t.id);
            if (existing) existing.planVersionId = pv.id;
            else
              db.state.subscriptions.push({
                id: db.id(),
                tenantId: t.id,
                planVersionId: pv.id,
                startsAt: db.nowIso(),
                endsAt: b.expiresAt ?? `${t.termEndDate}T23:59:59.000Z`,
                billingReference: null,
                createdBy: actorOf(ctx, s),
                createdAt: db.nowIso(),
              });
          }
          const from = t.state;
          const to = targetState(
            b.action,
            t.state,
            t.previousOperationalState,
            b.targetState as TenantLifecycleState | undefined,
          );
          if (
            ['suspend', 'deactivate', 'cancel'].includes(b.action) &&
            OPERATIONAL_MODE[from] === 'full'
          )
            t.previousOperationalState = from;
          t.state = to;
          if (b.expiresAt) t.expiresAt = b.expiresAt;
          if (b.action === 'grant_free' && !b.expiresAt) t.expiresAt = null;
          t.updatedAt = db.nowIso();
          const a = actorOf(ctx, s);
          db.state.lifecycleHistory.push({
            id: db.id(),
            tenantId: t.id,
            action: b.action,
            fromState: from,
            toState: to,
            reasonCode: b.reasonCode,
            note: b.note ?? null,
            expiresAt: t.expiresAt,
            refundStatus: b.refundStatus ?? 'none',
            actor: a,
            at: db.nowIso(),
          });
          if (b.refundStatus && b.refundStatus !== 'none')
            db.state.notes.unshift({
              id: db.id(),
              tenantId: t.id,
              category: 'refund',
              body: b.note ?? `Refund status: ${b.refundStatus}`,
              refundStatus: b.refundStatus,
              pinned: true,
              author: a,
              createdAt: db.nowIso(),
            });
          db.audit({
            tenantId: t.id,
            action: 'tenant.lifecycle_changed',
            outcome: 'success',
            actor: a,
            targetType: 'tenant',
            targetId: t.id,
            targetLabel: t.name,
            reasonCode: b.reasonCode,
            data: { action: b.action, from, to },
          });
          db.emit(
            {
              eventId: db.id(),
              type: 'tenant.state_changed',
              version: 1,
              tenantId: t.id,
              occurredAt: db.nowIso(),
              data: { tenantId: t.id, state: to, operationalMode: OPERATIONAL_MODE[to] },
            },
            { kind: 'tenant-queue', tenantId: t.id },
          );
          db.touch();
          return json(tenantDetail(db, t));
        });
      }),
    ),

    http.get(
      `${P}/tenants/:tenantId/lifecycle-history`,
      handle(({ request, params }) => {
        requirePlatform(ctx, request, 'platform.tenants.read');
        const t = tenantOr404(params.tenantId as string);
        const rows = db.state.lifecycleHistory
          .filter((h) => h.tenantId === t.id)
          .sort((a, b) => b.at.localeCompare(a.at))
          .map(lifecycleEntry);
        return json(page(rows, new URL(request.url)));
      }),
    ),

    http.get(
      `${P}/tenants/:tenantId/subscription`,
      handle(({ request, params }) => {
        requirePlatform(ctx, request, 'platform.tenants.read');
        const sub = subscriptionDto(db, tenantOr404(params.tenantId as string).id);
        return sub ? json(sub) : fail('NOT_FOUND', 'No subscription assigned');
      }),
    ),

    http.put(
      `${P}/tenants/:tenantId/subscription`,
      handle(async ({ request, params }) => {
        const s = requirePlatform(ctx, request, 'platform.subscriptions.write', true);
        const t = tenantOr404(params.tenantId as string);
        const b = await body<SetSubscriptionRequest>(request);
        const pv = db.state.planVersions.find((v) => v.id === b.planVersionId);
        if (!pv || pv.status !== 'published') return fail('PLAN_VERSION_NOT_PUBLISHED');
        if (b.endsAt <= b.startsAt) return invalid('endsAt', 'End must be after start');
        const a = actorOf(ctx, s);
        db.state.subscriptions = db.state.subscriptions.filter((x) => x.tenantId !== t.id);
        db.state.subscriptions.push({
          id: db.id(),
          tenantId: t.id,
          planVersionId: pv.id,
          startsAt: b.startsAt,
          endsAt: b.endsAt,
          billingReference: b.billingReference ?? null,
          createdBy: a,
          createdAt: db.nowIso(),
        });
        db.audit({
          tenantId: t.id,
          action: 'subscription.changed',
          outcome: 'success',
          actor: a,
          targetType: 'tenant',
          targetId: t.id,
          targetLabel: t.name,
          data: { plan: `${pv.planName} v${pv.version}` },
        });
        db.touch();
        return json(subscriptionDto(db, t.id));
      }),
    ),

    http.get(
      `${P}/tenants/:tenantId/entitlements`,
      handle(({ request, params }) => {
        requirePlatform(ctx, request, 'platform.tenants.read');
        return json(resolveEntitlements(db, tenantOr404(params.tenantId as string).id));
      }),
    ),

    http.get(
      `${P}/tenants/:tenantId/entitlement-overrides`,
      handle(({ request, params }) => {
        requirePlatform(ctx, request, 'platform.tenants.read');
        const t = tenantOr404(params.tenantId as string);
        const activeOnly = new URL(request.url).searchParams.get('activeOnly') === 'true';
        const items = db.state.overrides
          .filter(
            (o) =>
              o.tenantId === t.id &&
              (!activeOnly || (!o.revokedAt && (!o.expiresAt || o.expiresAt > db.nowIso()))),
          )
          .map(overrideDto);
        return json({ items });
      }),
    ),

    http.post(
      `${P}/tenants/:tenantId/entitlement-overrides`,
      handle(async ({ request, params }) => {
        const s = requirePlatform(ctx, request, 'platform.overrides.write', true);
        const t = tenantOr404(params.tenantId as string);
        const b = await body<CreateEntitlementOverrideRequest>(request);
        if (b.kind === 'feature' && typeof b.value !== 'boolean')
          return invalid('value', 'Feature overrides take true/false');
        if (b.kind === 'limit' && b.value !== null && (typeof b.value !== 'number' || b.value < 0))
          return invalid('value', 'Limit overrides take a non-negative number or null (unlimited)');
        const a = actorOf(ctx, s);
        const o = {
          id: db.id(),
          tenantId: t.id,
          kind: b.kind,
          key: b.key,
          value: b.value ?? null,
          reasonCode: b.reasonCode,
          note: b.note ?? '',
          expiresAt: b.expiresAt ?? null,
          createdBy: a,
          createdAt: db.nowIso(),
          revokedAt: null,
          revokedBy: null,
          revokeNote: null,
        };
        db.state.overrides.push(o);
        db.audit({
          tenantId: t.id,
          action: 'override.applied',
          outcome: 'success',
          actor: a,
          targetType: 'tenant',
          targetId: t.id,
          targetLabel: t.name,
          data: { key: b.key, value: b.value },
        });
        db.touch();
        return json(overrideDto(o), 201);
      }),
    ),

    http.post(
      `${P}/tenants/:tenantId/entitlement-overrides/:overrideId/revoke`,
      handle(async ({ request, params }) => {
        const s = requirePlatform(ctx, request, 'platform.overrides.write', true);
        const o =
          db.state.overrides.find(
            (x) => x.id === params.overrideId && x.tenantId === params.tenantId,
          ) ?? fail('NOT_FOUND');
        if (o.revokedAt) return fail('CONFLICT', 'Override already removed');
        const b = await body<RevokeRequest>(request);
        o.revokedAt = db.nowIso();
        o.revokedBy = actorOf(ctx, s);
        o.revokeNote = b.note;
        db.audit({
          tenantId: o.tenantId,
          action: 'override.revoked',
          outcome: 'success',
          actor: o.revokedBy,
          data: { key: o.key },
        });
        db.touch();
        return json(overrideDto(o));
      }),
    ),

    http.get(
      `${P}/tenants/:tenantId/usage`,
      handle(({ request, params }) => {
        requirePlatform(ctx, request, 'platform.tenants.read');
        return json(usage(tenantOr404(params.tenantId as string)));
      }),
    ),

    http.get(
      `${P}/tenants/:tenantId/notes`,
      handle(({ request, params }) => {
        requirePlatform(ctx, request, 'platform.notes.read');
        const t = tenantOr404(params.tenantId as string);
        const url = new URL(request.url);
        const cat = q(url, 'category');
        const rows = db.state.notes
          .filter((n) => n.tenantId === t.id && (!cat || n.category === cat))
          .sort(
            (a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt.localeCompare(a.createdAt),
          )
          .map(noteDto);
        return json(page(rows, url));
      }),
    ),

    http.post(
      `${P}/tenants/:tenantId/notes`,
      handle(async ({ request, params }) => {
        const s = requirePlatform(ctx, request, 'platform.notes.write', true);
        const t = tenantOr404(params.tenantId as string);
        const b = await body<CreateSupportNoteRequest>(request);
        if (!b.body?.trim()) return invalid('body', 'Note cannot be empty');
        const n = {
          id: db.id(),
          tenantId: t.id,
          category: b.category,
          body: b.body.trim(),
          refundStatus: b.refundStatus ?? 'none',
          pinned: b.pinned ?? false,
          author: actorOf(ctx, s),
          createdAt: db.nowIso(),
        };
        db.state.notes.unshift(n);
        db.audit({
          tenantId: t.id,
          action: 'note.added',
          outcome: 'success',
          actor: n.author,
          targetType: 'tenant',
          targetId: t.id,
          targetLabel: t.name,
          data: { category: n.category },
        });
        db.touch();
        return json(noteDto(n), 201);
      }),
    ),

    http.post(
      `${P}/tenants/:tenantId/school-admin-invitations`,
      handle(async ({ request, params }) => {
        const s = requirePlatform(ctx, request, 'platform.tenants.write', true);
        const t = tenantOr404(params.tenantId as string);
        const b = await body<SchoolAdminInvitationRequest>(request);
        const inv = {
          id: db.id(),
          tenantId: t.id,
          email: b.email,
          fullName: b.fullName,
          role: 'school.admin' as const,
          platformRoles: [],
          token: db.token('staffinv'),
          expiresAt: db.addDays(7),
          invitedBy: actorOf(ctx, s),
          createdAt: db.nowIso(),
          status: 'pending' as const,
        };
        db.state.staffInvitations.push(inv);
        db.audit({
          tenantId: t.id,
          action: 'staff.invited',
          outcome: 'success',
          actor: inv.invitedBy,
          targetLabel: b.email,
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

    // ── catalog ───────────────────────────────────────────
    http.get(
      `${P}/plans`,
      handle(({ request }) => {
        requirePlatform(ctx, request, 'platform.plans.read');
        return json({ items: db.state.plans.map((p) => planDto(db, p)) });
      }),
    ),
    http.post(
      `${P}/plans`,
      handle(async ({ request }) => {
        requirePlatform(ctx, request, 'platform.plans.write', true);
        const b = await body<CreatePlanRequest>(request);
        if (db.state.plans.some((p) => p.code === b.code))
          return fail('CONFLICT', 'Plan code already exists');
        const plan = {
          id: db.id(),
          code: b.code,
          name: b.name,
          description: b.description ?? null,
          isPublic: b.isPublic,
          versions: [],
        };
        db.state.plans.push(plan);
        db.touch();
        return json(planDto(db, plan), 201);
      }),
    ),
    http.get(
      `${P}/plans/:planId`,
      handle(({ request, params }) => {
        requirePlatform(ctx, request, 'platform.plans.read');
        const p = db.state.plans.find((x) => x.id === params.planId) ?? fail('NOT_FOUND');
        return json(planDto(db, p));
      }),
    ),
    http.post(
      `${P}/plans/:planId/versions`,
      handle(async ({ request, params }) => {
        requirePlatform(ctx, request, 'platform.plans.write', true);
        const p = db.state.plans.find((x) => x.id === params.planId) ?? fail('NOT_FOUND');
        const b = await body<CreatePlanVersionRequest>(request);
        const version =
          Math.max(
            0,
            ...db.state.planVersions.filter((v) => v.planId === p.id).map((v) => v.version),
          ) + 1;
        const pv = {
          id: db.id(),
          planId: p.id,
          planName: p.name,
          version,
          status: 'draft' as const,
          price: b.price,
          billingPeriod: 'annual' as const,
          features: b.features,
          limits: b.limits,
          createdAt: db.nowIso(),
          publishedAt: null,
        };
        db.state.planVersions.push(pv);
        db.touch();
        return json(pv, 201);
      }),
    ),
    ...(['publish', 'retire'] as const).map((verb) =>
      http.post(
        `${P}/plans/:planId/versions/:versionId/${verb}`,
        handle(({ request, params }) => {
          const s = requirePlatform(ctx, request, 'platform.plans.write', true);
          const pv =
            db.state.planVersions.find(
              (v) => v.id === params.versionId && v.planId === params.planId,
            ) ?? fail('NOT_FOUND');
          if (verb === 'publish' && pv.status !== 'draft')
            return fail('CONFLICT', 'Only draft versions can be published');
          if (verb === 'retire' && pv.status !== 'published')
            return fail('CONFLICT', 'Only published versions can be retired');
          pv.status = verb === 'publish' ? 'published' : 'retired';
          if (verb === 'publish') {
            pv.publishedAt = db.nowIso();
            db.audit({
              tenantId: null,
              action: 'plan.version_published',
              outcome: 'success',
              actor: actorOf(ctx, s),
              targetLabel: `${pv.planName} v${pv.version}`,
            });
          }
          db.touch();
          return json(pv);
        }),
      ),
    ),
    http.get(
      `${P}/feature-flags`,
      handle(({ request }) => {
        requirePlatform(ctx, request, 'platform.tenants.read');
        return json({ items: db.state.flags });
      }),
    ),
    http.put(
      `${P}/feature-flags/:flagKey`,
      handle(async ({ request, params }) => {
        const s = requirePlatform(ctx, request, 'platform.flags.write', true);
        const f = db.state.flags.find((x) => x.key === params.flagKey) ?? fail('NOT_FOUND');
        const b = await body<UpdateFeatureFlagRequest>(request);
        Object.assign(f, {
          enabledByDefault: b.enabledByDefault,
          tenantAllowList: b.tenantAllowList,
          tenantDenyList: b.tenantDenyList,
          updatedAt: db.nowIso(),
        });
        db.audit({
          tenantId: null,
          action: 'flag.updated',
          outcome: 'success',
          actor: actorOf(ctx, s),
          targetLabel: f.key,
          data: { note: b.note },
        });
        db.touch();
        return json(f);
      }),
    ),

    // ── ops ───────────────────────────────────────────────
    http.get(
      `${P}/audit-logs`,
      handle(({ request }) => {
        requirePlatform(ctx, request, 'platform.audit.read');
        const url = new URL(request.url);
        const rows = db.state.audit
          .filter(
            (a) =>
              (!q(url, 'tenantId') || a.tenantId === q(url, 'tenantId')) &&
              (!q(url, 'action') || a.action === q(url, 'action')) &&
              (!q(url, 'actorId') || a.actor.id === q(url, 'actorId')) &&
              (!q(url, 'outcome') || a.outcome === q(url, 'outcome')) &&
              inRange(a.occurredAt, q(url, 'from'), q(url, 'to')),
          )
          .map((a) => auditDto(db, a));
        if (q(url, 'format') === 'csv') return auditCsv(rows);
        return json(page(rows, url, 50));
      }),
    ),
    http.get(
      `${P}/support-sessions`,
      handle(({ request }) => {
        requirePlatform(ctx, request, 'platform.audit.read');
        const url = new URL(request.url);
        const rows = db.state.supportSessions
          .filter((x) => !q(url, 'tenantId') || x.tenantId === q(url, 'tenantId'))
          .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
          .map((x) => ({
            id: x.id,
            tenantId: x.tenantId,
            tenantName: db.tenant(x.tenantId)?.name ?? '',
            reason: x.reason,
            platformUser: {
              type: 'user' as const,
              id: x.platformUserId,
              displayName: db.user(x.platformUserId)?.fullName ?? '',
            },
            startedAt: x.startedAt,
            expiresAt: x.expiresAt,
            endedAt: x.endedAt,
          }));
        return json(page(rows, url));
      }),
    ),
    http.post(
      `${P}/support-sessions`,
      handle(async ({ request }) => {
        const s = requirePlatform(ctx, request, 'platform.support_sessions.create', true);
        const b = await body<CreateSupportSessionRequest>(request);
        const t = tenantOr404(b.tenantId);
        if (!b.reason || b.reason.trim().length < 10)
          return invalid('reason', 'Explain why you need access (at least 10 characters)');
        const user = db.user(s.userId)!;
        const issued = issueSession(
          ctx,
          new Request('http://mock/support', { headers: { Authorization: 'Bearer support' } }),
          user,
          'support',
          { scope: 'support.read_only', supportTenantId: t.id, minutes: b.durationMinutes },
        );
        const rec = {
          id: issued.session.id,
          tenantId: t.id,
          platformUserId: user.id,
          reason: b.reason.trim(),
          startedAt: db.nowIso(),
          expiresAt: db.addMinutes(b.durationMinutes),
          endedAt: null,
        };
        db.state.supportSessions.push(rec);
        db.audit({
          tenantId: t.id,
          action: 'support_session.started',
          outcome: 'success',
          actor: actorOf(ctx, s),
          targetType: 'tenant',
          targetId: t.id,
          targetLabel: t.name,
          data: { reason: rec.reason, minutes: b.durationMinutes },
        });
        db.touch();
        return json(
          {
            ...rec,
            tenantName: t.name,
            platformUser: { type: 'user', id: user.id, displayName: user.fullName },
            tokens: issued.tokens,
          },
          201,
        );
      }),
    ),
    http.post(
      `${P}/support-sessions/:sessionId/end`,
      handle(({ request, params }) => {
        const s = requirePlatform(ctx, request, 'platform.support_sessions.create');
        const rec =
          db.state.supportSessions.find((x) => x.id === params.sessionId) ?? fail('NOT_FOUND');
        rec.endedAt = db.nowIso();
        const sess = db.state.sessions.find((x) => x.id === rec.id);
        if (sess) sess.revokedAt = db.nowIso();
        db.audit({
          tenantId: rec.tenantId,
          action: 'support_session.ended',
          outcome: 'success',
          actor: actorOf(ctx, s),
        });
        db.touch();
        return json({
          id: rec.id,
          tenantId: rec.tenantId,
          tenantName: db.tenant(rec.tenantId)?.name ?? '',
          reason: rec.reason,
          platformUser: {
            type: 'user',
            id: rec.platformUserId,
            displayName: db.user(rec.platformUserId)?.fullName ?? '',
          },
          startedAt: rec.startedAt,
          expiresAt: rec.expiresAt,
          endedAt: rec.endedAt,
        });
      }),
    ),
    http.get(
      `${P}/users`,
      handle(({ request }) => {
        requirePlatform(ctx, request, 'platform.users.manage');
        const rows = db.state.users
          .filter((u) => u.platformRoles.length)
          .map((u) => ({
            userId: u.id,
            fullName: u.fullName,
            email: u.email ?? '',
            roles: u.platformRoles,
            status: u.platformStatus,
            mfaEnabled: u.mfaEnabled,
            lastLoginAt: u.lastLoginAt,
          }));
        return json(page(rows, new URL(request.url)));
      }),
    ),
    http.post(
      `${P}/user-invitations`,
      handle(async ({ request }) => {
        const s = requirePlatform(ctx, request, 'platform.users.manage', true);
        const b = await body<InvitePlatformUserRequest>(request);
        if (db.state.users.some((u) => u.email === b.email && u.platformRoles.length))
          return fail('CONFLICT', 'Already a platform user');
        const u = {
          id: db.id(),
          fullName: b.fullName,
          email: b.email,
          phone: null,
          password: null,
          platformRoles: b.roles,
          platformStatus: 'invited' as const,
          mfaEnabled: false,
          locale: 'en',
          termsVersion: null,
          lastLoginAt: null,
        };
        db.state.users.push(u);
        db.state.staffInvitations.push({
          id: db.id(),
          tenantId: null,
          email: b.email,
          fullName: b.fullName,
          role: null,
          platformRoles: b.roles,
          token: db.token('platinv'),
          expiresAt: db.addDays(7),
          invitedBy: actorOf(ctx, s),
          createdAt: db.nowIso(),
          status: 'pending',
        });
        db.audit({
          tenantId: null,
          action: 'platform_user.invited',
          outcome: 'success',
          actor: actorOf(ctx, s),
          targetLabel: b.email,
        });
        db.touch();
        return json(
          {
            userId: u.id,
            fullName: u.fullName,
            email: b.email,
            roles: u.platformRoles,
            status: u.platformStatus,
            mfaEnabled: false,
            lastLoginAt: null,
          },
          201,
        );
      }),
    ),
    http.patch(
      `${P}/users/:userId`,
      handle(async ({ request, params }) => {
        const s = requirePlatform(ctx, request, 'platform.users.manage', true);
        const u = db.user(params.userId as string);
        if (!u || !u.platformRoles.length) return fail('NOT_FOUND');
        const b = await body<UpdatePlatformUserRequest>(request);
        const supers = db.state.users.filter(
          (x) => x.platformRoles.includes('platform.super_admin') && x.platformStatus === 'active',
        );
        const losesSuper =
          u.platformRoles.includes('platform.super_admin') &&
          ((b.roles && !b.roles.includes('platform.super_admin')) || b.status === 'deactivated');
        if (losesSuper && supers.length <= 1)
          return fail('CONFLICT', 'Cannot remove the last super admin');
        if (b.roles) u.platformRoles = b.roles;
        if (b.status) u.platformStatus = b.status;
        db.audit({
          tenantId: null,
          action: 'platform_user.updated',
          outcome: 'success',
          actor: actorOf(ctx, s),
          targetLabel: u.email,
          data: b as Record<string, unknown>,
        });
        db.touch();
        return json({
          userId: u.id,
          fullName: u.fullName,
          email: u.email ?? '',
          roles: u.platformRoles,
          status: u.platformStatus,
          mfaEnabled: u.mfaEnabled,
          lastLoginAt: u.lastLoginAt,
        });
      }),
    ),
    http.get(
      `${P}/device-transfers`,
      handle(({ request }) => {
        requirePlatform(ctx, request, 'platform.tenants.read');
        const url = new URL(request.url);
        const suspiciousOnly = url.searchParams.get('suspiciousOnly') === 'true';
        const tenantId = q(url, 'tenantId');
        const rows = db.state.transfers
          .filter(
            (t) => (!suspiciousOnly || t.suspicious) && inRange(t.at, q(url, 'from'), q(url, 'to')),
          )
          .map((t) => {
            const u = db.user(t.userId)!;
            const tenants = db.state.guardians
              .filter((g) => g.userId === t.userId)
              .map((g) => ({
                tenantId: g.tenantId,
                tenantName: db.tenant(g.tenantId)?.name ?? '',
              }));
            return {
              transfer: transferDto(db, t),
              userId: u.id,
              fullName: u.fullName,
              maskedPhone: maskPhone(u.phone ?? ''),
              tenants,
            };
          })
          .filter((r) => !tenantId || r.tenants.some((t) => t.tenantId === tenantId))
          .sort((a, b) => b.transfer.at.localeCompare(a.transfer.at));
        return json(page(rows, url));
      }),
    ),
    http.post(
      `${P}/accounts/:userId/cooldown-overrides`,
      handle(async ({ request, params }) => {
        const s = requirePlatform(ctx, request, 'platform.devices.override', true);
        const u = db.user(params.userId as string) ?? fail('NOT_FOUND');
        const b = await body<CooldownOverrideRequest>(request);
        if (!b.note?.trim()) return invalid('note', 'A note is required');
        const o = {
          id: db.id(),
          userId: u.id,
          tenantId: null,
          reasonCode: b.reasonCode,
          note: b.note,
          grantedBy: actorOf(ctx, s),
          grantedByKind: 'platform' as const,
          createdAt: db.nowIso(),
          expiresAt: db.addDays(1),
          usedAt: null,
        };
        db.state.cooldownOverrides.push(o);
        db.audit({
          tenantId: null,
          action: 'device.cooldown_overridden',
          outcome: 'success',
          actor: o.grantedBy,
          targetLabel: u.fullName,
          reasonCode: b.reasonCode,
        });
        db.touch();
        return json(cooldownOverrideDto(db, o), 201);
      }),
    ),
  ];
}
