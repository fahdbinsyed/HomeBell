'use client';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@homebell/api-client';
import type { ImportJob } from '@homebell/contracts';
import {
  Badge,
  Banner,
  Button,
  Card,
  Checkbox,
  DataTable,
  PageHeader,
  StatCard,
  useToast,
} from '@homebell/ui-web';
import { messageFor, useApi, useIdempotencyKey } from '@homebell/web-core';
import { schoolKey, useSchool } from '@/lib/school';

export default function ImportPage() {
  const { tenantId } = useSchool();
  const { client } = useApi();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const idem = useIdempotencyKey();
  const fileRef = useRef<HTMLInputElement>(null);
  const [job, setJob] = useState<ImportJob | null>(null);
  const [skipErrors, setSkipErrors] = useState(false);
  const [onlyProblems, setOnlyProblems] = useState(true);

  const downloadTemplate = async () => {
    const r = await client.GET('/v1/t/{tenantId}/imports/template', {
      params: { path: { tenantId } },
      parseAs: 'text',
    });
    if (!r.response.ok) return toast('Could not download the template', 'danger');
    const url = URL.createObjectURL(new Blob([r.data as unknown as string], { type: 'text/csv' }));
    Object.assign(document.createElement('a'), {
      href: url,
      download: 'homebell-students-template.csv',
    }).click();
    URL.revokeObjectURL(url);
  };
  const upload = useMutation({
    mutationFn: (file: File) =>
      unwrap(
        client.POST('/v1/t/{tenantId}/imports', {
          params: { path: { tenantId } },
          body: { type: 'students_with_guardians', file: file as unknown as string },
          bodySerializer: (b) => {
            const fd = new FormData();
            fd.set('type', b.type);
            fd.set('file', b.file as unknown as Blob);
            return fd;
          },
        }),
      ),
    onSuccess: setJob,
  });
  const rows = useQuery({
    queryKey: schoolKey(tenantId, 'import', job?.id, onlyProblems),
    queryFn: async () => {
      const all = await unwrap(
        client.GET('/v1/t/{tenantId}/imports/{importId}/rows', {
          params: { path: { tenantId, importId: job!.id }, query: { limit: 100 } },
        }),
      );
      return onlyProblems ? all.items.filter((r) => r.status !== 'valid') : all.items;
    },
    enabled: !!job,
  });
  const commit = useMutation({
    mutationFn: () =>
      unwrap(
        client.POST('/v1/t/{tenantId}/imports/{importId}/commit', {
          params: {
            path: { tenantId, importId: job!.id },
            header: { 'Idempotency-Key': idem.key() },
          },
          body: { skipErrorRows: skipErrors },
        }),
      ),
    onSuccess: (j) => {
      idem.next();
      setJob(j);
      void qc.invalidateQueries({ queryKey: schoolKey(tenantId, 'students') });
      toast(
        `Import complete: ${j.summary.studentsToCreate} added, ${j.summary.studentsToUpdate} updated`,
      );
    },
  });

  return (
    <>
      <PageHeader
        title="Import students & guardians"
        breadcrumbs={[{ label: 'Students', href: `/t/${tenantId}/students` }, { label: 'Import' }]}
        description="Upload a CSV. Nothing changes until you review the preview and confirm. Each row needs the student, class and primary guardian's mobile number."
      />
      <div className="flex flex-col gap-6">
        <Card title="1. Upload">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="secondary" onClick={downloadTemplate}>
              Download template
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="text-sm file:mr-3 file:rounded-md file:border file:border-border-strong file:bg-surface file:px-3 file:py-1.5 file:text-sm"
              aria-label="CSV file"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) {
                  setJob(null);
                  upload.mutate(f);
                }
              }}
            />
            {upload.isPending && <Badge tone="info">Checking file…</Badge>}
          </div>
          {upload.error && (
            <div className="mt-4">
              <Banner tone="danger">{messageFor(upload.error)}</Banner>
            </div>
          )}
        </Card>
        {job && (
          <Card title="2. Review" description={job.fileName}>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="Rows" value={job.summary.totalRows} />
              <StatCard
                label="Ready"
                value={job.summary.validRows + job.summary.warningRows}
                tone="success"
                hint={`${job.summary.warningRows} will update existing students`}
              />
              <StatCard
                label="Errors"
                value={job.summary.errorRows}
                tone={job.summary.errorRows ? 'danger' : undefined}
              />
              <StatCard
                label="New guardians"
                value={job.summary.guardiansToCreate}
                hint={`${job.summary.guardiansToLink} existing linked`}
              />
            </div>
            <div className="mt-4 flex items-center justify-between">
              <Checkbox
                label="Show only rows with problems"
                checked={onlyProblems}
                onChange={(e) => setOnlyProblems(e.target.checked)}
              />
            </div>
            <div className="mt-3">
              <DataTable
                caption="Import rows"
                rows={rows.data}
                loading={rows.isPending}
                rowKey={(r) => String(r.rowNumber)}
                empty={{ title: 'No problems found', description: 'Every row is ready to import.' }}
                columns={[
                  { key: 'n', header: 'Row', cell: (r) => r.rowNumber },
                  {
                    key: 's',
                    header: 'Status',
                    cell: (r) => (
                      <Badge
                        tone={
                          r.status === 'error'
                            ? 'danger'
                            : r.status === 'warning'
                              ? 'warning'
                              : 'success'
                        }
                      >
                        {r.status}
                      </Badge>
                    ),
                  },
                  {
                    key: 'st',
                    header: 'Student',
                    cell: (r) =>
                      `${r.data.student_first_name ?? ''} ${r.data.student_last_name ?? ''}`,
                  },
                  {
                    key: 'g',
                    header: 'Guardian',
                    cell: (r) =>
                      `${r.data.guardian_full_name ?? ''} · ${r.data.guardian_phone ?? ''}`,
                    hideOnMobile: true,
                  },
                  {
                    key: 'm',
                    header: 'Messages',
                    cell: (r) => (
                      <ul className="text-xs">
                        {r.messages.map((m, i) => (
                          <li
                            key={i}
                            className={r.status === 'error' ? 'text-danger-fg' : 'text-text-muted'}
                          >
                            {m.message}
                          </li>
                        ))}
                      </ul>
                    ),
                  },
                ]}
              />
            </div>
          </Card>
        )}
        {job && (
          <Card title="3. Import">
            {job.status === 'completed' ? (
              <div className="flex flex-wrap items-center gap-3">
                <Banner tone="success">Import completed.</Banner>
                <Button onClick={() => router.push(`/t/${tenantId}/students`)}>
                  View students
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {commit.error && <Banner tone="danger">{messageFor(commit.error)}</Banner>}
                {job.summary.errorRows > 0 && (
                  <Checkbox
                    label={`Skip the ${job.summary.errorRows} rows with errors and import the rest`}
                    checked={skipErrors}
                    onChange={(e) => setSkipErrors(e.target.checked)}
                  />
                )}
                <div>
                  <Button
                    loading={commit.isPending}
                    disabled={job.summary.errorRows > 0 && !skipErrors}
                    onClick={() => commit.mutate()}
                  >
                    Import {job.summary.totalRows - (skipErrors ? job.summary.errorRows : 0)} rows
                  </Button>
                </div>
              </div>
            )}
          </Card>
        )}
      </div>
    </>
  );
}
