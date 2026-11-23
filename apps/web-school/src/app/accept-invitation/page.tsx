'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@homebell/api-client';
import { formatDate, labels } from '@homebell/copy';
import { AuthLayout, Banner, Button, Field, Input, Logo, Spinner } from '@homebell/ui-web';
import { meKey, messageFor, useApi } from '@homebell/web-core';

function AcceptInvitation() {
  const token = useSearchParams().get('token') ?? '';
  const { client } = useApi();
  const router = useRouter();
  const qc = useQueryClient();
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const preview = useQuery({
    queryKey: ['staff-invitation', token],
    queryFn: () => unwrap(client.POST('/v1/auth/staff/invitations/preview', { body: { token } })),
    enabled: !!token,
    retry: false,
  });
  const accept = useMutation({
    mutationFn: () =>
      unwrap(
        client.POST('/v1/auth/staff/invitations/accept', {
          body: { token, fullName: fullName || undefined, password },
        }),
      ),
    onSuccess: (r) => {
      if (r.status === 'authenticated') qc.setQueryData(meKey, r.me);
      router.replace(r.status === 'authenticated' ? '/select' : '/login');
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    accept.mutate();
  };
  const p = preview.data;
  return (
    <AuthLayout
      brand={<Logo product="for Schools" />}
      title="Join your school on HomeBell"
      subtitle={
        p ? `${p.tenantName} invited ${p.email} as ${labels.schoolRole[p.role]}.` : undefined
      }
    >
      {!token ? (
        <Banner tone="danger">This link is missing its invitation token.</Banner>
      ) : preview.isPending ? (
        <Spinner label="Checking invitation…" />
      ) : preview.error ? (
        <Banner tone="danger">{messageFor(preview.error)}</Banner>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4">
          {accept.error && <Banner tone="danger">{messageFor(accept.error)}</Banner>}
          <p className="text-xs text-text-muted">Invitation expires {formatDate(p!.expiresAt)}.</p>
          {!p!.accountExists && (
            <Field label="Your name">
              {(f) => (
                <Input {...f} value={fullName} onChange={(e) => setFullName(e.target.value)} />
              )}
            </Field>
          )}
          <Field
            label={p!.accountExists ? 'Your existing password' : 'Choose a password'}
            hint={p!.accountExists ? undefined : 'At least 12 characters.'}
          >
            {(f) => (
              <Input
                {...f}
                type="password"
                autoComplete={p!.accountExists ? 'current-password' : 'new-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            )}
          </Field>
          <Button
            type="submit"
            size="lg"
            loading={accept.isPending}
            disabled={p!.accountExists ? !password : password.length < 12}
          >
            Accept invitation
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}

export default function AcceptInvitationPage() {
  return (
    <Suspense>
      <AcceptInvitation />
    </Suspense>
  );
}
