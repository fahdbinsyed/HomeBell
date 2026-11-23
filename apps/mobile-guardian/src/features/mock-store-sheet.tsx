import { useEffect, useState } from 'react';
import { Modal, View } from 'react-native';
import { formatDate, formatMoney } from '@homebell/copy';
import { mockStoreSheet } from '@/platform/billing/mock-store';
import { Button, Text } from '@/ui/components';
import { useTheme } from '@/ui/theme';

type Pending = Parameters<Parameters<typeof mockStoreSheet.subscribe>[0]>[0];

/** Phase 1 stand-in for the Google Play / App Store purchase sheet (mock mode only). */
export function MockStoreSheetHost() {
  const [pending, setPending] = useState<Pending>(null);
  const { c, radius } = useTheme();
  useEffect(() => {
    const unsubscribe = mockStoreSheet.subscribe(setPending);
    return () => void unsubscribe();
  }, []);
  const store = pending?.provider === 'apple_app_store' ? 'App Store' : 'Google Play';
  return (
    <Modal
      visible={!!pending}
      transparent
      animationType="slide"
      onRequestClose={() => mockStoreSheet.settle({ status: 'cancelled' })}
    >
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' }}>
        <View
          accessibilityViewIsModal
          style={{
            backgroundColor: c.surface,
            padding: 20,
            gap: 12,
            borderTopLeftRadius: radius.xl,
            borderTopRightRadius: radius.xl,
          }}
        >
          <Text variant="small">MOCK {store.toUpperCase()} — no real payment</Text>
          <Text variant="heading">Additional guardian license</Text>
          <Text variant="muted">
            {pending?.intent.displayPrice ? formatMoney(pending.intent.displayPrice) : ''} · valid
            until {formatDate(pending?.intent.seatTermEndsAt)}
          </Text>
          <Button
            testID="store-buy"
            title="Buy"
            onPress={() =>
              mockStoreSheet.settle({
                status: 'purchased',
                purchaseToken: `ok-${Date.now()}`,
                productId: pending!.intent.productId,
              })
            }
          />
          <Button
            testID="store-pending"
            title="Simulate pending payment"
            variant="secondary"
            onPress={() =>
              mockStoreSheet.settle({
                status: 'purchased',
                purchaseToken: `pending-${Date.now()}`,
                productId: pending!.intent.productId,
              })
            }
          />
          <Button
            testID="store-fail"
            title="Simulate verification failure"
            variant="secondary"
            onPress={() =>
              mockStoreSheet.settle({
                status: 'purchased',
                purchaseToken: `invalid-${Date.now()}`,
                productId: pending!.intent.productId,
              })
            }
          />
          <Button
            testID="store-cancel"
            title="Cancel"
            variant="ghost"
            onPress={() => mockStoreSheet.settle({ status: 'cancelled' })}
          />
        </View>
      </View>
    </Modal>
  );
}
