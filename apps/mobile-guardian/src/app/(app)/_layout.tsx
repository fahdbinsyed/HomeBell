import { Redirect, Stack } from 'expo-router';
import { useSession } from '@/services/session';
import { useTheme } from '@/ui/theme';

export default function AppLayout() {
  const { status, me, limited } = useSession();
  const { c } = useTheme();
  if (status === 'signedOut') return <Redirect href="/welcome" />;
  if (status === 'signedIn' && me?.termsAcceptanceRequired && !limited)
    return <Redirect href="/terms" />;
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: c.surface },
        headerTintColor: c.text,
        contentStyle: { backgroundColor: c.bg },
        headerBackButtonDisplayMode: 'minimal',
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="request" options={{ title: 'Request pickup', presentation: 'modal' }} />
      <Stack.Screen name="pickup/[requestId]" options={{ title: 'Pickup status' }} />
      <Stack.Screen name="family/add" options={{ title: 'Add a guardian' }} />
      <Stack.Screen name="family/[guardianId]" options={{ title: 'Guardian' }} />
      <Stack.Screen name="device" options={{ title: 'This phone' }} />
      <Stack.Screen name="developer" options={{ title: 'Developer (mock)' }} />
    </Stack>
  );
}
