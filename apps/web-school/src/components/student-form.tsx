'use client';
import { useQuery } from '@tanstack/react-query';
import { unwrap } from '@homebell/api-client';
import { dismissalEligibilityValues, type DismissalEligibility } from '@homebell/contracts';
import { labels } from '@homebell/copy';
import { Field, Input, Select, Textarea } from '@homebell/ui-web';
import { useApi } from '@homebell/web-core';
import { schoolKey } from '@/lib/school';

export interface StudentFields {
  firstName: string;
  lastName: string;
  preferredName: string;
  externalRef: string;
  classId: string;
  sectionId: string;
  dismissalEligibility: DismissalEligibility;
  notes: string;
  restrictionsNote: string;
}

export function StudentFormFields({
  tenantId,
  value,
  onChange,
  errors = {},
  showRestricted = true,
}: {
  tenantId: string;
  value: StudentFields;
  onChange: (v: StudentFields) => void;
  errors?: Record<string, string>;
  showRestricted?: boolean;
}) {
  const { client } = useApi();
  const classes = useQuery({
    queryKey: schoolKey(tenantId, 'classes'),
    queryFn: () =>
      unwrap(client.GET('/v1/t/{tenantId}/classes', { params: { path: { tenantId } } })),
  });
  const set = <K extends keyof StudentFields>(k: K, v: StudentFields[K]) =>
    onChange({ ...value, [k]: v });
  const sections = classes.data?.items.find((c) => c.id === value.classId)?.sections ?? [];
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="First name" required error={errors.firstName}>
        {(p) => (
          <Input
            {...p}
            value={value.firstName}
            onChange={(e) => set('firstName', e.target.value)}
          />
        )}
      </Field>
      <Field label="Last name" required error={errors.lastName}>
        {(p) => (
          <Input {...p} value={value.lastName} onChange={(e) => set('lastName', e.target.value)} />
        )}
      </Field>
      <Field label="Preferred name" hint="Shown on screens instead of the first name.">
        {(p) => (
          <Input
            {...p}
            value={value.preferredName}
            onChange={(e) => set('preferredName', e.target.value)}
          />
        )}
      </Field>
      <Field label="Student number">
        {(p) => (
          <Input
            {...p}
            value={value.externalRef}
            onChange={(e) => set('externalRef', e.target.value)}
          />
        )}
      </Field>
      <Field label="Class" required error={errors.classId}>
        {(p) => (
          <Select
            {...p}
            value={value.classId}
            onChange={(e) => onChange({ ...value, classId: e.target.value, sectionId: '' })}
            placeholder="Choose a class"
            options={(classes.data?.items ?? []).map((c) => ({ value: c.id, label: c.name }))}
          />
        )}
      </Field>
      <Field label="Section">
        {(p) => (
          <Select
            {...p}
            value={value.sectionId}
            onChange={(e) => set('sectionId', e.target.value)}
            placeholder={sections.length ? 'No section' : 'No sections in this class'}
            options={sections.map((s) => ({ value: s.id, label: s.name }))}
          />
        )}
      </Field>
      <Field
        label="Dismissal eligibility"
        hint="“On hold” and “Not eligible” block guardian pickup requests."
      >
        {(p) => (
          <Select
            {...p}
            value={value.dismissalEligibility}
            onChange={(e) => set('dismissalEligibility', e.target.value as DismissalEligibility)}
            options={dismissalEligibilityValues.map((x) => ({
              value: x,
              label: labels.eligibility[x],
            }))}
          />
        )}
      </Field>
      <Field label="Notes" className="sm:col-span-2">
        {(p) => (
          <Textarea {...p} value={value.notes} onChange={(e) => set('notes', e.target.value)} />
        )}
      </Field>
      {showRestricted && (
        <Field
          label="Restrictions (confidential)"
          hint="Visible to school admins only — e.g. custody orders."
          className="sm:col-span-2"
        >
          {(p) => (
            <Textarea
              {...p}
              value={value.restrictionsNote}
              onChange={(e) => set('restrictionsNote', e.target.value)}
            />
          )}
        </Field>
      )}
    </div>
  );
}

export const emptyStudent: StudentFields = {
  firstName: '',
  lastName: '',
  preferredName: '',
  externalRef: '',
  classId: '',
  sectionId: '',
  dismissalEligibility: 'eligible',
  notes: '',
  restrictionsNote: '',
};
