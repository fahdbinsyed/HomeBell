/**
 * Guardian data flow through the typed client + mock API, running in the React Native Jest
 * environment: OTP sign-in → children → request pickup (idempotent) → confirm → invitation.
 */
import { createGuardianClient, unwrap, ApiError } from '@homebell/api-client';
import { createMockEnvironment, DEMO } from '@homebell/mocks/native';
import { toE164 } from '@/features/flow-store';

const device = {
  platform: 'android' as const,
  model: 'Pixel 9',
  osVersion: '16',
  appVersion: '1.0.0',
};

function setup() {
  const env = createMockEnvironment({ app: 'guardian', simulator: false });
  env.setScenario('quiet_queue');
  let token: string | null = null;
  const deviceId = '7b0e2f7c-1111-4222-8333-444455556666';
  const client = createGuardianClient({
    baseUrl: 'https://api.homebell.app',
    fetch: env.fetch,
    getAccessToken: () => token,
    getDeviceId: () => deviceId,
  });
  return { env, client, setToken: (t: string) => (token = t) };
}

describe('guardian flow (mock API)', () => {
  it('normalises phone input to E.164', () => {
    expect(toE164('555 010 0001')).toBe('+15550100001');
    expect(toE164('+44 7700 900000')).toBe('+447700900000');
  });

  it('signs in with OTP, requests pickup and confirms', async () => {
    const { client, setToken } = setup();
    const ch = await unwrap(
      client.POST('/v1/auth/otp/send', { body: { phone: DEMO.phones.primary, purpose: 'login' } }),
    );
    await expect(
      unwrap(
        client.POST('/v1/auth/otp/verify', {
          body: { challengeId: ch.challengeId, code: '999999', device },
        }),
      ),
    ).rejects.toMatchObject({ code: 'OTP_INVALID' });
    const r = await unwrap(
      client.POST('/v1/auth/otp/verify', {
        body: { challengeId: ch.challengeId, code: DEMO.otpCode, device },
      }),
    );
    if (r.outcome !== 'authenticated') throw new Error(`unexpected ${r.outcome}`);
    setToken(r.tokens.accessToken);

    const kids = await unwrap(client.GET('/v1/me/children'));
    expect(kids.tenants.map((t) => t.tenantName)).toEqual(
      expect.arrayContaining(['Greenfield Academy', 'Riverside Primary']),
    );
    const gf = kids.items.filter((k) => k.tenantId === DEMO.greenfield);

    const key = 'double-tap-key-0001';
    const first = await unwrap(
      client.POST('/v1/me/pickup-requests', {
        params: { header: { 'Idempotency-Key': key } },
        body: { tenantId: DEMO.greenfield, studentIds: [gf[0]!.studentId] },
      }),
    );
    const replay = await unwrap(
      client.POST('/v1/me/pickup-requests', {
        params: { header: { 'Idempotency-Key': key } },
        body: { tenantId: DEMO.greenfield, studentIds: [gf[0]!.studentId] },
      }),
    );
    expect(replay.created[0]!.id).toBe(first.created[0]!.id); // double tap → same request

    const ack = await unwrap(
      client.POST('/v1/me/pickup-requests/{requestId}/acknowledge', {
        params: {
          path: { requestId: first.created[0]!.id },
          header: { 'Idempotency-Key': 'ack-1' },
        },
      }),
    );
    expect(ack.state).toBe('acknowledged');
  });

  it('reports a device conflict with cooldown for a recently transferred account', async () => {
    const { client } = setup();
    const ch = await unwrap(
      client.POST('/v1/auth/otp/send', {
        body: { phone: DEMO.phones.conflictInCooldown, purpose: 'login' },
      }),
    );
    const r = await unwrap(
      client.POST('/v1/auth/otp/verify', {
        body: { challengeId: ch.challengeId, code: DEMO.otpCode, device },
      }),
    );
    expect(r.outcome).toBe('device_conflict');
    if (r.outcome !== 'device_conflict') return;
    expect(r.conflict.transfer.allowed).toBe(false);
    const err = await unwrap(
      client.POST('/v1/auth/device-transfer', {
        params: { header: { 'Idempotency-Key': 't-1' } },
        body: { conflictToken: r.conflict.conflictToken },
      }),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('DEVICE_TRANSFER_COOLDOWN');
  });

  it('blocks pickup requests for a blocked guardian', async () => {
    const { env, client, setToken } = setup();
    env.setScenario('blocked_guardian');
    const ch = await unwrap(
      client.POST('/v1/auth/otp/send', { body: { phone: DEMO.phones.primary, purpose: 'login' } }),
    );
    const r = await unwrap(
      client.POST('/v1/auth/otp/verify', {
        body: { challengeId: ch.challengeId, code: DEMO.otpCode, device },
      }),
    );
    if (r.outcome !== 'authenticated') throw new Error('expected sign-in');
    setToken(r.tokens.accessToken);
    const kids = await unwrap(client.GET('/v1/me/children'));
    const gfCtx = kids.tenants.find((t) => t.tenantId === DEMO.greenfield)!;
    expect(gfCtx.guardianState).toBe('blocked');
    const studentId = kids.items.find((k) => k.tenantId === DEMO.greenfield)!.studentId;
    await expect(
      unwrap(
        client.POST('/v1/me/pickup-requests', {
          params: { header: { 'Idempotency-Key': 'b-1' } },
          body: { tenantId: DEMO.greenfield, studentIds: [studentId] },
        }),
      ),
    ).rejects.toMatchObject({ code: 'GUARDIAN_BLOCKED' });
  });
});
