'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { unwrap } from '@homebell/api-client';
import {
  dismissalEligibilityValues,
  type DismissalEligibility,
  type Student,
  type StudentStatus,
} from '@homebell/contracts';
import { labels } from '@homebell/copy';
import {
  Button,
  DataTable,
  Input,
  LoadMore,
  PageHeader,
  Select,
  StateBadge,
  useLink,
} from '@homebell/ui-web';
import { messageFor, useApi, usePagedList } from '@homebell/web-core';
import { schoolKey, useSchool } from '@/lib/school';

export default function StudentsPage() {
  const { tenantId, can, canWrite, has } = useSchool();
  const { client } = useApi();
  const router = useRouter();
  const Link = useLink();
  const [q, setQ] = useState('');
  const [classId, setClassId] = useState('');
  const [status, setStatus] = useState<StudentStatus | ''>('active');
  const [eligibility, setEligibility] = useState<DismissalEligibility | ''>('');
  const classes = useQuery({
    queryKey: schoolKey(tenantId, 'classes'),
    queryFn: () =>
      unwrap(client.GET('/v1/t/{tenantId}/classes', { params: { path: { tenantId } } })),
  });
  const filters = { q, classId, status, eligibility };
  const list = usePagedList<Student>(schoolKey(tenantId, 'students', filters), (cursor) =>
    unwrap(
      client.GET('/v1/t/{tenantId}/students', {
        params: {
          path: { tenantId },
          query: {
            q: q || undefined,
            classId: classId || undefined,
            status: status || undefined,
            eligibility: eligibility || undefined,
            cursor,
            limit: 25,
          },
        },
      }),
    ),
  );
  const writable = canWrite && can('school.students.write');
  return (
    <>
      <PageHeader
        title="Students"
        description="Students, their class and dismissal eligibility, and the guardians allowed to request pickup."
        actions={
          writable && (
            <>
              {has('imports.csv') && can('school.imports.write') && (
                <Button
                  variant="secondary"
                  onClick={() => router.push(`/t/${tenantId}/students/import`)}
                >
                  Import CSV
                </Button>
              )}
              <Button onClick={() => router.push(`/t/${tenantId}/students/new`)}>
                Add student
              </Button>
            </>
          )
        }
      />
      <div className="mb-4 grid gap-3 md:grid-cols-[1fr_180px_160px_160px]">
        <Input
          type="search"
          placeholder="Search name or student number"
          aria-label="Search students"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Select
          aria-label="Class"
          value={classId}
          onChange={(e) => setClassId(e.target.value)}
          placeholder="All classes"
          options={(classes.data?.items ?? []).map((c) => ({ value: c.id, label: c.name }))}
        />
        <Select
          aria-label="Status"
          value={status}
          onChange={(e) => setStatus(e.target.value as StudentStatus | '')}
          placeholder="Any status"
          options={[
            { value: 'active', label: 'Active' },
            { value: 'inactive', label: 'Inactive' },
          ]}
        />
        <Select
          aria-label="Eligibility"
          value={eligibility}
          onChange={(e) => setEligibility(e.target.value as DismissalEligibility | '')}
          placeholder="Any eligibility"
          options={dismissalEligibilityValues.map((x) => ({
            value: x,
            label: labels.eligibility[x],
          }))}
        />
      </div>
      <DataTable
        caption="Students"
        rows={list.items}
        loading={list.isPending}
        error={list.error ? messageFor(list.error) : null}
        onRetry={() => list.refetch()}
        rowKey={(s) => s.id}
        onRowClick={(s) => router.push(`/t/${tenantId}/students/${s.id}`)}
        empty={{
          title: 'No students found',
          description: writable ? 'Add a student or import a CSV.' : undefined,
        }}
        columns={[
          {
            key: 'n',
            header: 'Student',
            cell: (s) => (
              <div>
                <Link
                  href={`/t/${tenantId}/students/${s.id}`}
                  className="font-medium text-text hover:underline"
                >
                  {s.preferredName ?? s.firstName} {s.lastName}
                </Link>
                <p className="text-xs text-text-muted">{s.externalRef ?? '—'}</p>
              </div>
            ),
          },
          {
            key: 'c',
            header: 'Class',
            cell: (s) => `${s.className}${s.sectionName ? ` ${s.sectionName}` : ''}`,
          },
          {
            key: 'g',
            header: 'Primary guardian',
            cell: (s) =>
              s.primaryGuardian ? (
                <div>
                  <p>{s.primaryGuardian.fullName}</p>
                  <p className="text-xs text-text-muted">{s.primaryGuardian.maskedPhone}</p>
                </div>
              ) : (
                <span className="text-danger-fg">None</span>
              ),
            hideOnMobile: true,
          },
          { key: 'gc', header: 'Guardians', cell: (s) => s.guardianCount, hideOnMobile: true },
          {
            key: 'e',
            header: 'Dismissal',
            cell: (s) => (
              <StateBadge
                group="eligibility"
                value={s.dismissalEligibility}
                label={labels.eligibility[s.dismissalEligibility]}
              />
            ),
          },
          {
            key: 's',
            header: 'Status',
            cell: (s) => (
              <StateBadge
                group="student"
                value={s.status}
                label={s.status === 'active' ? 'Active' : 'Inactive'}
              />
            ),
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
