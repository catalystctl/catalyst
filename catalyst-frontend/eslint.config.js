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
      // React Compiler memoization warnings (experimental feature)
      'react-hooks/preserve-manual-memoization': 'off',
    },
  },
);
