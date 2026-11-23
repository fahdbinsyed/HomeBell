import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Switch, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@homebell/api-client';
import type { CreatePickupResult } from '@homebell/contracts';
import { errorMessage } from '@homebell/copy';
import { getPickupLocation } from '@/platform/location';
import { codeOf, keys, messageFor, metaOf, useIdempotencyKey } from '@/services/api';
import { useServices } from '@/services/session';
import { Banner, Button, Card, Field, LoadingView, Row, Screen, Text } from '@/ui/components';

export default function RequestPickupScreen() {
  const { tenantId } = useLocalSearchParams<{ tenantId: string }>();
  const { client } = useServices();
  const qc = useQueryClient();
  const idem = useIdempotencyKey();
  const children = useQuery({
    queryKey: keys.children,
    queryFn: () => unwrap(client.GET('/v1/me/children')),
  });
  const kids = (children.data?.items ?? []).filter(
    (k) => k.tenantId === tenantId && k.pickup.eligible && !k.activeRequest,
  );
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [note, setNote] = useState('');
  const [result, setResult] = useState<CreatePickupResult | null>(null);
  const [locationIssue, setLocationIssue] = useState<string | null>(null);
  const chosen = kids.filter((k) => selected[k.studentId] ?? true).map((k) => k.studentId);
  const needsLocation = kids.some((k) => k.pickup.locationRequired);

  const submit = useMutation({
    mutationFn: async () => {
      setLocationIssue(null);
      let location;
      if (needsLocation) {
        const r = await getPickupLocation();
        if (!r.ok) {
          setLocationIssue(
            r.reason === 'denied'
              ? 'Location permission is off. Your school needs your location to accept pickup requests — enable it in Settings.'
              : 'We couldn’t get your location. Move outdoors and try again.',
          );
          throw new Error('location');
        }
        location = r.location;
      }
      return unwrap(
        client.POST('/v1/me/pickup-requests', {
          params: { header: { 'Idempotency-Key': idem.key() } },
          body: {
            tenantId: tenantId!,
            studentIds: chosen,
            note: note.trim() || undefined,
            location,
          },
        }),
      );
    },
    onSuccess: (r) => {
      idem.next();
      void qc.invalidateQueries({ queryKey: ['me'] });
      setResult(r);
      if (r.rejected.length === 0 && r.created.length === 1)
        router.replace({
          pathname: '/pickup/[requestId]',
          params: { requestId: r.created[0]!.id },
        });
    },
  });

  if (children.isPending) return <LoadingView />;
  if (result) {
    return (
      <Screen testID="request-result">
        <Text variant="title">{result.created.length ? 'Request sent' : 'Request not sent'}</Text>
        {result.created.map((r) => (
          <Banner key={r.id} tone="success" message={`${r.studentFirstName}: ${r.statusMessage}`} />
        ))}
        {result.rejected.map((r) => (
          <Banner
            key={r.studentId}
            tone="warning"
            message={`${children.data?.items.find((k) => k.studentId === r.studentId)?.firstName ?? 'Child'}: ${errorMessage(r.code)}`}
          />
        ))}
        <Button title="Done" onPress={() => router.back()} />
      </Screen>
    );
  }
  const err = submit.error && submit.error.message !== 'location' ? submit.error : null;
  const rejected = (metaOf(err).rejected as Array<{ code: string }> | undefined) ?? [];
  return (
    <Screen
      testID="request-screen"
      footer={
        <Button
          testID="confirm-request"
          title="Request pickup"
          loading={submit.isPending}
          disabled={chosen.length === 0}
          onPress={() => submit.mutate()}
          accessibilityHint="Sends your pickup request to the school"
        />
      }
    >
      <Text variant="title">Who are you picking up?</Text>
      {err && (
        <Banner
          tone="danger"
          message={
            codeOf(err) === 'DUPLICATE_ACTIVE_REQUEST' ||
            rejected[0]?.code === 'DUPLICATE_ACTIVE_REQUEST'
              ? errorMessage('DUPLICATE_ACTIVE_REQUEST')
              : messageFor(err)
          }
        />
      )}
      {locationIssue && <Banner tone="warning" message={locationIssue} />}
      {kids.length === 0 && (
        <Banner tone="info" message="No children can be requested right now." />
      )}
      {kids.map((k) => (
        <Card key={k.studentId}>
          <Row style={{ justifyContent: 'space-between' }}>
            <View>
              <Text variant="heading">
                {k.preferredName ?? k.firstName} {k.lastName}
              </Text>
              <Text variant="muted">{k.className}</Text>
            </View>
            <Switch
              accessibilityLabel={`Include ${k.firstName}`}
              value={selected[k.studentId] ?? true}
              onValueChange={(v) => setSelected((s) => ({ ...s, [k.studentId]: v }))}
            />
          </Row>
        </Card>
      ))}
      <Field
        testID="request-note"
        label="Note for the school (optional)"
        value={note}
        onChangeText={setNote}
        maxLength={200}
        placeholder="e.g. Silver minivan, gate 2"
      />
      {needsLocation && (
        <Text variant="small">
          This school checks that you’re nearby. We’ll ask for your location once, when you tap
          Request pickup.
        </Text>
      )}
    </Screen>
  );
}
