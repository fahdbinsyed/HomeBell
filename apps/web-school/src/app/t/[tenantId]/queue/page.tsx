'use client';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { unwrap } from '@homebell/api-client';
import type { QueueItem } from '@homebell/contracts';
import {
  Badge,
  Banner,
  Button,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  PageHeader,
  Select,
} from '@homebell/ui-web';
import { messageFor, useApi, useLiveQueue } from '@homebell/web-core';
import {
  CancelDialog,
  ConnectionPill,
  QueueCard,
  RequestDetailDialog,
  ResolveDialog,
  useNow,
  useQueueActions,
} from '@/components/queue-parts';
import { schoolKey, useSchool } from '@/lib/school';

function Lane({
  title,
  count,
  tone,
  children,
  empty,
}: {
  title: string;
  count: number;
  tone: 'info' | 'warning' | 'danger' | 'neutral';
  children: React.ReactNode;
  empty: string;
}) {
  return (
    <section aria-label={title} className="flex min-w-0 flex-col gap-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-text-muted">
        {title}
        <Badge tone={tone}>{count}</Badge>
      </h2>
      {count === 0 ? (
        <p className="rounded-lg border border-dashed border-border-strong p-4 text-center text-sm text-text-muted">
          {empty}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">{children}</ul>
      )}
    </section>
  );
}

export default function LiveQueuePage() {
  const { tenantId, can, canWrite, has } = useSchool();
  const { client } = useApi();
  const q = useLiveQueue(tenantId);
  const now = useNow();
  const { sendOut, bulk } = useQueueActions(tenantId);
  const classes = useQuery({
    queryKey: schoolKey(tenantId, 'classes'),
    queryFn: () =>
      unwrap(client.GET('/v1/t/{tenantId}/classes', { params: { path: { tenantId } } })),
  });
  const [classId, setClassId] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [cancelling, setCancelling] = useState<QueueItem | null>(null);
  const [resolving, setResolving] = useState<QueueItem | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const dispatch = canWrite && can('school.queue.dispatch');
  const sentOutStep = has('dismissal.sent_out_step');

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return q.items.filter(
      (i) =>
        (!classId || i.student.classId === classId) &&
        (!s ||
          `${i.student.firstName} ${i.student.lastName} ${i.guardian.fullName}`
            .toLowerCase()
            .includes(s)),
    );
  }, [q.items, classId, search]);
  const byState = (states: QueueItem['state'][]) =>
    filtered.filter((i) => states.includes(i.state));
  const requested = byState(['requested']).sort((a, b) =>
    a.requestedAt.localeCompare(b.requestedAt),
  );
  const sentOut = byState(['sent_out']).sort((a, b) =>
    (a.sentOutAt ?? '').localeCompare(b.sentOutAt ?? ''),
  );
  const exceptions = byState(['exception']);
  const closed = byState(['acknowledged', 'cancelled', 'resolved'])
    .sort((a, b) => (b.closedAt ?? '').localeCompare(a.closedAt ?? ''))
    .slice(0, 12);
  const toggle = (id: string, v: boolean) =>
    setSelected((s) => {
      const n = new Set(s);
      if (v) n.add(id);
      else n.delete(id);
      return n;
    });
  const selectedRequested = requested.filter((i) => selected.has(i.id)).map((i) => i.id);

  if (q.snapshot.isPending) return <LoadingState rows={8} />;
  if (q.snapshot.error)
    return <ErrorState message={messageFor(q.snapshot.error)} onRetry={() => q.refresh()} />;

  return (
    <>
      <PageHeader
        title="Live queue"
        description="Pickup requests in arrival order. Mark a child “sent out” when they leave the building; the guardian confirms once they have them."
        badge={<ConnectionPill state={q.connection} />}
      />
      {!sentOutStep && (
        <div className="mb-4">
          <Banner tone="info">
            This school doesn't use the “sent out” step. Requests close when the guardian confirms
            pickup.
          </Banner>
        </div>
      )}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Input
          type="search"
          className="max-w-xs"
          placeholder="Search student or guardian"
          aria-label="Search the queue"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select
          className="max-w-[200px]"
          aria-label="Filter by class"
          value={classId}
          onChange={(e) => setClassId(e.target.value)}
          placeholder="All classes"
          options={(classes.data?.items ?? []).map((c) => ({ value: c.id, label: c.name }))}
        />
        {dispatch && sentOutStep && selectedRequested.length > 0 && (
          <Button
            loading={bulk.isPending}
            onClick={() =>
              bulk.mutate(selectedRequested, { onSuccess: () => setSelected(new Set()) })
            }
          >
            Send out {selectedRequested.length} selected
          </Button>
        )}
      </div>
      <div className="grid gap-6 xl:grid-cols-3">
        <Lane title="Requested" count={requested.length} tone="info" empty="No one is waiting.">
          {requested.map((i) => (
            <QueueCard
              key={i.id}
              item={i}
              now={now}
              selected={selected.has(i.id)}
              onSelect={dispatch && sentOutStep ? (v) => toggle(i.id, v) : undefined}
              onOpen={() => setOpenId(i.id)}
              actions={
                dispatch && (
                  <>
                    {sentOutStep && (
                      <Button
                        size="sm"
                        loading={sendOut.isPending && sendOut.variables === i.id}
                        onClick={() => sendOut.mutate(i.id)}
                      >
                        Sent out
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => setCancelling(i)}>
                      Cancel
                    </Button>
                  </>
                )
              }
            />
          ))}
        </Lane>
        <Lane
          title="Sent out — awaiting confirmation"
          count={sentOut.length}
          tone="warning"
          empty="No children waiting for guardian confirmation."
        >
          {sentOut.map((i) => (
            <QueueCard
              key={i.id}
              item={i}
              now={now}
              onOpen={() => setOpenId(i.id)}
              actions={
                dispatch && (
                  <Button size="sm" variant="ghost" onClick={() => setCancelling(i)}>
                    Cancel
                  </Button>
                )
              }
            />
          ))}
        </Lane>
        <div className="flex flex-col gap-6">
          <Lane
            title="Needs follow-up"
            count={exceptions.length}
            tone="danger"
            empty="Nothing to follow up."
          >
            {exceptions.map((i) => (
              <QueueCard
                key={i.id}
                item={i}
                now={now}
                onOpen={() => setOpenId(i.id)}
                actions={
                  canWrite &&
                  can('school.queue.resolve') && (
                    <Button size="sm" variant="secondary" onClick={() => setResolving(i)}>
                      Resolve
                    </Button>
                  )
                }
              />
            ))}
          </Lane>
          <Lane
            title="Recently closed"
            count={closed.length}
            tone="neutral"
            empty="Closed requests appear here."
          >
            {closed.map((i) => (
              <QueueCard key={i.id} item={i} now={now} onOpen={() => setOpenId(i.id)} />
            ))}
          </Lane>
        </div>
      </div>
      {q.items.length === 0 && (
        <div className="mt-6">
          <EmptyState
            title="Quiet so far"
            description="Requests appear here the moment a guardian taps “Request pickup”."
          />
        </div>
      )}
      <CancelDialog tenantId={tenantId} item={cancelling} onClose={() => setCancelling(null)} />
      <ResolveDialog tenantId={tenantId} item={resolving} onClose={() => setResolving(null)} />
      <RequestDetailDialog tenantId={tenantId} requestId={openId} onClose={() => setOpenId(null)} />
    </>
  );
}
