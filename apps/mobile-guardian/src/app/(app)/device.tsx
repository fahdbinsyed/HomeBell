import { useQuery } from '@tanstack/react-query';
import { unwrap } from '@homebell/api-client';
import { formatDate, formatDateTime } from '@homebell/copy';
import { keys, messageFor } from '@/services/api';
import { useServices } from '@/services/session';
import { Badge, Banner, Card, ErrorView, LoadingView, Screen, Text } from '@/ui/components';

export default function DeviceScreen() {
  const { client } = useServices();
  const q = useQuery({ queryKey: keys.device, queryFn: () => unwrap(client.GET('/v1/me/device')) });
  if (q.isPending) return <LoadingView />;
  if (q.error)
    return (
      <Screen>
        <ErrorView message={messageFor(q.error)} onRetry={() => q.refetch()} />
      </Screen>
    );
  const d = q.data;
  return (
    <Screen testID="device-screen">
      <Text variant="title">This phone</Text>
      <Card>
        <Text variant="heading">{d.currentDevice.model}</Text>
        <Text variant="muted">
          {d.currentDevice.platform === 'ios' ? 'iPhone' : 'Android'} · active since{' '}
          {formatDate(d.currentDevice.activatedAt)}
        </Text>
        <Badge
          tone={d.isActiveDevice ? 'success' : 'warning'}
          label={d.isActiveDevice ? 'Active phone for your account' : 'Not the active phone'}
        />
      </Card>
      <Banner
        tone="info"
        message={
          d.nextTransferAllowedAt
            ? `You can move your account to another phone after ${formatDateTime(d.nextTransferAllowedAt)}.`
            : 'You can move your account to a new phone by signing in on it. The waiting period between moves is 30 days.'
        }
      />
      <Text variant="heading">Transfers</Text>
      {d.transferHistory.length === 0 ? (
        <Text variant="muted">No transfers.</Text>
      ) : (
        d.transferHistory.map((t) => (
          <Card key={t.id}>
            <Text>
              {t.fromDevice?.model ?? 'Previous phone'} → {t.toDevice.model}
            </Text>
            <Text variant="small">
              {formatDateTime(t.at)}
              {t.viaOverride ? ' · school override' : ''}
            </Text>
          </Card>
        ))
      )}
    </Screen>
  );
}
