import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { IncomingPush } from '@homebell/client-services';
import { pushService } from '@/platform/push';
import { Text } from '@/ui/components';
import { useTheme } from '@/ui/theme';

/** In-app banner for Phase 1 mock pushes (FCM on Android and iOS replaces the transport in Phase 7). */
export function PushBannerHost() {
  const [push, setPush] = useState<IncomingPush | null>(null);
  const insets = useSafeAreaInsets();
  const { c, radius } = useTheme();
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const sub = pushService.onPush((p) => {
      setPush(p);
      clearTimeout(timer);
      timer = setTimeout(() => setPush(null), 5000);
    });
    return () => {
      sub.unsubscribe();
      clearTimeout(timer);
    };
  }, []);
  if (!push) return null;
  return (
    <View
      pointerEvents="box-none"
      style={{ position: 'absolute', top: insets.top + 8, left: 12, right: 12 }}
    >
      <Pressable
        accessibilityRole="alert"
        accessibilityLabel={`${push.title}. ${push.body}`}
        onPress={() => {
          setPush(null);
          if (push.data.pickupRequestId)
            router.push({
              pathname: '/pickup/[requestId]',
              params: { requestId: push.data.pickupRequestId },
            });
        }}
        style={{
          backgroundColor: c.surface,
          borderRadius: radius.lg,
          padding: 14,
          borderWidth: 1,
          borderColor: c.border,
          shadowColor: '#000',
          shadowOpacity: 0.2,
          shadowRadius: 8,
          elevation: 6,
        }}
      >
        <Text variant="label">{push.title}</Text>
        <Text variant="muted">{push.body}</Text>
      </Pressable>
    </View>
  );
}
