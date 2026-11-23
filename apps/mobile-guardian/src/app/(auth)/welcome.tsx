import { router } from 'expo-router';
import { View } from 'react-native';
import { errorMessage } from '@homebell/copy';
import { useSession } from '@/services/session';
import { Banner, Button, Screen, Text } from '@/ui/components';
import { useTheme } from '@/ui/theme';

export default function Welcome() {
  const { signOutReason } = useSession();
  const { c, radius } = useTheme();
  return (
    <Screen testID="welcome-screen">
      <View style={{ alignItems: 'center', gap: 12, paddingTop: 48, paddingBottom: 24 }}>
        <View
          accessible
          accessibilityLabel="HomeBell logo"
          style={{
            width: 72,
            height: 72,
            borderRadius: radius.xl,
            backgroundColor: c.primary,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ color: c.primaryText, fontSize: 34 }}>🔔</Text>
        </View>
        <Text variant="title">HomeBell</Text>
        <Text variant="muted" style={{ textAlign: 'center' }}>
          Request pickup, see when your child is on the way, and confirm once they’re with you.
        </Text>
        <Text variant="small">Powered by neuXplus</Text>
      </View>
      {signOutReason && (
        <Banner
          tone={signOutReason === 'DEVICE_REVOKED' ? 'warning' : 'info'}
          title="You were signed out"
          message={errorMessage(signOutReason)}
        />
      )}
      <Button
        testID="start-sign-in"
        title="Sign in with my phone number"
        onPress={() => router.push('/phone')}
      />
      <Button
        testID="start-invite"
        title="I have an invitation code"
        variant="secondary"
        onPress={() => router.push('/invite')}
      />
      <Text variant="small" style={{ textAlign: 'center' }}>
        Your school registers your phone number. We send a one-time code by SMS.
      </Text>
    </Screen>
  );
}
