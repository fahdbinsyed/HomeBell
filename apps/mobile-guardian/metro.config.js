// Default Expo Metro config (handles the pnpm monorepo automatically, SDK 52+), plus one alias:
// `msw` → the Hermes-safe stand-in in packages/mocks (see packages/mocks/src/msw-lite.ts).
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
const mswLite = path.resolve(__dirname, '../../packages/mocks/src/msw-lite.ts');
const defaultResolve = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'msw') return { type: 'sourceFile', filePath: mswLite };
  return (defaultResolve ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
