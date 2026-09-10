import { defineConfig } from 'i18next-cli';

export default defineConfig({
  locales: ['en', 'zh-CN'],
  extract: {
    input: ['src/**/*.{ts,tsx}'],
    ignore: ['src/**/__tests__/**', 'src/**/*.{test,spec}.*'],
    output: 'src/i18n/locales/{{language}}/{{namespace}}.json',
    defaultNS: 'common',
    primaryLanguage: 'en',
    // Backend error codes and validation rule codes are looked up at runtime
    // (`t(code)`), so their namespaces must never be pruned as "unused".
    preservePatterns: ['errors:*', 'validation:*'],
    removeUnusedKeys: true,
    // Examples of t('…') in comments are documentation, not UI copy.
    extractFromComments: false,
    sort: true,
    indentation: 2,
  },
});
