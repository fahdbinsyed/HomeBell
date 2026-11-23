'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@homebell/api-client';
import { relationshipValues, type Relationship, type Student } from '@homebell/contracts';
import { labels } from '@homebell/copy';
import {
  Banner,
  Button,
  Card,
  Checkbox,
  Field,
  Input,
  PageHeader,
  Select,
  useToast,
} from '@homebell/ui-web';
import { fieldErrors, messageFor, useApi, usePagedList } from '@homebell/web-core';
import { schoolKey, useSchool } from '@/lib/school';

export default function NewGuardianPage() {
  const { tenantId } = useSchool();
  const { client } = useApi();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [relationship, setRelationship] = useState<Relationship>('parent');
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const students = usePagedList<Student>(
    schoolKey(tenantId, 'students', { q: search, picker: true }),
    (cursor) =>
      unwrap(
        client.GET('/v1/t/{tenantId}/students', {
          params: {
            path: { tenantId },
            query: { q: search || undefined, status: 'active', cursor, limit: 10 },
          },
        }),
      ),
  );
  const ids = Object.keys(picked).filter((k) => picked[k]);
  const create = useMutation({
    mutationFn: () =>
      unwrap(
        client.POST('/v1/t/{tenantId}/guardians', {
          params: { path: { tenantId } },
          body: {
            fullName: fullName.trim(),
            phone: phone.replace(/[\s()-]/g, ''),
            links: ids.map((studentId) => ({
              studentId,
              relationship,
              isPrimary: !students.items?.find((s) => s.id === studentId)?.primaryGuardian,
            })),
          },
        }),
      ),
    onSuccess: (g) => {
      void qc.invalidateQueries({ queryKey: schoolKey(tenantId, 'guardians') });
      toast(`${g.fullName} added`);
      router.push(`/t/${tenantId}/guardians/${g.id}`);
    },
  });
  const errs = fieldErrors(create.error);
  return (
    <>
      <PageHeader
        title="Add primary guardian"
        breadcrumbs={[{ label: 'Guardians', href: `/t/${tenantId}/guardians` }, { label: 'Add' }]}
        description="Use this when a student has no primary guardian yet. Additional guardians (spouse, driver…) are invited by the primary guardian from the app."
      />
      <div className="flex max-w-3xl flex-col gap-6">
        {create.error && <Banner tone="danger">{messageFor(create.error)}</Banner>}
        <Card title="Guardian">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Full name" required>
              {(p) => (
                <Input {...p} value={fullName} onChange={(e) => setFullName(e.target.value)} />
              )}
            </Field>
            <Field label="Mobile number" required error={errs.phone}>
              {(p) => (
                <Input
                  {...p}
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+1 555 123 4567"
                />
              )}
            </Field>
            <Field label="Relationship">
              {(p) => (
                <Select
                  {...p}
                  value={relationship}
                  onChange={(e) => setRelationship(e.target.value as Relationship)}
                  options={relationshipValues.map((r) => ({
                    value: r,
                    label: labels.relationship[r],
                  }))}
                />
              )}
            </Field>
          </div>
        </Card>
        <Card title="Children" description="Select the students this guardian can pick up.">
          <Input
            type="search"
            placeholder="Search students"
            aria-label="Search students"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <ul className="mt-3 flex flex-col gap-2">
            {(students.items ?? []).map((s) => (
              <li key={s.id}>
                <Checkbox
                  label={`${s.firstName} ${s.lastName} · ${s.className}`}
                  description={
                    s.primaryGuardian
                      ? `Primary guardian: ${s.primaryGuardian.fullName} — this link will be additional`
                      : 'No primary guardian — this guardian becomes primary'
                  }
                  checked={!!picked[s.id]}
                  onChange={(e) => setPicked((x) => ({ ...x, [s.id]: e.target.checked }))}
                />
              </li>
            ))}
          </ul>
        </Card>
        <div className="flex gap-2">
          <Button
            loading={create.isPending}
            disabled={!fullName.trim() || phone.length < 8 || ids.length === 0}
            onClick={() => create.mutate()}
          >
            Add guardian
          </Button>
          <Button variant="secondary" onClick={() => router.back()}>
            Cancel
          </Button>
        </div>
      </div>
    </>
  );
}
