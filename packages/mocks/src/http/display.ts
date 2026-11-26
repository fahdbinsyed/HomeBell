import type { CreatePairingSessionRequest, DisplayHeartbeatRequest } from '@homebell/contracts';
import { http } from 'msw';
import type { DisplayRecord } from '../db/types';
import { displayClassLabels, displayItem, isDisplayed } from '../mappers';
import { hasFeature } from '../rules/entitlements';
import { OPERATIONAL_MODE } from '../rules/lifecycle';
import { body, fail, handle, json, type MockContext } from './context';

export function displayHandlers(ctx: MockContext) {
  const db = ctx.db;
  const D = '*/v1/display';

  const requireDisplay = (request: Request): DisplayRecord => {
    const auth = request.headers.get('Authorization');
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
    const d = token ? db.state.displays.find((x) => x.token === token) : undefined;
    if (!d) return fail('UNAUTHENTICATED');
    if (d.state === 'revoked') return fail('DISPLAY_REVOKED');
    const t = db.tenant(d.tenantId)!;
    if (OPERATIONAL_MODE[t.state] !== 'full')
      return fail('TENANT_NOT_OPERATIONAL', undefined, {
        state: t.state,
        operationalMode: OPERATIONAL_MODE[t.state],
      });
    if (!hasFeature(db, t.id, 'dismissal.display'))
      return fail('FEATURE_NOT_ENTITLED', undefined, { feature: 'dismissal.display' });
    d.lastHeartbeatAt = db.nowIso();
    return d;
  };
  const visible = (d: DisplayRecord, queueDate: string) =>
    db.state.pickups
      .filter((p) => p.tenantId === d.tenantId && p.queueDate === queueDate && isDisplayed(p))
      .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));

  return [
    http.post(
      `${D}/pairing-sessions`,
      handle(async ({ request }) => {
        await body<CreatePairingSessionRequest>(request).catch(() => ({}));
        const ps = {
          id: db.id(),
          code: db.crockford(8),
          pollSecret: db.token('poll'),
          expiresAt: db.addMinutes(10),
          status: 'pending' as const,
          displayId: null,
          tokenDelivered: false,
        };
        db.state.pairingSessions.push(ps);
        db.touch();
        return json(
          {
            pairingSessionId: ps.id,
            pairingCode: ps.code,
            pollSecret: ps.pollSecret,
            expiresAt: ps.expiresAt,
            pollIntervalSeconds: 3,
          },
          201,
        );
      }),
    ),
    http.get(
      `${D}/pairing-sessions/:pairingSessionId`,
      handle(({ request, params }) => {
        const ps =
          db.state.pairingSessions.find(
            (x) =>
              x.id === params.pairingSessionId &&
              x.pollSecret === request.headers.get('X-Pairing-Secret'),
          ) ?? fail('NOT_FOUND');
        if (ps.status === 'pending' && ps.expiresAt < db.nowIso()) ps.status = 'expired';
        if (ps.status !== 'paired')
          return json({ status: ps.status, displayToken: null, displayId: null, tenantId: null });
        const d = db.state.displays.find((x) => x.id === ps.displayId)!;
        const token = ps.tokenDelivered ? null : d.token;
        ps.tokenDelivered = true;
        db.touch();
        return json({
          status: 'paired',
          displayToken: token,
          displayId: d.id,
          tenantId: d.tenantId,
        });
      }),
    ),
    http.get(
      `${D}/feed`,
      handle(({ request }) => {
        const d = requireDisplay(request);
        const t = db.tenant(d.tenantId)!;
        const queueDate = db.today(t.id);
        return json({
          tenantId: t.id,
          displayId: d.id,
          displayName: d.name,
          queueDate,
          seq: db.latestSeq(t.id, queueDate),
          items: visible(d, queueDate).map((p) => displayItem(db, p)),
          classLabels: displayClassLabels(db, t.id),
          settings: {
            schoolName: t.settings.branding.displayName,
            followUpAfterMinutes: t.settings.dismissal.timeouts.requestedStaleMinutes,
            logoUrl: t.settings.branding.logoUrl ?? null,
            primaryColor: t.settings.branding.primaryColor ?? null,
            theme: t.settings.display.theme,
          },
          generatedAt: db.nowIso(),
        });
      }),
    ),
    http.get(
      `${D}/feed/events`,
      handle(({ request }) => {
        const d = requireDisplay(request);
        const url = new URL(request.url);
        const queueDate = url.searchParams.get('queueDate') ?? db.today(d.tenantId);
        const after = Number(url.searchParams.get('afterSeq') ?? 0);
        const events = db.state.queueEvents.filter(
          (e) => e.tenantId === d.tenantId && e.queueDate === queueDate && e.seq > after,
        );
        const latestSeq = db.latestSeq(d.tenantId, queueDate);
        if (events.length > 500)
          return fail('QUEUE_CATCHUP_GAP_TOO_LARGE', undefined, { latestSeq });
        return json({
          events: events.map((e) => {
            const p = db.state.pickups.find((x) => x.id === e.pickupId);
            const shown = p && isDisplayed(p);
            return {
              eventId: e.eventId,
              type: shown ? 'display.item.upserted' : 'display.item.removed',
              seq: e.seq,
              queueDate,
              occurredAt: e.occurredAt,
              item: shown ? { ...displayItem(db, p), seq: e.seq } : null,
              itemId: shown ? null : (e.pickupId ?? null),
            };
          }),
          latestSeq,
          hasMore: false,
        });
      }),
    ),
    http.post(
      `${D}/heartbeat`,
      handle(async ({ request }) => {
        const d = requireDisplay(request);
        const b = await body<DisplayHeartbeatRequest>(request).catch(
          () => ({}) as DisplayHeartbeatRequest,
        );
        if (b.appVersion) d.appVersion = b.appVersion;
        db.touch();
        return json({ serverTime: db.nowIso(), rotatedToken: null });
      }),
    ),
  ];
}
