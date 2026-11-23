import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SessionProvider } from '@/services/session';
import { MockStoreSheetHost } from '@/features/mock-store-sheet';
import { PushBannerHost } from '@/features/push-banner';
import { useTheme } from '@/ui/theme';

function Navigator() {
  const { c } = useTheme();
  return (
    <>
      <StatusBar style="auto" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: c.surface },
          headerTintColor: c.text,
          contentStyle: { backgroundColor: c.bg },
          headerBackButtonDisplayMode: 'minimal',
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="(app)" options={{ headerShown: false }} />
        <Stack.Screen name="invite/index" options={{ title: 'Invitation code' }} />
        <Stack.Screen name="invite/[code]" options={{ title: 'Accept invitation' }} />
      </Stack>
      <PushBannerHost />
      <MockStoreSheetHost />
    </>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <Navigator />
      </SessionProvider>
    </SafeAreaProvider>
  );
}
