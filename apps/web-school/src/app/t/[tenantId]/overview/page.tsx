'use client';
import { useQuery } from '@tanstack/react-query';
import { unwrap } from '@homebell/api-client';
import { formatDate, formatTime } from '@homebell/copy';
import {
  Button,
  Card,
  ErrorState,
  LoadingState,
  PageHeader,
  StatCard,
  useLink,
} from '@homebell/ui-web';
import { messageFor, useApi, useLiveQueue } from '@homebell/web-core';
import { ConnectionPill, PickupBadge } from '@/components/queue-parts';
import { schoolKey, useSchool } from '@/lib/school';

export default function OverviewPage() {
  const { tenantId, membership, can } = useSchool();
  const { client } = useApi();
  const Link = useLink();
  const live = useLiveQueue(tenantId);
  const overview = useQuery({
    queryKey: schoolKey(tenantId, 'overview', live.seq),
    queryFn: () =>
      unwrap(client.GET('/v1/t/{tenantId}/overview', { params: { path: { tenantId } } })),
    placeholderData: (prev) => prev,
  });
  if (overview.isPending) return <LoadingState rows={6} />;
  if (overview.error)
    return <ErrorState message={messageFor(overview.error)} onRetry={() => overview.refetch()} />;
  const o = overview.data;
  const recent = [...live.items]
    .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))
    .slice(0, 6);
  return (
    <>
      <PageHeader
        title={`Good ${new Date().getHours() < 12 ? 'morning' : 'afternoon'}, ${membership.tenantName}`}
        description={`Dismissal for ${formatDate(o.queueDate, { dateStyle: 'full' })}`}
        badge={<ConnectionPill state={live.connection} />}
        actions={
          can('school.queue.read') && (
            <Link
              href={`/t/${tenantId}/queue`}
              className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-text hover:bg-primary-hover"
            >
              Open live queue
            </Link>
          )
        }
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Requests today"
          value={o.requests.total}
          hint={`${o.requests.requested} waiting · ${o.requests.sentOut} sent out`}
        />
        <StatCard
          label="Completed pickups"
          value={o.requests.acknowledged}
          hint={
            o.medianMinutesToAcknowledge !== null
              ? `Median ${o.medianMinutesToAcknowledge} min to confirm`
              : undefined
          }
          tone="success"
        />
        <StatCard
          label="Unresolved acknowledgments"
          value={o.unresolved}
          tone={o.unresolved ? 'danger' : undefined}
          hint={`${o.requests.exception} need follow-up`}
        />
        <StatCard
          label="Display screens online"
          value={`${o.displays.online} / ${o.displays.total}`}
          tone={o.displays.total && o.displays.online < o.displays.total ? 'warning' : undefined}
        />
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Active students"
          value={o.students.active}
          hint={`${o.students.onHold} on hold · ${o.students.inactive} inactive`}
        />
        <StatCard
          label="Active guardians"
          value={o.guardians.active}
          hint={`${o.guardians.additionalActive} additional · ${o.guardians.pendingActivation} not activated`}
        />
        <StatCard
          label="Blocked guardians"
          value={o.guardians.blocked}
          tone={o.guardians.blocked ? 'warning' : undefined}
          hint={`${o.guardians.deactivated} deactivated`}
        />
        <StatCard
          label="Device transfers (7 days)"
          value={o.deviceTransfersLast7Days}
          tone={o.suspiciousTransfersLast7Days ? 'danger' : undefined}
          hint={`${o.suspiciousTransfersLast7Days} suspicious`}
        />
      </div>
      <div className="mt-6">
        <Card
          title="Latest activity"
          actions={
            <Button size="sm" variant="ghost" onClick={() => live.refresh()}>
              Refresh
            </Button>
          }
          padded={false}
        >
          {recent.length === 0 ? (
            <p className="p-5 text-sm text-text-muted">No requests yet today.</p>
          ) : (
            <ul className="divide-y divide-border">
              {recent.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {i.student.firstName} {i.student.lastName}
                    </p>
                    <p className="truncate text-xs text-text-muted">
                      {i.student.className} · {i.guardian.fullName}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm tabular-nums text-text-muted">
                      {formatTime(i.requestedAt)}
                    </span>
                    <PickupBadge state={i.state} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
