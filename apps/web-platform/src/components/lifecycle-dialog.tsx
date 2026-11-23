'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@homebell/api-client';
import {
  lifecycleReasonCodeValues,
  refundStatusValues,
  type LifecycleReasonCode,
  type RefundStatus,
  type TenantDetail,
  type TenantLifecycleAction,
} from '@homebell/contracts';
import { labels } from '@homebell/copy';
import { Banner, Button, Dialog, Field, Input, Select, Textarea, useToast } from '@homebell/ui-web';
import { ApiError, fieldErrors, messageFor, useApi, useIdempotencyKey } from '@homebell/web-core';
import { dateToIso, isoToDate, keys, usePlans } from '@/lib/use-platform';

const NEEDS_EXPIRY: TenantLifecycleAction[] = [
  'start_trial',
  'activate',
  'convert_to_paid',
  'extend_expiry',
];
const OPTIONAL_EXPIRY: TenantLifecycleAction[] = ['grant_free', 'apply_manual_override'];
const CONFIRM_NAME: TenantLifecycleAction[] = ['deactivate', 'cancel', 'start_offboarding'];
const DESTRUCTIVE: TenantLifecycleAction[] = [
  'suspend',
  'deactivate',
  'cancel',
  'start_offboarding',
];
const DEFAULT_REASON: Partial<Record<TenantLifecycleAction, LifecycleReasonCode>> = {
  start_trial: 'trial_requested',
  grant_free: 'pilot_program',
  activate: 'contract_signed',
  convert_to_paid: 'contract_signed',
  extend_expiry: 'renewal',
  suspend: 'non_payment',
  deactivate: 'school_request',
  cancel: 'school_request',
  reinstate: 'renewal',
  start_offboarding: 'school_request',
  apply_manual_override: 'other',
};

const EXPLAIN: Record<TenantLifecycleAction, string> = {
  activate: 'Paid access starts. Requires a published plan.',
  start_trial: 'Full access until the trial end date.',
  convert_to_paid: 'Moves the school to paid access on the selected plan.',
  grant_free: 'Free pilot / charity access. Optional end date and caps via overrides.',
  apply_manual_override: 'Operator escape hatch for contract edge cases. A note is required.',
  extend_expiry: 'Moves the current expiry date later.',
  suspend: 'Staff keep read-only access; guardians cannot request pickups; display screens stop.',
  deactivate: 'Blocks the school immediately. Data is kept; reversible with Reinstate.',
  cancel:
    'Ends the service. HomeBell does not process refunds — record any refund handled manually below.',
  start_offboarding: 'Export-only access, then data is purged after the retention period.',
  reinstate: 'Restores the previous operational state.',
};

export function LifecycleDialog({
  tenant,
  action,
  onClose,
}: {
  tenant: TenantDetail;
  action: TenantLifecycleAction | null;
  onClose: () => void;
}) {
  const { client } = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const plans = usePlans();
  const idem = useIdempotencyKey();
  const [reasonCode, setReasonCode] = useState<LifecycleReasonCode>('other');
  const [note, setNote] = useState('');
  const [expires, setExpires] = useState('');
  const [planVersionId, setPlanVersionId] = useState('');
  const [targetState, setTargetState] = useState('');
  const [retentionDays, setRetentionDays] = useState('90');
  const [refundStatus, setRefundStatus] = useState<RefundStatus>('none');
  const [confirmName, setConfirmName] = useState('');

  useEffect(() => {
    if (!action) return;
    setReasonCode(DEFAULT_REASON[action] ?? 'other');
    setNote('');
    setExpires(action === 'extend_expiry' ? isoToDate(tenant.expiresAt) : '');
    setPlanVersionId(tenant.subscription?.planVersion.id ?? '');
    setTargetState(tenant.previousOperationalState ?? 'active_paid');
    setConfirmName('');
    setRefundStatus('none');
    idem.next();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action, tenant.id]);

  const run = useMutation({
    mutationFn: () =>
      unwrap(
        client.POST('/v1/platform/tenants/{tenantId}/lifecycle-transitions', {
          params: { path: { tenantId: tenant.id }, header: { 'Idempotency-Key': idem.key() } },
          body: {
            action: action!,
            expectedState: tenant.state,
            reasonCode,
            note: note.trim() || undefined,
            expiresAt:
              NEEDS_EXPIRY.includes(action!) || OPTIONAL_EXPIRY.includes(action!)
                ? dateToIso(expires)
                : undefined,
            planVersionId:
              (action === 'activate' || action === 'convert_to_paid') && planVersionId
                ? planVersionId
                : undefined,
            targetState: action === 'reinstate' ? (targetState as never) : undefined,
            retentionDays: action === 'start_offboarding' ? Number(retentionDays) : undefined,
            refundStatus: action === 'cancel' ? refundStatus : undefined,
            confirmTenantName: CONFIRM_NAME.includes(action!) ? confirmName : undefined,
          },
        }),
      ),
    onSuccess: (t) => {
      qc.setQueryData(keys.tenant(t.id), t);
      void qc.invalidateQueries({ queryKey: ['platform', 'tenant', t.id] });
      void qc.invalidateQueries({ queryKey: ['platform', 'tenants'] });
      toast(`${labels.lifecycleAction[action!]}: ${t.name} is now ${labels.tenantState[t.state]}`);
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'LIFECYCLE_STATE_CHANGED')
        void qc.invalidateQueries({ queryKey: keys.tenant(tenant.id) });
    },
  });

  if (!action) return null;
  const errs = fieldErrors(run.error);
  const versions = (plans.data?.items ?? []).flatMap((p) =>
    p.versions
      .filter((v) => v.status === 'published')
      .map((v) => ({ value: v.id, label: `${p.name} v${v.version}` })),
  );
  const needsExpiry = NEEDS_EXPIRY.includes(action);
  const blocked =
    (needsExpiry && !expires) ||
    (action === 'apply_manual_override' && !note.trim()) ||
    (CONFIRM_NAME.includes(action) && confirmName !== tenant.name) ||
    ((action === 'activate' || action === 'convert_to_paid') && !planVersionId);

  return (
    <Dialog
      open={!!action}
      onClose={onClose}
      title={`${labels.lifecycleAction[action]} — ${tenant.name}`}
      description={EXPLAIN[action]}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={DESTRUCTIVE.includes(action) ? 'danger' : 'primary'}
            loading={run.isPending}
            disabled={blocked}
            onClick={() => run.mutate()}
          >
            {labels.lifecycleAction[action]}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {run.error && <Banner tone="danger">{messageFor(run.error)}</Banner>}
        <p className="text-sm text-text-muted">
          Current state: <strong className="text-text">{labels.tenantState[tenant.state]}</strong>
        </p>
        <Field label="Reason" required>
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
        {(needsExpiry || OPTIONAL_EXPIRY.includes(action)) && (
          <Field
            label={action === 'start_trial' ? 'Trial ends' : 'Access ends'}
            required={needsExpiry}
            hint={needsExpiry ? undefined : 'Leave empty for no end date.'}
            error={errs.expiresAt}
          >
            {(p) => (
              <Input
                {...p}
                type="date"
                value={expires}
                onChange={(e) => setExpires(e.target.value)}
              />
            )}
          </Field>
        )}
        {(action === 'activate' || action === 'convert_to_paid') && (
          <Field label="Plan" required>
            {(p) => (
              <Select
                {...p}
                value={planVersionId}
                onChange={(e) => setPlanVersionId(e.target.value)}
                placeholder="Choose a published plan"
                options={versions}
              />
            )}
          </Field>
        )}
        {action === 'reinstate' && (
          <Field label="Reinstate to" hint="Defaults to the state before suspension/deactivation.">
            {(p) => (
              <Select
                {...p}
                value={targetState}
                onChange={(e) => setTargetState(e.target.value)}
                options={(['active_paid', 'trial', 'pilot_free', 'manual_override'] as const).map(
                  (s) => ({ value: s, label: labels.tenantState[s] }),
                )}
              />
            )}
          </Field>
        )}
        {action === 'start_offboarding' && (
          <Field
            label="Retention before purge (days)"
            hint="30–365. Data export is available during this period."
          >
            {(p) => (
              <Input
                {...p}
                type="number"
                min={30}
                max={365}
                value={retentionDays}
                onChange={(e) => setRetentionDays(e.target.value)}
              />
            )}
          </Field>
        )}
        {action === 'cancel' && (
          <Field
            label="Refund status (informational)"
            hint="HomeBell never processes refunds. The business team handles any refund outside the app."
          >
            {(p) => (
              <Select
                {...p}
                value={refundStatus}
                onChange={(e) => setRefundStatus(e.target.value as RefundStatus)}
                options={refundStatusValues.map((r) => ({
                  value: r,
                  label: labels.refundStatus[r],
                }))}
              />
            )}
          </Field>
        )}
        <Field label="Internal note" required={action === 'apply_manual_override'}>
          {(p) => (
            <Textarea
              {...p}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Why is this change being made?"
            />
          )}
        </Field>
        {CONFIRM_NAME.includes(action) && (
          <Field label={`Type “${tenant.name}” to confirm`} required error={errs.confirmTenantName}>
            {(p) => (
              <Input
                {...p}
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
                autoComplete="off"
              />
            )}
          </Field>
        )}
      </div>
    </Dialog>
  );
}
