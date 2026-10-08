import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "browser",
          include: ["apps/api/test/**/*.browser.test.ts"],
          fileParallelism: false,
          hookTimeout: 120000,
          testTimeout: 120000,
        },
      },
      { test: { name: "unit", include: ["apps/api/test/**/*.unit.test.ts"] } },
      {
        test: {
          name: "integration",
          include: ["apps/api/test/**/*.integration.test.ts"],
          fileParallelism: false,
          testTimeout: 30000,
          hookTimeout: 60000,
        },
      },
    ],
  },
});
