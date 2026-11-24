import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { unwrap } from '@homebell/api-client';
import { codeOf, messageFor, metaOf } from '@/services/api';
import { useServices, useSession } from '@/services/session';
import { flow } from '@/features/flow-store';
import { Banner, Button, OtpField, Screen, Text } from '@/ui/components';

export default function VerifyScreen() {
  const { client, device } = useServices();
  const { signIn } = useSession();
  const [code, setCode] = useState('');
  const [challenge, setChallenge] = useState(flow.challenge);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const h = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(h);
  }, []);
  // The code is passed to mutate() explicitly: auto-submit fires in the same tick as the last
  // keystroke, before React re-renders, so reading `code` from the closure would send 5 digits.
  const verify = useMutation({
    mutationFn: async (value: string) =>
      unwrap(
        client.POST('/v1/auth/otp/verify', {
          body: {
            challengeId: challenge!.challengeId,
            code: value,
            device: await device.getDeviceInfo(),
          },
        }),
      ),
    onSuccess: async (r) => {
      if (r.outcome === 'authenticated') {
        await signIn(r.tokens, r.me);
        router.replace('/');
      } else if (r.outcome === 'device_conflict') {
        flow.conflict = r.conflict;
        router.replace('/device-conflict');
      } else router.replace('/no-account');
    },
    onError: () => setCode(''),
  });
  const resend = useMutation({
    mutationFn: () =>
      unwrap(client.POST('/v1/auth/otp/resend', { body: { challengeId: challenge!.challengeId } })),
    onSuccess: (c) => {
      // A fresh code was sent: drop the old "wrong code" error and attempts count.
      verify.reset();
      setCode('');
      setChallenge(c);
    },
  });
  if (!challenge)
    return (
      <Screen>
        <Banner tone="warning" message="Start again by entering your phone number." />
        <Button title="Back" onPress={() => router.replace('/phone')} />
      </Screen>
    );
  const wait = Math.max(0, Math.ceil((Date.parse(challenge.resendAvailableAt) - now) / 1000));
  const err = verify.error ?? resend.error;
  const remaining =
    codeOf(verify.error) === 'OTP_INVALID' ? metaOf(verify.error).remainingAttempts : undefined;
  const dead = ['OTP_EXPIRED', 'OTP_ATTEMPTS_EXCEEDED', 'OTP_CHALLENGE_NOT_FOUND'].includes(
    codeOf(verify.error) ?? '',
  );
  return (
    <Screen
      testID="verify-screen"
      footer={
        <Button
          testID="verify-code"
          title="Verify"
          loading={verify.isPending}
          disabled={code.length !== 6 || dead}
          onPress={() => verify.mutate(code)}
        />
      }
    >
      <Text variant="title">Enter the code</Text>
      <Text variant="muted">
        We sent a 6-digit code to {challenge.maskedPhone}. It expires in 5 minutes.
      </Text>
      {err && (
        <Banner
          tone="danger"
          message={`${messageFor(err)}${typeof remaining === 'number' ? ` ${remaining} attempt${remaining === 1 ? '' : 's'} left.` : ''}`}
        />
      )}
      <OtpField
        testID="otp-input"
        value={code}
        onChange={(v) => {
          setCode(v);
          if (v.length === 6 && !verify.isPending) verify.mutate(v);
        }}
      />
      <Button
        testID="resend-code"
        title={wait > 0 ? `Resend code in ${wait}s` : 'Resend code'}
        variant="ghost"
        disabled={wait > 0}
        loading={resend.isPending}
        onPress={() => resend.mutate()}
      />
      <Text variant="small">
        {challenge.remainingSends} more code{challenge.remainingSends === 1 ? '' : 's'} can be sent
        in the next 15 minutes.
      </Text>
      {dead && (
        <Button
          title="Request a new code"
          variant="secondary"
          onPress={() => router.replace('/phone')}
        />
      )}
    </Screen>
  );
}
