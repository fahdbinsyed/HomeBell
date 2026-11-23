'use client';
import { useParams, usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { ErrorState, LoadingState, PageHeader, TabLinks } from '@homebell/ui-web';
import { messageFor } from '@homebell/web-core';
import { TenantFlags, TenantStateBadge } from '@/components/tenant-bits';
import { useTenant } from '@/lib/use-platform';

const TABS = [
  ['', 'Overview'],
  ['lifecycle', 'Lifecycle'],
  ['subscription', 'Plan & subscription'],
  ['entitlements', 'Entitlements'],
  ['usage', 'Usage & limits'],
  ['notes', 'Notes'],
  ['audit', 'Audit'],
] as const;

export default function TenantLayout({ children }: { children: ReactNode }) {
  const { tenantId } = useParams<{ tenantId: string }>();
  const pathname = usePathname();
  const tenant = useTenant(tenantId);
  const base = `/tenants/${tenantId}`;
  const active = pathname === base ? '' : (pathname.slice(base.length + 1).split('/')[0] ?? '');

  if (tenant.isPending) return <LoadingState rows={6} />;
  if (tenant.error)
    return <ErrorState message={messageFor(tenant.error)} onRetry={() => tenant.refetch()} />;
  const t = tenant.data;
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Schools', href: '/tenants' }, { label: t.name }]}
        title={t.name}
        badge={
          <span className="flex items-center gap-2">
            <TenantStateBadge state={t.state} />
            <TenantFlags flags={t.flags} />
          </span>
        }
        description={`${t.slug} · ${t.timezone} · ${t.region}`}
      />
      <TabLinks
        active={active}
        tabs={TABS.map(([k, label]) => ({ key: k, label, href: k ? `${base}/${k}` : base }))}
      />
      {children}
    </>
  );
}
