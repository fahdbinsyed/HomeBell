'use client';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect } from 'react';
import { labels } from '@homebell/copy';
import { AuthLayout, Button, EmptyState, Logo, StateBadge } from '@homebell/ui-web';
import { RequireAuth, useLogout } from '@homebell/web-core';
import type { Me } from '@homebell/contracts';

function Picker({ me }: { me: Me }) {
  const router = useRouter();
  const logout = useLogout();
  const only = me.memberships.length === 1 ? me.memberships[0] : null;
  // Scanning a display's QR code lands here with ?pairDisplay=CODE.
  const target = (tenantId: string) => {
    const code =
      typeof window === 'undefined'
        ? null
        : new URLSearchParams(window.location.search).get('pairDisplay');
    return code
      ? `/t/${tenantId}/displays?pair=${encodeURIComponent(code)}`
      : `/t/${tenantId}/overview`;
  };
  useEffect(() => {
    if (only) router.replace(target(only.tenantId));
  }, [only, router]);
  if (only) return null;
  return (
    <AuthLayout
      brand={<Logo product="for Schools" />}
      title="Choose a school"
      subtitle={`Signed in as ${me.fullName}`}
      footer={
        <button
          type="button"
          className="underline"
          onClick={() => logout.mutate(undefined, { onSettled: () => router.replace('/login') })}
        >
          Sign out
        </button>
      }
    >
      {me.memberships.length === 0 ? (
        <EmptyState
          title="No school access"
          description="Your account isn't linked to an active school. Ask your school admin to invite you."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {me.memberships.map((m) => (
            <li key={m.membershipId}>
              <Button
                variant="secondary"
                className="h-auto w-full justify-between py-3"
                onClick={() => router.push(target(m.tenantId))}
              >
                <span className="text-left">
                  <span className="block font-semibold">{m.tenantName}</span>
                  <span className="block text-xs text-text-muted">{labels.schoolRole[m.role]}</span>
                </span>
                <StateBadge
                  group="tenant"
                  value={m.tenantState}
                  label={labels.tenantState[m.tenantState]}
                />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </AuthLayout>
  );
}

export default function SelectSchoolPage() {
  const router = useRouter();
  const toLogin = useCallback(() => router.replace('/login'), [router]);
  return (
    <RequireAuth kinds={['staff', 'support']} onUnauthenticated={toLogin}>
      {(me) => <Picker me={me} />}
    </RequireAuth>
  );
}
