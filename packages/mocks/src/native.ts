/**
 * React Native wiring. The guardian app passes `env.fetch` to the API client; no global
 * patching or polyfills are needed. Persistence is optional (in-memory by default) — pass a
 * synchronous KeyValueStore (e.g. backed by expo-sqlite/kv-store) to keep demo data across reloads.
 */
export { createMockEnvironment } from './environment';
export * from './index';
