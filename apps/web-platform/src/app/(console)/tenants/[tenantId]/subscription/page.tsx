'use client';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@homebell/api-client';
import { formatDate, formatMoney, formatNumber, labels } from '@homebell/copy';
import {
  Banner,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  KeyValue,
  Select,
  useToast,
} from '@homebell/ui-web';
import { messageFor, useApi } from '@homebell/web-core';
import { dateToIso, isoToDate, keys, useCan, usePlans, useTenant } from '@/lib/use-platform';

export default function SubscriptionPage() {
  const { tenantId } = useParams<{ tenantId: string }>();
  const { client } = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const can = useCan();
  const tenant = useTenant(tenantId).data!;
  const plans = usePlans();
  const sub = tenant.subscription;
  const [planVersionId, setPlanVersionId] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [billingReference, setBillingReference] = useState('');
  useEffect(() => {
    setPlanVersionId(sub?.planVersion.id ?? '');
    setStartsAt(isoToDate(sub?.startsAt) || tenant.termStartDate);
    setEndsAt(isoToDate(sub?.endsAt) || tenant.termEndDate);
    setBillingReference(sub?.billingReference ?? '');
  }, [sub, tenant.termStartDate, tenant.termEndDate]);

  const save = useMutation({
    mutationFn: () =>
      unwrap(
        client.PUT('/v1/platform/tenants/{tenantId}/subscription', {
          params: { path: { tenantId } },
          body: {
            planVersionId,
            startsAt: new Date(`${startsAt}T00:00:00`).toISOString(),
            endsAt: dateToIso(endsAt)!,
            billingReference: billingReference || undefined,
          },
        }),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.tenant(tenantId) });
      toast('Subscription saved');
    },
  });
  const versions = (plans.data?.items ?? []).flatMap((p) =>
    p.versions
      .filter((v) => v.status === 'published')
      .map((v) => ({
        value: v.id,
        label: `${p.name} v${v.version} — ${formatMoney(v.price)}/year`,
      })),
  );
  const pv = sub?.planVersion;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card title="Current subscription">
        {pv ? (
          <div className="flex flex-col gap-5">
            <KeyValue
              items={[
                { label: 'Plan', value: `${pv.planName} v${pv.version}` },
                { label: 'Price', value: `${formatMoney(pv.price)} / year` },
                {
                  label: 'Period',
                  value: `${formatDate(sub!.startsAt)} – ${formatDate(sub!.endsAt)}`,
                },
                { label: 'Billing reference', value: sub!.billingReference ?? '—' },
              ]}
            />
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-text-muted">
                Limits
              </p>
              <ul className="grid gap-1 text-sm sm:grid-cols-2">
                {Object.entries(pv.limits).map(([k, v]) => (
                  <li key={k} className="flex justify-between gap-2">
                    <span className="text-text-muted">
                      {labels.limit[k as keyof typeof labels.limit] ?? k}
                    </span>
                    <span className="tabular-nums">{formatNumber(v)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : (
          <EmptyState
            title="No plan assigned"
            description="Assign a published plan version before paid activation."
          />
        )}
      </Card>
      <Card
        title="Assign plan"
        description="Payment is collected outside HomeBell (invoice / PO). Record the reference here."
      >
        {!can('platform.subscriptions.write') ? (
          <p className="text-sm text-text-muted">
            You don't have permission to change subscriptions.
          </p>
        ) : (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
          >
            {save.error && <Banner tone="danger">{messageFor(save.error)}</Banner>}
            <Field label="Plan version" required>
              {(p) => (
                <Select
                  {...p}
                  value={planVersionId}
                  onChange={(e) => setPlanVersionId(e.target.value)}
                  placeholder="Choose…"
                  options={versions}
                />
              )}
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Starts" required>
                {(p) => (
                  <Input
                    {...p}
                    type="date"
                    value={startsAt}
                    onChange={(e) => setStartsAt(e.target.value)}
                  />
                )}
              </Field>
              <Field label="Ends" required>
                {(p) => (
                  <Input
                    {...p}
                    type="date"
                    value={endsAt}
                    min={startsAt}
                    onChange={(e) => setEndsAt(e.target.value)}
                  />
                )}
              </Field>
            </div>
            <Field label="Billing reference" hint="Invoice or purchase-order number.">
              {(p) => (
                <Input
                  {...p}
                  value={billingReference}
                  onChange={(e) => setBillingReference(e.target.value)}
                />
              )}
            </Field>
            <Button
              type="submit"
              loading={save.isPending}
              disabled={!planVersionId || !startsAt || !endsAt || endsAt <= startsAt}
            >
              Save subscription
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
}
