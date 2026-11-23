'use client';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { AuthLayout, Banner, Button, Field, Input, Logo } from '@homebell/ui-web';
import { messageFor, useMfaEnroll, useMfaVerify, useStaffLogin } from '@homebell/web-core';

type Step =
  | { kind: 'password' }
  | { kind: 'mfa'; token: string }
  | { kind: 'enroll'; token: string; enrollmentId?: string; secret?: string }
  | { kind: 'recovery'; codes: string[] };

export default function LoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>({ kind: 'password' });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const login = useStaffLogin('platform');
  const mfa = useMfaVerify();
  const enroll = useMfaEnroll();
  const error = login.error ?? mfa.error ?? enroll.start.error ?? enroll.confirm.error;

  const submitPassword = async (e: FormEvent) => {
    e.preventDefault();
    const r = await login.mutateAsync({ email, password }).catch(() => null);
    if (!r) return;
    if (r.status === 'authenticated') router.replace('/tenants');
    else if (r.status === 'mfa_required') setStep({ kind: 'mfa', token: r.mfaToken });
    else {
      const s = await enroll.start.mutateAsync(r.enrollmentToken).catch(() => null);
      setStep({
        kind: 'enroll',
        token: r.enrollmentToken,
        enrollmentId: s?.enrollmentId,
        secret: s?.secret,
      });
    }
  };
  const submitMfa = async (e: FormEvent) => {
    e.preventDefault();
    if (step.kind !== 'mfa') return;
    if (await mfa.mutateAsync({ mfaToken: step.token, code: code.trim() }).catch(() => null))
      router.replace('/tenants');
  };
  const submitEnroll = async (e: FormEvent) => {
    e.preventDefault();
    if (step.kind !== 'enroll' || !step.enrollmentId) return;
    const r = await enroll.confirm
      .mutateAsync({
        enrollmentToken: step.token,
        enrollmentId: step.enrollmentId,
        code: code.trim(),
      })
      .catch(() => null);
    if (r) setStep({ kind: 'recovery', codes: r.recoveryCodes });
  };

  return (
    <AuthLayout
      brand={<Logo product="Platform" />}
      title={
        step.kind === 'password'
          ? 'Sign in to the control panel'
          : step.kind === 'mfa'
            ? 'Two-step verification'
            : step.kind === 'enroll'
              ? 'Set up two-step verification'
              : 'Save your recovery codes'
      }
      subtitle={
        step.kind === 'password'
          ? 'For HomeBell platform operators only.'
          : step.kind === 'mfa'
            ? 'Enter the 6-digit code from your authenticator app.'
            : undefined
      }
      footer="Access is logged and audited."
    >
      {error && (
        <div className="mb-4">
          <Banner tone="danger">{messageFor(error)}</Banner>
        </div>
      )}
      {step.kind === 'password' && (
        <form onSubmit={submitPassword} className="flex flex-col gap-4" noValidate>
          <Field label="Work email" required>
            {(p) => (
              <Input
                {...p}
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
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
                required
              />
            )}
          </Field>
          <Button
            type="submit"
            size="lg"
            loading={login.isPending || enroll.start.isPending}
            disabled={!email || !password}
          >
            Continue
          </Button>
        </form>
      )}
      {step.kind === 'mfa' && (
        <form onSubmit={submitMfa} className="flex flex-col gap-4">
          <Field label="Authentication code" hint="Or enter a recovery code (XXXX-XXXX).">
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
          <Button type="submit" size="lg" loading={mfa.isPending} disabled={code.trim().length < 6}>
            Verify
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setStep({ kind: 'password' });
              setCode('');
            }}
          >
            Use a different account
          </Button>
        </form>
      )}
      {step.kind === 'enroll' && (
        <form onSubmit={submitEnroll} className="flex flex-col gap-4">
          <p className="text-sm text-text-muted">
            Platform accounts require an authenticator app. Add this key to your app, then enter the
            code it shows.
          </p>
          <code className="rounded-md bg-surface-muted px-3 py-2 text-center font-mono text-sm tracking-widest">
            {step.secret ?? '…'}
          </code>
          <Field label="Authentication code">
            {(p) => (
              <Input
                {...p}
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            )}
          </Field>
          <Button
            type="submit"
            size="lg"
            loading={enroll.confirm.isPending}
            disabled={code.trim().length !== 6}
          >
            Turn on two-step verification
          </Button>
        </form>
      )}
      {step.kind === 'recovery' && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-text-muted">
            Store these codes somewhere safe. Each can be used once if you lose your authenticator.
          </p>
          <ul className="grid grid-cols-2 gap-2 font-mono text-sm">
            {step.codes.map((c) => (
              <li key={c} className="rounded bg-surface-muted px-2 py-1 text-center">
                {c}
              </li>
            ))}
          </ul>
          <Button size="lg" onClick={() => router.replace('/tenants')}>
            I saved them — continue
          </Button>
        </div>
      )}
    </AuthLayout>
  );
}
