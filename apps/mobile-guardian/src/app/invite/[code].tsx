import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { unwrap } from '@homebell/api-client';
import { formatDate, labels } from '@homebell/copy';
import { messageFor, useIdempotencyKey } from '@/services/api';
import { useServices, useSession } from '@/services/session';
import { flow, toE164 } from '@/features/flow-store';
import {
  Banner,
  Button,
  Card,
  ErrorView,
  Field,
  LoadingView,
  OtpField,
  Screen,
  Text,
} from '@/ui/components';

/**
 * Invitation redemption (brief §8.3). Reached from the code screen or a deep link:
 * homebell://invite/CODE, https://homebell.app/invite/CODE (Android App Links / iOS Universal Links).
 * The OTP goes ONLY to the invited number.
 */
export default function RedeemInvitation() {
  const { code: raw } = useLocalSearchParams<{ code: string }>();
  const code = String(raw ?? '')
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '');
  const { client, device } = useServices();
  const { status, signIn, signOut } = useSession();
  const idem = useIdempotencyKey();
  const [phone, setPhone] = useState('');
  const [fullName, setFullName] = useState('');
  const [otp, setOtp] = useState('');
  const [challengeId, setChallengeId] = useState<string | null>(null);

  const preview = useQuery({
    queryKey: ['invite', code],
    queryFn: () => unwrap(client.POST('/v1/invitations/lookup', { body: { code } })),
    retry: false,
    enabled: code.length >= 10,
  });
  const sendOtp = useMutation({
    mutationFn: () =>
      unwrap(
        client.POST('/v1/invitations/{invitationId}/otp', {
          params: { path: { invitationId: preview.data!.invitationId } },
          body: { code, phone: toE164(phone) },
        }),
      ),
    onSuccess: (c) => setChallengeId(c.challengeId),
  });
  const redeem = useMutation({
    mutationFn: async () =>
      unwrap(
        client.POST('/v1/invitations/{invitationId}/redeem', {
          params: {
            path: { invitationId: preview.data!.invitationId },
            header: { 'Idempotency-Key': idem.key() },
          },
          body: {
            challengeId: challengeId!,
            otpCode: otp,
            device: await device.getDeviceInfo(),
            fullName: fullName.trim() || undefined,
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
      }
    },
  });

  if (status === 'signedIn') {
    return (
      <Screen>
        <Banner
          tone="info"
          title="You’re already signed in"
          message="Invitations create a separate account for the invited person. Sign out first if this phone belongs to them."
        />
        <Button title="Sign out" variant="secondary" onPress={() => signOut()} />
        <Button title="Back" variant="ghost" onPress={() => router.replace('/')} />
      </Screen>
    );
  }
  if (preview.isPending) return <LoadingView label="Checking invitation…" />;
  if (preview.error)
    return (
      <Screen>
        <ErrorView message={messageFor(preview.error)} />
        <Button
          title="Enter a different code"
          variant="secondary"
          onPress={() => router.replace('/invite')}
        />
      </Screen>
    );
  const p = preview.data;
  const err = sendOtp.error ?? redeem.error;
  return (
    <Screen testID="redeem-invite-screen">
      <Text variant="title">{p.inviterFirstName} invited you</Text>
      <Card>
        <Text variant="label">{p.tenantName}</Text>
        <Text>
          Pickup for {p.studentFirstNames.join(' and ')} as{' '}
          {labels.relationship[p.relationship].toLowerCase()}.
        </Text>
        {p.validity && (
          <Text variant="muted">
            Access: {labels.validityMode[p.validity.mode]}
            {p.validity.durationDays ? ` (${p.validity.durationDays} days)` : ''}
          </Text>
        )}
        <Text variant="small">
          Invitation expires {formatDate(p.expiresAt)}. Sent to {p.maskedPhone}.
        </Text>
      </Card>
      {err && <Banner tone="danger" message={messageFor(err)} />}
      {!challengeId ? (
        <>
          <Field
            testID="invite-phone"
            label="Confirm your mobile number"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            autoComplete="tel"
            hint={`It must match ${p.maskedPhone}.`}
          />
          <Field
            label="Your name (optional)"
            value={fullName}
            onChangeText={setFullName}
            autoComplete="name"
          />
          <Button
            testID="invite-send-code"
            title="Send code to this number"
            loading={sendOtp.isPending}
            disabled={phone.replace(/\D/g, '').length < 10}
            onPress={() => sendOtp.mutate()}
          />
        </>
      ) : (
        <>
          <OtpField testID="invite-otp" value={otp} onChange={setOtp} />
          <Button
            testID="invite-redeem"
            title="Accept invitation"
            loading={redeem.isPending}
            disabled={otp.length !== 6}
            onPress={() => redeem.mutate()}
          />
        </>
      )}
      <Text variant="small">
        You’ll get your own HomeBell account. Sharing logins isn’t allowed.
      </Text>
    </Screen>
  );
}
