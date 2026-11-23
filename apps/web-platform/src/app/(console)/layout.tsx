'use client';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, type ReactNode } from 'react';
import { labels } from '@homebell/copy';
import { AppShell, Button, Logo } from '@homebell/ui-web';
import { RequireAuth, useLogout } from '@homebell/web-core';

const NAV = [
  { href: '/tenants', label: 'Schools' },
  { href: '/plans', label: 'Plans' },
  { href: '/feature-flags', label: 'Feature flags' },
  { href: '/device-transfers', label: 'Device transfers' },
  { href: '/support', label: 'Support sessions' },
  { href: '/audit', label: 'Audit log' },
  { href: '/users', label: 'Platform users' },
];

export default function ConsoleLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const logout = useLogout();
  const toLogin = useCallback(() => router.replace(`/login`), [router]);
  return (
    <RequireAuth kinds={['platform']} onUnauthenticated={toLogin}>
      {(me) => (
        <AppShell
          brand={<Logo product="Platform" />}
          nav={NAV.map((n) => ({
            ...n,
            active: pathname === n.href || pathname.startsWith(`${n.href}/`),
          }))}
          user={
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{me.fullName}</p>
                <p className="truncate text-xs text-text-muted">
                  {me.platformRoles.map((r) => labels.platformRole[r]).join(', ')}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => logout.mutate(undefined, { onSettled: toLogin })}
              >
                Sign out
              </Button>
            </div>
          }
        >
          {children}
        </AppShell>
      )}
    </RequireAuth>
  );
}
