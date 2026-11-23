// Standard Expo preset (SDK 58). Present so babel-jest can also compile ESM-only (.mjs) dependencies in tests.
module.exports = function (api) {
  api.cache(true);
  return { presets: ['babel-preset-expo'] };
};
