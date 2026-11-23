'use client';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@homebell/api-client';
import { formatDate, labels } from '@homebell/copy';
import {
  Badge,
  Banner,
  Button,
  Card,
  ConfirmDialog,
  DataTable,
  ErrorState,
  LoadingState,
  PageHeader,
  StateBadge,
  useLink,
  useToast,
} from '@homebell/ui-web';
import { ApiError, fieldErrors, messageFor, useApi } from '@homebell/web-core';
import { StudentFormFields, type StudentFields } from '@/components/student-form';
import { schoolKey, useSchool } from '@/lib/school';

export default function StudentDetailPage() {
  const { studentId } = useParams<{ studentId: string }>();
  const { tenantId, can, canWrite } = useSchool();
  const { client } = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const Link = useLink();
  const key = schoolKey(tenantId, 'student', studentId);
  const student = useQuery({
    queryKey: key,
    queryFn: async () => {
      const r = await client.GET('/v1/t/{tenantId}/students/{studentId}', {
        params: { path: { tenantId, studentId } },
      });
      const data = await unwrap(Promise.resolve(r));
      return { student: data, etag: r.response.headers.get('ETag') };
    },
  });
  const guardians = useQuery({
    queryKey: [...key, 'guardians'],
    queryFn: () =>
      unwrap(
        client.GET('/v1/t/{tenantId}/students/{studentId}/guardians', {
          params: { path: { tenantId, studentId } },
        }),
      ),
  });
  const [form, setForm] = useState<StudentFields | null>(null);
  const [confirm, setConfirm] = useState(false);
  const s = student.data?.student;
  useEffect(() => {
    if (s)
      setForm({
        firstName: s.firstName,
        lastName: s.lastName,
        preferredName: s.preferredName ?? '',
        externalRef: s.externalRef ?? '',
        classId: s.classId,
        sectionId: s.sectionId ?? '',
        dismissalEligibility: s.dismissalEligibility,
        notes: s.notes ?? '',
        restrictionsNote: s.restrictionsNote ?? '',
      });
  }, [s]);
  const writable = canWrite && can('school.students.write');
  const save = useMutation({
    mutationFn: () =>
      unwrap(
        client.PATCH('/v1/t/{tenantId}/students/{studentId}', {
          params: {
            path: { tenantId, studentId },
            header: { 'If-Match': student.data?.etag ?? undefined },
          },
          body: {
            firstName: form!.firstName,
            lastName: form!.lastName,
            preferredName: form!.preferredName || null,
            externalRef: form!.externalRef || null,
            classId: form!.classId,
            sectionId: form!.sectionId || null,
            dismissalEligibility: form!.dismissalEligibility,
            notes: form!.notes || null,
            restrictionsNote: form!.restrictionsNote || null,
          },
        }),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: schoolKey(tenantId, 'students') });
      void qc.invalidateQueries({ queryKey: key });
      toast('Student saved');
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'PRECONDITION_FAILED')
        void qc.invalidateQueries({ queryKey: key });
    },
  });
  const toggle = useMutation({
    mutationFn: () =>
      s!.status === 'active'
        ? unwrap(
            client.POST('/v1/t/{tenantId}/students/{studentId}/deactivate', {
              params: { path: { tenantId, studentId } },
              body: {},
            }),
          )
        : unwrap(
            client.POST('/v1/t/{tenantId}/students/{studentId}/reactivate', {
              params: { path: { tenantId, studentId } },
              body: {},
            }),
          ),
    onSuccess: (r) => {
      setConfirm(false);
      void qc.invalidateQueries({ queryKey: schoolKey(tenantId, 'students') });
      void qc.invalidateQueries({ queryKey: key });
      toast(
        r.status === 'active'
          ? 'Student reactivated'
          : 'Student deactivated — pickup requests are now blocked',
      );
    },
  });
  if (student.isPending || !form) return <LoadingState rows={6} />;
  if (student.error)
    return <ErrorState message={messageFor(student.error)} onRetry={() => student.refetch()} />;
  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: 'Students', href: `/t/${tenantId}/students` },
          { label: `${s!.firstName} ${s!.lastName}` },
        ]}
        title={`${s!.preferredName ?? s!.firstName} ${s!.lastName}`}
        badge={
          <span className="flex gap-2">
            <StateBadge
              group="student"
              value={s!.status}
              label={s!.status === 'active' ? 'Active' : 'Inactive'}
            />
            <StateBadge
              group="eligibility"
              value={s!.dismissalEligibility}
              label={labels.eligibility[s!.dismissalEligibility]}
            />
          </span>
        }
        description={`${s!.className}${s!.sectionName ? ` ${s!.sectionName}` : ''} · added ${formatDate(s!.createdAt)}`}
        actions={
          writable && (
            <Button variant="secondary" onClick={() => setConfirm(true)}>
              {s!.status === 'active' ? 'Deactivate' : 'Reactivate'}
            </Button>
          )
        }
      />
      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <Card title="Details">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
            className="flex flex-col gap-4"
          >
            {save.error && <Banner tone="danger">{messageFor(save.error)}</Banner>}
            <fieldset disabled={!writable} className="contents">
              <StudentFormFields
                tenantId={tenantId}
                value={form}
                onChange={setForm}
                errors={fieldErrors(save.error)}
                showRestricted={can('school.students.write')}
              />
            </fieldset>
            {writable && (
              <div>
                <Button type="submit" loading={save.isPending}>
                  Save changes
                </Button>
              </div>
            )}
          </form>
        </Card>
        <Card
          title="Guardians"
          description="Who can request pickup for this student."
          padded={false}
        >
          <DataTable
            caption="Guardians"
            rows={guardians.data?.items}
            loading={guardians.isPending}
            rowKey={(g) => g.guardianId}
            empty={{ title: 'No guardians linked' }}
            columns={[
              {
                key: 'n',
                header: 'Guardian',
                cell: (g) => (
                  <div>
                    <Link
                      href={`/t/${tenantId}/guardians/${g.guardianId}`}
                      className="font-medium hover:underline"
                    >
                      {g.fullName}
                    </Link>
                    <p className="text-xs text-text-muted">
                      {labels.relationship[g.relationship]} · {g.maskedPhone}
                    </p>
                  </div>
                ),
              },
              {
                key: 'k',
                header: 'Type',
                cell: (g) =>
                  g.isPrimary ? <Badge tone="brand">Primary</Badge> : <Badge>Additional</Badge>,
              },
              {
                key: 's',
                header: 'Status',
                cell: (g) => (
                  <StateBadge
                    group="guardian"
                    value={g.state}
                    label={labels.guardianState[g.state]}
                  />
                ),
              },
            ]}
          />
        </Card>
      </div>
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={() => toggle.mutate()}
        loading={toggle.isPending}
        tone={s!.status === 'active' ? 'danger' : 'primary'}
        title={s!.status === 'active' ? 'Deactivate student?' : 'Reactivate student?'}
        description={
          s!.status === 'active'
            ? 'Guardians will no longer be able to request pickup. History is kept.'
            : 'Guardians can request pickup again.'
        }
        confirmLabel={s!.status === 'active' ? 'Deactivate' : 'Reactivate'}
      >
        {toggle.error && <Banner tone="danger">{messageFor(toggle.error)}</Banner>}
      </ConfirmDialog>
    </>
  );
}
