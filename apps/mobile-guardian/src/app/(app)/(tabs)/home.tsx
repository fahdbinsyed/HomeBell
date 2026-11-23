import { router } from 'expo-router';
import { RefreshControl, ScrollView, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { unwrap } from '@homebell/api-client';
import type { ChildSummary, GuardianTenantContext } from '@homebell/contracts';
import { errorMessage, formatTime, labels } from '@homebell/copy';
import { keys, messageFor } from '@/services/api';
import { useServices } from '@/services/session';
import {
  Banner,
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

function SchoolBanner({ t }: { t: GuardianTenantContext }) {
  if (t.operationalMode !== 'full')
    return (
      <Banner
        tone="warning"
        title={`${t.tenantName}: service paused`}
        message="Pickup requests are unavailable while the school’s HomeBell service isn’t active. Follow the school’s usual dismissal process."
      />
    );
  if (t.guardianState === 'blocked')
    return <Banner tone="danger" title={t.tenantName} message={errorMessage('GUARDIAN_BLOCKED')} />;
  if (t.guardianState === 'deactivated')
    return (
      <Banner tone="danger" title={t.tenantName} message={errorMessage('GUARDIAN_DEACTIVATED')} />
    );
  if (t.guardianState === 'expired')
    return (
      <Banner
        tone="warning"
        title={t.tenantName}
        message={errorMessage('GUARDIAN_ACCESS_EXPIRED')}
      />
    );
  if (t.guardianState === 'revoked')
    return (
      <Banner tone="warning" title={t.tenantName} message={errorMessage('GUARDIAN_REVOKED')} />
    );
  return null;
}

function ChildCard({ child }: { child: ChildSummary }) {
  const name = child.preferredName ?? child.firstName;
  const r = child.activeRequest;
  return (
    <Card testID={`child-${child.firstName}`}>
      <Row style={{ justifyContent: 'space-between' }}>
        <View style={{ flex: 1 }}>
          <Text variant="heading">
            {name} {child.lastName}
          </Text>
          <Text variant="muted">
            {child.className}
            {child.sectionName ? ` ${child.sectionName}` : ''}
          </Text>
        </View>
        {r && <StateBadge group="pickup" value={r.state} label={labels.pickupState[r.state]} />}
      </Row>
      {r ? (
        <>
          <Text>{r.statusMessage}</Text>
          <Button
            testID={`open-request-${child.firstName}`}
            title={r.canAcknowledge && r.state === 'sent_out' ? 'Confirm picked up' : 'View status'}
            variant={r.state === 'sent_out' ? 'primary' : 'secondary'}
            onPress={() =>
              router.push({ pathname: '/pickup/[requestId]', params: { requestId: r.id } })
            }
          />
        </>
      ) : child.pickup.eligible ? null : (
        <Text variant="muted">
          {child.pickup.reasonCode === 'OUTSIDE_DISMISSAL_WINDOW' && child.pickup.windowOpensAt
            ? `Pickup requests open at ${formatTime(child.pickup.windowOpensAt)}.`
            : errorMessage(child.pickup.reasonCode)}
        </Text>
      )}
    </Card>
  );
}

export default function HomeScreen() {
  const { client } = useServices();
  const { c } = useTheme();
  const children = useQuery({
    queryKey: keys.children,
    queryFn: () => unwrap(client.GET('/v1/me/children')),
    refetchInterval: 30_000,
  });
  if (children.isPending) return <LoadingView label="Loading your children…" />;
  const data = children.data;
  return (
    <ScrollView
      style={{ backgroundColor: c.bg }}
      contentContainerStyle={{ padding: 20, gap: 16 }}
      refreshControl={
        <RefreshControl
          refreshing={children.isRefetching}
          onRefresh={() => void children.refetch()}
        />
      }
      testID="home-screen"
    >
      {children.error && (
        <ErrorView message={messageFor(children.error)} onRetry={() => children.refetch()} />
      )}
      {data && data.items.length === 0 && (
        <EmptyState
          title="No children linked yet"
          message="If you were just invited, your access starts once the invitation is accepted. Otherwise contact your school."
        />
      )}
      {data?.tenants.map((t) => {
        const kids = data.items.filter((k) => k.tenantId === t.tenantId);
        const requestable = kids.filter((k) => k.pickup.eligible && !k.activeRequest);
        return (
          <View key={t.tenantId} style={{ gap: 12 }}>
            <Text variant="small" style={{ textTransform: 'uppercase', letterSpacing: 1 }}>
              {t.tenantName}
              {t.kind === 'additional' ? ' · additional guardian' : ''}
            </Text>
            <SchoolBanner t={t} />
            {kids.map((k) => (
              <ChildCard key={k.studentId} child={k} />
            ))}
            {requestable.length > 0 && (
              <Button
                testID={`request-pickup-${t.tenantName.split(' ')[0]}`}
                title={
                  requestable.length > 1
                    ? `Request pickup (${requestable.length} children)`
                    : `Request pickup for ${requestable[0]!.preferredName ?? requestable[0]!.firstName}`
                }
                onPress={() =>
                  router.push({ pathname: '/request', params: { tenantId: t.tenantId } })
                }
              />
            )}
          </View>
        );
      })}
      <Text variant="small" style={{ textAlign: 'center' }}>
        HomeBell helps coordinate pickup. Always follow your school’s dismissal rules.
      </Text>
    </ScrollView>
  );
}
