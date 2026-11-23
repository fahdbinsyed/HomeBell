'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@homebell/api-client';
import { pickupResolutionValues, type PickupResolution, type QueueItem } from '@homebell/contracts';
import type { ConnectionState } from '@homebell/client-services';
import { formatDateTime, formatTime, labels, minutesSince } from '@homebell/copy';
import {
  Badge,
  Banner,
  Button,
  Dialog,
  Field,
  LoadingState,
  Select,
  StateBadge,
  Textarea,
  useToast,
} from '@homebell/ui-web';
import { messageFor, queueKey, useApi, useIdempotencyKey } from '@homebell/web-core';

export const PickupBadge = ({ state }: { state: QueueItem['state'] }) => (
  <StateBadge group="pickup" value={state} label={labels.pickupState[state]} />
);

/** Re-render every 30 s so "waiting N min" stays current. */
export function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const h = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(h);
  }, [intervalMs]);
  return now;
}

export function ConnectionPill({ state }: { state: ConnectionState }) {
  const map = {
    connected: ['success', 'Live'],
    connecting: ['info', 'Connecting…'],
    reconnecting: ['warning', 'Reconnecting… (catching up)'],
    disconnected: ['danger', 'Offline — refreshing every 20 s'],
    idle: ['neutral', '…'],
  } as const;
  const [tone, text] = map[state];
  return (
    <span role="status" aria-live="polite">
      <Badge tone={tone}>
        <span
          className={`inline-block size-2 rounded-full ${state === 'connected' ? 'animate-pulse bg-success-fg' : 'bg-current'}`}
          aria-hidden
        />
        {text}
      </Badge>
    </span>
  );
}

export function QueueCard({
  item,
  now,
  selected,
  onSelect,
  onOpen,
  actions,
}: {
  item: QueueItem;
  now: Date;
  selected?: boolean;
  onSelect?: (v: boolean) => void;
  onOpen: () => void;
  actions?: React.ReactNode;
}) {
  const name = `${item.student.preferredName ?? item.student.firstName} ${item.student.lastName}`;
  const closed =
    item.state === 'acknowledged' || item.state === 'cancelled' || item.state === 'resolved';
  const waited = minutesSince(
    item.state === 'sent_out' && item.sentOutAt ? item.sentOutAt : item.requestedAt,
    now,
  );
  return (
    <li
      className={`rounded-lg border bg-surface p-3 ${item.stale || item.state === 'exception' ? 'border-danger-border' : 'border-border'} ${selected ? 'ring-2 ring-primary' : ''}`}
    >
      <div className="flex items-start gap-3">
        {onSelect && (
          <input
            type="checkbox"
            className="mt-1 size-4 accent-primary"
            aria-label={`Select ${name}`}
            checked={!!selected}
            onChange={(e) => onSelect(e.target.checked)}
          />
        )}
        <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
          <p className="truncate text-base font-semibold">{name}</p>
          <p className="truncate text-sm text-text-muted">
            {item.student.className}
            {item.student.sectionName ? ` ${item.student.sectionName}` : ''} ·{' '}
            {item.guardian.fullName} ({labels.relationship[item.guardian.relationship]}
            {item.guardian.kind === 'additional' ? ', additional' : ''})
          </p>
          {item.note && <p className="mt-1 text-sm">“{item.note}”</p>}
        </button>
        <div className="flex shrink-0 flex-col items-end gap-1 text-right">
          {item.position && <span className="text-xs text-text-muted">#{item.position}</span>}
          {closed ? (
            <span className="flex flex-col items-end gap-1">
              <PickupBadge state={item.state} />
              <span className="text-xs tabular-nums text-text-muted">
                {formatTime(item.closedAt)}
              </span>
            </span>
          ) : (
            <span
              className={`text-sm tabular-nums ${waited >= 10 ? 'font-semibold text-danger-fg' : 'text-text-muted'}`}
              aria-label={`Waiting ${waited} minutes`}
            >
              {waited} min
            </span>
          )}
          {item.stale && <Badge tone="danger">Waiting long</Badge>}
          {item.state === 'sent_out' && item.reminderSentAt && (
            <Badge tone="warning">Reminder sent</Badge>
          )}
        </div>
      </div>
      {actions && <div className="mt-3 flex flex-wrap gap-2">{actions}</div>}
    </li>
  );
}

export function useQueueActions(tenantId: string) {
  const { client } = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const idem = useIdempotencyKey();
  const after = () => {
    idem.next();
    void qc.invalidateQueries({ queryKey: queueKey(tenantId) });
    void qc.invalidateQueries({ queryKey: ['school', tenantId, 'overview'] });
  };
  const sendOut = useMutation({
    mutationFn: (id: string) =>
      unwrap(
        client.POST('/v1/t/{tenantId}/pickup-requests/{requestId}/sent-out', {
          params: { path: { tenantId, requestId: id }, header: { 'Idempotency-Key': idem.key() } },
        }),
      ),
    onSuccess: (i) => {
      after();
      toast(`${i.student.firstName} sent out`);
    },
    onError: (e) => toast(messageFor(e), 'danger'),
  });
  const bulk = useMutation({
    mutationFn: (ids: string[]) =>
      unwrap(
        client.POST('/v1/t/{tenantId}/pickup-requests/sent-out', {
          params: { path: { tenantId }, header: { 'Idempotency-Key': idem.key() } },
          body: { requestIds: ids },
        }),
      ),
    onSuccess: (r) => {
      after();
      toast(
        `${r.succeeded.length} sent out${r.failed.length ? `, ${r.failed.length} skipped` : ''}`,
        r.failed.length ? 'warning' : 'success',
      );
    },
    onError: (e) => toast(messageFor(e), 'danger'),
  });
  return { sendOut, bulk, refresh: after };
}

export function CancelDialog({
  tenantId,
  item,
  onClose,
}: {
  tenantId: string;
  item: QueueItem | null;
  onClose: () => void;
}) {
  const { client } = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const cancel = useMutation({
    mutationFn: () =>
      unwrap(
        client.POST('/v1/t/{tenantId}/pickup-requests/{requestId}/cancel', {
          params: { path: { tenantId, requestId: item!.id } },
          body: { reason: reason.trim() },
        }),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queueKey(tenantId) });
      toast('Request cancelled');
      setReason('');
      onClose();
    },
  });
  return (
    <Dialog
      open={!!item}
      onClose={onClose}
      title={`Cancel request — ${item?.student.firstName ?? ''}`}
      description="The guardian is notified that the request was cancelled."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Keep request
          </Button>
          <Button
            variant="danger"
            loading={cancel.isPending}
            disabled={reason.trim().length < 3}
            onClick={() => cancel.mutate()}
          >
            Cancel request
          </Button>
        </>
      }
    >
      {cancel.error && (
        <div className="mb-3">
          <Banner tone="danger">{messageFor(cancel.error)}</Banner>
        </div>
      )}
      <Field label="Reason" required>
        {(p) => (
          <Textarea
            {...p}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Duplicate request, student absent today"
          />
        )}
      </Field>
    </Dialog>
  );
}

export function ResolveDialog({
  tenantId,
  item,
  onClose,
}: {
  tenantId: string;
  item: QueueItem | null;
  onClose: () => void;
}) {
  const { client } = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const [resolution, setResolution] = useState<PickupResolution>('guardian_confirmed_offline');
  const [note, setNote] = useState('');
  const resolve = useMutation({
    mutationFn: () =>
      unwrap(
        client.POST('/v1/t/{tenantId}/pickup-requests/{requestId}/resolve', {
          params: { path: { tenantId, requestId: item!.id } },
          body: { resolution, note: note.trim() },
        }),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queueKey(tenantId) });
      toast('Follow-up resolved');
      setNote('');
      onClose();
    },
  });
  return (
    <Dialog
      open={!!item}
      onClose={onClose}
      title={`Resolve follow-up — ${item?.student.firstName ?? ''}`}
      description="The guardian didn't confirm pickup in time. Record how this was followed up."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={resolve.isPending}
            disabled={!note.trim()}
            onClick={() => resolve.mutate()}
          >
            Resolve
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {resolve.error && <Banner tone="danger">{messageFor(resolve.error)}</Banner>}
        <Field label="Outcome">
          {(p) => (
            <Select
              {...p}
              value={resolution}
              onChange={(e) => setResolution(e.target.value as PickupResolution)}
              options={pickupResolutionValues.map((r) => ({
                value: r,
                label: labels.resolution[r],
              }))}
            />
          )}
        </Field>
        <Field label="Note" required>
          {(p) => (
            <Textarea
              {...p}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Called the mother — she has Mia."
            />
          )}
        </Field>
      </div>
    </Dialog>
  );
}

export function RequestDetailDialog({
  tenantId,
  requestId,
  onClose,
}: {
  tenantId: string;
  requestId: string | null;
  onClose: () => void;
}) {
  const { client } = useApi();
  const detail = useQuery({
    queryKey: ['school', tenantId, 'pickup', requestId],
    queryFn: () =>
      unwrap(
        client.GET('/v1/t/{tenantId}/pickup-requests/{requestId}', {
          params: { path: { tenantId, requestId: requestId! } },
        }),
      ),
    enabled: !!requestId,
  });
  const d = detail.data;
  return (
    <Dialog
      open={!!requestId}
      onClose={onClose}
      size="lg"
      title={d ? `${d.student.firstName} ${d.student.lastName}` : 'Pickup request'}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      {!d ? (
        <LoadingState rows={3} />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <PickupBadge state={d.state} />
            <span className="text-sm text-text-muted">
              Requested {formatDateTime(d.requestedAt)} by {d.guardian.fullName}
            </span>
          </div>
          {d.acknowledgment && (
            <Banner tone="success">
              Confirmed by {d.acknowledgment.guardianName} at {formatTime(d.acknowledgment.at)}
              {d.acknowledgment.viaSentOut ? '' : ' (before the school marked “sent out”)'}.
            </Banner>
          )}
          <ol className="relative ml-2 border-l border-border pl-5">
            {d.history.map((h, i) => (
              <li key={i} className="mb-4">
                <span
                  className="absolute -left-1.5 mt-1.5 size-3 rounded-full bg-primary"
                  aria-hidden
                />
                <p className="text-sm font-medium">{labels.pickupState[h.toState]}</p>
                <p className="text-xs text-text-muted">
                  {formatDateTime(h.at)} · {h.actor?.displayName ?? h.actorType}
                </p>
                {h.reason && <p className="mt-1 text-sm">{h.reason}</p>}
              </li>
            ))}
          </ol>
          <p className="text-xs text-text-muted">
            HomeBell records requests and guardian confirmations. It does not verify the identity of
            the person collecting the child.
          </p>
        </div>
      )}
    </Dialog>
  );
}
