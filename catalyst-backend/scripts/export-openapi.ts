#!/usr/bin/env npx tsx
/**
 * OpenAPI Exporter — authoritative API contract generator.
 *
 * Scans `src/routes/` for Fastify route registrations and emits an
 * OpenAPI 3.1 document. No database, Redis, or running server required:
 * everything comes from static analysis of the route sources.
 *
 * What is captured per route:
 * - HTTP method + full path (`:param` segments become `{param}`).
 * - Summary/description from the `//` comment block above the registration.
 * - Auth requirement from `preHandler` middleware (`authenticate`,
 *   `require*` permission guards, agent key verification).
 * - Referenced `ErrorCodes.*` values found in the route handler block.
 * - Tags derived deterministically from the URL's API section
 *   (see `tagFor()` — grouping rule, keep it stable).
 *
 * Bodies and response schemas are NOT reconstructed here: request validation
 * lives in zod schemas parsed inside handlers (`.parse(request.body)`), and
 * inventing field lists from filenames would fabricate the contract. Routes
 * list `requestBody: true/false` (zod-validated body present or not) and link
 * back to the source file. Full runtime schemas remain available at the live
 * `/docs` Swagger UI (DOCS_ENABLED=true); this artifact is the committed,
 * reviewable contract for the docs site and SDK authors.
 *
 * Run:  pnpm --filter catalyst-backend run openapi:export
 * Out:  ../api/openapi.json  (repo-relative override: --out <path>)
 */

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const routesDir = resolve(__dirname, '../src/routes');

const args = process.argv.slice(2);
const outFlag = args.indexOf('--out');
const outPath = outFlag >= 0 && args[outFlag + 1]
  ? resolve(args[outFlag + 1])
  : resolve(__dirname, '../../api/openapi.json');

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const;

/**
 * Route prefixes from src/index.ts `app.register(..., { prefix })`.
 * Files using absolute `/api/...` paths ignore this map.
 */
const PREFIXES: Record<string, string> = {
  'auth.ts': '/api/auth',
  'setup.ts': '/api/setup',
  'settings.ts': '/api/settings',
  'nodes.ts': '/api/nodes',
  'servers.ts': '/api/servers',
  'console-stream.ts': '/api/servers',
  'sse-events.ts': '/api/servers',
  'metrics-stream.ts': '/api/servers',
  'templates.ts': '/api/templates',
  'nests.ts': '/api/nests',
  'locations.ts': '/api/locations',
  'metrics.ts': '/api',
  'backups.ts': '/api/servers',
  'admin.ts': '/api/admin',
  'update.ts': '/api/admin/update',
  'admin-events.ts': '/api/admin/events',
  'roles.ts': '/api/roles',
  'tasks.ts': '/api/servers',
  'bulk-servers.ts': '/api/servers',
  'alerts.ts': '/api',
  'dashboard.ts': '/api/dashboard',
  'provider-keys.ts': '/api/providers',
};

interface Operation {
  file: string;
  line: number;
  summary: string;
  description: string;
  requiresAuth: boolean;
  permissions: string[];
  hasBody: boolean;
  errorCodes: string[];
}

/** Deterministic grouping: first meaningful URL section decides the tag. */
function tagFor(path: string): string {
  const seg = path.replace(/^\/api\//, '').split('/')[0] ?? 'misc';
  const map: Record<string, string> = {
    auth: 'Auth',
    servers: 'Servers',
    nodes: 'Nodes',
    templates: 'Templates',
    nests: 'Nests',
    roles: 'Roles',
    admin: 'Admin',
    dashboard: 'Dashboard',
    plugins: 'Plugins',
    setup: 'Setup',
    settings: 'Settings',
    providers: 'Providers',
    internal: 'Internal',
    'alert-rules': 'Alerts',
    update: 'Updates',
    locations: 'Locations',
    alerts: 'Alerts',
    metrics: 'Metrics',
  };
  if (seg === 'admin' && /^\/api\/admin\/api-keys/.test(path)) return 'API Keys';
  if (seg === 'admin' && /^\/api\/admin\/migration/.test(path)) return 'Migration';
  if (seg === 'admin' && /^\/api\/admin\/events/.test(path)) return 'Admin Events';
  return map[seg] ?? 'Misc';
}

function cleanComment(line: string): string {
  return line.replace(/^\s*\/\/\s?/, '').replace(/^─+\s?/, '').trim();
}

function parseFile(file: string): { method: string; path: string; op: Operation }[] {
  const full = resolve(routesDir, file);
  const content = readFileSync(full, 'utf-8');
  const lines = content.split('\n');
  const found: { method: string; path: string; op: Operation }[] = [];

  // Locate route registrations. Style varies: same-line `app.get("/x", ...)`
  // or multi-line `app.get(\n  "/x",`. The path string must appear within
  // the 3 lines following the `app.METHOD(` opener.
  const starts: { idx: number; method: string; rawPath: string }[] = [];
  lines.forEach((line, idx) => {
    for (const method of METHODS) {
      if (!new RegExp(`app\\.${method}\\s*\\(`).test(line)) continue;
      for (let j = idx; j <= Math.min(idx + 3, lines.length - 1); j++) {
        const m = lines[j].match(/["'`](\/[^"'`]*|:[^"'`]*)["'`]/);
        // Accept absolute paths and root-relative paths; skip option keys.
        if (m && (m[1].startsWith('/') || m[1].startsWith(':'))) {
          starts.push({ idx, method: method.toUpperCase(), rawPath: m[1] });
          break;
        }
        if (/[{,]\s*[a-zA-Z]+:/.test(lines[j]) && j > idx) break;
      }
      break;
    }
  });

  const prefix = PREFIXES[basename(file)] ?? (file.startsWith('servers/') ? '/api/servers' : '');

  starts.forEach((s, n) => {
    const end = n + 1 < starts.length ? starts[n + 1].idx : lines.length;
    // Absolute paths are used as-is; relative ones join the file's prefix.
    const path = s.rawPath.startsWith('/api/') || s.rawPath.startsWith('/api ')
      ? s.rawPath
      : `${prefix}${s.rawPath === '/' ? '' : s.rawPath}`;
    if (!path.startsWith('/api/')) return;

    // Description: contiguous // comment lines directly above the registration.
    const descLines: string[] = [];
    for (let j = s.idx - 1; j >= Math.max(0, s.idx - 6); j--) {
      const t = lines[j].trim();
      if (t.startsWith('//')) descLines.unshift(cleanComment(lines[j]));
      else if (t === '' || t.startsWith('*') || t.startsWith('/*') || t.startsWith('*/')) continue;
      else break;
    }
    const summary = (descLines[0] ?? `${s.method} ${path}`).slice(0, 120);
    const description = descLines.join('\n');

    // Options block: registration line through the handler start.
    const head = lines.slice(s.idx, Math.min(s.idx + 20, end)).join('\n');
    const requiresAuth = /authenticate|verifyAgentApiKey|requireAuth|apiKeyAuth|withAuth|requireAdmin|require[A-Z][A-Za-z]*\(|onRequest/.test(head);
    const permissions = [...head.matchAll(/require([A-Z][A-Za-z]*)/g)].map((m) => m[1]);

    // Handler block: zod body parsing + referenced error codes.
    const block = lines.slice(s.idx, end).join('\n');
    const hasBody = /\.parse\(\s*request\.body/.test(block) || /request\.body/.test(block);
    const errorCodes = [...new Set([...block.matchAll(/ErrorCodes\.([A-Z0-9_]+)/g)].map((m) => m[1]))];

    found.push({
      method: s.method,
      path,
      op: { file: `src/routes/${file}`, line: s.idx + 1, summary, description, requiresAuth, permissions, hasBody, errorCodes },
    });
  });
  return found;
}

function openapiPath(raw: string): string {
  return raw.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

function main(): void {
  // Route registrations also live one level down (servers/ subfolder).
  const files: string[] = [];
  for (const entry of readdirSync(routesDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.ts')) files.push(entry.name);
    if (entry.isDirectory()) {
      for (const sub of readdirSync(resolve(routesDir, entry.name))) {
        if (sub.endsWith('.ts')) files.push(`${entry.name}/${sub}`);
      }
    }
  }
  files.sort();

  const paths: Record<string, Record<string, unknown>> = {};
  let count = 0;
  for (const file of files) {
    if (basename(file).includes('.test.')) continue;
    for (const { method, path, op } of parseFile(file)) {
      const key = openapiPath(path);
      const params = [...key.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((m) => ({
        name: m[1],
        in: 'path',
        required: true,
        schema: { type: 'string' },
      }));
      const operation: Record<string, unknown> = {
        summary: op.summary,
        ...(op.description && op.description !== op.summary ? { description: op.description } : {}),
        tags: [tagFor(path)],
        ...(params.length > 0 ? { parameters: params } : {}),
        ...(op.hasBody
          ? { requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } } }
          : {}),
        responses: {
          '2xx': { description: 'Success (envelope: `{ success, data }`) — see endpoint notes.' },
          ...(op.requiresAuth ? { '401': { description: 'Unauthenticated.' } } : {}),
          '403': { description: 'Forbidden (`PERMISSION_DENIED`) — missing permission.' },
          ...(op.errorCodes.length > 0
            ? { '4xx': { description: `Documented codes in this handler: ${op.errorCodes.join(', ')}.` } }
            : {}),
        },
        ...(op.requiresAuth ? { security: [{ bearerAuth: [], cookieAuth: [] }] } : {}),
        'x-catalyst': {
          source: `${op.file}:${op.line}`,
          ...(op.permissions.length > 0 ? { permissionGuards: op.permissions } : {}),
          ...(op.errorCodes.length > 0 ? { errorCodes: op.errorCodes } : {}),
        },
      };
      paths[key] ??= {};
      // First registration wins on method+path duplicates (route shadowing).
      if (paths[key][method.toLowerCase()] === undefined) {
        paths[key][method.toLowerCase()] = operation;
        count++;
      }
    }
  }

  const doc = {
    openapi: '3.1.0',
    info: {
      title: 'Catalyst API',
      description:
        'Authoritative endpoint contract generated statically from catalyst-backend/src/routes/. ' +
        'Request/response shapes are validated by zod schemas in the handlers; this document captures ' +
        'routes, auth, parameters, and referenced error codes. Generated by scripts/export-openapi.ts — do not edit by hand.',
      version: '1.0.0',
    },
    servers: [{ url: '/api', description: 'Same origin as the panel' }],
    security: [],
    tags: [...new Set(Object.values(paths).flatMap((ops) => Object.values(ops).flatMap((o) => (o as { tags: string[] }).tags)))].sort().map((name) => ({ name })),
    paths: Object.fromEntries(Object.entries(paths).sort(([a], [b]) => a.localeCompare(b))),
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', description: 'Admin/user API key.' },
        cookieAuth: { type: 'apiKey', in: 'cookie', name: 'session', description: 'Panel session cookie.' },
      },
      responses: {
        Error: {
          description: 'Standard error envelope.',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['success', 'error', 'code'],
                properties: {
                  success: { type: 'boolean', const: false },
                  error: { type: 'string' },
                  code: { type: 'string', description: 'Stable machine-readable code — branch on this.' },
                },
              },
            },
          },
        },
      },
    },
  };

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(doc, null, 2)}\n`);
  console.log(`export-openapi: ${count} operations from ${files.length} files → ${outPath}`);
}

main();
