// Fallback for tooling (TypeScript, Jest). Metro picks index.android.ts / index.ios.ts at bundle time.
import { createMockBilling } from './mock-store';

export const billing = createMockBilling('google_play');
