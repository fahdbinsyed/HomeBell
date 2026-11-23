'use client';
import { useMemo, useRef } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { newIdempotencyKey } from '@homebell/api-client';

/**
 * Cursor pagination over `{ items, nextCursor }` pages. `fetchPage(cursor)` performs the typed call.
 */
export function usePagedList<T>(
  key: readonly unknown[],
  fetchPage: (
    cursor: string | undefined,
  ) => Promise<{ items: T[]; nextCursor: string | null; totalEstimate?: number | null }>,
  enabled = true,
) {
  const q = useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) => fetchPage(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled,
  });
  const items = useMemo(() => q.data?.pages.flatMap((p) => p.items), [q.data]);
  const total = q.data?.pages[0]?.totalEstimate ?? null;
  return { ...q, items, total };
}

/**
 * One Idempotency-Key per user intent: stable across retries of the same intent, renewed with
 * `next()` after success (ADR-0004 / 09-frontend-architecture §2).
 */
export function useIdempotencyKey() {
  const ref = useRef(newIdempotencyKey());
  return { key: () => ref.current, next: () => (ref.current = newIdempotencyKey()) };
}
