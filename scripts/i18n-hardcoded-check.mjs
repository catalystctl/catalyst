#!/usr/bin/env node
/**
 * Fails when the panel grows new hardcoded user-facing strings.
 *
 * `i18next-cli lint` already finds them, but the panel legitimately contains
 * plenty of literal text that must not be translated (process signals, units,
 * product names, code samples, keyboard hints). Those are recorded, once, in
 * `scripts/i18n-hardcoded-baseline.json` with a reason each; everything the
 * linter reports after that has to be either translated or added to the
 * baseline on purpose.
 *
 * Usage:
 *   node scripts/i18n-hardcoded-check.mjs            # verify (CI)
 *   node scripts/i18n-hardcoded-check.mjs --update   # re-record the baseline
 *   node scripts/i18n-hardcoded-check.mjs --list     # print current findings
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FRONTEND = path.join(ROOT, 'catalyst-frontend');
const BASELINE_PATH = path.join(ROOT, 'scripts', 'i18n-hardcoded-baseline.json');

/** Sample code that demonstrates the plugin API — not panel copy. */
const IGNORED_PREFIXES = ['src/plugins/example-plugin/'];

const key = (finding) => `${finding.file}\u0000${finding.type}\u0000${finding.text}`;

function collectFindings() {
  const stdout = execFileSync(
    'pnpm',
    ['--filter', 'catalyst-frontend', 'exec', 'tsx', 'scripts/i18n-lint-json.mts'],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  );
  const findings = JSON.parse(stdout);
  return findings
    .filter((finding) => !IGNORED_PREFIXES.some((prefix) => finding.file.startsWith(prefix)))
    .map((finding) => ({ ...finding, text: finding.text.replace(/\s+/g, ' ').trim() }));
}

function countFindings(findings) {
  const counts = new Map();
  for (const finding of findings) {
    const id = key(finding);
    const entry = counts.get(id) ?? { ...finding, count: 0 };
    entry.count += 1;
    counts.set(id, entry);
  }
  return counts;
}

function loadBaseline() {
  try {
    return JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
  } catch {
    return { note: '', entries: [] };
  }
}

function writeBaseline(entries) {
  const sorted = [...entries].sort((a, b) => key(a).localeCompare(key(b)));
  const payload = {
    note:
      'Literal strings the i18next linter reports that are deliberately not translated. ' +
      'Every entry needs a reason: reviewers use them to tell reviewed text apart from text ' +
      'nobody has looked at yet. Add translated copy to the catalogs instead of this file. ' +
      'Regenerate with: node scripts/i18n-hardcoded-check.mjs --update',
    entries: sorted,
  };
  writeFileSync(BASELINE_PATH, `${JSON.stringify(payload, null, 2)}\n`);
}

const args = new Set(process.argv.slice(2));
const findings = collectFindings();
const current = countFindings(findings);

if (args.has('--list')) {
  for (const entry of [...current.values()].sort((a, b) => key(a).localeCompare(key(b)))) {
    console.log(`${entry.file}:${entry.line} [${entry.type}] ${entry.text}`);
  }
  console.log(`\n${findings.length} finding(s) outside the ignored directories`);
  process.exit(0);
}

if (args.has('--update')) {
  const previous = new Map(loadBaseline().entries.map((entry) => [key(entry), entry]));
  const entries = [...current.values()].map((entry) => ({
    file: entry.file,
    type: entry.type,
    text: entry.text,
    count: entry.count,
    reason: previous.get(key(entry))?.reason ?? '',
  }));
  writeBaseline(entries);
  const missing = entries.filter((entry) => !entry.reason);
  console.log(`baseline updated: ${entries.length} entries (${missing.length} still need a reason)`);
  process.exit(0);
}

const baseline = new Map(loadBaseline().entries.map((entry) => [key(entry), entry]));
const added = [];
const stale = [];

for (const [id, entry] of current) {
  const allowed = baseline.get(id);
  if (!allowed) {
    added.push(entry);
  } else if (entry.count > allowed.count) {
    added.push({ ...entry, count: entry.count - allowed.count });
  }
}
for (const [id, entry] of baseline) {
  const seen = current.get(id);
  if (!seen || seen.count < entry.count) stale.push(entry);
}

if (added.length === 0) {
  console.log(`i18n: no new hardcoded strings (${current.size} known, ${findings.length} occurrences)`);
  if (stale.length > 0) {
    console.log(
      `i18n: ${stale.length} baseline entr${stale.length === 1 ? 'y is' : 'ies are'} stale — ` +
        'run `node scripts/i18n-hardcoded-check.mjs --update` to prune',
    );
  }
  process.exit(0);
}

console.error(`i18n: ${added.length} new hardcoded string(s) found\n`);
for (const entry of added) {
  const times = entry.count > 1 ? ` (x${entry.count})` : '';
  console.error(`  ${entry.file}:${entry.line} [${entry.type}] "${entry.text}"${times}`);
}
console.error(
  [
    '',
    'User-visible text must go through t() (or <Trans>) so it can be translated:',
    '  1. wrap the string, then run `pnpm --filter catalyst-frontend run i18n:extract`',
    '  2. translate the new key in src/i18n/locales/zh-CN/<namespace>.json',
    '',
    'If the string must stay literal (technical token, product name, unit symbol,',
    'keyboard hint, code sample), record it with a reason:',
    '  node scripts/i18n-hardcoded-check.mjs --update',
    '  (then explain the added entries in scripts/i18n-hardcoded-baseline.json)',
  ].join('\n'),
);
process.exit(1);
