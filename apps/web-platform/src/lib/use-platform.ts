'use client';
import { useQuery } from '@tanstack/react-query';
import { unwrap } from '@homebell/api-client';
import type { Permission } from '@homebell/contracts';
import { useApi, useMe } from '@homebell/web-core';

export const keys = {
  tenants: (f: unknown) => ['platform', 'tenants', f] as const,
  tenant: (id: string) => ['platform', 'tenant', id] as const,
  tenantPart: (id: string, part: string) => ['platform', 'tenant', id, part] as const,
  plans: ['platform', 'plans'] as const,
  flags: ['platform', 'flags'] as const,
};

export function useCan() {
  const me = useMe();
  return (p: Permission) => me.data?.platformPermissions.includes(p) ?? false;
}

export function useTenant(tenantId: string) {
  const { client } = useApi();
  return useQuery({
    queryKey: keys.tenant(tenantId),
    queryFn: () =>
      unwrap(client.GET('/v1/platform/tenants/{tenantId}', { params: { path: { tenantId } } })),
  });
}

export function usePlans() {
  const { client } = useApi();
  return useQuery({
    queryKey: keys.plans,
    queryFn: () => unwrap(client.GET('/v1/platform/plans')),
  });
}

/** Convert an <input type="date"> value to an end-of-day ISO timestamp. */
export const dateToIso = (d: string) => (d ? new Date(`${d}T23:59:59`).toISOString() : undefined);
export const isoToDate = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : '');
