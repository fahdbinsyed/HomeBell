import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { unwrap } from '@homebell/api-client';
import { formatDate, labels } from '@homebell/copy';
import { keys, messageFor } from '@/services/api';
import { useServices } from '@/services/session';
import {
  Badge,
  Banner,
  Button,
  Card,
  EmptyState,
  ErrorView,
  LoadingView,
  Row,
  Screen,
  StateBadge,
  Text,
} from '@/ui/components';

export default function FamilyScreen() {
  const { client } = useServices();
  const children = useQuery({
    queryKey: keys.children,
    queryFn: () => unwrap(client.GET('/v1/me/children')),
  });
  const guardians = useQuery({
    queryKey: keys.guardians,
    queryFn: () => unwrap(client.GET('/v1/me/guardians')),
  });
  const seats = useQuery({
    queryKey: keys.seats,
    queryFn: () => unwrap(client.GET('/v1/me/license-seats')),
  });
  if (children.isPending || guardians.isPending || seats.isPending) return <LoadingView />;
  const primaryTenants = children.data?.tenants.filter((t) => t.kind === 'primary') ?? [];
  if (primaryTenants.length === 0) {
    return (
      <Screen testID="family-screen">
        <Text variant="title">Family</Text>
        <Banner
          tone="info"
          message="Only the primary guardian can add other guardians. Ask them if someone else needs access."
        />
      </Screen>
    );
  }
  const available = seats.data?.items.filter((s) => s.state === 'available').length ?? 0;
  return (
    <Screen testID="family-screen">
      <Text variant="title">Family & helpers</Text>
      <Text variant="muted">
        Each extra person — spouse, grandparent, driver, nanny — gets their own HomeBell account
        with an additional guardian license. Sharing your login isn’t allowed.
      </Text>
      {(guardians.error || seats.error) && (
        <ErrorView
          message={messageFor(guardians.error ?? seats.error)}
          onRetry={() => {
            void guardians.refetch();
            void seats.refetch();
          }}
        />
      )}
      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <Text variant="heading">Licenses</Text>
          <Badge tone={available ? 'success' : 'neutral'} label={`${available} available`} />
        </Row>
        {seats.data?.items.map((s) => (
          <Text key={s.id} variant="muted">
            {labels.seatSource[s.source]} · {labels.seatState[s.state]} · until{' '}
            {formatDate(s.termEndsAt)} · reassigned {s.reassignmentsUsed}/{s.reassignmentsLimit}
          </Text>
        ))}
      </Card>
      <Button
        testID="add-guardian"
        title="Add a guardian"
        onPress={() => router.push('/family/add')}
      />
      {guardians.data?.items.length === 0 ? (
        <EmptyState title="No additional guardians yet" />
      ) : (
        guardians.data?.items.map((g) => (
          <Card
            key={g.guardianId}
            onPress={() =>
              router.push({
                pathname: '/family/[guardianId]',
                params: { guardianId: g.guardianId },
              })
            }
            accessibilityLabel={`${g.fullName}, ${labels.guardianState[g.state]}`}
          >
            <Row style={{ justifyContent: 'space-between' }}>
              <Text variant="heading">{g.fullName}</Text>
              <StateBadge
                group="guardian"
                value={g.state}
                label={
                  g.state === 'pending_activation'
                    ? 'Invitation sent'
                    : labels.guardianState[g.state]
                }
              />
            </Row>
            <Text variant="muted">
              {labels.relationship[g.relationship]} ·{' '}
              {g.students.map((s) => s.firstName).join(', ')}
            </Text>
            <Text variant="small">
              {labels.validityMode[g.validity.mode]}
              {g.validity.validUntil ? ` · until ${formatDate(g.validity.validUntil)}` : ''}
            </Text>
          </Card>
        ))
      )}
    </Screen>
  );
}
