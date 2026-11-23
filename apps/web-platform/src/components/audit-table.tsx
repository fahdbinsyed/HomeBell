'use client';
import { useState } from 'react';
import { unwrap } from '@homebell/api-client';
import {
  auditActionValues,
  auditOutcomeValues,
  type AuditAction,
  type AuditLogEntry,
  type AuditLogPage,
  type AuditOutcome,
} from '@homebell/contracts';
import { auditLabel, formatDateTime } from '@homebell/copy';
import { Badge, Button, DataTable, Input, LoadMore, Select, useToast } from '@homebell/ui-web';
import { messageFor, useApi, usePagedList } from '@homebell/web-core';

export function downloadText(text: string, filename: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}

export function AuditTable({ tenantId }: { tenantId?: string }) {
  const { client } = useApi();
  const toast = useToast();
  const [action, setAction] = useState<AuditAction | ''>('');
  const [outcome, setOutcome] = useState<AuditOutcome | ''>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const query = {
    tenantId,
    action: action || undefined,
    outcome: outcome || undefined,
    from: from || undefined,
    to: to || undefined,
  };
  const list = usePagedList<AuditLogEntry>(
    ['platform', 'audit', query],
    (cursor) =>
      unwrap(
        client.GET('/v1/platform/audit-logs', {
          params: { query: { ...query, cursor, limit: 50 } },
        }),
      ) as Promise<AuditLogPage>,
  );
  const exportCsv = async () => {
    try {
      const r = await client.GET('/v1/platform/audit-logs', {
        params: { query: { ...query, format: 'csv' } },
        parseAs: 'text',
      });
      if (r.error || !r.response.ok) throw new Error();
      downloadText(r.data as unknown as string, 'homebell-audit.csv');
    } catch {
      toast('Export failed', 'danger');
    }
  };
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_160px_160px_160px_auto]">
        <Select
          aria-label="Action"
          value={action}
          onChange={(e) => setAction(e.target.value as AuditAction | '')}
          placeholder="All actions"
          options={auditActionValues.map((a) => ({ value: a, label: auditLabel(a) }))}
        />
        <Select
          aria-label="Outcome"
          value={outcome}
          onChange={(e) => setOutcome(e.target.value as AuditOutcome | '')}
          placeholder="Any outcome"
          options={auditOutcomeValues.map((o) => ({ value: o, label: o }))}
        />
        <Input
          aria-label="From"
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <Input aria-label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <Button variant="secondary" onClick={exportCsv}>
          Export CSV
        </Button>
      </div>
      <DataTable
        caption="Audit log"
        rows={list.items}
        loading={list.isPending}
        error={list.error ? messageFor(list.error) : null}
        onRetry={() => list.refetch()}
        rowKey={(a) => a.id}
        empty={{ title: 'No audit entries match' }}
        columns={[
          {
            key: 'at',
            header: 'When',
            cell: (a) => <span className="whitespace-nowrap">{formatDateTime(a.occurredAt)}</span>,
          },
          {
            key: 'action',
            header: 'Action',
            cell: (a) => <span className="font-medium">{auditLabel(a.action)}</span>,
          },
          {
            key: 'outcome',
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
            key: 'actor',
            header: 'Actor',
            cell: (a) => (
              <div>
                <p>{a.actor.displayName}</p>
                {a.onBehalfOf && (
                  <p className="text-xs text-text-muted">for {a.onBehalfOf.displayName}</p>
                )}
              </div>
            ),
          },
          ...(tenantId
            ? []
            : [
                {
                  key: 'tenant',
                  header: 'School',
                  cell: (a: AuditLogEntry) =>
                    a.tenantName ?? <span className="text-text-muted">Platform</span>,
                  hideOnMobile: true,
                },
              ]),
          {
            key: 'target',
            header: 'Target',
            cell: (a) => (
              <div>
                <p>{a.targetLabel ?? '—'}</p>
                {a.reasonCode && <p className="text-xs text-text-muted">{a.reasonCode}</p>}
              </div>
            ),
            hideOnMobile: true,
          },
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
    </div>
  );
}
