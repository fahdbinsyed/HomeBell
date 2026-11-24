'use client';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { unwrap } from '@homebell/api-client';
import type { LifecycleHistoryEntry, TenantLifecycleAction } from '@homebell/contracts';
import { formatDate, formatDateTime, labels } from '@homebell/copy';
import { Button, Card, DataTable, LoadMore } from '@homebell/ui-web';
import { messageFor, useApi, usePagedList } from '@homebell/web-core';
import { LifecycleDialog } from '@/components/lifecycle-dialog';
import { TenantStateBadge } from '@/components/tenant-bits';
import { useTenant } from '@/lib/use-platform';

export default function LifecyclePage() {
  const { tenantId } = useParams<{ tenantId: string }>();
  const { client } = useApi();
  const tenant = useTenant(tenantId).data!;
  const [action, setAction] = useState<TenantLifecycleAction | null>(null);
  const history = usePagedList<LifecycleHistoryEntry>(
    ['platform', 'tenant', tenantId, 'history', tenant.state],
    (cursor) =>
      unwrap(
        client.GET('/v1/platform/tenants/{tenantId}/lifecycle-history', {
          params: { path: { tenantId }, query: { cursor } },
        }),
      ),
  );
  return (
    <div className="flex flex-col gap-6">
      <Card
        title="Change state"
        description="Every change requires a reason and is audited. HomeBell never processes refunds."
      >
        <div className="flex flex-wrap gap-2">
          {tenant.allowedActions.map((a) => (
            <Button key={a} variant="secondary" onClick={() => setAction(a)}>
              {labels.lifecycleAction[a]}
            </Button>
          ))}
          {tenant.allowedActions.length === 0 && (
            <p className="text-sm text-text-muted">
              No actions are available from {labels.tenantState[tenant.state]} for your role.
            </p>
          )}
        </div>
      </Card>
      <DataTable
        caption="Lifecycle history"
        rows={history.items}
        loading={history.isPending}
        error={history.error ? messageFor(history.error) : null}
        rowKey={(h) => h.id}
        empty={{ title: 'No history yet' }}
        columns={[
          { key: 'at', header: 'When', cell: (h) => formatDateTime(h.at) },
          {
            key: 'action',
            header: 'Action',
            cell: (h) => (
              <span className="font-medium">
                {h.action in labels.lifecycleAction
                  ? labels.lifecycleAction[h.action as TenantLifecycleAction]
                  : h.action === 'create'
                    ? 'Created'
                    : h.action === 'expire'
                      ? 'Expired (automatic)'
                      : h.action}
              </span>
            ),
          },
          {
            key: 'change',
            header: 'Change',
            cell: (h) => (
              <span className="flex items-center gap-1">
                {h.fromState ? <TenantStateBadge state={h.fromState} /> : '—'} →{' '}
                <TenantStateBadge state={h.toState} />
              </span>
            ),
          },
          {
            key: 'reason',
            header: 'Reason',
            cell: (h) => labels.reasonCode[h.reasonCode],
            hideOnMobile: true,
          },
          {
            key: 'expires',
            header: 'Expires',
            cell: (h) => (h.expiresAt ? formatDate(h.expiresAt) : '—'),
            hideOnMobile: true,
          },
          {
            key: 'refund',
            header: 'Refund',
            cell: (h) =>
              h.refundStatus && h.refundStatus !== 'none'
                ? labels.refundStatus[h.refundStatus]
                : '—',
            hideOnMobile: true,
          },
          {
            key: 'by',
            header: 'By',
            cell: (h) => (
              <div>
                <p>{h.actor.displayName}</p>
                {h.note && <p className="text-xs text-text-muted">{h.note}</p>}
              </div>
            ),
          },
        ]}
        footer={
          <LoadMore
            hasMore={!!history.hasNextPage}
            loading={history.isFetchingNextPage}
            onClick={() => history.fetchNextPage()}
          />
        }
      />
      <LifecycleDialog tenant={tenant} action={action} onClose={() => setAction(null)} />
    </div>
  );
}
