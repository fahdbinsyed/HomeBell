'use client';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { unwrap } from '@homebell/api-client';
import type { TenantLifecycleAction } from '@homebell/contracts';
import { encodeSupportHandoff } from '@homebell/mocks';
import { daysUntil, formatDate, formatDateTime, labels } from '@homebell/copy';
import {
  Banner,
  Button,
  Card,
  Dialog,
  Field,
  KeyValue,
  Select,
  Textarea,
  useToast,
} from '@homebell/ui-web';
import { messageFor, useApi } from '@homebell/web-core';
import { LifecycleDialog } from '@/components/lifecycle-dialog';
import { useCan, useTenant } from '@/lib/use-platform';

const SCHOOL_APP = process.env.NEXT_PUBLIC_SCHOOL_APP_URL ?? 'http://localhost:3000';
const DESTRUCTIVE: TenantLifecycleAction[] = [
  'suspend',
  'deactivate',
  'cancel',
  'start_offboarding',
];

export default function TenantOverview() {
  const { tenantId } = useParams<{ tenantId: string }>();
  const { client, mock } = useApi();
  const toast = useToast();
  const can = useCan();
  const t = useTenant(tenantId).data!;
  const [action, setAction] = useState<TenantLifecycleAction | null>(null);
  const [supportOpen, setSupportOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [minutes, setMinutes] = useState('15');
  const days = daysUntil(t.expiresAt);

  const support = useMutation({
    mutationFn: () =>
      unwrap(
        client.POST('/v1/platform/support-sessions', {
          body: { tenantId, reason: reason.trim(), durationMinutes: Number(minutes) },
        }),
      ),
    onSuccess: (s) => {
      setSupportOpen(false);
      setReason('');
      toast(`Support session started — ends ${formatDateTime(s.expiresAt)}`);
      // Mock mode: hand the session to the school app (separate origin). Phase 3: BFF token exchange.
      const handoff = mock
        ? encodeSupportHandoff({
            tenantId,
            expiresAt: s.expiresAt,
            platformUserName: s.platformUser.displayName,
            reason: s.reason,
          })
        : s.id;
      window.open(`${SCHOOL_APP}/support#${handoff}`, '_blank', 'noopener');
    },
  });

  return (
    <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
      <div className="flex flex-col gap-6">
        {days !== null && days >= 0 && days <= 14 && (
          <Banner tone="warning" title={`Access ends in ${days} day${days === 1 ? '' : 's'}`}>
            Extend expiry or convert to paid to avoid interruption.
          </Banner>
        )}
        {t.state === 'offboarding' && (
          <Banner tone="neutral" title="Offboarding">
            The school has export-only access. Data is purged when the retention period ends.
          </Banner>
        )}
        <Card title="Details">
          <KeyValue
            items={[
              {
                label: 'State',
                value: `${labels.tenantState[t.state]} · ${labels.operationalMode[t.operationalMode]}`,
              },
              { label: 'Expires', value: t.expiresAt ? formatDate(t.expiresAt) : 'No end date' },
              {
                label: 'Plan',
                value: t.subscription
                  ? `${t.subscription.planVersion.planName} v${t.subscription.planVersion.version}`
                  : 'None assigned',
              },
              { label: 'Billing reference', value: t.subscription?.billingReference ?? '—' },
              {
                label: 'School term',
                value: `${formatDate(t.termStartDate)} – ${formatDate(t.termEndDate)}`,
              },
              {
                label: 'Data placement',
                value: `${t.dataPlacement} · ${t.region} · ${t.countryCode}`,
              },
              { label: 'Students', value: t.studentCount },
              { label: 'Active guardians', value: t.activeGuardianCount },
              { label: 'Created', value: formatDate(t.createdAt) },
              {
                label: 'Previous operational state',
                value: t.previousOperationalState
                  ? labels.tenantState[t.previousOperationalState]
                  : '—',
              },
            ]}
          />
        </Card>
        <Card title="Primary contact">
          <KeyValue
            items={[
              { label: 'Name', value: t.primaryContact.fullName },
              { label: 'Email', value: t.primaryContact.email },
              { label: 'Legal name', value: t.legalName ?? '—' },
            ]}
          />
        </Card>
      </div>
      <div className="flex flex-col gap-6">
        <Card
          title="Lifecycle actions"
          description={
            can('platform.lifecycle.write')
              ? 'Available from the current state.'
              : 'You can view but not change lifecycle state.'
          }
        >
          {t.allowedActions.length === 0 ? (
            <p className="text-sm text-text-muted">No actions available.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {t.allowedActions.map((a) => (
                <Button
                  key={a}
                  variant={DESTRUCTIVE.includes(a) ? 'secondary' : 'primary'}
                  onClick={() => setAction(a)}
                >
                  {labels.lifecycleAction[a]}
                </Button>
              ))}
            </div>
          )}
        </Card>
        {can('platform.support_sessions.create') && (
          <Card
            title="Support"
            description="Read-only, time-boxed view of the school dashboard. Reason required; every view is audited."
          >
            <Button variant="secondary" onClick={() => setSupportOpen(true)}>
              View as school (read-only)
            </Button>
          </Card>
        )}
      </div>
      <LifecycleDialog tenant={t} action={action} onClose={() => setAction(null)} />
      <Dialog
        open={supportOpen}
        onClose={() => setSupportOpen(false)}
        title={`Support session — ${t.name}`}
        description="Opens the school dashboard in read-only mode with a banner. The school can see support access in its audit log."
        footer={
          <>
            <Button variant="secondary" onClick={() => setSupportOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={support.isPending}
              disabled={reason.trim().length < 10}
              onClick={() => support.mutate()}
            >
              Start session
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {support.error && <Banner tone="danger">{messageFor(support.error)}</Banner>}
          <Field
            label="Reason"
            required
            hint="At least 10 characters, e.g. the ticket number and problem."
          >
            {(p) => <Textarea {...p} value={reason} onChange={(e) => setReason(e.target.value)} />}
          </Field>
          <Field label="Duration">
            {(p) => (
              <Select
                {...p}
                value={minutes}
                onChange={(e) => setMinutes(e.target.value)}
                options={[
                  { value: '5', label: '5 minutes' },
                  { value: '15', label: '15 minutes' },
                  { value: '30', label: '30 minutes' },
                ]}
              />
            )}
          </Field>
        </div>
      </Dialog>
    </div>
  );
}
