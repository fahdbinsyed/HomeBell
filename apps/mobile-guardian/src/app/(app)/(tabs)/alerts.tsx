import { router } from 'expo-router';
import { useEffect } from 'react';
import { FlatList, RefreshControl } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@homebell/api-client';
import { formatRelative } from '@homebell/copy';
import { keys, messageFor } from '@/services/api';
import { useServices } from '@/services/session';
import { Button, Card, EmptyState, ErrorView, LoadingView, Text } from '@/ui/components';
import { useTheme } from '@/ui/theme';

export default function AlertsScreen() {
  const { client, push } = useServices();
  const { c } = useTheme();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: keys.notifications,
    queryFn: () => unwrap(client.GET('/v1/me/notifications', { params: { query: { limit: 50 } } })),
  });
  const readAll = useMutation({
    mutationFn: () => client.POST('/v1/me/notifications/read', { body: { all: true } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.notifications }),
  });
  // Ask for notification permission in context (Android 13+ / iOS), then register the token.
  useEffect(() => {
    void (async () => {
      if (
        (await push.getPermission()) === 'undetermined' &&
        (await push.requestPermission()) === 'granted'
      ) {
        const t = await push.getToken();
        if (t) await client.POST('/v1/me/push-tokens', { body: t });
      }
    })();
  }, [client, push]);
  if (q.isPending) return <LoadingView />;
  return (
    <FlatList
      testID="alerts-screen"
      style={{ backgroundColor: c.bg }}
      contentContainerStyle={{ padding: 20, gap: 12 }}
      data={q.data?.items ?? []}
      keyExtractor={(n) => n.id}
      refreshControl={
        <RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} />
      }
      ListHeaderComponent={
        <>
          {q.error && <ErrorView message={messageFor(q.error)} onRetry={() => q.refetch()} />}
          {(q.data?.unreadCount ?? 0) > 0 && (
            <Button title="Mark all as read" variant="ghost" onPress={() => readAll.mutate()} />
          )}
        </>
      }
      ListEmptyComponent={
        <EmptyState title="No alerts" message="Pickup updates and account changes appear here." />
      }
      renderItem={({ item }) => (
        <Card
          onPress={
            item.data?.pickupRequestId
              ? () =>
                  router.push({
                    pathname: '/pickup/[requestId]',
                    params: { requestId: item.data?.pickupRequestId! },
                  })
              : undefined
          }
          style={item.readAt ? undefined : { borderColor: c.primary, borderWidth: 1 }}
        >
          <Text variant="label">
            {item.readAt ? '' : '● '}
            {item.title}
          </Text>
          <Text variant="muted">{item.body}</Text>
          <Text variant="small">{formatRelative(item.createdAt)}</Text>
        </Card>
      )}
    />
  );
}
