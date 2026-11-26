import { router } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { unwrap } from '@homebell/api-client';
import { messageFor } from '@/services/api';
import { useServices, useSession } from '@/services/session';
import { Banner, Button, Card, Screen, Text } from '@/ui/components';

export default function TermsScreen() {
  const { client } = useServices();
  const { me, refreshMe, signOut } = useSession();
  const accept = useMutation({
    mutationFn: () =>
      unwrap(
        client.POST('/v1/me/terms-acceptance', {
          body: { termsVersion: me?.currentTermsVersion ?? '' },
        }),
      ),
    onSuccess: async () => {
      await refreshMe();
      router.replace('/home');
    },
  });
  return (
    <Screen
      testID="terms-screen"
      footer={
        <Button
          testID="accept-terms"
          title="I agree"
          loading={accept.isPending}
          onPress={() => accept.mutate()}
        />
      }
    >
      <Text variant="title">Before you start</Text>
      {accept.error && <Banner tone="danger" message={messageFor(accept.error)} />}
      <Card>
        <Text variant="label">How HomeBell works</Text>
        <Text>
          Your school uses HomeBell to coordinate dismissal. When you request pickup, the school
          sees your request straight away. You confirm in the app once your child is with you.
        </Text>
        <Text>
          HomeBell records requests and confirmations. It doesn’t verify who physically collects a
          child — follow your school’s pickup rules.
        </Text>
      </Card>
      <Card>
        <Text variant="label">Your data</Text>
        <Text>
          Your school controls your family’s data. HomeBell stores your name, phone number, pickup
          activity and this phone’s identifier to keep your account secure.
        </Text>
      </Card>
      <Button title="Not now — sign out" variant="ghost" onPress={() => signOut()} />
    </Screen>
  );
}
