import { router } from 'expo-router';
import { useState } from 'react';
import { Button, Field, Screen, Text } from '@/ui/components';

export default function EnterInviteCode() {
  const [code, setCode] = useState('');
  const clean = code.toUpperCase().replace(/[^0-9A-Z]/g, '');
  return (
    <Screen
      testID="invite-code-screen"
      footer={
        <Button
          testID="lookup-invite"
          title="Continue"
          disabled={clean.length !== 10}
          onPress={() => router.push({ pathname: '/invite/[code]', params: { code: clean } })}
        />
      }
    >
      <Text variant="title">Accept an invitation</Text>
      <Text variant="muted">
        A primary guardian invited you to help with pickup. Enter the 10-character code they shared,
        or open their invitation link on this phone.
      </Text>
      <Field
        testID="invite-code-input"
        label="Invitation code"
        value={code}
        onChangeText={setCode}
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={12}
        placeholder="GRNFD-7K2QX"
        style={{ fontSize: 22, letterSpacing: 4 }}
      />
    </Screen>
  );
}
