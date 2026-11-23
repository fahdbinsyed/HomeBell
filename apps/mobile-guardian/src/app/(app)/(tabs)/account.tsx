import { router } from 'expo-router';
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { unwrap } from '@homebell/api-client';
import { labels } from '@homebell/copy';
import { messageFor } from '@/services/api';
import { useServices, useSession } from '@/services/session';
import { Banner, Button, Card, Field, Row, Screen, StateBadge, Text } from '@/ui/components';

export default function AccountScreen() {
  const { me, signOut, refreshMe } = useSession();
  const { client, mock } = useServices();
  const [name, setName] = useState(me?.fullName ?? '');
  const save = useMutation({
    mutationFn: () => unwrap(client.PATCH('/v1/me/profile', { body: { fullName: name.trim() } })),
    onSuccess: () => refreshMe(),
  });
  return (
    <Screen testID="account-screen">
      <Text variant="title">Account</Text>
      <Card>
        <Text variant="label">Signed in as</Text>
        <Text>
          {me?.fullName} · {me?.maskedPhone}
        </Text>
      </Card>
      <Card>
        <Text variant="label">Schools</Text>
        {me?.guardianProfiles.map((p) => (
          <Row key={p.guardianId} style={{ justifyContent: 'space-between' }}>
            <Text>
              {p.tenantName} · {p.kind === 'primary' ? 'Primary' : 'Additional'}
            </Text>
            <StateBadge group="guardian" value={p.state} label={labels.guardianState[p.state]} />
          </Row>
        ))}
      </Card>
      {save.error && <Banner tone="danger" message={messageFor(save.error)} />}
      <Field label="Display name" value={name} onChangeText={setName} autoComplete="name" />
      <Button
        title="Save name"
        variant="secondary"
        loading={save.isPending}
        disabled={!name.trim() || name.trim() === me?.fullName}
        onPress={() => save.mutate()}
      />
      <Button
        testID="open-device"
        title="This phone & device transfers"
        variant="secondary"
        onPress={() => router.push('/device')}
      />
      {mock && (
        <Button
          testID="open-developer"
          title="Developer: mock scenarios"
          variant="ghost"
          onPress={() => router.push('/developer')}
        />
      )}
      <Button testID="sign-out" title="Sign out" variant="danger" onPress={() => signOut()} />
    </Screen>
  );
}
