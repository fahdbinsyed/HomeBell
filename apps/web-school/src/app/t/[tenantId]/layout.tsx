'use client';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { useCallback, type ReactNode } from 'react';
import type { Me, Permission } from '@homebell/contracts';
import { labels } from '@homebell/copy';
import { AppShell, Banner, Button, EmptyState, Logo } from '@homebell/ui-web';
import { RequireAuth, useLogout } from '@homebell/web-core';
import { SchoolProvider } from '@/lib/school';

const NAV: Array<{ path: string; label: string; perm: Permission }> = [
  { path: 'onboarding', label: 'Setup checklist', perm: 'school.settings.write' },
  { path: 'overview', label: 'Overview', perm: 'school.queue.read' },
  { path: 'queue', label: 'Live queue', perm: 'school.queue.read' },
  { path: 'students', label: 'Students', perm: 'school.students.read' },
  { path: 'guardians', label: 'Guardians', perm: 'school.guardians.read' },
  { path: 'staff', label: 'Staff & roles', perm: 'school.staff.manage' },
  { path: 'displays', label: 'Display screens', perm: 'school.displays.manage' },
  { path: 'reports', label: 'Reports', perm: 'school.reports.read' },
  { path: 'audit', label: 'Audit log', perm: 'school.audit.read' },
  { path: 'settings', label: 'Settings', perm: 'school.settings.read' },
  { path: 'subscription', label: 'Subscription', perm: 'school.subscription.read' },
];

function Shell({ me, tenantId, children }: { me: Me; tenantId: string; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const logout = useLogout();
  const m = me.memberships.find((x) => x.tenantId === tenantId);
  if (!m) {
    return (
      <div className="mx-auto max-w-lg p-10">
        <EmptyState
          title="School not found"
          description="You don't have access to this school, or it doesn't exist."
          action={<Button onClick={() => router.push('/select')}>Choose a school</Button>}
        />
      </div>
    );
  }
  const base = `/t/${tenantId}`;
  const isSupport = me.session.kind === 'support';
  const banners: ReactNode[] = [];
  if (isSupport)
    banners.push(
      <Banner key="support" tone="brand" title="HomeBell support session — read-only">
        You are viewing {m.tenantName} as HomeBell support. Changes are disabled and this session is
        audited.
      </Banner>,
    );
  if (m.operationalMode === 'read_only')
    banners.push(
      <Banner key="ro" tone="warning" title={`${labels.tenantState[m.tenantState]} — read-only`}>
        Guardians can't request pickups and changes are paused. Contact HomeBell to restore service.
      </Banner>,
    );
  if (m.operationalMode === 'blocked')
    banners.push(
      <Banner
        key="blocked"
        tone="danger"
        title={`Service ${labels.tenantState[m.tenantState].toLowerCase()}`}
      >
        HomeBell service for this school is not active. Contact HomeBell.
      </Banner>,
    );
  if (m.operationalMode === 'export_only')
    banners.push(
      <Banner key="off" tone="neutral" title="Offboarding">
        Only data export is available.
      </Banner>,
    );
  if (m.tenantState === 'trial') banners.push(<TrialBanner key="trial" tenantId={tenantId} />);

  return (
    <SchoolProvider tenantId={tenantId} me={me} membership={m}>
      <AppShell
        brand={
          <span className="flex flex-col">
            <Logo product="for Schools" endorsement={false} />
            <span className="mt-0.5 truncate text-xs text-text-muted">{m.tenantName}</span>
          </span>
        }
        nav={NAV.filter((n) => m.permissions.includes(n.perm)).map((n) => ({
          href: `${base}/${n.path}`,
          label: n.label,
          active: pathname.startsWith(`${base}/${n.path}`),
        }))}
        banner={banners.length ? banners : undefined}
        user={
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{me.fullName}</p>
              <p className="truncate text-xs text-text-muted">
                {isSupport ? 'HomeBell support' : labels.schoolRole[m.role]}
              </p>
            </div>
            <div className="flex flex-col items-end gap-1">
              {me.memberships.length > 1 && (
                <Button variant="ghost" size="sm" onClick={() => router.push('/select')}>
                  Switch
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  logout.mutate(undefined, { onSettled: () => router.replace('/login') })
                }
              >
                Sign out
              </Button>
            </div>
          </div>
        }
      >
        {children}
      </AppShell>
    </SchoolProvider>
  );
}

function TrialBanner({ tenantId }: { tenantId: string }) {
  const router = useRouter();
  return (
    <Banner
      tone="info"
      title="Trial"
      action={
        <Button
          size="sm"
          variant="secondary"
          onClick={() => router.push(`/t/${tenantId}/subscription`)}
        >
          View subscription
        </Button>
      }
    >
      This school is on a HomeBell trial. Check the subscription page for the end date.
    </Banner>
  );
}

export default function TenantLayout({ children }: { children: ReactNode }) {
  const { tenantId } = useParams<{ tenantId: string }>();
  const router = useRouter();
  const toLogin = useCallback(() => router.replace('/login'), [router]);
  return (
    <RequireAuth kinds={['staff', 'support']} onUnauthenticated={toLogin}>
      {(me) => (
        <Shell me={me} tenantId={tenantId}>
          {children}
        </Shell>
      )}
    </RequireAuth>
  );
}
