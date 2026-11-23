'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, unwrap } from '@homebell/api-client';
import type { QueueItem, QueueSnapshot } from '@homebell/contracts';
import { SequenceTracker, type ConnectionState } from '@homebell/client-services';
import { useApi } from './api';

export const queueKey = (tenantId: string) => ['queue', tenantId] as const;

/**
 * Live queue with the realtime contract's catch-up semantics (realtime.asyncapi.yaml):
 * snapshot → join(lastSeq) → apply events in order; on a gap fetch /queue/events; on 410 or
 * queue.reset reload the snapshot. The database (snapshot) is the source of truth.
 */
export function useLiveQueue(tenantId: string) {
  const { client, createQueueFeed } = useApi();
  const qc = useQueryClient();
  const tracker = useRef(new SequenceTracker());
  const [connection, setConnection] = useState<ConnectionState>('idle');
  const [lastEventAt, setLastEventAt] = useState<number | null>(null);

  const snapshot = useQuery({
    queryKey: queueKey(tenantId),
    queryFn: async () => {
      const s = await unwrap(
        client.GET('/v1/t/{tenantId}/queue', { params: { path: { tenantId } } }),
      );
      tracker.current.reset(s.seq);
      return s;
    },
    refetchInterval: connection === 'connected' ? false : 20_000,
  });

  const upsert = useCallback(
    (item: QueueItem) => {
      qc.setQueryData<QueueSnapshot>(queueKey(tenantId), (prev) => {
        if (!prev) return prev;
        const items = prev.items.some((i) => i.id === item.id)
          ? prev.items.map((i) => (i.id === item.id ? item : i))
          : [...prev.items, item];
        return { ...prev, seq: Math.max(prev.seq, item.seq), items };
      });
    },
    [qc, tenantId],
  );

  const catchUp = useCallback(async () => {
    const after = tracker.current.lastSeq ?? 0;
    try {
      const page = await unwrap(
        client.GET('/v1/t/{tenantId}/queue/events', {
          params: { path: { tenantId }, query: { afterSeq: after } },
        }),
      );
      for (const e of page.events) {
        if (e.data.item) upsert(e.data.item);
        tracker.current.applied(e.seq);
      }
    } catch (e) {
      if (e instanceof ApiError && e.code === 'QUEUE_CATCHUP_GAP_TOO_LARGE')
        await qc.invalidateQueries({ queryKey: queueKey(tenantId) });
    }
  }, [client, qc, tenantId, upsert]);

  useEffect(() => {
    if (!snapshot.data) return;
    const feed = createQueueFeed();
    let alive = true;
    const subs = [
      feed.onStateChange((s) => {
        setConnection(s);
        if (s === 'connected' && alive) void catchUp();
      }),
      feed.onEvent((e) => {
        setLastEventAt(Date.now());
        if (e.type === 'queue.reset')
          return void qc.invalidateQueries({ queryKey: queueKey(tenantId) });
        if (e.type === 'tenant.state_changed') return void qc.invalidateQueries();
        if (e.type === 'session.revoked')
          return void qc.invalidateQueries({ queryKey: ['auth', 'me'] });
        if (typeof e.seq !== 'number') return;
        const decision = tracker.current.decide(e.seq);
        if (decision === 'duplicate') return;
        if (decision === 'gap') return void catchUp();
        upsert(e.data.item);
        tracker.current.applied(e.seq);
      }),
    ];
    feed
      .connect()
      .then(() => feed.join({ tenantId, lastSeq: tracker.current.lastSeq }))
      .then((r) =>
        r.catchUp === 'events' ? catchUp() : r.catchUp === 'snapshot' ? undefined : undefined,
      )
      .catch(() => setConnection('reconnecting'));
    return () => {
      alive = false;
      subs.forEach((s) => s.unsubscribe());
      void feed.disconnect();
    };
    // Reconnect only when the tenant changes, not on every snapshot refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, !!snapshot.data, createQueueFeed]);

  return {
    snapshot,
    items: snapshot.data?.items ?? [],
    seq: snapshot.data?.seq ?? 0,
    connection,
    lastEventAt,
    refresh: () => snapshot.refetch(),
  };
}
