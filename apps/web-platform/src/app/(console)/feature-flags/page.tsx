'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@homebell/api-client';
import type { FeatureFlag } from '@homebell/contracts';
import { formatDateTime } from '@homebell/copy';
import {
  Badge,
  Banner,
  Button,
  DataTable,
  Dialog,
  Field,
  PageHeader,
  Switch,
  Textarea,
  useToast,
} from '@homebell/ui-web';
import { messageFor, useApi } from '@homebell/web-core';
import { keys, useCan } from '@/lib/use-platform';

export default function FeatureFlagsPage() {
  const { client } = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const can = useCan();
  const flags = useQuery({
    queryKey: keys.flags,
    queryFn: () => unwrap(client.GET('/v1/platform/feature-flags')),
  });
  const tenants = useQuery({
    queryKey: ['platform', 'tenants', 'all-names'],
    queryFn: () =>
      unwrap(client.GET('/v1/platform/tenants', { params: { query: { limit: 100 } } })),
  });
  const name = (id: string) => tenants.data?.items.find((t) => t.id === id)?.name ?? id.slice(0, 8);
  const [editing, setEditing] = useState<FeatureFlag | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [note, setNote] = useState('');
  const save = useMutation({
    mutationFn: () =>
      unwrap(
        client.PUT('/v1/platform/feature-flags/{flagKey}', {
          params: { path: { flagKey: editing!.key } },
          body: {
            enabledByDefault: enabled,
            tenantAllowList: editing!.tenantAllowList,
            tenantDenyList: editing!.tenantDenyList,
            note,
          },
        }),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.flags });
      toast('Flag updated');
      setEditing(null);
    },
  });
  return (
    <>
      <PageHeader
        title="Feature flags"
        description="Global kill switches and staged rollout. Flags can only restrict what a plan allows."
      />
      <DataTable
        caption="Feature flags"
        rows={flags.data?.items}
        loading={flags.isPending}
        error={flags.error ? messageFor(flags.error) : null}
        rowKey={(f) => f.key}
        columns={[
          {
            key: 'k',
            header: 'Flag',
            cell: (f) => (
              <div>
                <code className="text-sm font-medium">{f.key}</code>
                <p className="text-xs text-text-muted">{f.description}</p>
              </div>
            ),
          },
          {
            key: 'd',
            header: 'Default',
            cell: (f) =>
              f.enabledByDefault ? <Badge tone="success">On</Badge> : <Badge>Off</Badge>,
          },
          {
            key: 'a',
            header: 'Allow list',
            cell: (f) => f.tenantAllowList.map(name).join(', ') || '—',
            hideOnMobile: true,
          },
          {
            key: 'x',
            header: 'Deny list',
            cell: (f) => f.tenantDenyList.map(name).join(', ') || '—',
            hideOnMobile: true,
          },
          {
            key: 'u',
            header: 'Updated',
            cell: (f) => formatDateTime(f.updatedAt),
            hideOnMobile: true,
          },
          {
            key: 'e',
            header: <span className="sr-only">Edit</span>,
            cell: (f) =>
              can('platform.flags.write') && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setEditing(f);
                    setEnabled(f.enabledByDefault);
                    setNote('');
                  }}
                >
                  Edit
                </Button>
              ),
          },
        ]}
      />
      <Dialog
        open={!!editing}
        onClose={() => setEditing(null)}
        title={`Edit ${editing?.key ?? ''}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button loading={save.isPending} disabled={!note.trim()} onClick={() => save.mutate()}>
              Save
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {save.error && <Banner tone="danger">{messageFor(save.error)}</Banner>}
          <Switch
            label="Enabled by default"
            description="Allow/deny lists still apply."
            checked={enabled}
            onChange={setEnabled}
          />
          <Field label="Reason for change" required>
            {(p) => <Textarea {...p} value={note} onChange={(e) => setNote(e.target.value)} />}
          </Field>
        </div>
      </Dialog>
    </>
  );
}
