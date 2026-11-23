'use client';
import { useState } from 'react';
import { unwrap } from '@homebell/api-client';
import { auditActionValues, type AuditAction, type AuditLogEntry } from '@homebell/contracts';
import { auditLabel, formatDateTime } from '@homebell/copy';
import { Badge, DataTable, Input, LoadMore, PageHeader, Select } from '@homebell/ui-web';
import { messageFor, useApi, usePagedList } from '@homebell/web-core';
import { schoolKey, useSchool } from '@/lib/school';

export default function SchoolAuditPage() {
  const { tenantId } = useSchool();
  const { client } = useApi();
  const [action, setAction] = useState<AuditAction | ''>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const query = { action: action || undefined, from: from || undefined, to: to || undefined };
  const list = usePagedList<AuditLogEntry>(schoolKey(tenantId, 'audit', query), (cursor) =>
    unwrap(
      client.GET('/v1/t/{tenantId}/audit-logs', {
        params: { path: { tenantId }, query: { ...query, cursor } },
      }),
    ),
  );
  return (
    <>
      <PageHeader
        title="Audit log"
        description="Who did what, and when — including HomeBell support access. Entries can't be edited or deleted."
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_170px_170px]">
        <Select
          aria-label="Action"
          value={action}
          onChange={(e) => setAction(e.target.value as AuditAction | '')}
          placeholder="All actions"
          options={auditActionValues.map((a) => ({ value: a, label: auditLabel(a) }))}
        />
        <Input
          aria-label="From"
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <Input aria-label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>
      <DataTable
        caption="Audit log"
        rows={list.items}
        loading={list.isPending}
        error={list.error ? messageFor(list.error) : null}
        rowKey={(a) => a.id}
        empty={{ title: 'No entries match' }}
        columns={[
          {
            key: 'at',
            header: 'When',
            cell: (a) => <span className="whitespace-nowrap">{formatDateTime(a.occurredAt)}</span>,
          },
          {
            key: 'a',
            header: 'Action',
            cell: (a) => <span className="font-medium">{auditLabel(a.action)}</span>,
          },
          {
            key: 'o',
            header: 'Outcome',
            cell: (a) => (
              <Badge
                tone={
                  a.outcome === 'success'
                    ? 'success'
                    : a.outcome === 'denied'
                      ? 'warning'
                      : 'danger'
                }
              >
                {a.outcome}
              </Badge>
            ),
          },
          {
            key: 'w',
            header: 'By',
            cell: (a) => (
              <span>
                {a.actor.displayName}
                {a.actor.type === 'support' && (
                  <Badge tone="brand" className="ml-1">
                    Support
                  </Badge>
                )}
              </span>
            ),
          },
          { key: 't', header: 'Target', cell: (a) => a.targetLabel ?? '—', hideOnMobile: true },
          { key: 'r', header: 'Reason', cell: (a) => a.reasonCode ?? '—', hideOnMobile: true },
        ]}
        footer={
          <LoadMore
            hasMore={!!list.hasNextPage}
            loading={list.isFetchingNextPage}
            onClick={() => list.fetchNextPage()}
            shown={list.items?.length}
            total={list.total}
          />
        }
      />
    </>
  );
}
