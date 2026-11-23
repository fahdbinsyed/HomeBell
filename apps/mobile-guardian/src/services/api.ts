import { newIdempotencyKey } from '@homebell/api-client';
import { ApiError } from '@homebell/api-client';
import { errorMessage } from '@homebell/copy';
import { useRef } from 'react';

export const messageFor = (e: unknown): string =>
  e instanceof ApiError ? errorMessage(e.code) : errorMessage(null);
export const codeOf = (e: unknown): string | null => (e instanceof ApiError ? e.code : null);
export const metaOf = (e: unknown): Record<string, unknown> =>
  e instanceof ApiError ? ((e.problem?.meta as Record<string, unknown>) ?? {}) : {};

/** One Idempotency-Key per user intent; `next()` after success (double taps reuse the key). */
export function useIdempotencyKey() {
  const ref = useRef(newIdempotencyKey());
  return { key: () => ref.current, next: () => (ref.current = newIdempotencyKey()) };
}

export const keys = {
  children: ['me', 'children'] as const,
  history: ['me', 'history'] as const,
  pickup: (id: string) => ['me', 'pickup', id] as const,
  notifications: ['me', 'notifications'] as const,
  guardians: ['me', 'guardians'] as const,
  seats: ['me', 'seats'] as const,
  device: ['me', 'device'] as const,
};
