'use client';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@homebell/api-client';
import {
  featureKeyValues,
  limitKeyValues,
  type PlanVersion,
  type SubscriptionPlan,
} from '@homebell/contracts';
import { formatDate, formatMoney, formatNumber, labels } from '@homebell/copy';
import {
  Badge,
  Banner,
  Button,
  Card,
  Checkbox,
  Dialog,
  ErrorState,
  Field,
  Input,
  LoadingState,
  PageHeader,
  Textarea,
  useToast,
} from '@homebell/ui-web';
import { messageFor, useApi } from '@homebell/web-core';
import { keys, useCan, usePlans } from '@/lib/use-platform';

const STATUS_TONE = { draft: 'info', published: 'success', retired: 'neutral' } as const;

function VersionEditor({
  plan,
  base,
  open,
  onClose,
}: {
  plan: SubscriptionPlan;
  base?: PlanVersion;
  open: boolean;
  onClose: () => void;
}) {
  const { client } = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const [price, setPrice] = useState(base ? String(base.price.amountMinor / 100) : '0');
  const [features, setFeatures] = useState<Record<string, boolean>>(base?.features ?? {});
  const [limits, setLimits] = useState<Record<string, string>>(
    Object.fromEntries(
      limitKeyValues.map((k) => [k, base?.limits[k] == null ? '' : String(base.limits[k])]),
    ),
  );
  const save = useMutation({
    mutationFn: () =>
      unwrap(
        client.POST('/v1/platform/plans/{planId}/versions', {
          params: { path: { planId: plan.id } },
          body: {
            price: { amountMinor: Math.round(Number(price) * 100), currency: 'USD' },
            features,
            limits: Object.fromEntries(
              Object.entries(limits).map(([k, v]) => [k, v === '' ? null : Number(v)]),
            ),
          },
        }),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.plans });
      toast('Draft version created');
      onClose();
    },
  });
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={`New version of ${plan.name}`}
      description="Versions are immutable once published. Existing schools keep the version they are on."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            Create draft
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {save.error && <Banner tone="danger">{messageFor(save.error)}</Banner>}
        <Field label="Annual price (USD)">
          {(p) => (
            <Input
              {...p}
              type="number"
              min={0}
              step="0.01"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          )}
        </Field>
        <fieldset>
          <legend className="mb-2 text-sm font-medium">Features</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {featureKeyValues.map((k) => (
              <Checkbox
                key={k}
                label={labels.feature[k]}
                checked={!!features[k]}
                onChange={(e) => setFeatures((f) => ({ ...f, [k]: e.target.checked }))}
              />
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="mb-2 text-sm font-medium">
            Limits <span className="font-normal text-text-muted">(empty = unlimited)</span>
          </legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {limitKeyValues.map((k) => (
              <Field key={k} label={labels.limit[k]}>
                {(p) => (
                  <Input
                    {...p}
                    type="number"
                    min={0}
                    value={limits[k] ?? ''}
                    onChange={(e) => setLimits((l) => ({ ...l, [k]: e.target.value }))}
                  />
                )}
              </Field>
            ))}
          </div>
        </fieldset>
      </div>
    </Dialog>
  );
}

export default function PlansPage() {
  const { client } = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const can = useCan();
  const plans = usePlans();
  const [editing, setEditing] = useState<{ plan: SubscriptionPlan; base?: PlanVersion } | null>(
    null,
  );
  const [newPlan, setNewPlan] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const act = useMutation({
    mutationFn: ({
      planId,
      versionId,
      verb,
    }: {
      planId: string;
      versionId: string;
      verb: 'publish' | 'retire';
    }) =>
      verb === 'publish'
        ? unwrap(
            client.POST('/v1/platform/plans/{planId}/versions/{versionId}/publish', {
              params: { path: { planId, versionId } },
            }),
          )
        : unwrap(
            client.POST('/v1/platform/plans/{planId}/versions/{versionId}/retire', {
              params: { path: { planId, versionId } },
            }),
          ),
    onSuccess: (v) => {
      void qc.invalidateQueries({ queryKey: keys.plans });
      toast(`${v.planName} v${v.version} ${v.status}`);
    },
    onError: (e) => toast(messageFor(e), 'danger'),
  });
  const create = useMutation({
    mutationFn: () =>
      unwrap(
        client.POST('/v1/platform/plans', {
          body: { code, name, description: description || undefined, isPublic: false },
        }),
      ),
    onSuccess: () => {
      setNewPlan(false);
      setCode('');
      setName('');
      void qc.invalidateQueries({ queryKey: keys.plans });
    },
  });
  const writable = can('platform.plans.write');

  return (
    <>
      <PageHeader
        title="Plans"
        description="Subscription plans and their immutable versions. Prices are annual, in USD."
        actions={writable && <Button onClick={() => setNewPlan(true)}>New plan</Button>}
      />
      {plans.isPending ? (
        <LoadingState />
      ) : plans.error ? (
        <ErrorState message={messageFor(plans.error)} onRetry={() => plans.refetch()} />
      ) : (
        <div className="flex flex-col gap-6">
          {plans.data.items.map((p) => (
            <Card
              key={p.id}
              title={
                <span className="flex items-center gap-2">
                  {p.name} <code className="text-xs text-text-muted">{p.code}</code>
                </span>
              }
              description={p.description}
              actions={
                writable && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setEditing({ plan: p, base: p.versions.at(-1) })}
                  >
                    New version
                  </Button>
                )
              }
              padded={false}
            >
              {p.versions.length === 0 ? (
                <p className="p-5 text-sm text-text-muted">No versions yet.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {p.versions.map((v) => (
                    <li
                      key={v.id}
                      className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
                    >
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="font-medium">v{v.version}</span>
                        <Badge tone={STATUS_TONE[v.status]}>{v.status}</Badge>
                        <span className="text-sm">{formatMoney(v.price)} / year</span>
                        <span className="text-xs text-text-muted">
                          {formatNumber(v.limits['students.max'])} students ·{' '}
                          {formatNumber(v.limits['displays.max'])} displays ·{' '}
                          {v.publishedAt
                            ? `published ${formatDate(v.publishedAt)}`
                            : `created ${formatDate(v.createdAt)}`}
                        </span>
                      </div>
                      {writable && (
                        <div className="flex gap-2">
                          {v.status === 'draft' && (
                            <Button
                              size="sm"
                              loading={act.isPending}
                              onClick={() =>
                                act.mutate({ planId: p.id, versionId: v.id, verb: 'publish' })
                              }
                            >
                              Publish
                            </Button>
                          )}
                          {v.status === 'published' && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                act.mutate({ planId: p.id, versionId: v.id, verb: 'retire' })
                              }
                            >
                              Retire
                            </Button>
                          )}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ))}
        </div>
      )}
      {editing && (
        <VersionEditor
          plan={editing.plan}
          base={editing.base}
          open
          onClose={() => setEditing(null)}
        />
      )}
      <Dialog
        open={newPlan}
        onClose={() => setNewPlan(false)}
        title="New plan"
        footer={
          <>
            <Button variant="secondary" onClick={() => setNewPlan(false)}>
              Cancel
            </Button>
            <Button
              loading={create.isPending}
              disabled={!/^[a-z0-9_]{2,40}$/.test(code) || !name.trim()}
              onClick={() => create.mutate()}
            >
              Create
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {create.error && <Banner tone="danger">{messageFor(create.error)}</Banner>}
          <Field label="Code" hint="Lowercase letters, numbers, underscores.">
            {(p) => (
              <Input {...p} value={code} onChange={(e) => setCode(e.target.value.toLowerCase())} />
            )}
          </Field>
          <Field label="Name">
            {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} />}
          </Field>
          <Field label="Description">
            {(p) => (
              <Textarea
                {...p}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            )}
          </Field>
        </div>
      </Dialog>
    </>
  );
}
