#!/usr/bin/env node
/**
 * Translation catalog checks.
 *
 * Policies:
 * - every catalog file must be valid JSON
 * - `en` is the source of truth; secondary locales may not define keys that
 *   are absent from `en` (stale or misspelled keys)
 * - keys missing from a secondary locale are allowed — they fall back to
 *   English at runtime — but are reported so translators can see progress
 * - backend error codes with no entry in `en/errors.json` are reported
 *   (a warning by default, an error with --strict)
 *
 * Usage: node scripts/i18n-check.mjs [--strict]
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const localesDir = path.join(repoRoot, 'catalyst-frontend/src/i18n/locales');
const primaryLocale = 'en';

const strict = process.argv.includes('--strict');
const problems = [];
const warnings = [];

function catalogFiles(locale) {
  return readdirSync(path.join(localesDir, locale)).filter((file) => file.endsWith('.json'));
}

function namespaceOf(file) {
  return file.replace(/\.json$/, '');
}

/** Flatten a catalog into dot-separated leaf keys. */
function flattenLeaves(value, prefix, entries) {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) {
      flattenLeaves(child, prefix ? `${prefix}.${key}` : key, entries);
    }
    return;
  }
  entries.set(prefix, value);
}

function readNamespace(locale, file) {
  const raw = readFileSync(path.join(localesDir, locale, file), 'utf8');
  try {
    const entries = new Map();
    flattenLeaves(JSON.parse(raw), '', entries);
    return entries;
  } catch (error) {
    problems.push(`${locale}/${file}: invalid JSON (${error.message})`);
    return null;
  }
}

const locales = readdirSync(localesDir).filter((entry) =>
  statSync(path.join(localesDir, entry)).isDirectory(),
);

if (!locales.includes(primaryLocale)) {
  console.error(`i18n: primary locale directory "${primaryLocale}" not found in ${localesDir}`);
  process.exit(1);
}

// en: namespace -> Map<key, value>
const primary = new Map();
for (const file of catalogFiles(primaryLocale)) {
  const entries = readNamespace(primaryLocale, file);
  if (entries) primary.set(namespaceOf(file), entries);
}
const totalKeys = [...primary.values()].reduce((sum, entries) => sum + entries.size, 0);

for (const locale of locales) {
  if (locale === primaryLocale) continue;

  const present = new Map();
  for (const file of catalogFiles(locale)) {
    const entries = readNamespace(locale, file);
    if (entries) present.set(namespaceOf(file), entries);
  }

  let translated = 0;
  let untranslated = 0;

  for (const [namespace, primaryEntries] of primary) {
    const localeEntries = present.get(namespace) ?? new Map();
    for (const key of localeEntries.keys()) {
      if (!primaryEntries.has(key)) {
        problems.push(`${locale}/${namespace}.json: key "${key}" does not exist in ${primaryLocale}`);
      }
    }
    for (const [key, value] of primaryEntries) {
      if (localeEntries.has(key) && localeEntries.get(key) !== '') translated += 1;
      else untranslated += 1;
    }
  }

  const known = translated + untranslated;
  const coverage = known === 0 ? 100 : Math.round((translated / known) * 100);
  console.log(
    `i18n: ${locale}: ${translated}/${known} keys translated (${coverage}%), ${untranslated} awaiting translation`,
  );
}

// Backend error codes with no frontend translation.
const errorCodes = new Set();
const errorCodesDir = path.join(repoRoot, 'catalyst-backend/src/lib/error-codes');
try {
  for (const file of readdirSync(errorCodesDir)) {
    if (!file.endsWith('.ts') || file === 'index.ts') continue;
    const source = readFileSync(path.join(errorCodesDir, file), 'utf8');
    for (const match of source.matchAll(/^\s*([A-Z][A-Z0-9_]*)\s*:\s*"/gm)) {
      errorCodes.add(match[1]);
    }
  }
} catch (error) {
  warnings.push(`could not read backend error codes from ${errorCodesDir}: ${error.message}`);
}

const errorsCatalog = primary.get('errors') ?? new Map();
const untranslatedCodes = [...errorCodes].filter((code) => !errorsCatalog.has(code));
if (untranslatedCodes.length > 0) {
  const message = `backend error codes without an en/errors.json entry: ${untranslatedCodes.join(', ')}`;
  if (strict) problems.push(message);
  else warnings.push(message);
}

for (const warning of warnings) console.warn(`i18n: warning: ${warning}`);

if (problems.length > 0) {
  console.error(`i18n: ${problems.length} problem(s) found:`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(`i18n: ok (${locales.length} locales, ${totalKeys} keys in ${primaryLocale})`);
