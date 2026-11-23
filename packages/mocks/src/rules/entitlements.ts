/** SIMULATION of the EntitlementResolver (05-entitlements-lifecycle.md §3). */
import type {
  EffectiveEntitlements,
  EffectiveFeature,
  EffectiveLimit,
  FeatureKey,
  LimitKey,
} from '@homebell/contracts';
import { featureKeyValues, limitKeyValues } from '@homebell/contracts';
import type { MockDb } from '../db/db';
import { OPERATIONAL_MODE } from './lifecycle';

export function resolveEntitlements(db: MockDb, tenantId: string): EffectiveEntitlements {
  const t = db.tenant(tenantId)!;
  const now = db.nowIso();
  const sub = db.state.subscriptions.find((s) => s.tenantId === tenantId);
  const pv = sub ? db.state.planVersions.find((v) => v.id === sub.planVersionId) : undefined;
  const overrides = db.state.overrides.filter(
    (o) => o.tenantId === tenantId && !o.revokedAt && (!o.expiresAt || o.expiresAt > now),
  );
  const mode = OPERATIONAL_MODE[t.state];

  const features: EffectiveFeature[] = (featureKeyValues as readonly FeatureKey[]).map((key) => {
    const ov = overrides.filter((o) => o.kind === 'feature' && o.key === key).at(-1);
    let enabled =
      pv?.features[key] ??
      (t.state === 'trial' || t.state === 'pilot_free'
        ? !key.startsWith('audio') &&
          !key.startsWith('qr') &&
          !key.startsWith('campus') &&
          !key.startsWith('sso')
        : false);
    let source: EffectiveFeature['source'] = pv ? 'plan' : 'default';
    if (ov) {
      enabled = Boolean(ov.value);
      source = 'override';
    }
    const flag = db.state.flags.find((f) => f.key === key);
    if (
      flag &&
      (flag.tenantDenyList.includes(tenantId) ||
        (!flag.enabledByDefault && !flag.tenantAllowList.includes(tenantId)))
    ) {
      enabled = false;
      source = 'flag';
    }
    if (mode !== 'full' && key.startsWith('dismissal.')) {
      enabled = false;
      source = 'lifecycle';
    }
    return { key, enabled, source, overrideId: ov?.id ?? null, expiresAt: ov?.expiresAt ?? null };
  });

  const used: Partial<Record<LimitKey, number>> = {
    'students.max': db.state.students.filter(
      (s) => s.tenantId === tenantId && s.status === 'active',
    ).length,
    'staff.max': db.state.memberships.filter(
      (m) => m.tenantId === tenantId && m.status === 'active',
    ).length,
    'displays.max': db.state.displays.filter((d) => d.tenantId === tenantId && d.state === 'active')
      .length,
  };
  const limits: EffectiveLimit[] = (limitKeyValues as readonly LimitKey[]).map((key) => {
    const ov = overrides.filter((o) => o.kind === 'limit' && o.key === key).at(-1);
    const planValue = pv?.limits[key];
    return {
      key,
      value: ov
        ? (ov.value as number | null)
        : (planValue ?? (key === 'students.max' ? 500 : null)),
      used: used[key] ?? null,
      source: ov ? 'override' : pv ? 'plan' : 'default',
      overrideId: ov?.id ?? null,
      expiresAt: ov?.expiresAt ?? null,
    };
  });

  return { tenantId, state: t.state, operationalMode: mode, features, limits, computedAt: now };
}

export const hasFeature = (db: MockDb, tenantId: string, key: FeatureKey) =>
  resolveEntitlements(db, tenantId).features.find((f) => f.key === key)?.enabled ?? false;

export const limitOf = (db: MockDb, tenantId: string, key: LimitKey) =>
  resolveEntitlements(db, tenantId).limits.find((l) => l.key === key);
