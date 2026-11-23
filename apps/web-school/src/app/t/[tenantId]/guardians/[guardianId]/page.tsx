'use client';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@homebell/api-client';
import { cooldownOverrideReasonValues, type CooldownOverrideReason } from '@homebell/contracts';
import { formatDate, formatDateTime, formatPhone, formatRelative, labels } from '@homebell/copy';
import {
  Badge,
  Banner,
  Button,
  Card,
  DataTable,
  Dialog,
  ErrorState,
  Field,
  Input,
  KeyValue,
  LoadingState,
  PageHeader,
  Select,
  StateBadge,
  Textarea,
  useLink,
  useToast,
} from '@homebell/ui-web';
import { messageFor, useApi, useIdempotencyKey } from '@homebell/web-core';
import { schoolKey, useSchool } from '@/lib/school';

type StateAction = 'block' | 'unblock' | 'deactivate' | 'reactivate';
const ACTION_COPY: Record<
  StateAction,
  { title: string; body: string; tone: 'danger' | 'primary' }
> = {
  block: {
    title: 'Block guardian',
    body: 'They can no longer request pickup at this school. Their history and other schools are unaffected.',
    tone: 'danger',
  },
  unblock: { title: 'Unblock guardian', body: 'They can request pickup again.', tone: 'primary' },
  deactivate: {
    title: 'Deactivate guardian',
    body: 'Access at this school ends and they are signed out if this is their only school. History is kept.',
    tone: 'danger',
  },
  reactivate: {
    title: 'Reactivate guardian',
    body: 'Access is restored. If they never activated, they return to “not activated”.',
    tone: 'primary',
  },
};

export default function GuardianDetailPage() {
  const { guardianId } = useParams<{ guardianId: string }>();
  const { tenantId, can, canWrite, has } = useSchool();
  const { client } = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const Link = useLink();
  const idem = useIdempotencyKey();
  const key = schoolKey(tenantId, 'guardian', guardianId);
  const g = useQuery({
    queryKey: key,
    queryFn: () =>
      unwrap(
        client.GET('/v1/t/{tenantId}/guardians/{guardianId}', {
          params: { path: { tenantId, guardianId } },
        }),
      ),
  });
  const devices = useQuery({
    queryKey: [...key, 'devices'],
    queryFn: () =>
      unwrap(
        client.GET('/v1/t/{tenantId}/guardians/{guardianId}/devices', {
          params: { path: { tenantId, guardianId } },
        }),
      ),
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: key });
    void qc.invalidateQueries({ queryKey: schoolKey(tenantId, 'guardians') });
  };
  const [action, setAction] = useState<StateAction | null>(null);
  const [reason, setReason] = useState('');
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideReason, setOverrideReason] = useState<CooldownOverrideReason>('lost_device');
  const [overrideNote, setOverrideNote] = useState('');
  const [seatOpen, setSeatOpen] = useState(false);
  const [seatCount, setSeatCount] = useState('1');
  const [seatNote, setSeatNote] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');

  const change = useMutation({
    mutationFn: () => {
      const opts = { params: { path: { tenantId, guardianId } }, body: { reason: reason.trim() } };
      switch (action!) {
        case 'block':
          return unwrap(client.POST('/v1/t/{tenantId}/guardians/{guardianId}/block', opts));
        case 'unblock':
          return unwrap(client.POST('/v1/t/{tenantId}/guardians/{guardianId}/unblock', opts));
        case 'deactivate':
          return unwrap(client.POST('/v1/t/{tenantId}/guardians/{guardianId}/deactivate', opts));
        case 'reactivate':
          return unwrap(client.POST('/v1/t/{tenantId}/guardians/{guardianId}/reactivate', opts));
      }
    },
    onSuccess: (r) => {
      toast(`${r.fullName} is now ${labels.guardianState[r.state].toLowerCase()}`);
      setAction(null);
      setReason('');
      refresh();
    },
  });
  const override = useMutation({
    mutationFn: () =>
      unwrap(
        client.POST('/v1/t/{tenantId}/guardians/{guardianId}/cooldown-overrides', {
          params: { path: { tenantId, guardianId } },
          body: { reasonCode: overrideReason, note: overrideNote.trim() },
        }),
      ),
    onSuccess: () => {
      toast('Transfer cooldown lifted once (valid 24 hours)');
      setOverrideOpen(false);
      setOverrideNote('');
      void qc.invalidateQueries({ queryKey: [...key, 'devices'] });
    },
  });
  const grant = useMutation({
    mutationFn: () =>
      unwrap(
        client.POST('/v1/t/{tenantId}/license-seats/grants', {
          params: { path: { tenantId }, header: { 'Idempotency-Key': idem.key() } },
          body: { primaryGuardianId: guardianId, count: Number(seatCount), note: seatNote.trim() },
        }),
      ),
    onSuccess: (r) => {
      idem.next();
      toast(`${r.items.length} additional guardian seat(s) granted`);
      setSeatOpen(false);
      setSeatNote('');
    },
  });
  const edit = useMutation({
    mutationFn: () =>
      unwrap(
        client.PATCH('/v1/t/{tenantId}/guardians/{guardianId}', {
          params: { path: { tenantId, guardianId } },
          body: {
            fullName: name.trim() || undefined,
            phone: phone && phone !== g.data?.phone ? phone.replace(/[\s()-]/g, '') : undefined,
          },
        }),
      ),
    onSuccess: () => {
      toast('Guardian updated');
      setEditOpen(false);
      refresh();
    },
  });
  const welcome = useMutation({
    mutationFn: () =>
      client.POST('/v1/t/{tenantId}/guardians/{guardianId}/send-welcome', {
        params: { path: { tenantId, guardianId } },
      }),
    onSuccess: () => toast('Welcome SMS queued'),
  });

  if (g.isPending) return <LoadingState rows={6} />;
  if (g.error) return <ErrorState message={messageFor(g.error)} onRetry={() => g.refetch()} />;
  const x = g.data;
  const writable = canWrite && can('school.guardians.write');
  const blockable = canWrite && can('school.guardians.block');
  const actions: StateAction[] =
    x.state === 'blocked'
      ? ['unblock', 'deactivate']
      : x.state === 'deactivated'
        ? ['reactivate']
        : x.state === 'revoked'
          ? []
          : ['block', 'deactivate'];
  const d = devices.data;

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: 'Guardians', href: `/t/${tenantId}/guardians` },
          { label: x.fullName },
        ]}
        title={x.fullName}
        badge={
          <span className="flex gap-2">
            <StateBadge group="guardian" value={x.state} label={labels.guardianState[x.state]} />
            {x.kind === 'primary' ? <Badge tone="brand">Primary</Badge> : <Badge>Additional</Badge>}
          </span>
        }
        description={
          x.stateReason
            ? `Reason: ${x.stateReason}`
            : x.invitedBy
              ? `Invited by ${x.invitedBy.fullName}`
              : undefined
        }
        actions={
          <>
            {writable && (
              <Button
                variant="secondary"
                onClick={() => {
                  setName(x.fullName);
                  setPhone(x.phone ?? '');
                  setEditOpen(true);
                }}
              >
                Edit
              </Button>
            )}
            {blockable &&
              actions.map((a) => (
                <Button
                  key={a}
                  variant={ACTION_COPY[a].tone === 'danger' ? 'danger' : 'primary'}
                  onClick={() => setAction(a)}
                >
                  {ACTION_COPY[a].title.split(' ')[0]}
                </Button>
              ))}
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Profile">
          <KeyValue
            items={[
              { label: 'Phone', value: x.phone ? formatPhone(x.phone) : x.maskedPhone },
              {
                label: 'Activated',
                value: x.activatedAt
                  ? formatDate(x.activatedAt)
                  : 'Not yet — they activate by verifying their phone in the app',
              },
              { label: 'Last active', value: formatRelative(x.lastActiveAt) },
              {
                label: 'Access',
                value: x.validity
                  ? `${labels.validityMode[x.validity.mode]}${x.validity.validUntil ? ` · until ${formatDate(x.validity.validUntil)}` : ''}`
                  : 'Whole school term',
              },
            ]}
          />
          {writable && x.state === 'pending_activation' && (
            <Button
              className="mt-4"
              size="sm"
              variant="secondary"
              loading={welcome.isPending}
              onClick={() => welcome.mutate()}
            >
              Send welcome SMS
            </Button>
          )}
        </Card>
        <Card title="Children" padded={false}>
          <ul className="divide-y divide-border">
            {x.students.map((s) => (
              <li key={s.studentId} className="flex items-center justify-between gap-3 px-5 py-3">
                <div>
                  <Link
                    href={`/t/${tenantId}/students/${s.studentId}`}
                    className="font-medium hover:underline"
                  >
                    {s.fullName}
                  </Link>
                  <p className="text-xs text-text-muted">
                    {s.className} · {labels.relationship[s.relationship]}
                  </p>
                </div>
                {s.isPrimary && <Badge tone="brand">Primary</Badge>}
              </li>
            ))}
          </ul>
        </Card>
        <Card
          title="Device & transfers"
          description="One active phone per account. Moving to a new phone is limited to once every 30 days."
          actions={
            blockable &&
            can('school.devices.override') && (
              <Button
                size="sm"
                variant="secondary"
                disabled={!d || d.remainingSchoolOverridesThisTerm === 0}
                onClick={() => setOverrideOpen(true)}
              >
                Lift cooldown (lost phone)
              </Button>
            )
          }
        >
          {!d ? (
            <LoadingState rows={2} />
          ) : (
            <div className="flex flex-col gap-4">
              <KeyValue
                items={[
                  {
                    label: 'Active phone',
                    value: d.activeDevice
                      ? `${d.activeDevice.model} (${d.activeDevice.platform === 'ios' ? 'iPhone' : 'Android'}) · since ${formatDate(d.activeDevice.activatedAt)}`
                      : 'None',
                  },
                  {
                    label: 'Next transfer allowed',
                    value: d.nextTransferAllowedAt
                      ? formatDateTime(d.nextTransferAllowedAt)
                      : 'Now',
                  },
                  {
                    label: 'School overrides left this term',
                    value: d.remainingSchoolOverridesThisTerm,
                  },
                ]}
              />
              {d.transfers.length > 0 && (
                <DataTable
                  caption="Transfers"
                  rows={d.transfers}
                  rowKey={(t) => t.id}
                  columns={[
                    { key: 'at', header: 'When', cell: (t) => formatDateTime(t.at) },
                    {
                      key: 'm',
                      header: 'Move',
                      cell: (t) => `${t.fromDevice?.model ?? '—'} → ${t.toDevice.model}`,
                    },
                    {
                      key: 'f',
                      header: '',
                      cell: (t) => (
                        <span className="flex gap-1">
                          {t.suspicious && <Badge tone="danger">Suspicious</Badge>}
                          {t.viaOverride && <Badge tone="warning">Override</Badge>}
                        </span>
                      ),
                    },
                  ]}
                />
              )}
            </div>
          )}
        </Card>
        {x.kind === 'primary' && has('guardians.school_granted_seats') && writable && (
          <Card
            title="Additional guardian seats"
            description="Grant seats paid by the school (or for charity cases). The guardian assigns them to family members from the app."
          >
            <Button variant="secondary" onClick={() => setSeatOpen(true)}>
              Grant seats
            </Button>
          </Card>
        )}
      </div>

      <Dialog
        open={!!action}
        onClose={() => setAction(null)}
        title={action ? `${ACTION_COPY[action].title} — ${x.fullName}` : ''}
        description={action ? ACTION_COPY[action].body : undefined}
        footer={
          <>
            <Button variant="secondary" onClick={() => setAction(null)}>
              Cancel
            </Button>
            <Button
              variant={action && ACTION_COPY[action].tone === 'danger' ? 'danger' : 'primary'}
              loading={change.isPending}
              disabled={reason.trim().length < 3}
              onClick={() => change.mutate()}
            >
              {action ? ACTION_COPY[action].title.split(' ')[0] : ''}
            </Button>
          </>
        }
      >
        {change.error && (
          <div className="mb-3">
            <Banner tone="danger">{messageFor(change.error)}</Banner>
          </div>
        )}
        <Field label="Reason" required hint="Recorded in the audit log.">
          {(p) => <Textarea {...p} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
      </Dialog>
      <Dialog
        open={overrideOpen}
        onClose={() => setOverrideOpen(false)}
        title="Lift transfer cooldown"
        description="Use only when a guardian lost or replaced their phone. Single use, valid 24 hours; they still verify by SMS code. The transfer is flagged and audited."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOverrideOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={override.isPending}
              disabled={!overrideNote.trim()}
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
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value as CooldownOverrideReason)}
                options={cooldownOverrideReasonValues.map((r) => ({
                  value: r,
                  label: labels.cooldownReason[r],
                }))}
              />
            )}
          </Field>
          <Field label="How did you verify this?" required>
            {(p) => (
              <Textarea
                {...p}
                value={overrideNote}
                onChange={(e) => setOverrideNote(e.target.value)}
                placeholder="e.g. Parent came to the front office with ID"
              />
            )}
          </Field>
        </div>
      </Dialog>
      <Dialog
        open={seatOpen}
        onClose={() => setSeatOpen(false)}
        title="Grant additional guardian seats"
        footer={
          <>
            <Button variant="secondary" onClick={() => setSeatOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={grant.isPending}
              disabled={!seatNote.trim()}
              onClick={() => grant.mutate()}
            >
              Grant
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {grant.error && <Banner tone="danger">{messageFor(grant.error)}</Banner>}
          <Field label="Seats">
            {(p) => (
              <Select
                {...p}
                value={seatCount}
                onChange={(e) => setSeatCount(e.target.value)}
                options={['1', '2', '3', '4', '5'].map((n) => ({ value: n, label: n }))}
              />
            )}
          </Field>
          <Field label="Note" required>
            {(p) => (
              <Textarea
                {...p}
                value={seatNote}
                onChange={(e) => setSeatNote(e.target.value)}
                placeholder="e.g. Paid by the school for this family"
              />
            )}
          </Field>
        </div>
      </Dialog>
      <Dialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit guardian"
        description="Changing the phone number is audited; the guardian verifies the new number in the app."
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button loading={edit.isPending} onClick={() => edit.mutate()}>
              Save
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {edit.error && <Banner tone="danger">{messageFor(edit.error)}</Banner>}
          <Field label="Full name">
            {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} />}
          </Field>
          <Field label="Mobile number">
            {(p) => (
              <Input {...p} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
            )}
          </Field>
        </div>
      </Dialog>
    </>
  );
}
