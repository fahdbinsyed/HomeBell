'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { unwrap } from '@homebell/api-client';
import {
  guardianStateValues,
  type Guardian,
  type GuardianKind,
  type GuardianState,
} from '@homebell/contracts';
import { formatRelative, labels } from '@homebell/copy';
import {
  Badge,
  Button,
  DataTable,
  Input,
  LoadMore,
  PageHeader,
  Select,
  StateBadge,
  Switch,
  useLink,
} from '@homebell/ui-web';
import { messageFor, useApi, usePagedList } from '@homebell/web-core';
import { schoolKey, useSchool } from '@/lib/school';

export default function GuardiansPage() {
  const { tenantId, can, canWrite } = useSchool();
  const { client } = useApi();
  const router = useRouter();
  const Link = useLink();
  const [q, setQ] = useState('');
  const [state, setState] = useState<GuardianState | ''>('');
  const [kind, setKind] = useState<GuardianKind | ''>('');
  const [suspiciousOnly, setSuspiciousOnly] = useState(false);
  const filters = { q, state, kind, suspiciousOnly };
  const list = usePagedList<Guardian>(schoolKey(tenantId, 'guardians', filters), (cursor) =>
    unwrap(
      client.GET('/v1/t/{tenantId}/guardians', {
        params: {
          path: { tenantId },
          query: {
            q: q || undefined,
            state: state || undefined,
            kind: kind || undefined,
            suspiciousOnly: suspiciousOnly || undefined,
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
        title="Guardians"
        description="Primary guardians come from student records; additional guardians are invited and paid for by the primary guardian. You can block or deactivate anyone — history is always kept."
        actions={
          canWrite &&
          can('school.guardians.write') && (
            <Button onClick={() => router.push(`/t/${tenantId}/guardians/new`)}>
              Add primary guardian
            </Button>
          )
        }
      />
      <div className="mb-4 grid items-center gap-3 md:grid-cols-[1fr_170px_170px_auto]">
        <Input
          type="search"
          placeholder="Search name or last 4 digits"
          aria-label="Search guardians"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Select
          aria-label="State"
          value={state}
          onChange={(e) => setState(e.target.value as GuardianState | '')}
          placeholder="Any state"
          options={guardianStateValues.map((s) => ({ value: s, label: labels.guardianState[s] }))}
        />
        <Select
          aria-label="Type"
          value={kind}
          onChange={(e) => setKind(e.target.value as GuardianKind | '')}
          placeholder="Primary & additional"
          options={[
            { value: 'primary', label: 'Primary' },
            { value: 'additional', label: 'Additional' },
          ]}
        />
        <Switch
          label="Suspicious transfers"
          checked={suspiciousOnly}
          onChange={setSuspiciousOnly}
        />
      </div>
      <DataTable
        caption="Guardians"
        rows={list.items}
        loading={list.isPending}
        error={list.error ? messageFor(list.error) : null}
        onRetry={() => list.refetch()}
        rowKey={(g) => g.id}
        onRowClick={(g) => router.push(`/t/${tenantId}/guardians/${g.id}`)}
        empty={{ title: 'No guardians match' }}
        columns={[
          {
            key: 'n',
            header: 'Guardian',
            cell: (g) => (
              <div>
                <Link
                  href={`/t/${tenantId}/guardians/${g.id}`}
                  className="font-medium text-text hover:underline"
                >
                  {g.fullName}
                </Link>
                <p className="text-xs text-text-muted">{g.maskedPhone}</p>
              </div>
            ),
          },
          {
            key: 'k',
            header: 'Type',
            cell: (g) =>
              g.kind === 'primary' ? (
                <Badge tone="brand">Primary</Badge>
              ) : (
                <Badge>Additional</Badge>
              ),
          },
          {
            key: 'c',
            header: 'Children',
            cell: (g) => g.students.map((s) => s.fullName).join(', '),
            hideOnMobile: true,
          },
          {
            key: 's',
            header: 'Status',
            cell: (g) => (
              <span className="flex flex-wrap gap-1">
                <StateBadge
                  group="guardian"
                  value={g.state}
                  label={labels.guardianState[g.state]}
                />
                {(g.suspiciousTransfersLast30Days ?? 0) > 0 && (
                  <Badge tone="danger">Suspicious transfer</Badge>
                )}
              </span>
            ),
          },
          {
            key: 'd',
            header: 'Device',
            cell: (g) => (g.activeDevice ? `${g.activeDevice.model}` : '—'),
            hideOnMobile: true,
          },
          {
            key: 'a',
            header: 'Last active',
            cell: (g) => formatRelative(g.lastActiveAt),
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
