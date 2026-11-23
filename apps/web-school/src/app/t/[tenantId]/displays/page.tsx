'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@homebell/api-client';
import type { Display } from '@homebell/contracts';
import { formatDate, formatRelative } from '@homebell/copy';
import {
  Badge,
  Banner,
  Button,
  ConfirmDialog,
  DataTable,
  Dialog,
  EmptyState,
  Field,
  Input,
  PageHeader,
  useToast,
} from '@homebell/ui-web';
import { messageFor, useApi } from '@homebell/web-core';
import { schoolKey, useSchool } from '@/lib/school';

const DISPLAY_APP = process.env.NEXT_PUBLIC_DISPLAY_APP_URL ?? 'http://localhost:3002';

export default function DisplaysPage() {
  const { tenantId, canWrite, has } = useSchool();
  const { client } = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const key = schoolKey(tenantId, 'displays');
  const displays = useQuery({
    queryKey: key,
    queryFn: () =>
      unwrap(client.GET('/v1/t/{tenantId}/displays', { params: { path: { tenantId } } })),
    refetchInterval: 30_000,
  });
  const [pairOpen, setPairOpen] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [zone, setZone] = useState('');
  const [revoking, setRevoking] = useState<Display | null>(null);
  const pair = useMutation({
    mutationFn: () =>
      unwrap(
        client.POST('/v1/t/{tenantId}/displays/pair', {
          params: { path: { tenantId } },
          body: {
            pairingCode: code.replace(/[\s-]/g, ''),
            name: name.trim(),
            zone: zone.trim() || undefined,
          },
        }),
      ),
    onSuccess: (d) => {
      setPairOpen(false);
      setCode('');
      setName('');
      setZone('');
      void qc.invalidateQueries({ queryKey: key });
      toast(`${d.name} paired — the screen will start showing the queue`);
    },
  });
  const revoke = useMutation({
    mutationFn: () =>
      unwrap(
        client.POST('/v1/t/{tenantId}/displays/{displayId}/revoke', {
          params: { path: { tenantId, displayId: revoking!.id } },
        }),
      ),
    onSuccess: () => {
      setRevoking(null);
      void qc.invalidateQueries({ queryKey: key });
      toast('Screen unpaired');
    },
  });
  const { mock } = useApi();
  // QR code on the TV links here with ?pair=CODE.
  useEffect(() => {
    const fromQr = new URLSearchParams(window.location.search).get('pair');
    if (fromQr && canWrite) {
      setCode(fromQr.toUpperCase());
      setPairOpen(true);
    }
  }, [canWrite]);
  // Mock mode only: the display app keeps its own demo data, so simulate a screen waiting to pair here.
  const simulateScreen = async () => {
    const s = await unwrap(
      client.POST('/v1/display/pairing-sessions', { body: { appVersion: 'simulated' } }),
    );
    setCode(s.pairingCode);
    setPairOpen(true);
  };
  const active = displays.data?.items.filter((d) => d.state === 'active') ?? [];
  return (
    <>
      <PageHeader
        title="Display screens"
        description="TVs and monitors that show the pickup queue in the car line or lobby. Screens show first names and last initials only — never phone numbers or guardian names."
        actions={
          canWrite &&
          has('dismissal.display') && (
            <>
              {mock && (
                <Button variant="secondary" onClick={() => void simulateScreen()}>
                  Simulate a screen (mock)
                </Button>
              )}
              <Button onClick={() => setPairOpen(true)}>Pair a screen</Button>
            </>
          )
        }
      />
      {!has('dismissal.display') && (
        <div className="mb-4">
          <Banner tone="info">Display screens aren't included in this school's plan.</Banner>
        </div>
      )}
      <DataTable
        caption="Display screens"
        rows={displays.data?.items}
        loading={displays.isPending}
        error={displays.error ? messageFor(displays.error) : null}
        rowKey={(d) => d.id}
        empty={{
          title: 'No screens yet',
          description: (
            <>
              Open <code className="rounded bg-surface-muted px-1">{DISPLAY_APP}</code> on the TV
              browser, then choose “Pair a screen” and enter the code it shows.
            </>
          ),
        }}
        columns={[
          {
            key: 'n',
            header: 'Screen',
            cell: (d) => (
              <div>
                <p className="font-medium">{d.name}</p>
                <p className="text-xs text-text-muted">
                  {d.zone ? `Zone: ${d.zone}` : 'All requests'}
                </p>
              </div>
            ),
          },
          {
            key: 's',
            header: 'Status',
            cell: (d) =>
              d.state === 'revoked' ? (
                <Badge>Unpaired</Badge>
              ) : d.online ? (
                <Badge tone="success">Online</Badge>
              ) : (
                <Badge tone="warning">Offline</Badge>
              ),
          },
          { key: 'h', header: 'Last seen', cell: (d) => formatRelative(d.lastHeartbeatAt) },
          {
            key: 'p',
            header: 'Paired',
            cell: (d) => `${formatDate(d.pairedAt)} by ${d.pairedBy.displayName}`,
            hideOnMobile: true,
          },
          {
            key: 'a',
            header: <span className="sr-only">Actions</span>,
            cell: (d) =>
              canWrite &&
              d.state === 'active' && (
                <Button size="sm" variant="ghost" onClick={() => setRevoking(d)}>
                  Unpair
                </Button>
              ),
          },
        ]}
      />
      {active.length === 0 && displays.data && displays.data.items.length > 0 && (
        <div className="mt-4">
          <EmptyState title="All screens are unpaired" />
        </div>
      )}
      <Dialog
        open={pairOpen}
        onClose={() => setPairOpen(false)}
        title="Pair a screen"
        description={`On the TV, open ${DISPLAY_APP}. Enter the 8-character code it shows.`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setPairOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={pair.isPending}
              disabled={code.replace(/[\s-]/g, '').length !== 8 || !name.trim()}
              onClick={() => pair.mutate()}
            >
              Pair
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {pair.error && <Banner tone="danger">{messageFor(pair.error)}</Banner>}
          <Field label="Pairing code" required>
            {(p) => (
              <Input
                {...p}
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                autoComplete="off"
                className="font-mono text-lg tracking-[0.3em]"
                maxLength={9}
              />
            )}
          </Field>
          <Field label="Screen name" required hint="e.g. Front gate TV">
            {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} />}
          </Field>
          <Field label="Zone" hint="Optional (multi-zone pickup areas).">
            {(p) => <Input {...p} value={zone} onChange={(e) => setZone(e.target.value)} />}
          </Field>
        </div>
      </Dialog>
      <ConfirmDialog
        open={!!revoking}
        onClose={() => setRevoking(null)}
        onConfirm={() => revoke.mutate()}
        loading={revoke.isPending}
        tone="danger"
        title={`Unpair ${revoking?.name ?? ''}?`}
        description="The screen stops showing the queue immediately and returns to its pairing code."
        confirmLabel="Unpair"
      >
        {revoke.error && <Banner tone="danger">{messageFor(revoke.error)}</Banner>}
      </ConfirmDialog>
    </>
  );
}
