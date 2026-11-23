'use client';
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { unwrap } from '@homebell/api-client';
import {
  cooldownOverrideReasonValues,
  type CooldownOverrideReason,
  type PlatformDeviceTransfer,
} from '@homebell/contracts';
import { formatDateTime, labels } from '@homebell/copy';
import {
  Badge,
  Banner,
  Button,
  DataTable,
  Dialog,
  Field,
  LoadMore,
  PageHeader,
  Select,
  Switch,
  Textarea,
  useToast,
} from '@homebell/ui-web';
import { messageFor, useApi, usePagedList } from '@homebell/web-core';
import { useCan } from '@/lib/use-platform';

export default function DeviceTransfersPage() {
  const { client } = useApi();
  const toast = useToast();
  const can = useCan();
  const [suspiciousOnly, setSuspiciousOnly] = useState(true);
  const list = usePagedList<PlatformDeviceTransfer>(
    ['platform', 'transfers', suspiciousOnly],
    (cursor) =>
      unwrap(
        client.GET('/v1/platform/device-transfers', {
          params: { query: { suspiciousOnly, cursor } },
        }),
      ),
  );
  const [target, setTarget] = useState<PlatformDeviceTransfer | null>(null);
  const [reasonCode, setReasonCode] = useState<CooldownOverrideReason>('lost_device');
  const [note, setNote] = useState('');
  const override = useMutation({
    mutationFn: () =>
      unwrap(
        client.POST('/v1/platform/accounts/{userId}/cooldown-overrides', {
          params: { path: { userId: target!.userId } },
          body: { reasonCode, note },
        }),
      ),
    onSuccess: () => {
      toast(`Cooldown lifted once for ${target!.fullName} (valid 24 h)`);
      setTarget(null);
      setNote('');
    },
  });
  return (
    <>
      <PageHeader
        title="Device transfers"
        description="Guardian accounts moved between phones across all schools. Transfers made with a cooldown override are flagged as suspicious."
      />
      <div className="mb-4 max-w-sm">
        <Switch label="Suspicious only" checked={suspiciousOnly} onChange={setSuspiciousOnly} />
      </div>
      <DataTable
        caption="Device transfers"
        rows={list.items}
        loading={list.isPending}
        error={list.error ? messageFor(list.error) : null}
        rowKey={(r) => r.transfer.id}
        empty={{ title: suspiciousOnly ? 'No suspicious transfers' : 'No transfers' }}
        columns={[
          { key: 'at', header: 'When', cell: (r) => formatDateTime(r.transfer.at) },
          {
            key: 'who',
            header: 'Guardian',
            cell: (r) => (
              <div>
                <p className="font-medium">{r.fullName}</p>
                <p className="text-xs text-text-muted">{r.maskedPhone}</p>
              </div>
            ),
          },
          {
            key: 'schools',
            header: 'Schools',
            cell: (r) => r.tenants.map((t) => t.tenantName).join(', '),
            hideOnMobile: true,
          },
          {
            key: 'move',
            header: 'Move',
            cell: (r) =>
              `${r.transfer.fromDevice ? `${r.transfer.fromDevice.model} (${r.transfer.fromDevice.platform})` : 'Unknown'} → ${r.transfer.toDevice.model} (${r.transfer.toDevice.platform})`,
          },
          {
            key: 'flags',
            header: 'Flags',
            cell: (r) => (
              <span className="flex gap-1">
                {r.transfer.suspicious && <Badge tone="danger">Suspicious</Badge>}
                {r.transfer.viaOverride && <Badge tone="warning">Override</Badge>}
              </span>
            ),
          },
          {
            key: 'a',
            header: <span className="sr-only">Actions</span>,
            cell: (r) =>
              can('platform.devices.override') && (
                <Button size="sm" variant="ghost" onClick={() => setTarget(r)}>
                  Lift cooldown
                </Button>
              ),
          },
        ]}
        footer={
          <LoadMore
            hasMore={!!list.hasNextPage}
            loading={list.isFetchingNextPage}
            onClick={() => list.fetchNextPage()}
          />
        }
      />
      <Dialog
        open={!!target}
        onClose={() => setTarget(null)}
        title={`Lift transfer cooldown — ${target?.fullName ?? ''}`}
        description="Single use, valid 24 hours. The guardian still verifies by SMS code on the new phone. The resulting transfer is flagged as suspicious and audited."
        footer={
          <>
            <Button variant="secondary" onClick={() => setTarget(null)}>
              Cancel
            </Button>
            <Button
              loading={override.isPending}
              disabled={!note.trim()}
              onClick={() => override.mutate()}
            >
              Lift cooldown once
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {override.error && <Banner tone="danger">{messageFor(override.error)}</Banner>}
          <Field label="Reason">
            {(p) => (
              <Select
                {...p}
                value={reasonCode}
                onChange={(e) => setReasonCode(e.target.value as CooldownOverrideReason)}
                options={cooldownOverrideReasonValues.map((r) => ({
                  value: r,
                  label: labels.cooldownReason[r],
                }))}
              />
            )}
          </Field>
          <Field label="How was the request verified?" required>
            {(p) => <Textarea {...p} value={note} onChange={(e) => setNote(e.target.value)} />}
          </Field>
        </div>
      </Dialog>
    </>
  );
}
