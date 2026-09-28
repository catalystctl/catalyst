import { defineConfig } from 'i18next-cli';

export default defineConfig({
  locales: ['en', 'fr', 'zh-CN'],
  extract: {
    input: ['src/**/*.{ts,tsx}'],
    ignore: ['src/**/__tests__/**', 'src/**/*.{test,spec}.*'],
    output: 'src/i18n/locales/{{language}}/{{namespace}}.json',
    defaultNS: 'common',
    primaryLanguage: 'en',
    // Backend error codes and validation rule codes are looked up at runtime
    // (`t(code)`), so their namespaces must never be pruned as "unused".
    // Clone blockers/warnings/changes are addressed by the stable codes the
    // backend returns, so those subtrees are runtime lookups too.
    preservePatterns: [
      'errors:*',
      'validation:*',
      'servers:cloneServer.blockers.*',
      'servers:cloneServer.warnings.*',
      'servers:cloneServer.changeLabels.*',
    ],
    removeUnusedKeys: true,
    // Examples of t('…') in comments are documentation, not UI copy.
    extractFromComments: false,
    sort: true,
    indentation: 2,
  },
});
