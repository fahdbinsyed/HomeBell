import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@homebell/api-client';
import { formatTime, labels } from '@homebell/copy';
import { keys, messageFor, useIdempotencyKey } from '@/services/api';
import { useServices } from '@/services/session';
import {
  Banner,
  Button,
  Card,
  ErrorView,
  LoadingView,
  Row,
  Screen,
  StateBadge,
  Text,
} from '@/ui/components';

export default function PickupStatusScreen() {
  const { requestId } = useLocalSearchParams<{ requestId: string }>();
  const { client } = useServices();
  const qc = useQueryClient();
  const idem = useIdempotencyKey();
  const req = useQuery({
    queryKey: keys.pickup(requestId!),
    queryFn: () =>
      unwrap(
        client.GET('/v1/me/pickup-requests/{requestId}', {
          params: { path: { requestId: requestId! } },
        }),
      ),
    refetchInterval: 15_000,
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['me'] });
  const ack = useMutation({
    mutationFn: () =>
      unwrap(
        client.POST('/v1/me/pickup-requests/{requestId}/acknowledge', {
          params: { path: { requestId: requestId! }, header: { 'Idempotency-Key': idem.key() } },
        }),
      ),
    onSuccess: (r) => {
      qc.setQueryData(keys.pickup(r.id), r);
      refresh();
    },
  });
  const cancel = useMutation({
    mutationFn: () =>
      unwrap(
        client.POST('/v1/me/pickup-requests/{requestId}/cancel', {
          params: { path: { requestId: requestId! } },
          body: {},
        }),
      ),
    onSuccess: (r) => {
      qc.setQueryData(keys.pickup(r.id), r);
      refresh();
    },
  });
  if (req.isPending) return <LoadingView />;
  if (req.error)
    return (
      <Screen>
        <ErrorView message={messageFor(req.error)} onRetry={() => req.refetch()} />
      </Screen>
    );
  const r = req.data;
  const err = ack.error ?? cancel.error;
  return (
    <Screen testID="pickup-status-screen">
      <Row style={{ justifyContent: 'space-between' }}>
        <Text variant="title">{r.studentFirstName}</Text>
        <StateBadge group="pickup" value={r.state} label={labels.pickupState[r.state]} />
      </Row>
      <Text variant="muted">{r.tenantName}</Text>
      {err && <Banner tone="danger" message={messageFor(err)} />}
      <Card>
        <Text variant="heading" accessibilityLiveRegion="polite">
          {r.statusMessage}
        </Text>
        {r.position && r.state === 'requested' && (
          <Text variant="muted">Position in queue: {r.position}</Text>
        )}
        <Text variant="small">
          Requested {formatTime(r.requestedAt)} by{' '}
          {r.requestedBy?.isMe ? 'you' : (r.requestedBy?.fullName ?? 'another guardian')}
          {r.sentOutAt ? ` · sent out ${formatTime(r.sentOutAt)}` : ''}
          {r.acknowledgedAt ? ` · confirmed ${formatTime(r.acknowledgedAt)}` : ''}
        </Text>
      </Card>
      {r.canAcknowledge && (
        <Button
          testID="confirm-picked-up"
          title={`Confirm ${r.studentFirstName} is with me`}
          loading={ack.isPending}
          onPress={() => ack.mutate()}
          accessibilityHint="Tell the school you have your child"
        />
      )}
      {r.state === 'requested' && (
        <Text variant="small">Only confirm once your child is physically with you.</Text>
      )}
      {r.canCancel && (
        <Button
          testID="cancel-request"
          title="Cancel request"
          variant="secondary"
          loading={cancel.isPending}
          onPress={() => cancel.mutate()}
        />
      )}
      {r.state === 'exception' && (
        <Banner
          tone="warning"
          message="The school will follow up because pickup wasn’t confirmed. If you already have your child, confirm now."
        />
      )}
      <Button title="Back to pickup" variant="ghost" onPress={() => router.navigate('/home')} />
    </Screen>
  );
}
