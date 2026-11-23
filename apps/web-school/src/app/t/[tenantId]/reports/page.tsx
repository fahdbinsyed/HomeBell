'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { unwrap } from '@homebell/api-client';
import type {
  DeviceTransferReportRow,
  GuardianActivityRow,
  PickupReportPage,
  PickupReportRow,
  UsageReport,
} from '@homebell/contracts';
import { formatDate, formatDateTime, formatRelative, formatTime, labels } from '@homebell/copy';
import {
  Badge,
  Button,
  DataTable,
  Input,
  LoadMore,
  PageHeader,
  StatCard,
  StateBadge,
  useToast,
} from '@homebell/ui-web';
import { messageFor, useApi, usePagedList } from '@homebell/web-core';
import { schoolKey, useSchool } from '@/lib/school';

type Report = 'pickups' | 'unresolved' | 'guardian-activity' | 'device-transfers' | 'usage';
const TABS: Array<[Report, string]> = [
  ['pickups', 'Pickup history'],
  ['unresolved', 'Unresolved acknowledgments'],
  ['guardian-activity', 'Guardian activity'],
  ['device-transfers', 'Device transfers'],
  ['usage', 'Daily usage'],
];
const iso = (d: Date) => d.toISOString().slice(0, 10);

function PickupColumns() {
  return [
    { key: 'd', header: 'Date', cell: (r: PickupReportRow) => formatDate(r.queueDate) },
    {
      key: 's',
      header: 'Student',
      cell: (r: PickupReportRow) => (
        <div>
          <p className="font-medium">{r.studentName}</p>
          <p className="text-xs text-text-muted">{r.className}</p>
        </div>
      ),
    },
    {
      key: 'g',
      header: 'Guardian',
      cell: (r: PickupReportRow) => (
        <div>
          <p>{r.guardianName}</p>
          <p className="text-xs text-text-muted">{r.guardianKind}</p>
        </div>
      ),
      hideOnMobile: true,
    },
    {
      key: 'st',
      header: 'Outcome',
      cell: (r: PickupReportRow) => (
        <div className="flex flex-col gap-1">
          <StateBadge group="pickup" value={r.state} label={labels.pickupState[r.state]} />
          {r.resolution && (
            <span className="text-xs text-text-muted">{labels.resolution[r.resolution]}</span>
          )}
        </div>
      ),
    },
    {
      key: 't',
      header: 'Requested → confirmed',
      cell: (r: PickupReportRow) =>
        `${formatTime(r.requestedAt)} → ${r.acknowledgedAt ? formatTime(r.acknowledgedAt) : '—'}`,
      hideOnMobile: true,
    },
    { key: 'm', header: 'Minutes', cell: (r: PickupReportRow) => r.minutesToAcknowledge ?? '—' },
  ];
}

export default function ReportsPage() {
  const { tenantId, can, has } = useSchool();
  const { client } = useApi();
  const toast = useToast();
  const [report, setReport] = useState<Report>('pickups');
  const [from, setFrom] = useState(iso(new Date(Date.now() - 6 * 86_400_000)));
  const [to, setTo] = useState(iso(new Date()));
  const range = { from: from || undefined, to: to || undefined };
  const path = { tenantId };
  const pickups = usePagedList<PickupReportRow>(
    schoolKey(tenantId, 'report', report, range),
    (cursor) =>
      (report === 'unresolved'
        ? unwrap(
            client.GET('/v1/t/{tenantId}/reports/unresolved', {
              params: { path, query: { ...range, cursor } },
            }),
          )
        : unwrap(
            client.GET('/v1/t/{tenantId}/reports/pickups', {
              params: { path, query: { ...range, cursor } },
            }),
          )) as Promise<PickupReportPage>,
    report === 'pickups' || report === 'unresolved',
  );
  const totals = useQuery({
    queryKey: schoolKey(tenantId, 'report-totals', report, range),
    queryFn: () =>
      unwrap(
        client.GET('/v1/t/{tenantId}/reports/pickups', {
          params: { path, query: { ...range, limit: 1 } },
        }),
      ) as Promise<PickupReportPage>,
    enabled: report === 'pickups',
  });
  const activity = usePagedList<GuardianActivityRow>(
    schoolKey(tenantId, 'report', 'activity', range),
    (cursor) =>
      unwrap(
        client.GET('/v1/t/{tenantId}/reports/guardian-activity', {
          params: { path, query: { ...range, cursor } },
        }),
      ) as never,
    report === 'guardian-activity',
  );
  const transfers = usePagedList<DeviceTransferReportRow>(
    schoolKey(tenantId, 'report', 'transfers', range),
    (cursor) =>
      unwrap(
        client.GET('/v1/t/{tenantId}/reports/device-transfers', {
          params: { path, query: { ...range, cursor } },
        }),
      ) as never,
    report === 'device-transfers',
  );
  const usage = useQuery({
    queryKey: schoolKey(tenantId, 'report', 'usage', range),
    queryFn: () =>
      unwrap(
        client.GET('/v1/t/{tenantId}/reports/usage', { params: { path, query: range } }),
      ) as Promise<UsageReport>,
    enabled: report === 'usage',
  });

  const exportCsv = async () => {
    const url = `/v1/t/{tenantId}/reports/${report}` as '/v1/t/{tenantId}/reports/pickups';
    const r = await client.GET(url, {
      params: { path, query: { ...range, format: 'csv' } },
      parseAs: 'text',
    });
    if (!r.response.ok) return toast(messageFor(r.error), 'danger');
    const href = URL.createObjectURL(new Blob([r.data as unknown as string], { type: 'text/csv' }));
    Object.assign(document.createElement('a'), {
      href,
      download: `${report}-${from}-to-${to}.csv`,
    }).click();
    URL.revokeObjectURL(href);
  };

  const t = totals.data?.totals;
  const maxRequests = Math.max(1, ...(usage.data?.days.map((d) => d.requests) ?? [1]));
  return (
    <>
      <PageHeader
        title="Reports"
        description="Dismissal history and accountability reports. Export to CSV for your records."
        actions={
          can('school.reports.export') &&
          has('reports.export') && (
            <Button variant="secondary" onClick={exportCsv}>
              Export CSV
            </Button>
          )
        }
      />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div
          role="tablist"
          aria-label="Report"
          className="flex flex-wrap gap-1 rounded-lg bg-surface-muted p-1"
        >
          {TABS.map(([k, label]) => (
            <button
              key={k}
              role="tab"
              aria-selected={report === k}
              type="button"
              onClick={() => setReport(k)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${report === k ? 'bg-surface text-text shadow-sm' : 'text-text-muted hover:text-text'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="text-sm">
          From{' '}
          <Input
            type="date"
            value={from}
            max={to}
            onChange={(e) => setFrom(e.target.value)}
            className="mt-1 w-40"
          />
        </label>
        <label className="text-sm">
          To{' '}
          <Input
            type="date"
            value={to}
            min={from}
            onChange={(e) => setTo(e.target.value)}
            className="mt-1 w-40"
          />
        </label>
      </div>
      {report === 'pickups' && t && (
        <div className="mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <StatCard label="Requests" value={t.requests} />
          <StatCard label="Picked up" value={t.acknowledged} tone="success" />
          <StatCard label="Cancelled" value={t.cancelled} />
          <StatCard
            label="Needs follow-up"
            value={t.exceptions}
            tone={t.exceptions ? 'danger' : undefined}
          />
          <StatCard label="Median minutes to confirm" value={t.medianMinutesToAcknowledge ?? '—'} />
        </div>
      )}
      {(report === 'pickups' || report === 'unresolved') && (
        <DataTable
          caption={report}
          rows={pickups.items}
          loading={pickups.isPending}
          error={pickups.error ? messageFor(pickups.error) : null}
          rowKey={(r) => r.requestId}
          empty={{
            title:
              report === 'unresolved'
                ? 'No unresolved acknowledgments in this period'
                : 'No pickups in this period',
          }}
          columns={PickupColumns()}
          footer={
            <LoadMore
              hasMore={!!pickups.hasNextPage}
              loading={pickups.isFetchingNextPage}
              onClick={() => pickups.fetchNextPage()}
              shown={pickups.items?.length}
              total={pickups.total}
            />
          }
        />
      )}
      {report === 'guardian-activity' && (
        <DataTable
          caption="Guardian activity"
          rows={activity.items}
          loading={activity.isPending}
          error={activity.error ? messageFor(activity.error) : null}
          rowKey={(r) => r.guardianId}
          columns={[
            {
              key: 'n',
              header: 'Guardian',
              cell: (r) => (
                <div>
                  <p className="font-medium">{r.fullName}</p>
                  <p className="text-xs text-text-muted">{r.kind}</p>
                </div>
              ),
            },
            {
              key: 's',
              header: 'Status',
              cell: (r) => (
                <StateBadge
                  group="guardian"
                  value={r.state}
                  label={labels.guardianState[r.state]}
                />
              ),
            },
            { key: 'r', header: 'Requests', cell: (r) => r.requests },
            { key: 'a', header: 'Confirmed', cell: (r) => r.acknowledged },
            {
              key: 'u',
              header: 'Unresolved',
              cell: (r) => (r.unresolved ? <Badge tone="danger">{r.unresolved}</Badge> : 0),
            },
            {
              key: 'l',
              header: 'Last active',
              cell: (r) => formatRelative(r.lastActiveAt),
              hideOnMobile: true,
            },
          ]}
          footer={
            <LoadMore
              hasMore={!!activity.hasNextPage}
              loading={activity.isFetchingNextPage}
              onClick={() => activity.fetchNextPage()}
            />
          }
        />
      )}
      {report === 'device-transfers' && (
        <DataTable
          caption="Device transfers"
          rows={transfers.items}
          loading={transfers.isPending}
          error={transfers.error ? messageFor(transfers.error) : null}
          rowKey={(r) => r.transfer.id}
          empty={{ title: 'No device transfers in this period' }}
          columns={[
            { key: 'at', header: 'When', cell: (r) => formatDateTime(r.transfer.at) },
            { key: 'g', header: 'Guardian', cell: (r) => r.guardianName },
            {
              key: 'm',
              header: 'Move',
              cell: (r) => `${r.transfer.fromDevice?.model ?? '—'} → ${r.transfer.toDevice.model}`,
            },
            {
              key: 'f',
              header: 'Flags',
              cell: (r) => (
                <span className="flex gap-1">
                  {r.transfer.suspicious && <Badge tone="danger">Suspicious</Badge>}
                  {r.transfer.viaOverride && <Badge tone="warning">Override</Badge>}
                </span>
              ),
            },
          ]}
        />
      )}
      {report === 'usage' && usage.data && (
        <div className="rounded-lg border border-border bg-surface p-5">
          <p className="mb-4 text-sm text-text-muted">
            Requests per day ({formatDate(usage.data.from)} – {formatDate(usage.data.to)})
          </p>
          <ol className="flex flex-col gap-2">
            {usage.data.days.map((d) => (
              <li
                key={d.date}
                className="grid grid-cols-[90px_1fr_80px] items-center gap-3 text-sm"
              >
                <span className="text-text-muted">
                  {formatDate(d.date, { weekday: 'short', day: 'numeric', month: 'short' })}
                </span>
                <span className="h-3 rounded bg-surface-muted" aria-hidden>
                  <span
                    className="block h-3 rounded bg-primary"
                    style={{ width: `${(d.requests / maxRequests) * 100}%` }}
                  />
                </span>
                <span className="tabular-nums">
                  {d.requests} ({d.exceptions} f/u)
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </>
  );
}
