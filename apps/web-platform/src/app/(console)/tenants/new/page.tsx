'use client';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@homebell/api-client';
import type { CreateTenantRequest } from '@homebell/contracts';
import {
  Banner,
  Button,
  Card,
  Checkbox,
  Field,
  Input,
  PageHeader,
  Select,
  Textarea,
  useToast,
} from '@homebell/ui-web';
import { ApiError, fieldErrors, messageFor, useApi, useIdempotencyKey } from '@homebell/web-core';
import { dateToIso, usePlans } from '@/lib/use-platform';

const TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'Europe/London',
  'Asia/Dubai',
  'Asia/Karachi',
  'Asia/Riyadh',
];
const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);

export default function NewTenantPage() {
  const { client } = useApi();
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const plans = usePlans();
  const idem = useIdempotencyKey();
  const [f, setF] = useState({
    name: '',
    slug: '',
    slugTouched: false,
    legalName: '',
    countryCode: 'US',
    region: 'us-east',
    timezone: 'America/New_York',
    termStartDate: '',
    termEndDate: '',
    initialState: 'trial' as CreateTenantRequest['initialState'],
    expiresAt: '',
    planVersionId: '',
    contactName: '',
    contactEmail: '',
    inviteSchoolAdmin: true,
    note: '',
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  const create = useMutation({
    mutationFn: () =>
      unwrap(
        client.POST('/v1/platform/tenants', {
          params: { header: { 'Idempotency-Key': idem.key() } },
          body: {
            name: f.name.trim(),
            slug: f.slug,
            legalName: f.legalName || undefined,
            countryCode: f.countryCode,
            region: f.region,
            timezone: f.timezone,
            termStartDate: f.termStartDate,
            termEndDate: f.termEndDate,
            initialState: f.initialState,
            expiresAt: f.initialState === 'trial' ? dateToIso(f.expiresAt) : undefined,
            planVersionId: f.planVersionId || undefined,
            primaryContact: { fullName: f.contactName.trim(), email: f.contactEmail.trim() },
            inviteSchoolAdmin: f.inviteSchoolAdmin,
            note: f.note || undefined,
          },
        }),
      ),
    onSuccess: (t) => {
      idem.next();
      void qc.invalidateQueries({ queryKey: ['platform', 'tenants'] });
      toast(`${t.name} created`);
      router.push(`/tenants/${t.id}`);
    },
  });
  const errs = fieldErrors(create.error);
  const versions = (plans.data?.items ?? []).flatMap((p) =>
    p.versions
      .filter((v) => v.status === 'published')
      .map((v) => ({ value: v.id, label: `${p.name} v${v.version}` })),
  );
  const valid =
    f.name.trim() &&
    f.slug.length >= 3 &&
    f.termStartDate &&
    f.termEndDate &&
    f.contactName.trim() &&
    /\S+@\S+\.\S+/.test(f.contactEmail) &&
    (f.initialState !== 'trial' || f.expiresAt);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (valid) create.mutate();
  };

  return (
    <>
      <PageHeader
        title="Create school"
        breadcrumbs={[{ label: 'Schools', href: '/tenants' }, { label: 'Create' }]}
        description="Creates a tenant and (optionally) invites its first school admin. Billing is handled outside HomeBell."
      />
      <form onSubmit={submit} className="flex max-w-3xl flex-col gap-6" noValidate>
        {create.error && <Banner tone="danger">{messageFor(create.error)}</Banner>}
        <Card title="School">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="School name" required error={errs.name}>
              {(p) => (
                <Input
                  {...p}
                  value={f.name}
                  onChange={(e) =>
                    setF((x) => ({
                      ...x,
                      name: e.target.value,
                      slug: x.slugTouched ? x.slug : slugify(e.target.value),
                    }))
                  }
                />
              )}
            </Field>
            <Field
              label="Address (slug)"
              required
              hint="Lowercase letters, numbers and dashes."
              error={
                create.error instanceof ApiError && create.error.code === 'TENANT_SLUG_TAKEN'
                  ? messageFor(create.error)
                  : errs.slug
              }
            >
              {(p) => (
                <Input
                  {...p}
                  value={f.slug}
                  onChange={(e) =>
                    setF((x) => ({ ...x, slug: slugify(e.target.value), slugTouched: true }))
                  }
                />
              )}
            </Field>
            <Field label="Legal name">
              {(p) => (
                <Input
                  {...p}
                  value={f.legalName}
                  onChange={(e) => set('legalName', e.target.value)}
                />
              )}
            </Field>
            <Field label="Time zone" required>
              {(p) => (
                <Select
                  {...p}
                  value={f.timezone}
                  onChange={(e) => set('timezone', e.target.value)}
                  options={TIMEZONES.map((t) => ({ value: t, label: t }))}
                />
              )}
            </Field>
            <Field label="Country" required hint="ISO code — drives data residency (ADR-0012).">
              {(p) => (
                <Input
                  {...p}
                  value={f.countryCode}
                  maxLength={2}
                  onChange={(e) => set('countryCode', e.target.value.toUpperCase())}
                />
              )}
            </Field>
            <Field label="Hosting region" required>
              {(p) => (
                <Select
                  {...p}
                  value={f.region}
                  onChange={(e) => set('region', e.target.value)}
                  options={[
                    { value: 'us-east', label: 'US East' },
                    { value: 'eu-west', label: 'EU West' },
                    { value: 'me-central', label: 'Middle East' },
                  ]}
                />
              )}
            </Field>
            <Field label="Term starts" required>
              {(p) => (
                <Input
                  {...p}
                  type="date"
                  value={f.termStartDate}
                  onChange={(e) => set('termStartDate', e.target.value)}
                />
              )}
            </Field>
            <Field label="Term ends" required error={errs.termEndDate}>
              {(p) => (
                <Input
                  {...p}
                  type="date"
                  value={f.termEndDate}
                  min={f.termStartDate}
                  onChange={(e) => set('termEndDate', e.target.value)}
                />
              )}
            </Field>
          </div>
        </Card>
        <Card
          title="Access"
          description="Schools start in draft, trial or pilot/free. Paid activation happens from the school page."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Initial state" required>
              {(p) => (
                <Select
                  {...p}
                  value={f.initialState}
                  onChange={(e) => set('initialState', e.target.value as typeof f.initialState)}
                  options={[
                    { value: 'draft', label: 'Draft (setup only)' },
                    { value: 'trial', label: 'Trial' },
                    { value: 'pilot_free', label: 'Pilot / free' },
                  ]}
                />
              )}
            </Field>
            {f.initialState === 'trial' && (
              <Field label="Trial ends" required error={errs.expiresAt}>
                {(p) => (
                  <Input
                    {...p}
                    type="date"
                    value={f.expiresAt}
                    onChange={(e) => set('expiresAt', e.target.value)}
                  />
                )}
              </Field>
            )}
            <Field label="Plan" hint="Optional now; required before paid activation.">
              {(p) => (
                <Select
                  {...p}
                  value={f.planVersionId}
                  onChange={(e) => set('planVersionId', e.target.value)}
                  placeholder="No plan yet"
                  options={versions}
                />
              )}
            </Field>
          </div>
        </Card>
        <Card title="Primary contact">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" required>
              {(p) => (
                <Input
                  {...p}
                  value={f.contactName}
                  onChange={(e) => set('contactName', e.target.value)}
                />
              )}
            </Field>
            <Field label="Email" required>
              {(p) => (
                <Input
                  {...p}
                  type="email"
                  value={f.contactEmail}
                  onChange={(e) => set('contactEmail', e.target.value)}
                />
              )}
            </Field>
          </div>
          <Checkbox
            className="mt-4"
            label="Invite this contact as the school admin"
            checked={f.inviteSchoolAdmin}
            onChange={(e) => set('inviteSchoolAdmin', e.target.checked)}
          />
          <Field className="mt-4" label="Internal note">
            {(p) => (
              <Textarea
                {...p}
                value={f.note}
                onChange={(e) => set('note', e.target.value)}
                placeholder="Context for the team (not visible to the school)"
              />
            )}
          </Field>
        </Card>
        <div className="flex gap-2">
          <Button type="submit" loading={create.isPending} disabled={!valid}>
            Create school
          </Button>
          <Button variant="secondary" onClick={() => router.back()}>
            Cancel
          </Button>
        </div>
      </form>
    </>
  );
}
