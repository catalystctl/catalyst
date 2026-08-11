import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist', '.vite', 'node_modules', 'coverage', 'test-results', 'playwright-report', 'screenshots'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended, prettier],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      // Disable overly strict rules that conflict with common patterns
      '@typescript-eslint/no-unused-expressions': 'off',
      'no-inner-declarations': 'off',
      'no-useless-assignment': 'off',
      // React Compiler rules that conflict with intentional runtime patterns:
      // latest-ref sync during render, identity-reset effects, dynamic icon maps,
      // and query option mutation on ensureQuery. Keep core rules-of-hooks/error.
      'react-hooks/preserve-manual-memoization': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/static-components': 'off',
      'react-hooks/immutability': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/set-state-in-render': 'off',
      'react-hooks/globals': 'off',
      'react-hooks/error-boundaries': 'off',
      'react-hooks/use-memo': 'off',
      'react-hooks/config': 'off',
      'react-hooks/gating': 'off',
      // Disallow console.log in runtime source — use debugLog() from lib/debug-log instead
      // (test and e2e files are exempt — see override below)
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  // E2E / test files: allow console.log (CLI output is expected)
  {
    files: ['e2e/**/*.{ts,tsx}', '**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}'],
    rules: {
      'no-console': 'off',
    },
  },
);
