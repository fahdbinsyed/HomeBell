'use client';
import { createContext, useContext, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { unwrap } from '@homebell/api-client';
import type {
  EffectiveEntitlements,
  FeatureKey,
  Me,
  Permission,
  TenantMembershipSummary,
} from '@homebell/contracts';
import { useApi } from '@homebell/web-core';

export interface SchoolContextValue {
  tenantId: string;
  me: Me;
  membership: TenantMembershipSummary;
  isSupport: boolean;
  /** Writes are possible (operational + not read-only + not support). */
  canWrite: boolean;
  can: (p: Permission) => boolean;
  has: (f: FeatureKey) => boolean;
  entitlements: EffectiveEntitlements | undefined;
}

const SchoolContext = createContext<SchoolContextValue | null>(null);
export const useSchool = (): SchoolContextValue => {
  const v = useContext(SchoolContext);
  if (!v) throw new Error('useSchool outside a school route');
  return v;
};

export function SchoolProvider({
  tenantId,
  me,
  membership,
  children,
}: {
  tenantId: string;
  me: Me;
  membership: TenantMembershipSummary;
  children: ReactNode;
}) {
  const { client } = useApi();
  const ent = useQuery({
    queryKey: ['school', tenantId, 'entitlements'],
    queryFn: () =>
      unwrap(client.GET('/v1/t/{tenantId}/entitlements', { params: { path: { tenantId } } })),
  });
  const isSupport = me.session.kind === 'support';
  const value: SchoolContextValue = {
    tenantId,
    me,
    membership,
    isSupport,
    canWrite:
      !isSupport &&
      (membership.operationalMode === 'full' || membership.operationalMode === 'setup'),
    can: (p) => membership.permissions.includes(p),
    has: (f) => ent.data?.features.find((x) => x.key === f)?.enabled ?? false,
    entitlements: ent.data,
  };
  return <SchoolContext.Provider value={value}>{children}</SchoolContext.Provider>;
}

export const schoolKey = (tenantId: string, ...parts: unknown[]) =>
  ['school', tenantId, ...parts] as const;
