/** SIMULATION of pickup eligibility (06-state-machines.md §1) and guardian validity (ADR-0011). */
import type { ErrorCode, PickupEligibility } from '@homebell/contracts';
import type { MockDb } from '../db/db';
import type { GuardianRecord, StudentRecord } from '../db/types';
import { tzOffsetMinutes } from '../db/tz';
import { hasFeature } from './entitlements';
import { OPERATIONAL_MODE } from './lifecycle';

export const OPEN_STATES = ['requested', 'sent_out', 'exception'] as const;

/** Effective guardian state after validity windows (temporary / valid-until / one-time). */
export function effectiveGuardianState(db: MockDb, g: GuardianRecord): GuardianRecord['state'] {
  if (g.state === 'active' && g.validUntil && g.validUntil < db.nowIso()) return 'expired';
  return g.state;
}

/** Guardian-level rejection that applies to every child (null = ok). */
export function guardianRejection(db: MockDb, g: GuardianRecord): ErrorCode | null {
  const t = db.tenant(g.tenantId);
  if (!t || OPERATIONAL_MODE[t.state] !== 'full') return 'TENANT_NOT_OPERATIONAL';
  if (!hasFeature(db, g.tenantId, 'dismissal.queue')) return 'FEATURE_NOT_ENTITLED';
  switch (effectiveGuardianState(db, g)) {
    case 'blocked':
      return 'GUARDIAN_BLOCKED';
    case 'deactivated':
      return 'GUARDIAN_DEACTIVATED';
    case 'revoked':
      return 'GUARDIAN_REVOKED';
    case 'expired':
      return 'GUARDIAN_ACCESS_EXPIRED';
    case 'pending_activation':
      return 'FORBIDDEN';
    default:
      return null;
  }
}

function windowFor(
  db: MockDb,
  tenantId: string,
): { open: boolean; opensAt: string | null; closesAt: string | null } {
  const t = db.tenant(tenantId)!;
  const { time, isoWeekday } = db.localClock(t.timezone);
  const today = db.localDate(t.timezone);
  const w = t.settings.dismissal.windows.find((x) => x.dayOfWeek === isoWeekday);
  const toIso = (hhmm: string) => {
    // Approximate the tenant-local wall time as an instant for display purposes.
    const [h, m] = hhmm.split(':').map(Number);
    const offsetMin = tzOffsetMinutes(t.timezone, db.now());
    const utc =
      Date.UTC(
        Number(today.slice(0, 4)),
        Number(today.slice(5, 7)) - 1,
        Number(today.slice(8, 10)),
        h ?? 0,
        m ?? 0,
      ) -
      offsetMin * 60_000;
    return new Date(utc).toISOString();
  };
  if (!w) return { open: false, opensAt: null, closesAt: null };
  return {
    open: time >= w.opensAt && time <= w.closesAt,
    opensAt: toIso(w.opensAt),
    closesAt: toIso(w.closesAt),
  };
}

export function studentRejection(db: MockDb, s: StudentRecord): ErrorCode | null {
  if (s.status !== 'active') return 'STUDENT_INACTIVE';
  if (s.dismissalEligibility !== 'eligible') return 'STUDENT_NOT_ELIGIBLE';
  if (!windowFor(db, s.tenantId).open) return 'OUTSIDE_DISMISSAL_WINDOW';
  return null;
}

export function pickupEligibility(
  db: MockDb,
  g: GuardianRecord,
  s: StudentRecord,
): PickupEligibility {
  const w = windowFor(db, s.tenantId);
  const locationRequired = db.tenant(s.tenantId)!.settings.locationRule.enabled;
  const reasonCode = guardianRejection(db, g) ?? studentRejection(db, s);
  return {
    eligible: reasonCode === null,
    reasonCode,
    windowOpensAt: w.opensAt,
    windowClosesAt: w.closesAt,
    locationRequired,
  };
}

/** Haversine distance in metres. */
export function distanceMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
