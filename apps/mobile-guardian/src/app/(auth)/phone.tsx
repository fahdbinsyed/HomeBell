import { router } from 'expo-router';
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { unwrap } from '@homebell/api-client';
import { codeOf, messageFor, metaOf } from '@/services/api';
import { useServices } from '@/services/session';
import { flow, toE164 } from '@/features/flow-store';
import { Banner, Button, Field, Screen, Text } from '@/ui/components';

export default function PhoneScreen() {
  const { client } = useServices();
  const [phone, setPhone] = useState(flow.phone);
  const send = useMutation({
    mutationFn: (e164: string) =>
      unwrap(client.POST('/v1/auth/otp/send', { body: { phone: e164, purpose: 'login' } })),
    onSuccess: (challenge, e164) => {
      flow.phone = e164;
      flow.challenge = challenge;
      router.push('/verify');
    },
  });
  const e164 = toE164(phone);
  const valid = /^\+[1-9]\d{6,14}$/.test(e164);
  const err = send.error;
  return (
    <Screen
      testID="phone-screen"
      footer={
        <Button
          testID="send-code"
          title="Send code"
          loading={send.isPending}
          disabled={!valid}
          onPress={() => send.mutate(e164)}
        />
      }
    >
      <Text variant="title">What’s your mobile number?</Text>
      <Text variant="muted">
        Use the number your school has on file. We’ll text you a 6-digit code.
      </Text>
      {err && (
        <Banner
          tone="danger"
          message={
            codeOf(err) === 'OTP_LOCKED' && metaOf(err).lockedUntil
              ? `${messageFor(err)} Try again after ${new Date(String(metaOf(err).lockedUntil)).toLocaleTimeString()}.`
              : messageFor(err)
          }
        />
      )}
      <Field
        testID="phone-input"
        label="Mobile number"
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        textContentType="telephoneNumber"
        autoComplete="tel"
        placeholder="+1 555 010 0001"
        hint="Include your country code."
        autoFocus
      />
    </Screen>
  );
}
