import '@testing-library/jest-dom/vitest';
import i18n from './src/i18n';

// Unit tests render against the complete English catalog: every namespace is
// loaded eagerly so components never suspend, and English copy stays identical
// to the pre-i18n assertions.
const englishCatalogs = import.meta.glob<{ default: Record<string, unknown> }>(
  './src/i18n/locales/en/*.json',
  { eager: true },
);

for (const [path, module] of Object.entries(englishCatalogs)) {
  const namespace = path.split('/').pop()!.replace(/\.json$/, '');
  i18n.addResourceBundle('en', namespace, module.default, true, true);
}

i18n.options.react = { ...(i18n.options.react ?? {}), useSuspense: false };
