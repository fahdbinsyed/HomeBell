import { router } from 'expo-router';
import { Alert } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { unwrap } from '@homebell/api-client';
import { formatDate, formatRelative } from '@homebell/copy';
import { messageFor, useIdempotencyKey } from '@/services/api';
import { useServices, useSession } from '@/services/session';
import { flow } from '@/features/flow-store';
import { Banner, Button, Card, Screen, Text } from '@/ui/components';

/** Transfer-or-buy (business rule 3.3; ADR-0009/0010/0017). Same flow on Android and iOS. */
export default function DeviceConflictScreen() {
  const { client } = useServices();
  const { signIn } = useSession();
  const idem = useIdempotencyKey();
  const conflict = flow.conflict;
  const transfer = useMutation({
    mutationFn: () =>
      unwrap(
        client.POST('/v1/auth/device-transfer', {
          params: { header: { 'Idempotency-Key': idem.key() } },
          body: { conflictToken: conflict!.conflictToken },
        }),
      ),
    onSuccess: async (r) => {
      await signIn(r.tokens, r.me);
      router.replace('/');
    },
  });
  const buy = useMutation({
    mutationFn: () =>
      unwrap(
        client.POST('/v1/auth/device-conflict/limited-session', {
          body: { conflictToken: conflict!.conflictToken },
        }),
      ),
    onSuccess: async (tokens) => {
      await signIn(tokens);
      router.replace('/family/add');
    },
  });
  if (!conflict)
    return (
      <Screen>
        <Banner tone="warning" message="This step timed out. Verify your phone again." />
        <Button title="Start again" onPress={() => router.replace('/phone')} />
      </Screen>
    );
  const d = conflict.activeDevice;
  const err = transfer.error ?? buy.error;
  return (
    <Screen testID="device-conflict-screen">
      <Text variant="title">This account is active on another phone</Text>
      <Text variant="muted">
        Each HomeBell account works on one phone at a time. Shared logins aren’t allowed — each
        family member needs their own account.
      </Text>
      <Card>
        <Text variant="label">Active phone</Text>
        <Text>
          {d.model} ({d.platform === 'ios' ? 'iPhone' : 'Android'})
        </Text>
        <Text variant="small">
          Active since {formatDate(d.activatedAt)} · last seen {formatRelative(d.lastSeenAt)}
        </Text>
      </Card>
      {err && <Banner tone="danger" message={messageFor(err)} />}
      <Card>
        <Text variant="heading">Move my account to this phone</Text>
        <Text variant="muted">
          The other phone will be signed out. You can move your account once every 30 days.
        </Text>
        {conflict.transfer.allowed ? (
          <Button
            testID="transfer-device"
            title="Move to this phone"
            loading={transfer.isPending}
            onPress={() =>
              Alert.alert(
                'Move your account to this phone?',
                'Your other phone will be signed out, and you won’t be able to move again for 30 days.',
                [
                  { text: 'Not now', style: 'cancel' },
                  { text: 'Move account', onPress: () => transfer.mutate() },
                ],
              )
            }
          />
        ) : (
          <Banner
            tone="warning"
            title="Not available yet"
            message={`Your account moved recently. You can move it again on ${formatDate(conflict.transfer.cooldownEndsAt)}. Lost your phone? Ask your school's front office for help.`}
          />
        )}
        {conflict.transfer.overrideActive && (
          <Text variant="small">Your school lifted the waiting period for you once.</Text>
        )}
      </Card>
      {conflict.purchase.available && (
        <Card>
          <Text variant="heading">This phone is for someone else</Text>
          <Text variant="muted">
            Buy an additional guardian license and invite this person with their own phone number
            and account.
          </Text>
          <Button
            testID="buy-license"
            title="Buy an additional guardian license"
            variant="secondary"
            loading={buy.isPending}
            onPress={() => buy.mutate()}
          />
        </Card>
      )}
      <Button title="Cancel" variant="ghost" onPress={() => router.replace('/welcome')} />
    </Screen>
  );
}
