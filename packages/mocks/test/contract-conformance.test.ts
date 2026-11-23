/**
 * Drives the mock API through realistic platform, school, guardian and display sessions and
 * validates EVERY response (success and error) against the bundled OpenAPI contract.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { createTestEnvironment } from '../src/node';
import { DEMO } from '../src/db/seed';
import {
  allOperationIds,
  coverage,
  validateResponse,
  type ValidationFailure,
} from './contract-validator';

const BASE = 'http://mock.local';
const failures: ValidationFailure[] = [];

type Opts = {
  body?: unknown;
  token?: string;
  deviceId?: string;
  idem?: boolean;
  form?: FormData;
  headers?: Record<string, string>;
};

function client(env: ReturnType<typeof createTestEnvironment>) {
  return async function call<T = any>(
    method: string,
    path: string,
    o: Opts = {},
  ): Promise<{ status: number; body: T }> {
    const headers: Record<string, string> = { ...(o.headers ?? {}) };
    if (o.body !== undefined) headers['Content-Type'] = 'application/json';
    if (o.token) headers.Authorization = `Bearer ${o.token}`;
    if (o.deviceId) headers['X-Device-Id'] = o.deviceId;
    if (o.idem) headers['Idempotency-Key'] = crypto.randomUUID();
    const request = new Request(`${BASE}${path}`, {
      method,
      headers,
      body: o.form ?? (o.body !== undefined ? JSON.stringify(o.body) : undefined),
    });
    const response = await env.fetch(request.clone());
    const failure = await validateResponse(request, response);
    if (failure) failures.push(failure);
    const text = await response.text();
    const isJson = response.headers.get('Content-Type')?.includes('json');
    return { status: response.status, body: (isJson && text ? JSON.parse(text) : text) as T };
  };
}

describe('mock API conforms to the OpenAPI contract', () => {
  it('platform owner session', async () => {
    const env = createTestEnvironment('platform');
    const call = client(env);
    const login = await call('POST', '/v1/auth/staff/login', {
      body: { email: 'owner@homebell.test', password: DEMO.password, audience: 'platform' },
    });
    expect(login.body.status).toBe('mfa_required');
    expect(
      (
        await call('POST', '/v1/auth/staff/mfa/verify', {
          body: { mfaToken: login.body.mfaToken, code: '111111' },
        })
      ).status,
    ).toBe(401);
    const auth = await call('POST', '/v1/auth/staff/mfa/verify', {
      body: { mfaToken: login.body.mfaToken, code: DEMO.mfaCode },
    });
    const token = auth.body.tokens.accessToken as string;
    await call('GET', '/v1/auth/me', { token });

    const list = await call('GET', '/v1/platform/tenants?limit=5', { token });
    expect(list.body.items).toHaveLength(5);
    await call(
      'GET',
      `/v1/platform/tenants?state=trial&state=suspended&cursor=${list.body.nextCursor}`,
      { token },
    );
    const hc = DEMO.hillcrest;
    const detail = await call('GET', `/v1/platform/tenants/${hc}`, { token });
    expect(detail.body.allowedActions).toContain('reinstate');
    for (const sub of [
      'lifecycle-history',
      'subscription',
      'entitlements',
      'entitlement-overrides',
      'usage',
      'notes',
    ])
      await call('GET', `/v1/platform/tenants/${hc}/${sub}`, { token });
    await call('PATCH', `/v1/platform/tenants/${hc}`, {
      token,
      body: { legalName: 'Hillcrest School LLC' },
    });

    // Lifecycle: stale expectedState → 409, invalid → 409, valid reinstate → 200.
    expect(
      (
        await call('POST', `/v1/platform/tenants/${hc}/lifecycle-transitions`, {
          token,
          idem: true,
          body: { action: 'reinstate', expectedState: 'active_paid', reasonCode: 'renewal' },
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await call('POST', `/v1/platform/tenants/${hc}/lifecycle-transitions`, {
          token,
          idem: true,
          body: {
            action: 'start_trial',
            expectedState: 'suspended',
            reasonCode: 'renewal',
            expiresAt: '2027-01-01T00:00:00Z',
          },
        })
      ).status,
    ).toBe(409);
    const reinstated = await call('POST', `/v1/platform/tenants/${hc}/lifecycle-transitions`, {
      token,
      idem: true,
      body: {
        action: 'reinstate',
        expectedState: 'suspended',
        reasonCode: 'renewal',
        note: 'Paid',
      },
    });
    expect(reinstated.body.state).toBe('active_paid');
    expect(
      (
        await call('POST', `/v1/platform/tenants/${hc}/lifecycle-transitions`, {
          token,
          idem: true,
          body: {
            action: 'cancel',
            expectedState: 'active_paid',
            reasonCode: 'school_request',
            confirmTenantName: 'wrong',
          },
        })
      ).status,
    ).toBe(400);

    await call('POST', `/v1/platform/tenants/${hc}/notes`, {
      token,
      body: {
        category: 'refund',
        body: 'Refund handled manually by finance.',
        refundStatus: 'refund_handled_manually',
      },
    });
    const ov = await call('POST', `/v1/platform/tenants/${hc}/entitlement-overrides`, {
      token,
      body: {
        kind: 'limit',
        key: 'displays.max',
        value: 9,
        reasonCode: 'contract_signed',
        note: 'Extra screens',
      },
    });
    await call('POST', `/v1/platform/tenants/${hc}/entitlement-overrides/${ov.body.id}/revoke`, {
      token,
      body: { note: 'No longer needed' },
    });
    await call('PUT', `/v1/platform/tenants/${hc}/subscription`, {
      token,
      body: {
        planVersionId: env.db.state.planVersions[0]!.id,
        startsAt: '2026-08-01T00:00:00Z',
        endsAt: '2027-07-31T00:00:00Z',
      },
    });
    await call('POST', `/v1/platform/tenants/${hc}/school-admin-invitations`, {
      token,
      body: { email: 'new@hillcrest.test', fullName: 'New Admin' },
    });

    const created = await call('POST', '/v1/platform/tenants', {
      token,
      idem: true,
      body: {
        name: 'Test School',
        slug: 'test-school',
        countryCode: 'US',
        region: 'us-east',
        timezone: 'America/New_York',
        termStartDate: '2026-08-20',
        termEndDate: '2027-06-10',
        initialState: 'trial',
        expiresAt: '2027-01-01T00:00:00Z',
        primaryContact: { fullName: 'Pat Doe', email: 'pat@test-school.test' },
      },
    });
    expect(created.status).toBe(201);
    expect(
      (
        await call('POST', '/v1/platform/tenants', {
          token,
          idem: true,
          body: {
            name: 'Dup',
            slug: 'test-school',
            countryCode: 'US',
            region: 'us-east',
            timezone: 'UTC',
            termStartDate: '2026-08-20',
            termEndDate: '2027-06-10',
            initialState: 'draft',
            primaryContact: { fullName: 'X', email: 'x@x.test' },
          },
        })
      ).status,
    ).toBe(409);

    const plans = await call('GET', '/v1/platform/plans', { token });
    const plan = plans.body.items[0];
    await call('GET', `/v1/platform/plans/${plan.id}`, { token });
    const v = await call('POST', `/v1/platform/plans/${plan.id}/versions`, {
      token,
      body: {
        price: { amountMinor: 1000, currency: 'USD' },
        features: { 'dismissal.queue': true },
        limits: { 'students.max': 10 },
      },
    });
    await call('POST', `/v1/platform/plans/${plan.id}/versions/${v.body.id}/publish`, { token });
    await call('POST', `/v1/platform/plans/${plan.id}/versions/${v.body.id}/retire`, { token });
    await call('POST', '/v1/platform/plans', {
      token,
      body: { code: 'enterprise', name: 'Enterprise', isPublic: false },
    });
    const flags = await call('GET', '/v1/platform/feature-flags', { token });
    await call('PUT', `/v1/platform/feature-flags/${flags.body.items[0].key}`, {
      token,
      body: { enabledByDefault: false, tenantAllowList: [], tenantDenyList: [], note: 'Pause' },
    });
    await call('GET', '/v1/platform/audit-logs?limit=10', { token });
    await call('GET', '/v1/platform/audit-logs?format=csv', { token });
    const ss = await call('POST', '/v1/platform/support-sessions', {
      token,
      body: {
        tenantId: DEMO.greenfield,
        reason: 'Investigating a queue issue',
        durationMinutes: 15,
      },
    });
    await call('GET', '/v1/platform/support-sessions', { token });
    await call('POST', `/v1/platform/support-sessions/${ss.body.id}/end`, { token });
    await call('GET', '/v1/platform/users', { token });
    await call('POST', '/v1/platform/user-invitations', {
      token,
      body: {
        email: 'analyst@homebell.test',
        fullName: 'Ana Lyst',
        roles: ['platform.support_analyst'],
      },
    });
    expect(
      (
        await call('PATCH', `/v1/platform/users/${env.db.state.users[0]!.id}`, {
          token,
          body: { roles: ['platform.ops_admin'] },
        })
      ).status,
    ).toBe(409);
    const transfers = await call('GET', '/v1/platform/device-transfers?suspiciousOnly=true', {
      token,
    });
    await call(
      'POST',
      `/v1/platform/accounts/${transfers.body.items[0].userId}/cooldown-overrides`,
      { token, body: { reasonCode: 'lost_device', note: 'Verified by phone' } },
    );
    expect(
      (await call('GET', '/v1/platform/tenants/00000000-0000-7000-8000-ffffffffffff', { token }))
        .status,
    ).toBe(404);
    expect((await call('GET', '/v1/platform/tenants', { token: 'not-a-real-token' })).status).toBe(
      401,
    );
    await call('POST', '/v1/auth/logout', { token });
  });

  it('school staff session', async () => {
    const env = createTestEnvironment('school', 'quiet_queue');
    const call = client(env);
    const login = await call('POST', '/v1/auth/staff/login', {
      body: { email: 'admin@greenfield.test', password: DEMO.password },
    });
    expect(login.body.status).toBe('authenticated');
    const token = login.body.tokens.accessToken as string;
    const t = `/v1/t/${DEMO.greenfield}`;
    for (const p of [
      'overview',
      'entitlements',
      'subscription',
      'settings',
      'classes',
      'staff',
      'displays',
      'guardians?limit=5',
      'students?limit=5&q=rivera',
      'audit-logs',
      'queue',
      'queue/events?afterSeq=0',
    ])
      await call('GET', `${t}/${p}`, { token });
    for (const r of ['pickups', 'unresolved', 'guardian-activity', 'device-transfers', 'usage']) {
      await call('GET', `${t}/reports/${r}`, { token });
      await call('GET', `${t}/reports/${r}?format=csv`, { token });
    }
    const settings = await call('GET', `${t}/settings`, { token });
    await call('PUT', `${t}/settings`, { token, body: settings.body });
    const classes = await call('GET', `${t}/classes`, { token });
    const cls = await call('POST', `${t}/classes`, {
      token,
      body: { name: 'Grade 6', sortOrder: 6 },
    });
    const sec = await call('POST', `${t}/classes/${cls.body.id}/sections`, {
      token,
      body: { name: 'A' },
    });
    await call('PATCH', `${t}/sections/${sec.body.id}`, { token, body: { name: 'Blue' } });
    await call('DELETE', `${t}/sections/${sec.body.id}`, { token });
    await call('PATCH', `${t}/classes/${cls.body.id}`, { token, body: { gradeLevel: '6' } });
    await call('DELETE', `${t}/classes/${cls.body.id}`, { token });
    expect(
      (await call('DELETE', `${t}/classes/${classes.body.items[0].id}`, { token })).status,
    ).toBe(409);

    const student = await call('POST', `${t}/students`, {
      token,
      body: {
        firstName: 'Nia',
        lastName: 'Test',
        classId: classes.body.items[0].id,
        primaryGuardian: { fullName: 'Ola Test', phone: '+15559990001', relationship: 'mother' },
      },
    });
    expect(student.status).toBe(201);
    await call('GET', `${t}/students/${student.body.id}`, { token });
    await call('PATCH', `${t}/students/${student.body.id}`, {
      token,
      body: { preferredName: 'Nini' },
    });
    await call('GET', `${t}/students/${student.body.id}/guardians`, { token });
    await call('POST', `${t}/students/${student.body.id}/deactivate`, {
      token,
      body: { note: 'Moved' },
    });
    await call('POST', `${t}/students/${student.body.id}/reactivate`, { token, body: {} });
    expect(
      (
        await call('POST', `${t}/students`, {
          token,
          body: {
            firstName: 'X',
            lastName: 'Y',
            classId: classes.body.items[0].id,
            primaryGuardian: { fullName: 'Z', phone: '555', relationship: 'mother' },
          },
        })
      ).status,
    ).toBe(400);

    await call('GET', `${t}/imports/template`, { token });
    const form = new FormData();
    form.set('type', 'students_with_guardians');
    form.set(
      'file',
      new File(
        [
          'student_external_ref,student_first_name,student_last_name,class,section,guardian_full_name,guardian_phone,guardian_relationship\nS9001,Ama,Ofori,Grade 1,A,Kofi Ofori,+15559990002,father\n,Bad,Row,Grade 99,A,No One,12345,cousin\n',
        ],
        'import.csv',
        { type: 'text/csv' },
      ),
    );
    const job = await call('POST', `${t}/imports`, { token, form });
    expect(job.body.summary.errorRows).toBe(1);
    await call('GET', `${t}/imports/${job.body.id}`, { token });
    await call('GET', `${t}/imports/${job.body.id}/rows?status=error`, { token });
    expect(
      (await call('POST', `${t}/imports/${job.body.id}/commit`, { token, idem: true, body: {} }))
        .status,
    ).toBe(422);
    expect(
      (
        await call('POST', `${t}/imports/${job.body.id}/commit`, {
          token,
          idem: true,
          body: { skipErrorRows: true },
        })
      ).body.status,
    ).toBe('completed');

    const guardians = await call('GET', `${t}/guardians?state=active&kind=primary`, { token });
    const g = guardians.body.items.find((x: any) => x.maskedPhone.endsWith('0006'));
    await call('GET', `${t}/guardians/${g.id}`, { token });
    await call('GET', `${t}/guardians/${g.id}/devices`, { token });
    await call('POST', `${t}/guardians/${g.id}/cooldown-overrides`, {
      token,
      body: { reasonCode: 'lost_device', note: 'Phone lost' },
    });
    await call('POST', `${t}/guardians/${g.id}/block`, {
      token,
      body: { reason: 'Testing block' },
    });
    await call('POST', `${t}/guardians/${g.id}/unblock`, { token, body: { reason: 'Resolved' } });
    await call('POST', `${t}/guardians/${g.id}/deactivate`, { token, body: { reason: 'Left' } });
    await call('POST', `${t}/guardians/${g.id}/reactivate`, { token, body: { reason: 'Back' } });
    await call('PATCH', `${t}/guardians/${g.id}`, { token, body: { fullName: 'Riley P. Patel' } });
    await call('POST', `${t}/guardians/${g.id}/send-welcome`, { token });
    const ng = await call('POST', `${t}/guardians`, {
      token,
      body: {
        fullName: 'Second Parent',
        phone: '+15559990003',
        links: [{ studentId: student.body.id, relationship: 'father', isPrimary: false }],
      },
    });
    await call('POST', `${t}/guardians/${ng.body.id}/links`, {
      token,
      body: {
        studentId: guardians.body.items[0].students[0].studentId,
        relationship: 'other',
        isPrimary: false,
      },
    });
    await call('DELETE', `${t}/guardians/${ng.body.id}/links/${student.body.id}`, { token });
    const jordan = env.db.state.guardians.find(
      (x) => x.tenantId === DEMO.greenfield && x.phone === DEMO.phones.primary,
    )!;
    await call('POST', `${t}/license-seats/grants`, {
      token,
      idem: true,
      body: { primaryGuardianId: jordan.id, count: 1, note: 'School-paid' },
    });

    const staff = await call('GET', `${t}/staff`, { token });
    const inv = await call('POST', `${t}/staff-invitations`, {
      token,
      body: { email: 'teacher@greenfield.test', fullName: 'Tea Cher', role: 'school.front_desk' },
    });
    await call('DELETE', `${t}/staff-invitations/${inv.body.id}`, { token });
    const dispatcher = staff.body.members.find((m: any) => m.role === 'school.dispatcher');
    await call('PATCH', `${t}/staff/${dispatcher.membershipId}`, {
      token,
      body: { role: 'school.front_desk' },
    });
    await call('POST', `${t}/staff/${dispatcher.membershipId}/deactivate`, { token });
    await call('POST', `${t}/staff/${dispatcher.membershipId}/reactivate`, { token });

    const queue = await call('GET', `${t}/queue?state=requested&state=exception`, { token });
    const requested = queue.body.items.filter((i: any) => i.state === 'requested');
    const exception = queue.body.items.find((i: any) => i.state === 'exception');
    await call('GET', `${t}/pickup-requests/${requested[0].id}`, { token });
    await call('POST', `${t}/pickup-requests/${requested[0].id}/sent-out`, { token, idem: true });
    await call('POST', `${t}/pickup-requests/sent-out`, {
      token,
      idem: true,
      body: { requestIds: [requested[1].id, requested[0].id, exception.id] },
    });
    await call('POST', `${t}/pickup-requests/${requested[2].id}/cancel`, {
      token,
      body: { reason: 'Duplicate request' },
    });
    await call('POST', `${t}/pickup-requests/${exception.id}/resolve`, {
      token,
      body: { resolution: 'guardian_confirmed_offline', note: 'Called the parent' },
    });
    expect(
      (
        await call('POST', `${t}/pickup-requests/${exception.id}/resolve`, {
          token,
          body: { resolution: 'other', note: 'x' },
        })
      ).status,
    ).toBe(409);
    const events = await call('GET', `${t}/queue/events?afterSeq=${queue.body.seq}`, { token });
    expect(events.body.events.length).toBeGreaterThan(0);

    const pairing = await call('POST', '/v1/display/pairing-sessions', {
      body: { appVersion: '1.0.0' },
    });
    const paired = await call('POST', `${t}/displays/pair`, {
      token,
      body: { pairingCode: pairing.body.pairingCode.toLowerCase(), name: 'Gym TV' },
    });
    expect(paired.status).toBe(201);
    const poll = await call(
      'GET',
      `/v1/display/pairing-sessions/${pairing.body.pairingSessionId}`,
      { headers: { 'X-Pairing-Secret': pairing.body.pollSecret } },
    );
    expect(poll.body.displayToken).toBeTruthy();
    await call('PATCH', `${t}/displays/${paired.body.id}`, { token, body: { zone: 'gym' } });
    await call('POST', `${t}/displays/${paired.body.id}/revoke`, { token });
    expect((await call('GET', '/v1/display/feed', { token: poll.body.displayToken })).status).toBe(
      401,
    );

    // Tenant isolation: Greenfield staff cannot see Riverside → 404.
    expect((await call('GET', `/v1/t/${DEMO.riverside}/students`, { token })).status).toBe(404);
    // Role: front desk cannot manage staff.
    const fd = await call('POST', '/v1/auth/staff/login', {
      body: { email: 'frontdesk@greenfield.test', password: DEMO.password },
    });
    expect((await call('GET', `${t}/staff`, { token: fd.body.tokens.accessToken })).status).toBe(
      403,
    );
  });

  it('guardian app session', async () => {
    const env = createTestEnvironment('guardian', 'quiet_queue');
    const call = client(env);
    const deviceId = crypto.randomUUID();
    const device = { platform: 'ios', model: 'iPhone 16', osVersion: '19.1', appVersion: '1.0.0' };
    const ch = await call('POST', '/v1/auth/otp/send', {
      deviceId,
      body: { phone: DEMO.phones.primary, purpose: 'login' },
    });
    expect(ch.status).toBe(202);
    expect(
      (
        await call('POST', '/v1/auth/otp/resend', {
          deviceId,
          body: { challengeId: ch.body.challengeId },
        })
      ).status,
    ).toBe(429);
    expect(
      (
        await call('POST', '/v1/auth/otp/verify', {
          deviceId,
          body: { challengeId: ch.body.challengeId, code: '123456', device },
        })
      ).status,
    ).toBe(422);
    const ok = await call('POST', '/v1/auth/otp/verify', {
      deviceId,
      body: { challengeId: ch.body.challengeId, code: DEMO.otpCode, device },
    });
    expect(ok.body.outcome).toBe('authenticated');
    const token = ok.body.tokens.accessToken as string;
    await call('POST', '/v1/me/terms-acceptance', {
      token,
      deviceId,
      body: { termsVersion: '2026-08' },
    });
    await call('GET', '/v1/me/profile', { token, deviceId });
    await call('PATCH', '/v1/me/profile', { token, deviceId, body: { locale: 'en' } });
    const kids = await call('GET', '/v1/me/children', { token, deviceId });
    expect(kids.body.items.length).toBe(3);
    const gfKids = kids.body.items
      .filter((k: any) => k.tenantId === DEMO.greenfield)
      .map((k: any) => k.studentId);
    const created = await call('POST', '/v1/me/pickup-requests', {
      token,
      deviceId,
      idem: true,
      body: { tenantId: DEMO.greenfield, studentIds: gfKids, note: 'Red car' },
    });
    expect(created.body.created).toHaveLength(2);
    const dup = await call('POST', '/v1/me/pickup-requests', {
      token,
      deviceId,
      idem: true,
      body: { tenantId: DEMO.greenfield, studentIds: gfKids },
    });
    expect(dup.body.code).toBe('DUPLICATE_ACTIVE_REQUEST');
    const rv = kids.body.items.find((k: any) => k.tenantId === DEMO.riverside);
    await call('POST', '/v1/me/pickup-requests', {
      token,
      deviceId,
      idem: true,
      body: { tenantId: DEMO.riverside, studentIds: [rv.studentId] },
    });
    const id = created.body.created[0].id;
    await call('GET', `/v1/me/pickup-requests/${id}`, { token, deviceId });
    await call('POST', `/v1/me/pickup-requests/${created.body.created[1].id}/cancel`, {
      token,
      deviceId,
      body: { reason: 'Changed plans' },
    });
    await call('POST', `/v1/me/pickup-requests/${id}/acknowledge`, { token, deviceId, idem: true });
    await call('GET', '/v1/me/pickup-requests?limit=5', { token, deviceId });
    await call('GET', '/v1/me/notifications', { token, deviceId });
    await call('POST', '/v1/me/notifications/read', { token, deviceId, body: { all: true } });
    await call('GET', '/v1/me/device', { token, deviceId });
    await call('POST', '/v1/me/push-tokens', {
      token,
      deviceId,
      body: { provider: 'fcm', token: 'fcm-demo-token' },
    });
    await call('DELETE', '/v1/me/push-tokens/current', { token, deviceId });

    const seats = await call('GET', `/v1/me/license-seats?tenantId=${DEMO.greenfield}`, {
      token,
      deviceId,
    });
    await call('GET', '/v1/me/guardians', { token, deviceId });
    for (const provider of ['google_play', 'apple_app_store']) {
      const intent = await call('POST', '/v1/me/license-purchases', {
        token,
        deviceId,
        idem: true,
        body: { tenantId: DEMO.greenfield, provider },
      });
      expect(
        (
          await call('POST', `/v1/me/license-purchases/${intent.body.intentId}/complete`, {
            token,
            deviceId,
            idem: true,
            body: { purchaseToken: 'pending-1', productId: 'guardian_seat_term' },
          })
        ).body.state,
      ).toBe('pending');
      expect(
        (
          await call('POST', `/v1/me/license-purchases/${intent.body.intentId}/complete`, {
            token,
            deviceId,
            idem: true,
            body: { purchaseToken: 'invalid-1', productId: 'guardian_seat_term' },
          })
        ).status,
      ).toBe(422);
      await call('POST', `/v1/me/license-purchases/${intent.body.intentId}/complete`, {
        token,
        deviceId,
        idem: true,
        body: { purchaseToken: `ok-${provider}`, productId: 'guardian_seat_term' },
      });
    }
    const available = seats.body.items.find((s: any) => s.state === 'available');
    const invite = await call('POST', '/v1/me/guardian-invitations', {
      token,
      deviceId,
      idem: true,
      body: {
        tenantId: DEMO.greenfield,
        seatId: available.id,
        fullName: 'Grandma Rivera',
        phone: '+15559990010',
        relationship: 'grandparent',
        studentIds: [gfKids[0]],
        validity: { mode: 'temporary', durationDays: 7 },
      },
    });
    expect(invite.status).toBe(201);
    await call('PATCH', `/v1/me/guardians/${invite.body.guardian.guardianId}`, {
      token,
      deviceId,
      body: { validity: { mode: 'valid_until_date', validUntil: '2027-01-15' } },
    });
    await call('POST', `/v1/me/guardians/${invite.body.guardian.guardianId}/invitation/resend`, {
      token,
      deviceId,
    });

    // Invited guardian redeems on a separate device.
    const device2 = crypto.randomUUID();
    const look = await call('POST', '/v1/invitations/lookup', {
      deviceId: device2,
      body: { code: DEMO.invitationCode },
    });
    expect(
      (
        await call('POST', `/v1/invitations/${look.body.invitationId}/otp`, {
          deviceId: device2,
          body: { code: DEMO.invitationCode, phone: '+15550000000' },
        })
      ).status,
    ).toBe(422);
    const ich = await call('POST', `/v1/invitations/${look.body.invitationId}/otp`, {
      deviceId: device2,
      body: { code: DEMO.invitationCode, phone: DEMO.phones.invited },
    });
    const redeemed = await call('POST', `/v1/invitations/${look.body.invitationId}/redeem`, {
      deviceId: device2,
      idem: true,
      body: {
        challengeId: ich.body.challengeId,
        otpCode: DEMO.otpCode,
        device: { ...device, platform: 'android', model: 'Pixel 9' },
      },
    });
    expect(redeemed.body.outcome).toBe('authenticated');
    expect(
      (
        await call('POST', '/v1/invitations/lookup', {
          deviceId: device2,
          body: { code: DEMO.expiredInvitationCode },
        })
      ).status,
    ).toBe(410);
    expect(
      (
        await call('POST', '/v1/invitations/lookup', {
          deviceId: device2,
          body: { code: 'ZZZZZZZZZZ' },
        })
      ).status,
    ).toBe(404);
    await call('POST', `/v1/me/guardians/${invite.body.guardian.guardianId}/revoke`, {
      token,
      deviceId,
    });

    // Device conflict + transfer (Riley: allowed), cooldown (Drew: blocked), limited purchase session.
    const d3 = crypto.randomUUID();
    const rch = await call('POST', '/v1/auth/otp/send', {
      deviceId: d3,
      body: { phone: DEMO.phones.conflictTransferAllowed, purpose: 'login' },
    });
    const conflict = await call('POST', '/v1/auth/otp/verify', {
      deviceId: d3,
      body: { challengeId: rch.body.challengeId, code: DEMO.otpCode, device },
    });
    expect(conflict.body.outcome).toBe('device_conflict');
    const moved = await call('POST', '/v1/auth/device-transfer', {
      deviceId: d3,
      idem: true,
      body: { conflictToken: conflict.body.conflict.conflictToken },
    });
    expect(moved.status).toBe(200);
    const dch = await call('POST', '/v1/auth/otp/send', {
      deviceId: d3,
      body: { phone: DEMO.phones.conflictInCooldown, purpose: 'login' },
    });
    const cool = await call('POST', '/v1/auth/otp/verify', {
      deviceId: d3,
      body: { challengeId: dch.body.challengeId, code: DEMO.otpCode, device },
    });
    expect(cool.body.conflict.transfer.allowed).toBe(false);
    expect(
      (
        await call('POST', '/v1/auth/device-transfer', {
          deviceId: d3,
          idem: true,
          body: { conflictToken: cool.body.conflict.conflictToken },
        })
      ).status,
    ).toBe(409);
    const limited = await call('POST', '/v1/auth/device-conflict/limited-session', {
      deviceId: d3,
      body: { conflictToken: cool.body.conflict.conflictToken },
    });
    expect(limited.body.scope).toBe('guardian.license_purchase');
    expect(
      (await call('GET', '/v1/me/children', { token: limited.body.accessToken, deviceId: d3 }))
        .status,
    ).toBe(403);

    // Blocked guardian, no account, suspended school.
    const bch = await call('POST', '/v1/auth/otp/send', {
      deviceId: crypto.randomUUID(),
      body: { phone: DEMO.phones.noAccount, purpose: 'login' },
    });
    expect(
      (
        await call('POST', '/v1/auth/otp/verify', {
          deviceId: crypto.randomUUID(),
          body: { challengeId: bch.body.challengeId, code: DEMO.otpCode, device },
        })
      ).body.outcome,
    ).toBe('no_account');
    expect(
      (
        await call('POST', '/v1/auth/otp/send', {
          deviceId,
          body: { phone: '+447700900000', purpose: 'login' },
        })
      ).status,
    ).toBe(422);
    const refreshed = await call('POST', '/v1/auth/refresh', {
      deviceId,
      body: { refreshToken: ok.body.tokens.refreshToken },
    });
    expect(refreshed.status).toBe(200);
    await call('POST', '/v1/auth/realtime-tickets', {
      token: refreshed.body.accessToken,
      body: { hub: 'guardian' },
    });
    expect(
      (await call('GET', '/v1/me/children', { token: refreshed.body.accessToken })).status,
    ).toBe(400);
  });

  it('staff onboarding and account recovery', async () => {
    const env = createTestEnvironment('platform');
    const call = client(env);
    await call('POST', '/v1/auth/staff/password/forgot', {
      body: { email: 'admin@greenfield.test' },
    });
    expect(
      (
        await call('POST', '/v1/auth/staff/password/reset', {
          body: { token: 'nope', newPassword: 'long-enough-password' },
        })
      ).status,
    ).toBe(410);
    await call('POST', '/v1/auth/staff/password/reset', {
      body: { token: 'reset_demo', newPassword: 'long-enough-password' },
    });

    // School staff invitation → new account.
    const preview = await call('POST', '/v1/auth/staff/invitations/preview', {
      body: { token: 'staffinv_demo_greenfield' },
    });
    expect(preview.body.accountExists).toBe(false);
    const accepted = await call('POST', '/v1/auth/staff/invitations/accept', {
      body: {
        token: 'staffinv_demo_greenfield',
        fullName: 'Jesse Moore',
        password: 'a-strong-password',
      },
    });
    expect(accepted.body.status).toBe('authenticated');
    await call('POST', '/v1/auth/logout', { token: accepted.body.tokens.accessToken });

    // Platform user invitation → MFA enrollment on first sign-in.
    const owner = await call('POST', '/v1/auth/staff/login', {
      body: { email: 'owner@homebell.test', password: DEMO.password, audience: 'platform' },
    });
    const ownerTokens = (
      await call('POST', '/v1/auth/staff/mfa/verify', {
        body: { mfaToken: owner.body.mfaToken, code: DEMO.mfaCode },
      })
    ).body.tokens;
    await call('POST', '/v1/platform/user-invitations', {
      token: ownerTokens.accessToken,
      body: { email: 'newops@homebell.test', fullName: 'New Ops', roles: ['platform.ops_admin'] },
    });
    const platInv = env.db.state.staffInvitations.find((i) => i.email === 'newops@homebell.test')!;
    const acc = await call('POST', '/v1/auth/staff/invitations/accept', {
      body: { token: platInv.token, password: 'another-strong-password' },
    });
    expect(acc.body.status).toBe('mfa_enrollment_required');
    const start = await call('POST', '/v1/auth/staff/mfa/enroll', {
      body: { enrollmentToken: acc.body.enrollmentToken },
    });
    const done = await call('POST', '/v1/auth/staff/mfa/enroll/confirm', {
      body: {
        enrollmentToken: acc.body.enrollmentToken,
        enrollmentId: start.body.enrollmentId,
        code: DEMO.mfaCode,
      },
    });
    expect(done.body.recoveryCodes.length).toBeGreaterThan(0);
  });

  it('display session', async () => {
    const env = createTestEnvironment('display', 'quiet_queue');
    const call = client(env);
    const token = DEMO.displayToken;
    const feed = await call('GET', '/v1/display/feed', { token });
    expect(feed.body.items.length).toBeGreaterThan(0);
    expect(JSON.stringify(feed.body)).not.toMatch(/\+1555/);
    await call('GET', `/v1/display/feed/events?afterSeq=0`, { token });
    await call('POST', '/v1/display/heartbeat', {
      token,
      body: { appVersion: '1.0.0', lastSeq: feed.body.seq },
    });
    env.setScenario('tenant_suspended');
    expect((await call('GET', '/v1/display/feed', { token })).status).toBe(403);
  });

  afterAll(() => {
    if (failures.length) console.error(JSON.stringify(failures, null, 2));
    const uncovered = allOperationIds().filter(
      (id) =>
        !coverage.has(id) && !['googlePlayNotification', 'appStoreServerNotification'].includes(id),
    );
    console.log(
      `contract coverage: ${coverage.size} operations exercised; not exercised: ${uncovered.join(', ') || 'none'}`,
    );
  });

  it('every response matched the contract', () => {
    expect(failures).toEqual([]);
  });
});
