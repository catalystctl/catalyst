#!/usr/bin/env node
/**
 * Audit every request body the backend validates before it reaches a route.
 *
 * Why: a schema stricter than the data the panel legitimately sends rejects a
 * request the UI believed was valid, and the user only sees a validation
 * failure. The 1.88.x "changing the container image always says Invalid request
 * body" bug was exactly that — `environment` values required min(1) while
 * stored eggs carry "".
 *
 * What this prints, per validated route:
 *   - the method + path, the schema, and where the schema is declared
 *   - the constraints that can reject a value (min/max/enum/required/regex)
 *   - whether the rejection is reported with a stable code + field details
 *     (so the panel can name the field) or is opaque
 *
 * Usage:
 *   node scripts/audit-validation-contract.mjs            # human table
 *   node scripts/audit-validation-contract.mjs --json     # machine readable
 *   node scripts/audit-validation-contract.mjs --opaque   # only opaque sites
 *
 * Exit code is 1 when an opaque rejection site is found, so this can run in CI.
 * It reads source text; it does not import the app or touch the database.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const args = new Set(process.argv.slice(2));
const asJson = args.has('--json');
const onlyOpaque = args.has('--opaque');

const walk = (dir, out = []) => {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue;
      walk(full, out);
    } else if (entry.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
};

const files = walk(SRC);
const read = (file) => readFileSync(file, 'utf8');
const rel = (file) => path.relative(ROOT, file);

/** Constraint summary for a schema body, e.g. min(1), max(100), enum(a|b). */
function constraintsOf(schemaSource) {
  const out = [];
  for (const match of schemaSource.matchAll(/\.min\(([^)]*)\)/g)) out.push(`min(${match[1]})`);
  for (const match of schemaSource.matchAll(/\.max\(([^)]*)\)/g)) out.push(`max(${match[1]})`);
  for (const match of schemaSource.matchAll(/\.regex\((\/[^/]+\/[a-z]*)/g)) out.push(`regex(${match[1]})`);
  for (const match of schemaSource.matchAll(/z\.enum\((?:\[([^\]]*)\]|([A-Za-z0-9_]+))/g)) {
    out.push(`enum(${(match[1] ?? match[2] ?? '').replace(/\s+/g, ' ').trim()})`);
  }
  if (/\bz\.record\(/.test(schemaSource)) out.push('record');
  return out;
}

/**
 * Locate a schema declaration and return its source body. Schemas are declared
 * either in lib/validation.ts or inside the route module that uses them.
 */
function findSchema(name, preferredFile) {
  const candidates = [
    path.join(SRC, 'lib', 'validation.ts'),
    preferredFile,
    ...files.filter((file) => file !== preferredFile),
  ];
  for (const file of candidates) {
    if (!file) continue;
    const source = read(file);
    const declaration = new RegExp(
      `(?:export\\s+)?const\\s+${name}\\s*(?::[^=]+)?=\\s*`,
      'm',
    ).exec(source);
    if (!declaration) continue;
    const start = declaration.index + declaration[0].length;
    // Balance braces/parens so nested object literals are captured whole.
    let depth = 0;
    let end = start;
    for (; end < source.length; end += 1) {
      const char = source[end];
      if (char === '{' || char === '(') depth += 1;
      else if (char === '}' || char === ')') {
        depth -= 1;
        if (depth === 0 && source[end + 1] === ';') break;
        if (depth < 0) break;
      }
    }
    return { file, body: source.slice(start, end + 1) };
  }
  return null;
}

/** Route path + method for the handler registered nearest above an index. */
function routeAt(source, index) {
  const before = source.slice(0, index);
  const methods = [...before.matchAll(/app\.(get|post|put|patch|delete)\(\s*\n?\s*["'`]([^"'`]+)["'`]/g)];
  const last = methods.at(-1);
  if (!last) return { method: '?', routePath: '?' };
  return { method: last[1].toUpperCase(), routePath: last[2] };
}

const sites = [];
for (const file of files) {
  const source = read(file);

  // Family 1: preHandler: [validateRequestBody(schema)]
  for (const match of source.matchAll(/validateRequestBody\(([A-Za-z0-9_]+)\)/g)) {
    const schemaName = match[1];
    const { method, routePath } = routeAt(source, match.index);
    const schema = findSchema(schemaName, file);
    sites.push({
      family: 'validateRequestBody',
      file: rel(file),
      method,
      routePath,
      schema: schemaName,
      schemaFile: schema ? rel(schema.file) : null,
      constraints: schema ? constraintsOf(schema.body) : [],
      // validateRequestBody always answers with a code + details.
      reportsFieldDetails: true,
      reportsCode: true,
    });
  }

  // Family 2: inline schema.safeParse(request.body) blocks that answer 400.
  for (const match of source.matchAll(/([A-Za-z0-9_]+)\.safeParse\(\s*request\.body/g)) {
    const schemaName = match[1];
    const { method, routePath } = routeAt(source, match.index);
    const schema = findSchema(schemaName, file);
    // Look at the rejection branch: does it answer with a stable code and with
    // field details? `apiError(reply, status, ErrorCodes.X, ...)` carries the
    // code positionally, so both shapes count.
    const tail = source.slice(match.index, match.index + 1200);
    sites.push({
      family: 'inline safeParse',
      file: rel(file),
      method,
      routePath,
      schema: schemaName,
      schemaFile: schema ? rel(schema.file) : null,
      constraints: schema ? constraintsOf(schema.body) : [],
      reportsFieldDetails: /\bdetails:/.test(tail),
      reportsCode: /\bcode:/.test(tail) || /apiError\([^;]*ErrorCodes\./.test(tail),
    });
  }
}

sites.sort((a, b) => `${a.file}${a.routePath}`.localeCompare(`${b.file}${b.routePath}`));
/**
 * actionable    code + field details: the panel names the offending field.
 * message-only  no field details, but a stable code and a message that names
 *               the problem itself (e.g. "Preferences payload too large").
 * opaque        neither: the client can only show a generic sentence.
 */
const classify = (site) => {
  if (site.reportsCode && site.reportsFieldDetails) return 'actionable';
  if (site.reportsCode) return 'message-only';
  return 'opaque';
};
for (const site of sites) site.reporting = classify(site);

const opaque = sites.filter((site) => site.reporting === 'opaque');
const shown = onlyOpaque ? sites.filter((site) => site.reporting !== 'actionable') : sites;

if (asJson) {
  console.log(JSON.stringify({ sites: shown, opaqueCount: opaque.length, total: sites.length }, null, 2));
} else {
  const counts = { actionable: 0, 'message-only': 0, opaque: 0 };
  for (const site of sites) counts[site.reporting] += 1;
  console.log(
    `Validated request-body sites: ${sites.length} ` +
      `(actionable: ${counts.actionable}, message-only: ${counts['message-only']}, opaque: ${counts.opaque})\n`,
  );
  for (const site of shown) {
    const reporting = site.reporting.toUpperCase();
    console.log(`${site.method} ${site.routePath}   [${reporting}]`);
    console.log(`  schema: ${site.schema}${site.schemaFile ? ` (${site.schemaFile})` : ' (not found)'}`);
    console.log(`  via:    ${site.family} in ${site.file}`);
    console.log(`  bounds: ${site.constraints.length ? site.constraints.join(', ') : '—'}`);
    console.log('');
  }
  if (opaque.length > 0) {
    console.log('Opaque sites answer without a stable code or field details, so the panel');
    console.log('can only show a generic sentence. Give them apiError(...) style');
    console.log('{ error, code: VALIDATION_ERROR, details: formatZodIssues(...) }.');
  } else {
    console.log('No opaque sites: every validated body rejection carries a stable code, and');
    console.log('every field-level one also names the field (message-only entries name the');
    console.log('problem in their own message).');
  }
}

process.exitCode = opaque.length > 0 ? 1 : 0;
