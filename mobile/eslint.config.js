// https://docs.expo.dev/guides/using-eslint/
const { defineConfig, globalIgnores } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  globalIgnores(['dist/*', '.expo/*', 'ios/*', 'android/*']),
  expoConfig,
  {
    rules: {
      // Match the web app's style (AGENTS.md at the repo root).
      yoda: ['error', 'always', { onlyEquality: true }],
      'no-console': ['warn', { allow: ['info', 'warn', 'error', 'debug', 'trace'] }],
    },
  },
]);
