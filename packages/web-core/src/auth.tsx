'use client';
import { useEffect, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, unwrap } from '@homebell/api-client';
import type { Me, StaffLoginResult } from '@homebell/contracts';
import { Spinner } from '@homebell/ui-web';
import { useApi } from './api';

export const meKey = ['auth', 'me'] as const;

/** Current identity, or null when signed out. */
export function useMe() {
  const { client } = useApi();
  return useQuery({
    queryKey: meKey,
    queryFn: async (): Promise<Me | null> => {
      try {
        return await unwrap(client.GET('/v1/auth/me'));
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 60_000,
  });
}

export function useStaffLogin(audience: 'school' | 'platform') {
  const { client } = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { email: string; password: string }) =>
      unwrap(client.POST('/v1/auth/staff/login', { body: { ...v, audience } })),
    onSuccess: (r: StaffLoginResult) => {
      if (r.status === 'authenticated') qc.setQueryData(meKey, r.me);
    },
  });
}

export function useMfaVerify() {
  const { client } = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { mfaToken: string; code: string }) =>
      unwrap(client.POST('/v1/auth/staff/mfa/verify', { body: v })),
    onSuccess: (r) => qc.setQueryData(meKey, r.me),
  });
}

export function useMfaEnroll() {
  const { client } = useApi();
  const qc = useQueryClient();
  const start = useMutation({
    mutationFn: (enrollmentToken: string) =>
      unwrap(client.POST('/v1/auth/staff/mfa/enroll', { body: { enrollmentToken } })),
  });
  const confirm = useMutation({
    mutationFn: (v: { enrollmentToken: string; enrollmentId: string; code: string }) =>
      unwrap(client.POST('/v1/auth/staff/mfa/enroll/confirm', { body: v })),
    onSuccess: (r) => qc.setQueryData(meKey, r.me),
  });
  return { start, confirm };
}

export function useLogout() {
  const { client } = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      try {
        await unwrap(client.POST('/v1/auth/logout'));
      } catch {
        /* signing out locally regardless */
      }
    },
    onSettled: () => {
      qc.clear();
      qc.setQueryData(meKey, null);
    },
  });
}

/** Renders children only for a signed-in user of the expected session kind. */
export function RequireAuth({
  kinds,
  onUnauthenticated,
  children,
}: {
  kinds: Array<Me['session']['kind']>;
  onUnauthenticated: () => void;
  children: (me: Me) => ReactNode;
}) {
  const me = useMe();
  const ok = me.data && kinds.includes(me.data.session.kind);
  useEffect(() => {
    if (me.isSuccess && !ok) onUnauthenticated();
  }, [me.isSuccess, ok, onUnauthenticated]);
  if (me.isPending) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner label="Loading…" />
      </div>
    );
  }
  if (!ok) return null;
  return <>{children(me.data!)}</>;
}
