import { Redirect, Stack } from 'expo-router';
import { useSession } from '@/services/session';
import { useTheme } from '@/ui/theme';

export default function AuthLayout() {
  const { status } = useSession();
  const { c } = useTheme();
  if (status === 'signedIn') return <Redirect href="/" />;
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: c.surface },
        headerTintColor: c.text,
        contentStyle: { backgroundColor: c.bg },
        headerBackButtonDisplayMode: 'minimal',
      }}
    >
      <Stack.Screen name="welcome" options={{ headerShown: false }} />
      <Stack.Screen name="phone" options={{ title: 'Sign in' }} />
      <Stack.Screen name="verify" options={{ title: 'Enter code' }} />
      <Stack.Screen name="device-conflict" options={{ title: 'New phone detected' }} />
      <Stack.Screen name="no-account" options={{ title: 'No account found' }} />
    </Stack>
  );
}
