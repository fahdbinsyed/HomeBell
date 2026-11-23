import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useState } from 'react';
import { Share, Switch, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@homebell/api-client';
import {
  type GuardianInvitationCreated,
  type LicenseValidityMode,
  type Relationship,
} from '@homebell/contracts';
import { formatDate, labels } from '@homebell/copy';
import { keys, messageFor, useIdempotencyKey } from '@/services/api';
import { useServices, useSession } from '@/services/session';
import { toE164 } from '@/features/flow-store';
import { Banner, Button, Card, Field, LoadingView, Row, Screen, Text } from '@/ui/components';
import { useTheme } from '@/ui/theme';

const MODES: LicenseValidityMode[] = ['permanent', 'temporary', 'valid_until_date', 'one_time'];
const RELS: Relationship[] = [
  'spouse',
  'parent',
  'grandparent',
  'driver',
  'nanny',
  'aunt_uncle',
  'sibling',
  'family_friend',
  'other',
];

/** Buy a license (store billing, ADR-0005) → invite → share the single-use code. */
export default function AddGuardianScreen() {
  const { client, billing } = useServices();
  const { limited, signOut } = useSession();
  const { c, radius } = useTheme();
  const qc = useQueryClient();
  const idemBuy = useIdempotencyKey();
  const idemInvite = useIdempotencyKey();
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [relationship, setRelationship] = useState<Relationship>('spouse');
  const [mode, setMode] = useState<LicenseValidityMode>('permanent');
  const [days, setDays] = useState('7');
  const [until, setUntil] = useState('');
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [done, setDone] = useState<GuardianInvitationCreated | null>(null);
  const [purchaseNote, setPurchaseNote] = useState<string | null>(null);

  const children = useQuery({
    queryKey: keys.children,
    queryFn: () => unwrap(client.GET('/v1/me/children')),
    enabled: !limited,
  });
  const seats = useQuery({
    queryKey: keys.seats,
    queryFn: () => unwrap(client.GET('/v1/me/license-seats')),
  });
  const tenant =
    children.data?.tenants.find((t) => t.kind === 'primary' && t.canPurchaseSeats) ??
    children.data?.tenants.find((t) => t.kind === 'primary');
  const tenantId = tenant?.tenantId ?? seats.data?.items[0]?.tenantId;
  const seat = seats.data?.items.find((s) => s.state === 'available' && s.tenantId === tenantId);
  const kids = (children.data?.items ?? []).filter(
    (k) => k.tenantId === tenantId && k.myRole === 'primary',
  );

  const buy = useMutation({
    mutationFn: async () => {
      setPurchaseNote(null);
      const intent = await unwrap(
        client.POST('/v1/me/license-purchases', {
          params: { header: { 'Idempotency-Key': idemBuy.key() } },
          body: { tenantId: tenantId!, provider: billing.provider },
        }),
      );
      const outcome = await billing.purchase(intent);
      if (outcome.status === 'cancelled') return 'cancelled' as const;
      if (outcome.status !== 'purchased') throw new Error('store');
      const r = await unwrap(
        client.POST('/v1/me/license-purchases/{intentId}/complete', {
          params: {
            path: { intentId: intent.intentId },
            header: { 'Idempotency-Key': `${idemBuy.key()}-complete` },
          },
          body: {
            purchaseToken: outcome.purchaseToken,
            productId: outcome.productId,
            orderId: outcome.orderId,
          },
        }),
      );
      return r.state;
    },
    onSuccess: (state) => {
      idemBuy.next();
      if (state === 'pending')
        setPurchaseNote(
          'Your purchase is pending at the store. The license appears here once payment completes.',
        );
      void qc.invalidateQueries({ queryKey: keys.seats });
    },
  });
  const studentIds = limited
    ? []
    : kids.filter((k) => picked[k.studentId] ?? true).map((k) => k.studentId);
  const invite = useMutation({
    mutationFn: () =>
      unwrap(
        client.POST('/v1/me/guardian-invitations', {
          params: { header: { 'Idempotency-Key': idemInvite.key() } },
          body: {
            tenantId: tenantId!,
            seatId: seat!.id,
            fullName: fullName.trim(),
            phone: toE164(phone),
            relationship,
            studentIds,
            validity: {
              mode,
              durationDays: mode === 'temporary' ? Number(days) : undefined,
              validUntil: mode === 'valid_until_date' ? until : undefined,
            },
          },
        }),
      ),
    onSuccess: (r) => {
      idemInvite.next();
      setDone(r);
      void qc.invalidateQueries({ queryKey: ['me'] });
    },
  });

  if (seats.isPending || (!limited && children.isPending)) return <LoadingView />;
  if (done) {
    const share = () =>
      Share.share({
        message: `You're invited to help with school pickup on HomeBell. Open ${done.deepLink} or enter code ${done.code} in the app. It works only with your phone number.`,
      });
    return (
      <Screen testID="invite-created">
        <Text variant="title">Invitation ready</Text>
        <Text variant="muted">
          Share this code with {done.guardian.fullName}. It works once, only with{' '}
          {done.guardian.maskedPhone}, and expires {formatDate(done.expiresAt)}.
        </Text>
        <View
          style={{
            padding: 20,
            borderRadius: radius.lg,
            backgroundColor: c.surfaceMuted,
            alignItems: 'center',
          }}
        >
          <Text
            testID="invite-code"
            style={{ fontSize: 32, fontWeight: '700', letterSpacing: 4, color: c.text }}
            selectable
          >
            {done.code.slice(0, 5)}-{done.code.slice(5)}
          </Text>
        </View>
        <Button title="Share invitation" onPress={share} />
        <Button
          title="Copy code"
          variant="secondary"
          onPress={() => void Clipboard.setStringAsync(done.code)}
        />
        {limited ? (
          <Button title="Done — sign out of this phone" variant="ghost" onPress={() => signOut()} />
        ) : (
          <Button title="Done" variant="ghost" onPress={() => router.replace('/family')} />
        )}
      </Screen>
    );
  }
  const err = buy.error ?? invite.error;
  const valid =
    !!seat &&
    fullName.trim() &&
    phone.replace(/\D/g, '').length >= 10 &&
    (limited || studentIds.length > 0) &&
    (mode !== 'valid_until_date' || /^\d{4}-\d{2}-\d{2}$/.test(until));
  return (
    <Screen testID="add-guardian-screen">
      {limited && (
        <Banner
          tone="info"
          title="Invite the person using this phone"
          message="Your account stays on your other phone. Buy a license and invite this person with their own number — they’ll sign in with their own account."
        />
      )}
      {err && (
        <Banner
          tone="danger"
          message={
            buy.error?.message === 'store'
              ? 'The store couldn’t complete the purchase.'
              : messageFor(err)
          }
        />
      )}
      {purchaseNote && <Banner tone="warning" message={purchaseNote} />}
      <Card>
        <Text variant="heading">1. License</Text>
        {seat ? (
          <Text>You have an available license (valid until {formatDate(seat.termEndsAt)}).</Text>
        ) : (
          <Text variant="muted">
            Each additional guardian needs a license for this school term.
          </Text>
        )}
        {!seat && (
          <Button
            testID="buy-seat"
            title={`Buy a license (${billing.provider === 'apple_app_store' ? 'App Store' : 'Google Play'})`}
            loading={buy.isPending}
            disabled={!tenantId || (tenant && !tenant.canPurchaseSeats)}
            onPress={() => buy.mutate()}
          />
        )}
        {tenant && !tenant.canPurchaseSeats && (
          <Text variant="small">
            In-app purchase isn’t available at {tenant.tenantName}. Ask the school about licenses.
          </Text>
        )}
      </Card>
      <Card style={{ opacity: seat ? 1 : 0.5 }}>
        <Text variant="heading">2. Who are you inviting?</Text>
        <Field
          testID="guardian-name"
          label="Full name"
          value={fullName}
          onChangeText={setFullName}
          editable={!!seat}
        />
        <Field
          testID="guardian-phone"
          label="Their mobile number"
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          editable={!!seat}
          hint="The code only works with this number."
        />
        <Text variant="label">Relationship</Text>
        <Row style={{ flexWrap: 'wrap' }}>
          {RELS.map((r) => (
            <Button
              key={r}
              title={labels.relationship[r]}
              variant={relationship === r ? 'primary' : 'secondary'}
              onPress={() => setRelationship(r)}
              style={{ minHeight: 40 }}
            />
          ))}
        </Row>
        {!limited &&
          kids.map((k) => (
            <Row key={k.studentId} style={{ justifyContent: 'space-between' }}>
              <Text>{k.firstName}</Text>
              <Switch
                accessibilityLabel={`Allow pickup of ${k.firstName}`}
                value={picked[k.studentId] ?? true}
                onValueChange={(v) => setPicked((p) => ({ ...p, [k.studentId]: v }))}
              />
            </Row>
          ))}
        <Text variant="label">Access</Text>
        {MODES.map((m) => (
          <Button
            key={m}
            title={labels.validityMode[m]}
            variant={mode === m ? 'primary' : 'secondary'}
            onPress={() => setMode(m)}
            style={{ minHeight: 44 }}
          />
        ))}
        {mode === 'temporary' && (
          <Field
            label="Number of days (1–30)"
            value={days}
            onChangeText={(t) => setDays(t.replace(/\D/g, '').slice(0, 2))}
            keyboardType="number-pad"
          />
        )}
        {mode === 'valid_until_date' && (
          <Field
            label="Last day (YYYY-MM-DD)"
            value={until}
            onChangeText={setUntil}
            placeholder="2027-01-15"
          />
        )}
        {mode === 'one_time' && (
          <Text variant="small">
            Access ends after their first confirmed pickup, or after 24 hours.
          </Text>
        )}
      </Card>
      <Button
        testID="send-invitation"
        title="Create invitation"
        loading={invite.isPending}
        disabled={!valid}
        onPress={() => invite.mutate()}
      />
      {!limited && (
        <Text variant="small">
          You can change access or remove this person later. Removing someone frees the license for
          reuse this term.
        </Text>
      )}
    </Screen>
  );
}
