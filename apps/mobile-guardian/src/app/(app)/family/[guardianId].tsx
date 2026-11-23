import { router, useLocalSearchParams } from 'expo-router';
import { Share } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@homebell/api-client';
import { formatDate, formatRelative, labels } from '@homebell/copy';
import { keys, messageFor } from '@/services/api';
import { useServices } from '@/services/session';
import { Banner, Button, Card, LoadingView, Screen, StateBadge, Text } from '@/ui/components';

export default function ManagedGuardianScreen() {
  const { guardianId } = useLocalSearchParams<{ guardianId: string }>();
  const { client } = useServices();
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: keys.guardians,
    queryFn: () => unwrap(client.GET('/v1/me/guardians')),
  });
  const g = list.data?.items.find((x) => x.guardianId === guardianId);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['me'] });
  const resend = useMutation({
    mutationFn: () =>
      unwrap(
        client.POST('/v1/me/guardians/{guardianId}/invitation/resend', {
          params: { path: { guardianId: guardianId! } },
        }),
      ),
    onSuccess: (r) => {
      refresh();
      void Share.share({
        message: `Your new HomeBell invitation code: ${r.code} (or open ${r.deepLink}).`,
      });
    },
  });
  const revoke = useMutation({
    mutationFn: () =>
      unwrap(
        client.POST('/v1/me/guardians/{guardianId}/revoke', {
          params: { path: { guardianId: guardianId! } },
        }),
      ),
    onSuccess: () => {
      refresh();
      router.back();
    },
  });
  const extend = useMutation({
    mutationFn: () =>
      unwrap(
        client.PATCH('/v1/me/guardians/{guardianId}', {
          params: { path: { guardianId: guardianId! } },
          body: { validity: { mode: 'permanent' } },
        }),
      ),
    onSuccess: refresh,
  });
  if (list.isPending) return <LoadingView />;
  if (!g)
    return (
      <Screen>
        <Banner tone="warning" message="This guardian no longer exists." />
      </Screen>
    );
  const err = resend.error ?? revoke.error ?? extend.error;
  return (
    <Screen testID="managed-guardian-screen">
      <Text variant="title">{g.fullName}</Text>
      <StateBadge
        group="guardian"
        value={g.state}
        label={g.state === 'pending_activation' ? 'Invitation sent' : labels.guardianState[g.state]}
      />
      {err && <Banner tone="danger" message={messageFor(err)} />}
      <Card>
        <Text>
          {labels.relationship[g.relationship]} · {g.maskedPhone}
        </Text>
        <Text variant="muted">Can pick up: {g.students.map((s) => s.firstName).join(', ')}</Text>
        <Text variant="muted">
          Access: {labels.validityMode[g.validity.mode]}
          {g.validity.validUntil ? ` until ${formatDate(g.validity.validUntil)}` : ''}
        </Text>
        {g.invitation && (
          <Text variant="small">
            {labels.invitationState[g.invitation.state]} · expires{' '}
            {formatDate(g.invitation.expiresAt)}
          </Text>
        )}
        {g.lastPickupAt && (
          <Text variant="small">Last pickup {formatRelative(g.lastPickupAt)}</Text>
        )}
      </Card>
      {g.state === 'pending_activation' && (
        <Button
          title="Send a new code"
          variant="secondary"
          loading={resend.isPending}
          onPress={() => resend.mutate()}
        />
      )}
      {g.state === 'expired' && (
        <Button
          title="Extend for the whole term"
          loading={extend.isPending}
          onPress={() => extend.mutate()}
        />
      )}
      {g.state !== 'revoked' && (
        <Button
          testID="revoke-guardian"
          title="Remove access"
          variant="danger"
          loading={revoke.isPending}
          onPress={() => revoke.mutate()}
          accessibilityHint="Removes this person's access and frees the license"
        />
      )}
    </Screen>
  );
}
