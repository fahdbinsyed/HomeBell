import { Tabs } from 'expo-router/js-tabs';
import { Text, type ColorValue } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { unwrap } from '@homebell/api-client';
import { keys } from '@/services/api';
import { useServices } from '@/services/session';
import { useTheme } from '@/ui/theme';

const icon =
  (glyph: string) =>
  ({ color }: { color: ColorValue }) => (
    <Text style={{ color, fontSize: 20 }} accessibilityElementsHidden>
      {glyph}
    </Text>
  );

export default function TabsLayout() {
  const { c } = useTheme();
  const { client } = useServices();
  const notifications = useQuery({
    queryKey: keys.notifications,
    queryFn: () => unwrap(client.GET('/v1/me/notifications', { params: { query: { limit: 20 } } })),
  });
  const unread = notifications.data?.unreadCount ?? 0;
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: c.surface },
        headerTintColor: c.text,
        tabBarStyle: { backgroundColor: c.surface, borderTopColor: c.border },
        tabBarActiveTintColor: c.primary,
        tabBarInactiveTintColor: c.textMuted,
        tabBarLabelStyle: { fontSize: 12 },
      }}
    >
      <Tabs.Screen name="home" options={{ title: 'Pickup', tabBarIcon: icon('🏫') }} />
      <Tabs.Screen name="history" options={{ title: 'History', tabBarIcon: icon('🕘') }} />
      <Tabs.Screen name="family" options={{ title: 'Family', tabBarIcon: icon('👪') }} />
      <Tabs.Screen
        name="alerts"
        options={{
          title: 'Alerts',
          tabBarIcon: icon('🔔'),
          tabBarBadge: unread ? unread : undefined,
        }}
      />
      <Tabs.Screen name="account" options={{ title: 'Account', tabBarIcon: icon('👤') }} />
    </Tabs>
  );
}
