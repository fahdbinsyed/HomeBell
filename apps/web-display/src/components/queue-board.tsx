'use client';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
  // Only children still waiting are shown. "Coming out now" (sent_out) is left out for now — it may
  // return later as an add-on — so a child leaves the board once staff press Sent out.
  const waiting = items.filter((i) => i.state === 'requested');
  const rows = buildRows(feed?.classLabels ?? [], waiting);
  const followUpMs = (feed?.settings.followUpAfterMinutes ?? 10) * 60_000;
  const accent = feed?.settings.primaryColor ?? undefined;

  return (
    <main
      className="flex h-dvh flex-col bg-bg text-text"
      style={accent ? ({ ['--hb-primary' as string]: accent } as React.CSSProperties) : undefined}
    >
      <header className="flex items-center justify-between gap-6 border-b border-border px-10 py-6">
        <div>
          <h1 className="text-4xl font-bold">{feed?.settings.schoolName ?? 'HomeBell'}</h1>
          <p className="text-xl text-text-muted">
            Pickup queue{feed?.displayName ? ` · ${feed.displayName}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-10">
          <p className="text-right">
            <span className="block text-5xl font-semibold tabular-nums">{waiting.length}</span>
            <span className="text-lg text-text-muted">waiting</span>
          </p>
          <div className="text-right">
            <p className="text-5xl font-semibold tabular-nums">{formatTime(now.toISOString())}</p>
            <p
              className={`text-lg ${connection === 'connected' ? 'text-success-fg' : 'text-warning-fg'}`}
              role="status"
            >
              {connection === 'connected' ? '● Live' : '● Reconnecting…'}
            </p>
          </div>
        </div>
      </header>
      <GradeBoard rows={rows} now={now} followUpMs={followUpMs} />
      <footer className="border-t border-border px-10 py-3 text-base text-text-muted">
        HomeBell · safer dismissal, smoother pickup
      </footer>
    </main>
  );
}

interface Row {
  label: string | null;
  items: DisplayItem[];
}

/** One row per grade/class from the school's list, in school order, kept even when empty. A request
 * whose label isn't in the list (e.g. a class renamed mid-day) gets its own row at the end so the name
 * still shows. No list (the school hides the class) → one row for everyone. Oldest request first. */
function buildRows(labels: string[], items: DisplayItem[]): Row[] {
  const byOldest = (a: DisplayItem, b: DisplayItem) => a.requestedAt.localeCompare(b.requestedAt);
  if (labels.length === 0) return [{ label: null, items: [...items].sort(byOldest) }];
  const map = new Map<string, DisplayItem[]>(labels.map((l) => [l, []]));
  const extra: string[] = [];
  for (const i of items) {
    const key = i.classLabel ?? 'Other';
    if (!map.has(key)) {
      map.set(key, []);
      extra.push(key);
    }
    map.get(key)!.push(i);
  }
  return [...labels, ...extra].map((label) => ({
    label,
    items: map.get(label)!.sort(byOldest),
  }));
}

const PAGE_MS = 9_000;

/** Pack whole rows into pages that fit the available height. */
function packPages(heights: number[], available: number): number[][] {
  const pages: number[][] = [];
  let cur: number[] = [];
  let used = 0;
  heights.forEach((h, i) => {
    if (cur.length && used + h > available) {
      pages.push(cur);
      cur = [];
      used = 0;
    }
    cur.push(i);
    used += h;
  });
  if (cur.length) pages.push(cur);
  return pages;
}

function GradeBoard({ rows, now, followUpMs }: { rows: Row[]; now: Date; followUpMs: number }) {
  const area = useRef<HTMLDivElement>(null);
  const measure = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState<number[][]>([rows.map((_, i) => i)]);
  const [page, setPage] = useState(0);
  const [size, setSize] = useState({ w: 0, h: 0 });

  // Track the board's size.
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Measure every row off-screen at the same width, then pack rows into pages.
  const signature = rows.map((r) => `${r.label}:${r.items.map((i) => i.id).join(',')}`).join('|');
  useLayoutEffect(() => {
    const m = measure.current;
    if (!m || !size.h) return;
    const heights = [...m.children].map((c) => (c as HTMLElement).offsetHeight);
    const next = packPages(heights, size.h);
    setPages((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
  }, [signature, size.w, size.h]);

  // Turn pages on a fixed timer. Live updates must not restart it, or later pages never show.
  const pageCount = pages.length;
  useEffect(() => {
    if (pageCount <= 1) return;
    const h = setInterval(() => setPage((p) => (p + 1) % pageCount), PAGE_MS);
    return () => clearInterval(h);
  }, [pageCount]);
  const current = pageCount ? page % pageCount : 0;
  const shown = (pages[current] ?? []).map((i) => rows[i]).filter((r): r is Row => !!r);
  const first = shown[0]?.label;
  const last = shown[shown.length - 1]?.label;

  const renderRow = (r: Row, key: string) => (
    <section
      key={key}
      aria-label={r.label ?? 'Requested'}
      className="grid grid-cols-[13rem_minmax(0,1fr)] items-start gap-6 border-b border-border px-10 py-4"
    >
      {r.label ? (
        <div>
          <h2 className="text-3xl font-bold text-info-fg">{r.label}</h2>
          <p className="text-lg tabular-nums text-text-muted">
            {r.items.length ? `${r.items.length} waiting` : 'No requests'}
          </p>
        </div>
      ) : (
        <p className="text-xl text-text-muted">{r.items.length} waiting</p>
      )}
      <ul className="flex min-h-[2.5rem] flex-wrap items-center gap-x-4 gap-y-3">
        {r.items.map((i) => {
          const waitedMs = now.getTime() - Date.parse(i.requestedAt);
          const overdue = waitedMs > followUpMs;
          return (
            <li
              key={i.id}
              className={`max-w-full break-words rounded-xl border px-4 py-1.5 text-3xl font-semibold leading-snug ${
                overdue
                  ? 'border-warning-border bg-warning-bg text-warning-fg'
                  : 'border-border bg-surface text-text'
              }`}
            >
              {i.displayName}
              {overdue && (
                <span className="ml-3 text-xl font-medium">
                  {Math.floor(waitedMs / 60_000)} min
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );

  const overdueCount = rows.reduce(
    (n, r) =>
      n + r.items.filter((i) => now.getTime() - Date.parse(i.requestedAt) > followUpMs).length,
    0,
  );

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={area} className="relative min-h-0 flex-1 overflow-hidden">
        {shown.map((r, i) => renderRow(r, `${current}-${r.label ?? 'all'}-${i}`))}
        {/* Off-screen copy used only to measure row heights at the real width. */}
        <div
          ref={measure}
          aria-hidden="true"
          className="pointer-events-none invisible absolute inset-x-0 top-0"
        >
          {rows.map((r, i) => renderRow(r, `m-${i}`))}
        </div>
      </div>
      {(overdueCount > 0 || pageCount > 1) && (
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border px-10 py-3 text-xl">
          <p className={overdueCount ? 'font-medium text-warning-fg' : 'text-text-muted'}>
            {overdueCount > 0 &&
              `${overdueCount} waiting more than ${Math.round(followUpMs / 60_000)} min — please follow up`}
          </p>
          {pageCount > 1 && (
            <p className="tabular-nums text-text-muted" role="status">
              Page {current + 1} of {pageCount}
              {first && last ? ` · ${first === last ? first : `${first} – ${last}`}` : ''}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
