import { router } from 'expo-router';
import { useState } from 'react';
import { Button, Field, Screen, Text } from '@/ui/components';

const normalise = (v: string) => v.toUpperCase().replace(/[^0-9A-Z]/g, '');

/** Manual entry for an invitation code (when the guardian did not open the invite link). */
export default function EnterInvitationCode() {
  const [code, setCode] = useState('');
  const valid = normalise(code).length === 10;
  return (
    <Screen
      testID="invite-code-screen"
      footer={
        <Button
          testID="lookup-invite"
          title="Continue"
          disabled={!valid}
          onPress={() => router.push(`/invite/${normalise(code)}`)}
        />
      }
    >
      <Text variant="title">Enter your invitation code</Text>
      <Text variant="muted">
        The guardian who invited you received a 10-character code. It is also in the invitation
        link.
      </Text>
      <Field
        testID="invite-code-input"
        label="Invitation code"
        value={code}
        onChangeText={(t) => setCode(t.toUpperCase().slice(0, 14))}
        autoCapitalize="characters"
        autoCorrect={false}
        autoFocus
        placeholder="GRNFD7K2QX"
      />
    </Screen>
  );
}
