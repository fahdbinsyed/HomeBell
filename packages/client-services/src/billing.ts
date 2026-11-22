import type { BillingProvider, PurchaseIntent } from '@homebell/contracts';

export type StorePurchaseOutcome =
  | { status: 'purchased'; purchaseToken: string; productId: string; orderId?: string }
  | { status: 'pending' }
  | { status: 'cancelled' }
  | {
      status: 'failed';
      reason: 'store_unavailable' | 'item_unavailable' | 'already_owned' | 'unknown';
    };

/**
 * Store billing (ADR-0005, ADR-0017). Mock (Phase 1) simulates the purchase sheet;
 * Phase 5: Google Play Billing on Android, StoreKit 2 on iOS — one interface, selected per platform.
 * On iOS `purchaseToken` is the signed transaction (JWS). The server verifies every purchase —
 * a 'purchased' outcome here grants nothing until /complete succeeds.
 */
export interface BillingService {
  readonly provider: BillingProvider;
  isAvailable(): Promise<boolean>;
  /** Launch the store purchase sheet using the server-issued intent. */
  purchase(intent: PurchaseIntent): Promise<StorePurchaseOutcome>;
  /** Purchases completed at the store but not yet confirmed with the server (app killed mid-flow). */
  pendingUnconfirmed(): Promise<
    Array<{
      purchaseToken: string;
      productId: string;
      obfuscatedProfileId?: string;
      appAccountToken?: string;
    }>
  >;
}
