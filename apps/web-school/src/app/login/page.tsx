'use client';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { AuthLayout, Banner, Button, Field, Input, Logo } from '@homebell/ui-web';
import { messageFor, useMfaVerify, useStaffLogin } from '@homebell/web-core';

export default function SchoolLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const login = useStaffLogin('school');
  const mfa = useMfaVerify();
  const error = login.error ?? mfa.error;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (mfaToken) {
      if (await mfa.mutateAsync({ mfaToken, code: code.trim() }).catch(() => null))
        router.replace('/select');
      return;
    }
    const r = await login.mutateAsync({ email, password }).catch(() => null);
    if (!r) return;
    if (r.status === 'authenticated') router.replace('/select');
    else if (r.status === 'mfa_required') setMfaToken(r.mfaToken);
  };

  return (
    <AuthLayout
      brand={<Logo product="for Schools" />}
      title={mfaToken ? 'Two-step verification' : 'Sign in'}
      subtitle={
        mfaToken
          ? 'Enter the code from your authenticator app.'
          : 'School staff sign-in. Guardians use the HomeBell mobile app.'
      }
      footer="Safer dismissal, smoother pickup."
    >
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {error && <Banner tone="danger">{messageFor(error)}</Banner>}
        {mfaToken ? (
          <Field label="Authentication code">
            {(p) => (
              <Input
                {...p}
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            )}
          </Field>
        ) : (
          <>
            <Field label="Email" required>
              {(p) => (
                <Input
                  {...p}
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              )}
            </Field>
            <Field label="Password" required>
              {(p) => (
                <Input
                  {...p}
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              )}
            </Field>
          </>
        )}
        <Button
          type="submit"
          size="lg"
          loading={login.isPending || mfa.isPending}
          disabled={mfaToken ? code.trim().length < 6 : !email || !password}
        >
          {mfaToken ? 'Verify' : 'Sign in'}
        </Button>
      </form>
    </AuthLayout>
  );
}
