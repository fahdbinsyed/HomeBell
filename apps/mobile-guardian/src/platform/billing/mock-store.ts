import type { BillingProvider, PurchaseIntent } from '@homebell/contracts';
import type { BillingService, StorePurchaseOutcome } from '@homebell/client-services';

/**
 * Phase 1 mock of the store purchase sheet. The real adapters (Google Play Billing / StoreKit 2)
 * arrive in Phase 5 behind the same BillingService interface. A host component renders the sheet
 * (cross-platform modal — Android alerts are limited to three buttons).
 */
type Pending = {
  intent: PurchaseIntent;
  provider: BillingProvider;
  resolve: (o: StorePurchaseOutcome) => void;
};
const listeners = new Set<(p: Pending | null) => void>();
let current: Pending | null = null;

export const mockStoreSheet = {
  subscribe(l: (p: Pending | null) => void) {
    listeners.add(l);
    l(current);
    return () => listeners.delete(l);
  },
  settle(outcome: StorePurchaseOutcome) {
    current?.resolve(outcome);
    current = null;
    listeners.forEach((l) => l(null));
  },
};

export function createMockBilling(provider: BillingProvider): BillingService {
  return {
    provider,
    isAvailable: async () => true,
    purchase: (intent) =>
      new Promise<StorePurchaseOutcome>((resolve) => {
        current = { intent, provider, resolve };
        listeners.forEach((l) => l(current));
      }),
    pendingUnconfirmed: async () => [],
  };
}
