'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { unwrap } from '@homebell/api-client';
import {
  tenantLifecycleStateValues,
  type TenantLifecycleState,
  type TenantSummary,
} from '@homebell/contracts';
import { formatDate, formatRelative, labels } from '@homebell/copy';
import { Button, DataTable, Input, LoadMore, PageHeader, Select, useLink } from '@homebell/ui-web';
import { messageFor, useApi, usePagedList } from '@homebell/web-core';
import { TenantFlags, TenantStateBadge } from '@/components/tenant-bits';
import { useCan } from '@/lib/use-platform';

export default function TenantsPage() {
  const { client } = useApi();
  const router = useRouter();
  const Link = useLink();
  const can = useCan();
  const [q, setQ] = useState('');
  const [state, setState] = useState<TenantLifecycleState | ''>('');
  const [flag, setFlag] = useState('');
  const filters = { q, state, flag };
  const list = usePagedList<TenantSummary>(['platform', 'tenants', filters], (cursor) =>
    unwrap(
      client.GET('/v1/platform/tenants', {
        params: {
          query: {
            q: q || undefined,
            state: state ? [state] : undefined,
            flag: (flag || undefined) as never,
            cursor,
            limit: 25,
          },
        },
      }),
    ),
  );

  return (
    <>
      <PageHeader
        title="Schools"
        description="Every HomeBell tenant, its lifecycle state and plan. Open a school to change its access, plan or entitlements."
        actions={
          can('platform.tenants.write') && (
            <Button onClick={() => router.push('/tenants/new')}>Create school</Button>
          )
        }
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_200px_200px]">
        <Input
          type="search"
          placeholder="Search by name or address…"
          aria-label="Search schools"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Select
          aria-label="Filter by state"
          value={state}
          onChange={(e) => setState(e.target.value as TenantLifecycleState | '')}
          placeholder="All states"
          options={tenantLifecycleStateValues.map((s) => ({
            value: s,
            label: labels.tenantState[s],
          }))}
        />
        <Select
          aria-label="Filter by flag"
          value={flag}
          onChange={(e) => setFlag(e.target.value)}
          placeholder="Any flag"
          options={[
            { value: 'expiring_soon', label: 'Expiring soon' },
            { value: 'suspicious_transfers', label: 'Suspicious transfers' },
            { value: 'setup_incomplete', label: 'Setup incomplete' },
          ]}
        />
      </div>
      <DataTable
        caption="Schools"
        rows={list.items}
        loading={list.isPending}
        error={list.error ? messageFor(list.error) : null}
        onRetry={() => list.refetch()}
        rowKey={(t) => t.id}
        onRowClick={(t) => router.push(`/tenants/${t.id}`)}
        empty={{ title: 'No schools match', description: 'Try a different search or filter.' }}
        columns={[
          {
            key: 'name',
            header: 'School',
            cell: (t) => (
              <div>
                <Link href={`/tenants/${t.id}`} className="font-medium text-text hover:underline">
                  {t.name}
                </Link>
                <p className="text-xs text-text-muted">
                  {t.slug} · {t.region}
                </p>
              </div>
            ),
          },
          { key: 'state', header: 'State', cell: (t) => <TenantStateBadge state={t.state} /> },
          {
            key: 'plan',
            header: 'Plan',
            cell: (t) => t.planName ?? <span className="text-text-muted">—</span>,
            hideOnMobile: true,
          },
          {
            key: 'expires',
            header: 'Expires',
            cell: (t) => (t.expiresAt ? formatDate(t.expiresAt) : '—'),
            hideOnMobile: true,
          },
          {
            key: 'students',
            header: 'Students',
            cell: (t) => <span className="tabular-nums">{t.studentCount}</span>,
            hideOnMobile: true,
          },
          {
            key: 'guardians',
            header: 'Guardians',
            cell: (t) => <span className="tabular-nums">{t.activeGuardianCount}</span>,
            hideOnMobile: true,
          },
          {
            key: 'flags',
            header: 'Flags',
            cell: (t) => <TenantFlags flags={t.flags} />,
            hideOnMobile: true,
          },
          {
            key: 'activity',
            header: 'Last activity',
            cell: (t) => formatRelative(t.lastActivityAt),
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
    </>
  );
}
