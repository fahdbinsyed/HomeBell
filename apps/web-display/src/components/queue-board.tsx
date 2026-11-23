'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, unwrap } from '@homebell/api-client';
import type { DisplayFeed, DisplayItem } from '@homebell/contracts';
import { SequenceTracker, type ConnectionState } from '@homebell/client-services';
import { errorMessage, formatTime } from '@homebell/copy';
import { useApi } from '@homebell/web-core';

const HEARTBEAT_MS = 60_000;
const POLL_MS = 5_000;

/**
 * TV-ready, privacy-safe queue (ADR-0013): first name + last initial (per school setting), class label,
 * status. Realtime via the display feed with seq catch-up; falls back to polling when offline.
 */
export function QueueBoard({
  token,
  onUnpaired,
  onTokenRotated,
}: {
  token: string;
  onUnpaired: () => void;
  onTokenRotated: (t: string) => void;
}) {
  const { client, mock } = useApi();
  const auth = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [feed, setFeed] = useState<DisplayFeed | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [connection, setConnection] = useState<ConnectionState>('idle');
  const [now, setNow] = useState(() => new Date());
  const tracker = useRef(new SequenceTracker());

  const handleError = useCallback(
    (e: unknown) => {
      if (e instanceof ApiError && (e.code === 'DISPLAY_REVOKED' || e.code === 'UNAUTHENTICATED'))
        return onUnpaired();
      if (
        e instanceof ApiError &&
        (e.code === 'TENANT_NOT_OPERATIONAL' || e.code === 'FEATURE_NOT_ENTITLED')
      )
        return setBlocked(errorMessage(e.code));
      setConnection('reconnecting');
    },
    [onUnpaired],
  );

  const loadSnapshot = useCallback(async () => {
    try {
      const f = await unwrap(client.GET('/v1/display/feed', { headers: auth }));
      tracker.current.reset(f.seq);
      setFeed(f);
      setBlocked(null);
    } catch (e) {
      handleError(e);
    }
  }, [client, auth, handleError]);

  const upsert = useCallback(
    (item: DisplayItem) =>
      setFeed((f) =>
        f
          ? {
              ...f,
              items: f.items.some((i) => i.id === item.id)
                ? f.items.map((i) => (i.id === item.id ? item : i))
                : [...f.items, item],
            }
          : f,
      ),
    [],
  );
  const remove = useCallback(
    (id: string) => setFeed((f) => (f ? { ...f, items: f.items.filter((i) => i.id !== id) } : f)),
    [],
  );

  const catchUp = useCallback(async () => {
    try {
      const page = await unwrap(
        client.GET('/v1/display/feed/events', {
          headers: auth,
          params: { query: { afterSeq: tracker.current.lastSeq ?? 0 } },
        }),
      );
      for (const e of page.events) {
        if (e.item) upsert(e.item);
        else if (e.itemId) remove(e.itemId);
        tracker.current.applied(e.seq);
      }
    } catch (e) {
      if (e instanceof ApiError && e.code === 'QUEUE_CATCHUP_GAP_TOO_LARGE') return loadSnapshot();
      handleError(e);
    }
  }, [client, auth, upsert, remove, loadSnapshot, handleError]);

  // Snapshot + realtime (mock feed now; SignalR in Phase 4) with polling fallback.
  useEffect(() => {
    void loadSnapshot();
    if (!mock) {
      const h = setInterval(() => void loadSnapshot(), POLL_MS);
      setConnection('disconnected');
      return () => clearInterval(h);
    }
    const channel = mock.createDisplayFeed(() => token);
    const subs = [
      channel.onStateChange((s) => {
        setConnection(s);
        if (s === 'connected') void catchUp();
      }),
      channel.onEvent((e) => {
        if (e.type === 'display.revoked') return onUnpaired();
        if (e.type === 'queue.reset') return void loadSnapshot();
        if (typeof e.seq !== 'number') return;
        const d = tracker.current.decide(e.seq);
        if (d === 'duplicate') return;
        if (d === 'gap') return void catchUp();
        if (e.type === 'display.item.upserted') upsert(e.data.item);
        else remove(e.data.itemId);
        tracker.current.applied(e.seq);
      }),
    ];
    channel
      .connect()
      .then(() => channel.hello(tracker.current.lastSeq))
      .catch(() => setConnection('reconnecting'));
    const poll = setInterval(() => {
      if (channel.state !== 'connected') void loadSnapshot();
    }, POLL_MS * 4);
    return () => {
      subs.forEach((s) => s.unsubscribe());
      clearInterval(poll);
      void channel.disconnect();
    };
  }, [mock, token, loadSnapshot, catchUp, upsert, remove, onUnpaired]);

  useEffect(() => {
    const beat = async () => {
      try {
        const r = await unwrap(
          client.POST('/v1/display/heartbeat', {
            headers: auth,
            body: { appVersion: '1.0.0', lastSeq: tracker.current.lastSeq ?? undefined },
          }),
        );
        if (r.rotatedToken) onTokenRotated(r.rotatedToken);
      } catch (e) {
        handleError(e);
      }
    };
    void beat();
    const h = setInterval(beat, HEARTBEAT_MS);
    const clock = setInterval(() => setNow(new Date()), 15_000);
    return () => {
      clearInterval(h);
      clearInterval(clock);
    };
  }, [client, auth, onTokenRotated, handleError]);

  if (blocked) {
    return (
      <main className="flex h-dvh flex-col items-center justify-center gap-4 bg-bg p-10 text-center text-text">
        <h1 className="text-5xl font-semibold">Pickup display paused</h1>
        <p className="max-w-3xl text-2xl text-text-muted">
          {blocked} Please follow staff instructions.
        </p>
      </main>
    );
  }
  const items = [...(feed?.items ?? [])].sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
  const comingOut = items.filter((i) => i.state === 'sent_out');
  const waiting = items.filter((i) => i.state === 'requested');
  const accent = feed?.settings.primaryColor ?? undefined;

  return (
    <main
      className="flex h-dvh flex-col bg-bg text-text"
      style={accent ? ({ ['--hb-primary' as string]: accent } as React.CSSProperties) : undefined}
    >
      <header className="flex items-center justify-between border-b border-border px-10 py-6">
        <div>
          <h1 className="text-4xl font-bold">{feed?.settings.schoolName ?? 'HomeBell'}</h1>
          <p className="text-xl text-text-muted">
            Pickup queue{feed?.displayName ? ` · ${feed.displayName}` : ''}
          </p>
        </div>
        <div className="text-right">
          <p className="text-5xl font-semibold tabular-nums">{formatTime(now.toISOString())}</p>
          <p
            className={`text-lg ${connection === 'connected' ? 'text-success-fg' : 'text-warning-fg'}`}
            role="status"
          >
            {connection === 'connected' ? '● Live' : '● Reconnecting…'}
          </p>
        </div>
      </header>
      <div className="grid flex-1 grid-cols-1 gap-8 overflow-hidden p-10 lg:grid-cols-2">
        <Column
          title="Coming out now"
          tone="success"
          items={comingOut}
          empty="No one is on the way out."
        />
        <Column
          title="Requested"
          tone="info"
          items={waiting}
          empty="Waiting for pickup requests."
        />
      </div>
      <footer className="border-t border-border px-10 py-3 text-base text-text-muted">
        HomeBell · safer dismissal, smoother pickup
      </footer>
    </main>
  );
}

function Column({
  title,
  tone,
  items,
  empty,
}: {
  title: string;
  tone: 'success' | 'info';
  items: DisplayItem[];
  empty: string;
}) {
  const MAX = 9;
  const shown = items.slice(0, MAX);
  return (
    <section aria-label={title} className="flex min-h-0 flex-col">
      <h2
        className={`mb-4 flex items-baseline gap-3 text-3xl font-bold ${tone === 'success' ? 'text-success-fg' : 'text-info-fg'}`}
      >
        {title}
        <span className="text-2xl font-medium text-text-muted">{items.length}</span>
      </h2>
      {items.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border-strong p-10 text-center text-2xl text-text-muted">
          {empty}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {shown.map((i) => (
            <li
              key={i.id}
              className={`flex items-center justify-between rounded-2xl border px-6 py-4 ${tone === 'success' ? 'border-success-border bg-success-bg' : 'border-border bg-surface'}`}
            >
              <span className="text-4xl font-semibold">{i.displayName}</span>
              {i.classLabel && <span className="text-2xl text-text-muted">{i.classLabel}</span>}
            </li>
          ))}
          {items.length > MAX && (
            <li className="px-6 text-xl text-text-muted">+ {items.length - MAX} more</li>
          )}
        </ul>
      )}
    </section>
  );
}
