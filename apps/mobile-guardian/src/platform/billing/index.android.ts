import { createMockBilling } from './mock-store';

/** Android: Google Play Billing (Phase 5). Phase 1 uses the mock sheet with the Play provider. */
export const billing = createMockBilling('google_play');
