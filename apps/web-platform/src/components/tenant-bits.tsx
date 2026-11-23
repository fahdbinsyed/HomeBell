'use client';
import type { TenantFlag, TenantLifecycleState } from '@homebell/contracts';
import { labels } from '@homebell/copy';
import { Badge, StateBadge } from '@homebell/ui-web';

export const TenantStateBadge = ({ state }: { state: TenantLifecycleState }) => (
  <StateBadge group="tenant" value={state} label={labels.tenantState[state]} />
);

const FLAG: Record<TenantFlag, { label: string; tone: 'warning' | 'danger' | 'info' | 'neutral' }> =
  {
    expiring_soon: { label: 'Expiring soon', tone: 'warning' },
    over_limit: { label: 'Over limit', tone: 'danger' },
    suspicious_transfers: { label: 'Suspicious transfers', tone: 'danger' },
    no_recent_activity: { label: 'No recent activity', tone: 'neutral' },
    setup_incomplete: { label: 'Setup incomplete', tone: 'info' },
  };
export const TenantFlags = ({ flags }: { flags: TenantFlag[] }) => (
  <span className="flex flex-wrap gap-1">
    {flags.map((f) => (
      <Badge key={f} tone={FLAG[f].tone}>
        {FLAG[f].label}
      </Badge>
    ))}
  </span>
);
