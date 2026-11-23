'use client';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@homebell/api-client';
import {
  featureKeyValues,
  limitKeyValues,
  lifecycleReasonCodeValues,
  type EntitlementOverride,
  type LifecycleReasonCode,
} from '@homebell/contracts';
import { formatDate, formatNumber, labels } from '@homebell/copy';
import {
  Badge,
  Banner,
  Button,
  Card,
  DataTable,
  Dialog,
  Field,
  Input,
  Select,
  Textarea,
  useToast,
} from '@homebell/ui-web';
import { messageFor, useApi } from '@homebell/web-core';
import { dateToIso, keys, useCan } from '@/lib/use-platform';

const SOURCE_TONE = {
  plan: 'neutral',
  override: 'brand',
  lifecycle: 'warning',
  flag: 'info',
  default: 'neutral',
} as const;

export default function EntitlementsPage() {
  const { tenantId } = useParams<{ tenantId: string }>();
  const { client } = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const can = useCan();
  const eff = useQuery({
    queryKey: keys.tenantPart(tenantId, 'entitlements'),
    queryFn: () =>
      unwrap(
        client.GET('/v1/platform/tenants/{tenantId}/entitlements', {
          params: { path: { tenantId } },
        }),
      ),
  });
  const overrides = useQuery({
    queryKey: keys.tenantPart(tenantId, 'overrides'),
    queryFn: () =>
      unwrap(
        client.GET('/v1/platform/tenants/{tenantId}/entitlement-overrides', {
          params: { path: { tenantId } },
        }),
      ),
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: keys.tenantPart(tenantId, 'entitlements') });
    void qc.invalidateQueries({ queryKey: keys.tenantPart(tenantId, 'overrides') });
  };

  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<'feature' | 'limit'>('limit');
  const [key, setKey] = useState<string>('students.max');
  const [value, setValue] = useState('');
  const [reasonCode, setReasonCode] = useState<LifecycleReasonCode>('contract_signed');
  const [note, setNote] = useState('');
  const [expires, setExpires] = useState('');
  const [revoking, setRevoking] = useState<EntitlementOverride | null>(null);
  const [revokeNote, setRevokeNote] = useState('');

  const add = useMutation({
    mutationFn: () =>
      unwrap(
        client.POST('/v1/platform/tenants/{tenantId}/entitlement-overrides', {
          params: { path: { tenantId } },
          body: {
            kind,
            key,
            value: kind === 'feature' ? value === 'true' : value === '' ? null : Number(value),
            reasonCode,
            note,
            expiresAt: dateToIso(expires),
          },
        }),
      ),
    onSuccess: () => {
      setOpen(false);
      setNote('');
      setValue('');
      setExpires('');
      refresh();
      toast('Override applied');
    },
  });
  const revoke = useMutation({
    mutationFn: () =>
      unwrap(
        client.POST('/v1/platform/tenants/{tenantId}/entitlement-overrides/{overrideId}/revoke', {
          params: { path: { tenantId, overrideId: revoking!.id } },
          body: { note: revokeNote },
        }),
      ),
    onSuccess: () => {
      setRevoking(null);
      setRevokeNote('');
      refresh();
      toast('Override removed');
    },
  });

  return (
    <div className="flex flex-col gap-6">
      {eff.data && eff.data.operationalMode !== 'full' && (
        <Banner
          tone="warning"
          title={`Lifecycle restricts access (${labels.operationalMode[eff.data.operationalMode]})`}
        >
          Dismissal features are off while the school is {labels.tenantState[eff.data.state]},
          whatever the plan says.
        </Banner>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <DataTable
          caption="Effective features"
          rows={eff.data?.features}
          loading={eff.isPending}
          error={eff.error ? messageFor(eff.error) : null}
          rowKey={(f) => f.key}
          columns={[
            { key: 'f', header: 'Feature', cell: (f) => labels.feature[f.key] },
            {
              key: 'on',
              header: 'Enabled',
              cell: (f) => (f.enabled ? <Badge tone="success">On</Badge> : <Badge>Off</Badge>),
            },
            {
              key: 'src',
              header: 'Source',
              cell: (f) => <Badge tone={SOURCE_TONE[f.source]}>{f.source}</Badge>,
            },
          ]}
        />
        <DataTable
          caption="Effective limits"
          rows={eff.data?.limits}
          loading={eff.isPending}
          rowKey={(l) => l.key}
          columns={[
            { key: 'l', header: 'Limit', cell: (l) => labels.limit[l.key] },
            {
              key: 'v',
              header: 'Value',
              cell: (l) => <span className="tabular-nums">{formatNumber(l.value)}</span>,
            },
            {
              key: 'u',
              header: 'Used',
              cell: (l) => <span className="tabular-nums">{l.used ?? '—'}</span>,
            },
            {
              key: 'src',
              header: 'Source',
              cell: (l) => <Badge tone={SOURCE_TONE[l.source]}>{l.source}</Badge>,
            },
          ]}
        />
      </div>
      <Card
        title="Overrides"
        description="Overrides win over the plan until they expire or are removed. Removing keeps the history."
        actions={
          can('platform.overrides.write') && (
            <Button size="sm" onClick={() => setOpen(true)}>
              Add override
            </Button>
          )
        }
        padded={false}
      >
        <DataTable
          caption="Overrides"
          rows={overrides.data?.items}
          loading={overrides.isPending}
          rowKey={(o) => o.id}
          empty={{
            title: 'No overrides',
            description: 'Use overrides for pilots, charity caps and contract exceptions.',
          }}
          columns={[
            {
              key: 'k',
              header: 'Entitlement',
              cell: (o) =>
                (o.kind === 'feature'
                  ? labels.feature[o.key as keyof typeof labels.feature]
                  : labels.limit[o.key as keyof typeof labels.limit]) ?? o.key,
            },
            {
              key: 'v',
              header: 'Value',
              cell: (o) =>
                typeof o.value === 'boolean'
                  ? o.value
                    ? 'On'
                    : 'Off'
                  : formatNumber(o.value as number | null),
            },
            {
              key: 'r',
              header: 'Reason',
              cell: (o) => (
                <div>
                  <p>{labels.reasonCode[o.reasonCode]}</p>
                  <p className="text-xs text-text-muted">{o.note}</p>
                </div>
              ),
            },
            {
              key: 'e',
              header: 'Expires',
              cell: (o) => (o.expiresAt ? formatDate(o.expiresAt) : 'Never'),
              hideOnMobile: true,
            },
            {
              key: 's',
              header: 'Status',
              cell: (o) =>
                o.revokedAt ? (
                  <Badge>Removed {formatDate(o.revokedAt)}</Badge>
                ) : o.expiresAt && o.expiresAt < new Date().toISOString() ? (
                  <Badge tone="warning">Expired</Badge>
                ) : (
                  <Badge tone="success">Active</Badge>
                ),
            },
            {
              key: 'a',
              header: <span className="sr-only">Actions</span>,
              cell: (o) =>
                !o.revokedAt &&
                can('platform.overrides.write') && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={(e) => {
                      e.stopPropagation();
                      setRevoking(o);
                    }}
                  >
                    Remove
                  </Button>
                ),
            },
          ]}
        />
      </Card>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Add entitlement override"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={add.isPending}
              disabled={!note.trim() || (kind === 'feature' && !value)}
              onClick={() => add.mutate()}
            >
              Apply override
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {add.error && <Banner tone="danger">{messageFor(add.error)}</Banner>}
          <Field label="Type">
            {(p) => (
              <Select
                {...p}
                value={kind}
                onChange={(e) => {
                  const k = e.target.value as 'feature' | 'limit';
                  setKind(k);
                  setKey((k === 'feature' ? featureKeyValues[0] : limitKeyValues[0]) ?? '');
                  setValue('');
                }}
                options={[
                  { value: 'limit', label: 'Limit' },
                  { value: 'feature', label: 'Feature' },
                ]}
              />
            )}
          </Field>
          <Field label="Entitlement">
            {(p) => (
              <Select
                {...p}
                value={key}
                onChange={(e) => setKey(e.target.value)}
                options={(kind === 'feature' ? featureKeyValues : limitKeyValues).map((k) => ({
                  value: k,
                  label:
                    kind === 'feature'
                      ? labels.feature[k as keyof typeof labels.feature]
                      : labels.limit[k as keyof typeof labels.limit],
                }))}
              />
            )}
          </Field>
          {kind === 'feature' ? (
            <Field label="Value" required>
              {(p) => (
                <Select
                  {...p}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder="Choose…"
                  options={[
                    { value: 'true', label: 'On' },
                    { value: 'false', label: 'Off' },
                  ]}
                />
              )}
            </Field>
          ) : (
            <Field label="Value" hint="Leave empty for unlimited.">
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  min={0}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                />
              )}
            </Field>
          )}
          <Field label="Reason">
            {(p) => (
              <Select
                {...p}
                value={reasonCode}
                onChange={(e) => setReasonCode(e.target.value as LifecycleReasonCode)}
                options={lifecycleReasonCodeValues.map((r) => ({
                  value: r,
                  label: labels.reasonCode[r],
                }))}
              />
            )}
          </Field>
          <Field label="Note" required>
            {(p) => <Textarea {...p} value={note} onChange={(e) => setNote(e.target.value)} />}
          </Field>
          <Field label="Expires" hint="Optional.">
            {(p) => (
              <Input
                {...p}
                type="date"
                value={expires}
                onChange={(e) => setExpires(e.target.value)}
              />
            )}
          </Field>
        </div>
      </Dialog>
      <Dialog
        open={!!revoking}
        onClose={() => setRevoking(null)}
        title="Remove override"
        description="The plan value applies again immediately. The override stays in history."
        footer={
          <>
            <Button variant="secondary" onClick={() => setRevoking(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={revoke.isPending}
              disabled={!revokeNote.trim()}
              onClick={() => revoke.mutate()}
            >
              Remove
            </Button>
          </>
        }
      >
        {revoke.error && (
          <div className="mb-3">
            <Banner tone="danger">{messageFor(revoke.error)}</Banner>
          </div>
        )}
        <Field label="Why?" required>
          {(p) => (
            <Textarea {...p} value={revokeNote} onChange={(e) => setRevokeNote(e.target.value)} />
          )}
        </Field>
      </Dialog>
    </div>
  );
}
