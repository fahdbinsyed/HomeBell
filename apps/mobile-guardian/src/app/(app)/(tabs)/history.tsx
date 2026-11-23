import { router } from 'expo-router';
import { FlatList, RefreshControl } from 'react-native';
import { useInfiniteQuery } from '@tanstack/react-query';
import { unwrap } from '@homebell/api-client';
import { formatDate, formatTime, labels } from '@homebell/copy';
import { keys, messageFor } from '@/services/api';
import { useServices } from '@/services/session';
import {
  Button,
  Card,
  EmptyState,
  ErrorView,
  LoadingView,
  Row,
  StateBadge,
  Text,
} from '@/ui/components';
import { useTheme } from '@/ui/theme';

export default function HistoryScreen() {
  const { client } = useServices();
  const { c } = useTheme();
  const q = useInfiniteQuery({
    queryKey: keys.history,
    queryFn: ({ pageParam }) =>
      unwrap(
        client.GET('/v1/me/pickup-requests', {
          params: { query: { cursor: pageParam, limit: 20 } },
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (p) => p.nextCursor ?? undefined,
  });
  if (q.isPending) return <LoadingView />;
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <FlatList
      testID="history-screen"
      style={{ backgroundColor: c.bg }}
      contentContainerStyle={{ padding: 20, gap: 12 }}
      data={items}
      keyExtractor={(i) => i.id}
      refreshControl={
        <RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} />
      }
      ListHeaderComponent={
        q.error ? (
          <ErrorView message={messageFor(q.error)} onRetry={() => q.refetch()} />
        ) : undefined
      }
      ListEmptyComponent={
        <EmptyState title="No pickups yet" message="Your pickup requests will appear here." />
      }
      renderItem={({ item }) => (
        <Card
          onPress={() =>
            router.push({ pathname: '/pickup/[requestId]', params: { requestId: item.id } })
          }
          accessibilityLabel={`${item.studentFirstName}, ${labels.pickupState[item.state]}, ${formatDate(item.requestedAt)}`}
        >
          <Row style={{ justifyContent: 'space-between' }}>
            <Text variant="heading">{item.studentFirstName}</Text>
            <StateBadge group="pickup" value={item.state} label={labels.pickupState[item.state]} />
          </Row>
          <Text variant="muted">
            {item.tenantName} · {formatDate(item.requestedAt)} {formatTime(item.requestedAt)}
            {item.requestedBy?.isMe ? '' : ` · by ${item.requestedBy?.fullName}`}
          </Text>
        </Card>
      )}
      ListFooterComponent={
        q.hasNextPage ? (
          <Button
            title="Load more"
            variant="secondary"
            loading={q.isFetchingNextPage}
            onPress={() => q.fetchNextPage()}
          />
        ) : undefined
      }
    />
  );
}
