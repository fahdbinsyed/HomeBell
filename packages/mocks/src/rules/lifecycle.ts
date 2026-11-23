/** SIMULATION of docs/architecture/05-entitlements-lifecycle.md §4–5. The server is authoritative. */
import type {
  OperationalMode,
  TenantLifecycleAction,
  TenantLifecycleState,
} from '@homebell/contracts';

export const OPERATIONAL_MODE: Record<TenantLifecycleState, OperationalMode> = {
  draft: 'setup',
  trial: 'full',
  pilot_free: 'full',
  active_paid: 'full',
  manual_override: 'full',
  expired: 'read_only',
  suspended: 'read_only',
  deactivated: 'blocked',
  cancelled: 'blocked',
  offboarding: 'export_only',
};

const OPERATIONAL: TenantLifecycleState[] = [
  'trial',
  'pilot_free',
  'active_paid',
  'manual_override',
];

export const TRANSITIONS: Record<
  TenantLifecycleAction,
  { from: TenantLifecycleState[]; to: TenantLifecycleState | 'same' | 'previous' }
> = {
  start_trial: { from: ['draft', 'expired'], to: 'trial' },
  grant_free: { from: ['draft', 'trial', 'expired', 'active_paid'], to: 'pilot_free' },
  activate: { from: ['draft'], to: 'active_paid' },
  convert_to_paid: {
    from: ['trial', 'pilot_free', 'manual_override', 'expired'],
    to: 'active_paid',
  },
  apply_manual_override: {
    from: ['trial', 'pilot_free', 'active_paid', 'expired', 'suspended'],
    to: 'manual_override',
  },
  extend_expiry: { from: ['trial', 'pilot_free', 'active_paid', 'manual_override'], to: 'same' },
  suspend: {
    from: ['trial', 'pilot_free', 'active_paid', 'manual_override', 'expired'],
    to: 'suspended',
  },
  deactivate: {
    from: ['trial', 'pilot_free', 'active_paid', 'manual_override', 'expired', 'suspended'],
    to: 'deactivated',
  },
  cancel: {
    from: [
      'trial',
      'pilot_free',
      'active_paid',
      'manual_override',
      'expired',
      'suspended',
      'deactivated',
    ],
    to: 'cancelled',
  },
  start_offboarding: { from: ['cancelled', 'deactivated'], to: 'offboarding' },
  reinstate: { from: ['suspended', 'deactivated', 'cancelled'], to: 'previous' },
};

export const ACTIONS_REQUIRING_EXPIRY: TenantLifecycleAction[] = [
  'start_trial',
  'activate',
  'convert_to_paid',
  'extend_expiry',
];
export const ACTIONS_REQUIRING_NAME_CONFIRMATION: TenantLifecycleAction[] = [
  'deactivate',
  'cancel',
  'start_offboarding',
];

export function allowedActions(state: TenantLifecycleState): TenantLifecycleAction[] {
  return (Object.keys(TRANSITIONS) as TenantLifecycleAction[]).filter((a) =>
    TRANSITIONS[a].from.includes(state),
  );
}

export function targetState(
  action: TenantLifecycleAction,
  current: TenantLifecycleState,
  previous: TenantLifecycleState | null,
  explicit?: TenantLifecycleState,
): TenantLifecycleState {
  const to = TRANSITIONS[action].to;
  if (to === 'same') return current;
  if (to === 'previous')
    return explicit ?? (previous && OPERATIONAL.includes(previous) ? previous : 'active_paid');
  return to;
}

export const isOperational = (state: TenantLifecycleState) => OPERATIONAL_MODE[state] === 'full';
