import { router } from 'expo-router';
import { Button, Card, Screen, Text } from '@/ui/components';
import { flow } from '@/features/flow-store';

export default function NoAccountScreen() {
  return (
    <Screen testID="no-account-screen">
      <Text variant="title">We couldn’t find your school</Text>
      <Text variant="muted">
        {flow.phone || 'This number'} isn’t registered as a guardian at any HomeBell school.
      </Text>
      <Card>
        <Text variant="label">What you can do</Text>
        <Text>• Ask your school’s front office to add or update your mobile number.</Text>
        <Text>• If a family member invited you, use “I have an invitation code”.</Text>
      </Card>
      <Button title="I have an invitation code" onPress={() => router.replace('/invite')} />
      <Button
        title="Try another number"
        variant="secondary"
        onPress={() => router.replace('/phone')}
      />
    </Screen>
  );
}
