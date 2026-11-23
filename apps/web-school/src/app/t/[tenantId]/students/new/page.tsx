'use client';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@homebell/api-client';
import { relationshipValues, type Relationship } from '@homebell/contracts';
import { labels } from '@homebell/copy';
import { Banner, Button, Card, Field, Input, PageHeader, Select, useToast } from '@homebell/ui-web';
import { fieldErrors, messageFor, useApi } from '@homebell/web-core';
import { emptyStudent, StudentFormFields } from '@/components/student-form';
import { schoolKey, useSchool } from '@/lib/school';

export default function NewStudentPage() {
  const { tenantId } = useSchool();
  const { client } = useApi();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const [s, setS] = useState(emptyStudent);
  const [g, setG] = useState({ fullName: '', phone: '', relationship: 'mother' as Relationship });
  const create = useMutation({
    mutationFn: () =>
      unwrap(
        client.POST('/v1/t/{tenantId}/students', {
          params: { path: { tenantId } },
          body: {
            firstName: s.firstName.trim(),
            lastName: s.lastName.trim(),
            preferredName: s.preferredName || undefined,
            externalRef: s.externalRef || undefined,
            classId: s.classId,
            sectionId: s.sectionId || undefined,
            dismissalEligibility: s.dismissalEligibility,
            notes: s.notes || undefined,
            restrictionsNote: s.restrictionsNote || undefined,
            primaryGuardian: {
              fullName: g.fullName.trim(),
              phone: g.phone.replace(/[\s()-]/g, ''),
              relationship: g.relationship,
            },
          },
        }),
      ),
    onSuccess: (st) => {
      void qc.invalidateQueries({ queryKey: schoolKey(tenantId, 'students') });
      toast(
        `${st.firstName} added. ${st.primaryGuardian?.state === 'pending_activation' ? 'The guardian can activate the app with their phone number.' : ''}`,
      );
      router.push(`/t/${tenantId}/students/${st.id}`);
    },
  });
  const errs = fieldErrors(create.error);
  const valid =
    s.firstName.trim() &&
    s.lastName.trim() &&
    s.classId &&
    g.fullName.trim() &&
    /^\+?[\d\s()-]{8,}$/.test(g.phone);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (valid) create.mutate();
  };
  return (
    <>
      <PageHeader
        title="Add student"
        breadcrumbs={[{ label: 'Students', href: `/t/${tenantId}/students` }, { label: 'Add' }]}
      />
      <form onSubmit={submit} className="flex max-w-3xl flex-col gap-6" noValidate>
        {create.error && <Banner tone="danger">{messageFor(create.error)}</Banner>}
        <Card title="Student">
          <StudentFormFields tenantId={tenantId} value={s} onChange={setS} errors={errs} />
        </Card>
        <Card
          title="Primary guardian"
          description="Each student includes one primary guardian account. They activate the HomeBell app by verifying this phone number. If the number is already a guardian at this school, the student is linked to them."
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Full name" required>
              {(p) => (
                <Input
                  {...p}
                  value={g.fullName}
                  onChange={(e) => setG({ ...g, fullName: e.target.value })}
                />
              )}
            </Field>
            <Field
              label="Mobile number"
              required
              hint="International format, e.g. +1 555 123 4567"
              error={errs['primaryGuardian.phone']}
            >
              {(p) => (
                <Input
                  {...p}
                  type="tel"
                  autoComplete="off"
                  value={g.phone}
                  onChange={(e) => setG({ ...g, phone: e.target.value })}
                />
              )}
            </Field>
            <Field label="Relationship">
              {(p) => (
                <Select
                  {...p}
                  value={g.relationship}
                  onChange={(e) => setG({ ...g, relationship: e.target.value as Relationship })}
                  options={relationshipValues.map((r) => ({
                    value: r,
                    label: labels.relationship[r],
                  }))}
                />
              )}
            </Field>
          </div>
        </Card>
        <div className="flex gap-2">
          <Button type="submit" loading={create.isPending} disabled={!valid}>
            Add student
          </Button>
          <Button variant="secondary" onClick={() => router.back()}>
            Cancel
          </Button>
        </div>
      </form>
    </>
  );
}
