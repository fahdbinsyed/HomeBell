import { createMockBilling } from './mock-store';

/** iOS: Apple In-App Purchase / StoreKit 2 (Phase 5). Phase 1 uses the mock sheet with the App Store provider. */
export const billing = createMockBilling('apple_app_store');
