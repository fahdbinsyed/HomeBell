/**
 * Named mock scenarios (docs/architecture/09-frontend-architecture.md §4). Switching a scenario
 * resets the mock DB to the seed and then applies the scenario, so every scenario starts clean.
 */
import type { MockDb } from './db/db';
import { DEMO, IDS } from './db/seed';

export type MockApp = 'platform' | 'school' | 'display' | 'guardian';

export interface ScenarioFlags {
  /** Added latency per request. */
  slowNetworkMs?: number;
  /** Every request fails at the transport level. */
  networkFailure?: boolean;
  /** Every staff/platform write returns 403 FORBIDDEN. */
  permissionDenied?: boolean;
  /** Pickup creation reports DUPLICATE_ACTIVE_REQUEST for every student. */
  duplicatePickup?: boolean;
  /** OTP send/resend hits the send limit immediately after the first code. */
  otpResendLimit?: boolean;
  /** OTP verification reports the phone as locked. */
  otpLocked?: boolean;
  /** Background simulation of other guardians/dispatchers (queue activity). Default on. */
  liveSimulation?: boolean;
}

export interface Scenario {
  id: string;
  label: string;
  description: string;
  apps: MockApp[];
  flags?: ScenarioFlags;
  apply?: (db: MockDb) => void;
}

const ALL: MockApp[] = ['platform', 'school', 'display', 'guardian'];

const setTenant = (
  db: MockDb,
  state: MockDb['state']['tenants'][number]['state'],
  expiresInDays: number | null = null,
) => {
  const t = db.tenant(DEMO.greenfield)!;
  if (state !== 'trial') t.previousOperationalState = t.state;
  t.state = state;
  t.expiresAt = expiresInDays === null ? t.expiresAt : db.addDays(expiresInDays);
};
const setJordanGreenfield = (db: MockDb, state: 'blocked' | 'deactivated', reason: string) => {
  const g = db.state.guardians.find(
    (x) => x.tenantId === DEMO.greenfield && x.phone === DEMO.phones.primary,
  )!;
  g.state = state;
  g.stateReason = reason;
  g.stateChangedAt = db.nowIso();
};
const jordanUserId = (db: MockDb) =>
  db.state.users.find((u) => u.phone === DEMO.phones.primary)!.id;

export const SCENARIOS: Scenario[] = [
  {
    id: 'default',
    label: 'Default',
    description: 'Seeded demo data with live queue simulation.',
    apps: ALL,
    flags: { liveSimulation: true },
  },
  {
    id: 'quiet_queue',
    label: 'Quiet queue',
    description: 'No background queue activity (deterministic screens).',
    apps: ['school', 'display', 'guardian'],
    flags: { liveSimulation: false },
  },
  {
    id: 'slow_network',
    label: 'Slow network',
    description: 'Every request takes 2.5 s.',
    apps: ALL,
    flags: { slowNetworkMs: 2500, liveSimulation: true },
  },
  {
    id: 'network_failure',
    label: 'Network failure',
    description: 'Every request fails at the network level.',
    apps: ALL,
    flags: { networkFailure: true },
  },
  {
    id: 'permission_denied',
    label: 'Permission denied',
    description: 'Staff and platform writes return 403 FORBIDDEN.',
    apps: ['platform', 'school'],
    flags: { permissionDenied: true },
  },
  {
    id: 'tenant_suspended',
    label: 'School suspended',
    description: 'Greenfield Academy is suspended (read-only; pickups blocked).',
    apps: ['school', 'display', 'guardian'],
    apply: (db) => setTenant(db, 'suspended'),
  },
  {
    id: 'tenant_expired',
    label: 'School expired',
    description: 'Greenfield Academy subscription expired (read-only grace).',
    apps: ['school', 'display', 'guardian'],
    apply: (db) => setTenant(db, 'expired', -2),
  },
  {
    id: 'tenant_cancelled',
    label: 'School cancelled',
    description: 'Greenfield Academy service cancelled (blocked).',
    apps: ['school', 'display', 'guardian'],
    apply: (db) => setTenant(db, 'cancelled'),
  },
  {
    id: 'trial_expiring',
    label: 'Trial expiring',
    description: 'Greenfield Academy is on a trial ending in 2 days.',
    apps: ['school', 'guardian'],
    apply: (db) => setTenant(db, 'trial', 2),
  },
  {
    id: 'blocked_guardian',
    label: 'Guardian blocked',
    description: 'Jordan Rivera is blocked at Greenfield (still active at Riverside).',
    apps: ['guardian', 'school'],
    apply: (db) => setJordanGreenfield(db, 'blocked', 'Please contact the front office'),
  },
  {
    id: 'deactivated_guardian',
    label: 'Guardian deactivated',
    description: 'Jordan Rivera is deactivated at Greenfield.',
    apps: ['guardian', 'school'],
    apply: (db) => setJordanGreenfield(db, 'deactivated', 'Account deactivated by school'),
  },
  {
    id: 'device_conflict_transfer_allowed',
    label: 'New device — transfer allowed',
    description: "Jordan's account is active on another phone; transfer is allowed.",
    apps: ['guardian'],
    apply: (db) => {
      db.state.devices.push({
        id: IDS.device(90),
        userId: jordanUserId(db),
        platform: 'android',
        model: 'Pixel 7',
        state: 'active',
        activatedAt: db.addDays(-60),
        lastSeenAt: db.addDays(-1),
      });
    },
  },
  {
    id: 'device_conflict_in_cooldown',
    label: 'New device — in cooldown',
    description:
      "Jordan's account moved phones 10 days ago; another transfer is blocked for 20 days.",
    apps: ['guardian'],
    apply: (db) => {
      const userId = jordanUserId(db);
      db.state.devices.push({
        id: IDS.device(91),
        userId,
        platform: 'ios',
        model: 'iPhone 13',
        state: 'active',
        activatedAt: db.addDays(-10),
        lastSeenAt: db.addDays(-1),
      });
      db.state.transfers.push({
        id: db.id(),
        userId,
        fromDeviceId: null,
        toDeviceId: IDS.device(91),
        at: db.addDays(-10),
        viaOverride: false,
        suspicious: false,
      });
    },
  },
  {
    id: 'otp_resend_limit',
    label: 'OTP send limit',
    description: 'After the first code, resends hit the send limit.',
    apps: ['guardian'],
    flags: { otpResendLimit: true },
  },
  {
    id: 'otp_locked',
    label: 'OTP locked',
    description: 'Verification reports the phone as temporarily locked.',
    apps: ['guardian'],
    flags: { otpLocked: true },
  },
  {
    id: 'duplicate_pickup',
    label: 'Duplicate pickup',
    description: 'Pickup requests report an existing open request.',
    apps: ['guardian'],
    flags: { duplicatePickup: true },
  },
];

export const scenarioById = (id: string): Scenario =>
  SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0]!;
