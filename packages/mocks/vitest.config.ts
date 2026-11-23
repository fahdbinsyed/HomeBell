import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 60_000,
    // Tests share a module-level coverage/failure registry; run in one worker, in order.
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
