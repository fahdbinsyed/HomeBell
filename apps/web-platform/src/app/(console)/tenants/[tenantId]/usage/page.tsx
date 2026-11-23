'use client';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { unwrap } from '@homebell/api-client';
import { formatDateTime, formatNumber } from '@homebell/copy';
import { Card, ErrorState, LoadingState, StatCard } from '@homebell/ui-web';
import { messageFor, useApi } from '@homebell/web-core';
import { keys } from '@/lib/use-platform';

function Meter({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const tone =
    limit && pct >= 100 ? 'bg-danger-fg' : limit && pct >= 85 ? 'bg-warning-fg' : 'bg-primary';
  return (
    <div>
      <div className="mb-1 flex justify-between text-sm">
        <span>{label}</span>
        <span className="tabular-nums text-text-muted">
          {used} / {formatNumber(limit)}
        </span>
      </div>
      <div
        className="h-2 rounded-full bg-surface-muted"
        role="progressbar"
        aria-label={label}
        aria-valuenow={used}
        aria-valuemin={0}
        aria-valuemax={limit ?? undefined}
      >
        <div className={`h-2 rounded-full ${tone}`} style={{ width: `${limit ? pct : 5}%` }} />
      </div>
    </div>
  );
}

export default function UsagePage() {
  const { tenantId } = useParams<{ tenantId: string }>();
  const { client } = useApi();
  const usage = useQuery({
    queryKey: keys.tenantPart(tenantId, 'usage'),
    queryFn: () =>
      unwrap(
        client.GET('/v1/platform/tenants/{tenantId}/usage', { params: { path: { tenantId } } }),
      ),
  });
  if (usage.isPending) return <LoadingState />;
  if (usage.error)
    return <ErrorState message={messageFor(usage.error)} onRetry={() => usage.refetch()} />;
  const u = usage.data;
  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-text-muted">As of {formatDateTime(u.asOf)}</p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Pickups today" value={u.pickups.today} />
        <StatCard label="Pickups (7 days)" value={u.pickups.last7Days} />
        <StatCard
          label="Unresolved (30 days)"
          value={u.pickups.unresolvedLast30Days}
          tone={u.pickups.unresolvedLast30Days ? 'warning' : undefined}
        />
        <StatCard
          label="Suspicious transfers (30 days)"
          value={u.deviceTransfers.suspiciousLast30Days}
          tone={u.deviceTransfers.suspiciousLast30Days ? 'danger' : undefined}
          hint={`${u.deviceTransfers.last30Days} transfers in total`}
        />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Plan limits">
          <div className="flex flex-col gap-4">
            <Meter label="Active students" used={u.students.used} limit={u.students.limit} />
            <Meter label="Staff accounts" used={u.staff.used} limit={u.staff.limit} />
            <Meter label="Display screens" used={u.displays.used} limit={u.displays.limit} />
            <Meter label="SMS codes today" used={u.otp.sentToday} limit={u.otp.dailyBudget} />
          </div>
        </Card>
        <Card title="Guardians & licenses">
          <dl className="grid grid-cols-2 gap-4 text-sm">
            {[
              ['Primary active', u.guardians.primaryActive],
              ['Primary not activated', u.guardians.primaryPending],
              ['Additional active', u.guardians.additionalActive],
              ['Blocked', u.guardians.blocked],
              ['Seats available', u.guardians.seatsAvailable],
              ['Seats in use', u.guardians.seatsAssigned],
            ].map(([k, v]) => (
              <div key={k as string}>
                <dt className="text-text-muted">{k}</dt>
                <dd className="text-xl font-semibold tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>
    </div>
  );
}
