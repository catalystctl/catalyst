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
 * - Summary/description and Fastify schema metadata declared on the registration.
 * - Auth requirement from `preHandler` middleware (`authenticate`,
 *   `require*` permission guards, agent key verification).
 * - Referenced `ErrorCodes.*` values found in the route handler block.
 * - Tags derived deterministically from the URL's API section
 *   (see `tagFor()` — grouping rule, keep it stable).
 *
 * Schemas are copied only when a route declares a literal Fastify `schema`
 * object. Handler-local Zod parsing is deliberately not guessed: inventing
 * field lists from filenames or destructuring would fabricate the contract.
 *
 * Run:  pnpm --filter catalyst-backend run openapi:export
 * Out:  ../api/openapi.json  (repo-relative override: --out <path>)
 */

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ErrorCodes } from '../src/lib/error-codes/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const routesDir = resolve(__dirname, '../src/routes');
const sourceDir = resolve(__dirname, '../src');

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
  schema?: Record<string, unknown>;
  statusCodes: string[];
  errorCodes: string[];
  mediaTypes: string[];
}

type OpenApiSchema = Record<string, unknown>;

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });

/**
 * Contracts for schemas which are deliberately kept local to route modules.
 * Keep these in lock-step with the Zod declarations in the referenced source
 * files; this registry is the static-export boundary and is not runtime input
 * validation.  Do not add fields which are not accepted by those schemas.
 */
const CONTRACTS: Record<string, OpenApiSchema> = {
  ServerCreate: {
    type: 'object', required: ['name', 'templateId', 'nodeId', 'locationId', 'primaryPort', 'allocatedMemoryMb', 'allocatedCpuCores', 'allocatedDiskMb'],
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 100 }, description: { type: 'string', maxLength: 500 },
      templateId: { type: 'string', minLength: 1 }, nodeId: { type: 'string', minLength: 1 }, locationId: { type: 'string', minLength: 1 }, ownerId: { type: 'string', minLength: 1 },
      environment: { type: 'object', additionalProperties: { type: 'string', minLength: 1, maxLength: 4096 }, default: {} },
      portBindings: { type: 'object', additionalProperties: { type: 'integer', minimum: 1, maximum: 65535 }, default: {} },
      primaryPort: { type: 'integer', minimum: 1, maximum: 65535 }, primaryIp: { type: ['string', 'null'], maxLength: 45 }, allocationId: { type: 'string', minLength: 1 },
      allocatedMemoryMb: { type: 'integer', minimum: 512, maximum: 131072 }, allocatedCpuCores: { type: 'integer', minimum: 1, maximum: 128 }, allocatedDiskMb: { type: 'integer', minimum: 1024, maximum: 1048576 },
      backupAllocationMb: { type: 'integer', minimum: 0, maximum: 1048576 }, databaseAllocation: { type: 'integer', minimum: 0, maximum: 1048576 },
      networkMode: { type: 'string', enum: ['bridge', 'macvlan', 'host', 'mc-lan-static', 'mc-lan-dynamic'], default: 'mc-lan-static' },
    },
  },
  ServerUpdate: {
    type: 'object', properties: {
      name: { type: 'string', minLength: 1, maxLength: 100 }, description: { type: 'string', maxLength: 500 }, environment: { type: 'object', additionalProperties: { type: 'string' } },
      startupCommand: { type: ['string', 'null'], maxLength: 4096 }, portBindings: { type: 'object', additionalProperties: { type: 'integer', minimum: 1, maximum: 65535 } },
      allocatedMemoryMb: { type: 'integer', minimum: 512, maximum: 131072 }, allocatedCpuCores: { type: 'integer', minimum: 1, maximum: 128 }, allocatedDiskMb: { type: 'integer', minimum: 1024, maximum: 1048576 },
      backupAllocationMb: { type: 'integer', minimum: 0, maximum: 1048576 }, databaseAllocation: { type: 'integer', minimum: 0, maximum: 1024 }, primaryPort: { type: 'integer', minimum: 1, maximum: 65535 }, primaryIp: { type: ['string', 'null'], maxLength: 45 }, allocationId: { type: 'string', maxLength: 64 }, networkMode: { type: 'string', enum: ['bridge', 'macvlan', 'host'] },
    },
  },
  ServerClone: {
    type: 'object', properties: {
      mode: { type: 'string', enum: ['full', 'configuration'] }, nodeId: { type: 'string', minLength: 1 }, targetNodeId: { type: 'string', minLength: 1 }, copyFiles: { type: 'boolean' }, preflightId: { type: 'string', minLength: 1 }, fingerprint: { type: 'string', minLength: 8 }, acknowledgedWarnings: { type: 'array', items: { type: 'string', minLength: 1 }, default: [] },
      name: { type: 'string', minLength: 1, maxLength: 100 }, description: { type: 'string', maxLength: 500 }, allocatedMemoryMb: { type: 'integer', minimum: 512, maximum: 131072 }, allocatedCpuCores: { type: 'integer', minimum: 1, maximum: 128 }, allocatedDiskMb: { type: 'integer', minimum: 1024, maximum: 1048576 }, allocatedSwapMb: { type: 'integer', minimum: 0, maximum: 131072 }, ioWeight: { type: 'integer', minimum: 10, maximum: 1000 }, backupAllocationMb: { type: 'integer', minimum: 0, maximum: 1048576 }, databaseAllocation: { type: 'integer', minimum: 0, maximum: 1048576 }, environment: { type: 'object', additionalProperties: { type: 'string', minLength: 1, maxLength: 4096 } }, ownerId: { type: 'string', minLength: 1 }, allocationId: { type: 'string', minLength: 1 }, networkMode: { type: 'string', enum: ['bridge', 'macvlan', 'host', 'mc-lan-static', 'mc-lan-dynamic'] }, backupStorageMode: { type: 'string', enum: ['local', 's3', 'stream'] }, copyBackupCredentials: { type: 'boolean', default: false }, includeAccess: { type: 'boolean', default: true }, includeRoleGrants: { type: 'boolean', default: true }, includeScheduledTasks: { type: 'boolean', default: false }, includeDatabases: { type: 'boolean', default: false }, includeInstalledMods: { type: 'boolean' },
    },
  },
  Allocation: { type: 'object', properties: { allocationId: { type: 'string', minLength: 1 }, containerPort: { type: 'integer', minimum: 1, maximum: 65535 }, hostPort: { type: 'integer', minimum: 1, maximum: 65535 } }, anyOf: [{ required: ['allocationId'] }, { required: ['containerPort', 'hostPort'] }] },
  ApiKeyCreate: { type: 'object', required: ['name'], properties: { name: { type: 'string', minLength: 1, maxLength: 100 }, expiresIn: { type: 'number', minimum: 3600, maximum: 31536000 }, allPermissions: { type: 'boolean', default: false }, permissions: { type: 'array', items: { type: 'string' }, default: [] }, metadata: { type: 'object', additionalProperties: true }, rateLimitMax: { type: 'number', minimum: 1, maximum: 10000, default: 100 }, rateLimitTimeWindow: { type: 'number', minimum: 1000, maximum: 3600000, default: 60000 } } },
  ApiKeyUpdate: { type: 'object', properties: { name: { type: 'string', minLength: 1, maxLength: 100 }, enabled: { type: 'boolean' }, rateLimitMax: { type: 'integer', minimum: 1, maximum: 10000 }, rateLimitTimeWindow: { type: 'integer', minimum: 1000, maximum: 3600000 } } },
  PluginEnable: { type: 'object', required: ['enabled'], properties: { enabled: { type: 'boolean' }, safety: { type: 'object', properties: { disclaimerVersion: { type: 'string' } }, required: ['disclaimerVersion'] } } },
  PluginConfig: { type: 'object', required: ['config'], properties: { config: { type: 'object', additionalProperties: true } } },
  PluginPermissions: { type: 'object', required: ['granted'], properties: { granted: { type: 'array', items: { type: 'string' } } } },
  MarketplaceSourceAdd: { type: 'object', required: ['url'], properties: { url: { type: 'string', minLength: 1, maxLength: 2048 }, label: { type: 'string', maxLength: 100 } } },
  MarketplaceSourceUpdate: { type: 'object', required: ['enabled'], properties: { enabled: { type: 'boolean' } } },
  PluginInstall: { type: 'object', required: ['url'], properties: { url: { type: 'string', format: 'uri' }, sha256: { type: 'string', pattern: '^[0-9a-fA-F]{64}$' } } },
  PluginUninstall: { type: 'object', properties: { purgeData: { type: 'boolean' } } },
  Setup: { type: 'object', required: ['email', 'username', 'password'], properties: { email: { type: 'string', format: 'email' }, username: { type: 'string', minLength: 2, maxLength: 32 }, password: { type: 'string', minLength: 8 }, panelName: { type: 'string', minLength: 1, maxLength: 50, default: 'Catalyst' }, primaryColor: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$', default: '#c48d5a' }, secondaryColor: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$', default: '#5ac4c2' }, accentColor: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$', default: '#5a5cc4' }, defaultTheme: { type: 'string', enum: ['light', 'dark'], default: 'dark' }, logoUrl: { type: 'string' }, metadata: { type: 'object', additionalProperties: true, default: {} }, environment: { type: 'object', additionalProperties: { type: 'string' } } } },
};

// Response contracts for handlers whose route metadata intentionally keeps the
// response open.  These describe the stable envelope and leave ORM/agent data
// open rather than guessing at fields that can vary by installation.
const RESPONSE_CONTRACTS: Record<string, OpenApiSchema> = {
  SuccessEnvelope: { type: 'object', required: ['success'], properties: { success: { type: 'boolean', const: true }, data: { description: 'Handler-specific payload; its shape may vary by agent/plugin operation.' } }, additionalProperties: false },
  SuccessArrayEnvelope: { type: 'object', required: ['success', 'data'], properties: { success: { type: 'boolean', const: true }, data: { type: 'array', items: { type: 'object', additionalProperties: true } } }, additionalProperties: false },
  MessageSuccess: { type: 'object', required: ['success', 'message'], properties: { success: { type: 'boolean', const: true }, message: { type: 'string' } }, additionalProperties: false },
  AuthSuccess: { type: 'object', required: ['success', 'data'], properties: { success: { type: 'boolean', const: true }, data: { type: 'object', required: ['userId', 'email', 'username', 'permissions', 'token'], properties: { userId: { type: 'string' }, email: { type: 'string', format: 'email' }, username: { type: 'string' }, name: { type: ['string', 'null'] }, firstName: { type: ['string', 'null'] }, lastName: { type: ['string', 'null'] }, image: { type: ['string', 'null'] }, role: { type: 'string' }, permissions: { type: 'array', items: { type: 'string' } }, token: { type: ['string', 'null'] } }, additionalProperties: false } }, additionalProperties: false },
  AuthTwoFactor: { type: 'object', required: ['success', 'data'], properties: { success: { type: 'boolean', const: false }, data: { type: 'object', required: ['twoFactorRequired', 'token'], properties: { twoFactorRequired: { type: 'boolean', const: true }, token: { type: ['string', 'null'] } }, additionalProperties: false } }, additionalProperties: false },
  ApiKeyEnvelope: { type: 'object', required: ['success', 'data'], properties: { success: { type: 'boolean', const: true }, data: { type: 'object', additionalProperties: true } }, additionalProperties: false },
  ApiKeyArrayEnvelope: { type: 'object', required: ['success', 'data'], properties: { success: { type: 'boolean', const: true }, data: { type: 'array', items: { type: 'object', additionalProperties: true } } }, additionalProperties: false },
  TaskEnvelope: { type: 'object', required: ['task'], properties: { success: { type: 'boolean', const: true }, task: { type: 'object', additionalProperties: true } }, additionalProperties: false },
  TaskList: { type: 'object', required: ['tasks'], properties: { tasks: { type: 'array', items: { type: 'object', additionalProperties: true } } }, additionalProperties: false },
  BackupEnvelope: { type: 'object', properties: { success: { type: 'boolean', const: true }, data: { type: 'object', additionalProperties: true } }, additionalProperties: false },
  PaginatedEnvelope: { type: 'object', required: ['success', 'data'], properties: { success: { type: 'boolean', const: true }, data: { type: 'array', items: { type: 'object', additionalProperties: true } }, pagination: { type: 'object', properties: { page: { type: 'integer' }, limit: { type: 'integer' }, total: { type: 'integer' }, totalPages: { type: 'integer' } }, additionalProperties: true } }, additionalProperties: false },
  MetricsEnvelope: { type: 'object', properties: { success: { type: 'boolean', const: true }, data: { type: ['object', 'array'], additionalProperties: true } }, additionalProperties: true },
  Settings: { type: 'object', properties: { locale: { type: 'string' }, defaultLocale: { type: 'string' }, theme: { type: 'object', additionalProperties: true } }, additionalProperties: true },
  Health: { type: 'object', required: ['status', 'redis'], properties: { status: { type: 'string', const: 'ok' }, redis: { type: 'string' } }, additionalProperties: false },
  HealthUnhealthy: { type: 'object', required: ['status'], properties: { status: { type: 'string', const: 'unhealthy' } }, additionalProperties: false },
};

const RESPONSE_RULES: { method: string; path: RegExp; status?: string; schema: string }[] = [
  { method: 'POST', path: /\/api\/(?:auth\/register|auth\/login)$/, schema: 'AuthSuccess' },
  { method: 'GET', path: /\/api\/admin\/api-keys\/permissions$/, schema: 'ApiKeyArrayEnvelope' },
  { method: 'GET', path: /\/api\/admin\/api-keys$/, schema: 'ApiKeyArrayEnvelope' },
  { method: 'POST', path: /\/api\/admin\/api-keys$/, schema: 'ApiKeyEnvelope' },
  { method: 'PATCH', path: /\/api\/admin\/api-keys\//, schema: 'ApiKeyEnvelope' },
  { method: 'GET', path: /\/tasks$/, schema: 'TaskList' },
  { method: 'GET', path: /\/tasks\{?[^}]*\}?$/, schema: 'TaskEnvelope' },
  { method: 'POST', path: /\/tasks$/, schema: 'TaskEnvelope' },
  { method: 'PUT', path: /\/tasks\//, schema: 'TaskEnvelope' },
  { method: 'GET', path: /\/backups$/, schema: 'PaginatedEnvelope' },
  { method: 'GET', path: /\/backups\//, schema: 'BackupEnvelope' },
  { method: 'POST', path: /\/backups$/, schema: 'BackupEnvelope' },
  { method: 'POST', path: /\/backups\//, schema: 'BackupEnvelope' },
  { method: 'GET', path: /\/metrics/, schema: 'MetricsEnvelope' },
  { method: 'GET', path: /\/settings\/?$/, schema: 'Settings' },
  { method: 'GET', path: /\/alerts$/, schema: 'PaginatedEnvelope' },
  { method: 'GET', path: /\/nodes$/, schema: 'PaginatedEnvelope' },
  { method: 'GET', path: /\/servers$/, schema: 'PaginatedEnvelope' },
  { method: 'GET', path: /\/templates$/, schema: 'PaginatedEnvelope' },
  { method: 'GET', path: /\/plugins\//, schema: 'SuccessEnvelope' },
  { method: 'GET', path: /\/nodes\//, schema: 'SuccessEnvelope' },
  { method: 'POST', path: /\/nodes\//, schema: 'SuccessEnvelope' },
  { method: 'PUT', path: /\/nodes\//, schema: 'SuccessEnvelope' },
  { method: 'DELETE', path: /\/nodes\//, schema: 'SuccessEnvelope' },
  { method: 'GET', path: /\/servers\//, schema: 'SuccessEnvelope' },
  { method: 'POST', path: /\/servers\//, schema: 'SuccessEnvelope' },
  { method: 'PUT', path: /\/servers\//, schema: 'SuccessEnvelope' },
];

function responseContract(method: string, path: string): string | undefined {
  return RESPONSE_RULES.find((rule) => rule.method === method && rule.path.test(path))?.schema;
}

function enrichResponse(response: Record<string, unknown> | undefined, method: string, path: string): Record<string, unknown> | undefined {
  if (!response && path === '/health') return { '200': ref('Health'), '503': ref('HealthUnhealthy') };
  if (!response) return response;
  const contract = responseContract(method, path);
  if (!contract) return response;
  const result = { ...response };
  for (const status of ['200', '201']) {
    const value = result[status];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const candidate = value as Record<string, unknown>;
      if (candidate.type === 'object' && (!candidate.properties || candidate.additionalProperties === true)) {
        result[status] = ref(contract);
      }
    }
  }
  return result;
}

const CONTRACT_RULES: { method: string; path: RegExp; schema: string }[] = [
  { method: 'POST', path: /\/api\/servers$/, schema: 'ServerCreate' },
  { method: 'PUT', path: /\/api\/servers\/\{serverId\}$/, schema: 'ServerUpdate' },
  { method: 'POST', path: /\/api\/servers\/\{serverId\}\/clone$/, schema: 'ServerClone' },
  { method: 'POST', path: /\/api\/servers\/\{serverId\}\/allocations$/, schema: 'Allocation' },
  { method: 'POST', path: /\/api\/admin\/api-keys$/, schema: 'ApiKeyCreate' },
  { method: 'PATCH', path: /\/api\/admin\/api-keys\/\{id\}$/, schema: 'ApiKeyUpdate' },
  { method: 'POST', path: /\/plugins\/[^/]+\/enable$/, schema: 'PluginEnable' },
  { method: 'PUT', path: /\/plugins\/[^/]+\/config$/, schema: 'PluginConfig' },
  { method: 'PUT', path: /\/plugins\/[^/]+\/permissions$/, schema: 'PluginPermissions' },
  { method: 'POST', path: /\/api\/plugins\/marketplace\/sources$/, schema: 'MarketplaceSourceAdd' },
  { method: 'PATCH', path: /\/api\/plugins\/marketplace\/sources\/\{id\}$/, schema: 'MarketplaceSourceUpdate' },
  { method: 'POST', path: /\/api\/plugins\/install$/, schema: 'PluginInstall' },
  { method: 'POST', path: /\/api\/plugins\/\{name\}\/uninstall$/, schema: 'PluginUninstall' },
  { method: 'POST', path: /\/api\/setup$/, schema: 'Setup' },
];

function contractFor(method: string, path: string): string | undefined {
  return CONTRACT_RULES.find((rule) => rule.method === method && rule.path.test(path))?.schema;
}

function errorStatus(code: string): string {
  if (/_NOT_FOUND$/.test(code) || code === 'NOT_FOUND') return '404';
  if (/PERMISSION|FORBIDDEN|ACCESS_DENIED/.test(code)) return '403';
  if (/UNAUTHENTICATED|UNAUTHORIZED|INVALID_TOKEN/.test(code)) return '401';
  if (/CONFLICT|ALREADY_EXISTS|DUPLICATE/.test(code)) return '409';
  if (/RATE_LIMIT/.test(code)) return '429';
  return '400';
}

function humanizeErrorCode(code: string): string {
  return code.toLowerCase().split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

/**
 * Build the stable error catalog independently of route discovery. This keeps
 * codes which are currently only emitted by shared services (or future routes)
 * in the published contract too.
 */
function errorCatalog(files: string[]): { codes: string[]; statusByCode: Record<string, string>; descriptions: Record<string, string> } {
  const codes = new Set<string>(Object.values(ErrorCodes));
  const statusByCode: Record<string, string> = {};
  const descriptions: Record<string, string> = {};
  for (const code of codes) descriptions[code] = humanizeErrorCode(code);

  for (const file of files) {
    const full = file === 'server.ts' ? resolve(sourceDir, file) : resolve(routesDir, file);
    const source = readFileSync(full, 'utf-8');
    // apiError is the canonical structured error emitter.
    for (const match of source.matchAll(/apiError\(\s*reply\s*,\s*(\d{3})[\s\S]{0,180}?ErrorCodes\.([A-Z0-9_]+)/g)) {
      const [, status, code] = match;
      codes.add(code);
      statusByCode[code] ??= status;
    }
    // Also retain literal error codes used by a few legacy response paths.
    for (const match of source.matchAll(/reply\.status\(\s*(\d{3})[\s\S]{0,240}?code\s*:\s*['"]([A-Z0-9_]+)['"]/g)) {
      const [, status, code] = match;
      codes.add(code);
      statusByCode[code] ??= status;
      descriptions[code] ??= humanizeErrorCode(code);
    }
  }
  for (const code of codes) statusByCode[code] ??= errorStatus(code);
  return { codes: [...codes].sort(), statusByCode, descriptions };
}

type Literal = Record<string, unknown> | unknown[] | string | number | boolean | null;

/** Parse the deliberately small literal subset used by inline Fastify schemas. */
function parseLiteral(source: string, start = 0): { value: Literal; end: number } | undefined {
  let i = start;
  const ws = () => { while (/\s/.test(source[i] ?? '')) i++; };
  const string = (): string | undefined => {
    const quote = source[i++]; let out = '';
    while (i < source.length) {
      const c = source[i++];
      if (c === quote) return out;
      if (c === '\\' && i < source.length) out += source[i++]; else out += c;
    }
    return undefined;
  };
  const value = (): Literal | undefined => {
    ws();
    if (source[i] === '"' || source[i] === "'") return string();
    if (source[i] === '{') {
      i++; const object: Record<string, unknown> = {};
      while (i < source.length) {
        ws(); if (source[i] === '}') { i++; return object; }
        const quoted = source[i] === '"' || source[i] === "'";
        const key = quoted ? string() : source.slice(i).match(/^(?:[A-Za-z_$][\w$-]*|\d+)/)?.[0];
        if (!key) return undefined;
        if (!quoted) i += key.length;
        ws(); if (source[i++] !== ':') return undefined;
        const parsed = value(); if (parsed === undefined) return undefined; object[key] = parsed;
        ws(); if (source[i] === ',') { i++; continue; }
        if (source[i] === '}') { i++; return object; }
        return undefined;
      }
      return undefined;
    }
    if (source[i] === '[') {
      i++; const array: unknown[] = [];
      while (i < source.length) { ws(); if (source[i] === ']') { i++; return array; }
        const parsed = value(); if (parsed === undefined) return undefined; array.push(parsed); ws();
        if (source[i] === ',') { i++; continue; } if (source[i] === ']') { i++; return array; } return undefined;
      }
    }
    const token = source.slice(i).match(/^(true|false|null|-?\d+(?:\.\d+)?)/)?.[0];
    if (!token) return undefined; i += token.length;
    return token === 'true' ? true : token === 'false' ? false : token === 'null' ? null : Number(token);
  };
  const parsed = value(); return parsed === undefined ? undefined : { value: parsed, end: i };
}

function literalAfter(source: string, marker: RegExp): Literal | undefined {
  const match = marker.exec(source); if (!match) return undefined;
  const open = source.indexOf('{', match.index + match[0].length); if (open < 0) return undefined;
  return parseLiteral(source, open)?.value;
}

function schemaFromOptions(options: string): Record<string, unknown> | undefined {
  const schema = literalAfter(options, /\bschema\s*:/);
  return schema && typeof schema === 'object' && !Array.isArray(schema) ? schema as Record<string, unknown> : undefined;
}

function responseObjects(response: Record<string, unknown> | undefined, mediaTypes: string[]): Record<string, unknown> | undefined {
  if (!response) return undefined;
  const media = mediaTypes.length > 0 ? mediaTypes : ['application/json'];
  return Object.fromEntries(Object.entries(response).map(([status, value]) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return [status, { description: `HTTP ${status} response.`, content: Object.fromEntries(media.map((type) => [type, { schema: value }])) }];
    }
    const candidate = value as Record<string, unknown>;
    if ('description' in candidate || 'content' in candidate || 'headers' in candidate) return [status, candidate];
    if ('$ref' in candidate) return [status, { description: `HTTP ${status} response.`, content: { 'application/json': { schema: candidate } } }];
    const declaredType = typeof candidate.contentMediaType === 'string' ? candidate.contentMediaType : undefined;
    if (declaredType) {
      const schema = { ...candidate };
      delete schema.contentMediaType;
      return [status, { description: `HTTP ${status} response.`, content: { [declaredType]: { schema } } }];
    }
    return [status, { description: `HTTP ${status} response.`, content: Object.fromEntries(media.map((type) => [type, { schema: candidate }])) }];
  }));
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
  return line.replace(/^\s*\/\/\s?/, '').replace(/^─+\s?/, '').replace(/\s*[─—]{2,}\s*/g, ' ').trim();
}

function parseFile(file: string): { method: string; path: string; op: Operation }[] {
  const full = file === 'server.ts' ? resolve(sourceDir, file) : resolve(routesDir, file);
  const content = readFileSync(full, 'utf-8');
  const lines = content.split('\n');
  const found: { method: string; path: string; op: Operation }[] = [];

  // Locate route registrations. Style varies: same-line `app.get("/x", ...)`
  // or multi-line `app.get(\n  "/x",`. The path string must appear within
  // the 3 lines following the `app.METHOD(` opener.
  const starts: { idx: number; method: string; rawPath: string }[] = [];
  lines.forEach((line, idx) => {
    for (const method of METHODS) {
      // Fastify registrations may carry a TypeScript generic between the
      // method name and the opening parenthesis (app.get<{ Params: ... }>(...).
      if (!new RegExp(`app\\.${method}(?:\\s*<[^>]*>)?\\s*\\(`).test(line)) continue;
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
    if (!path.startsWith('/api/') && !(file === 'server.ts' && path === '/health')) return;

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

    // Route metadata is intentionally limited to literals. Imported/dynamic schemas
    // cannot be evaluated safely by this script.
    const schema = schemaFromOptions(head);

    // Handler block: observed status codes + referenced error codes.
    const block = lines.slice(s.idx, end).join('\n');
    const helperContent = file.startsWith('servers/')
      ? readFileSync(resolve(routesDir, 'servers/_helpers.ts'), 'utf-8')
      : '';
    const statusCodes = [...new Set([
      ...block.matchAll(/reply\.status\(\s*['"]?(\d{3})/g),
      ...block.matchAll(/reply\.code\(\s*['"]?(\d{3})/g),
      ...block.matchAll(/apiError\(\s*reply\s*,\s*(\d{3})/g),
    ].map((m) => m[1]))].sort();
    // Include codes referenced by helpers in the same route module as well as
    // the registration block (helpers are often called by several handlers).
    const errorCodes = [...new Set([
      ...[...block.matchAll(/ErrorCodes\.([A-Z0-9_]+)/g)].map((m) => m[1]),
      ...[...`${content}\n${helperContent}`.matchAll(/ErrorCodes\.([A-Z0-9_]+)/g)].map((m) => m[1]),
    ])];

    found.push({
      method: s.method,
      path,
      op: { file: `src/${file === 'server.ts' ? file : `routes/${file}`}`, line: s.idx + 1, summary: schema?.summary && typeof schema.summary === 'string' ? schema.summary : summary, description: schema?.description && typeof schema.description === 'string' ? schema.description : description, requiresAuth, permissions, schema, statusCodes, errorCodes, mediaTypes: Array.isArray(schema?.produces) ? schema.produces.filter((v): v is string => typeof v === 'string') : [] },
    });
  });
  return found;
}

function openapiPath(raw: string): string {
  return raw.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

function operationId(method: string, path: string): string {
  const suffix = path.replace(/^\//, '').replace(/\{([^}]+)\}/g, 'by_$1').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return `${method.toLowerCase()}_${suffix || 'root'}`;
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
  files.push('server.ts');
  files.sort();
  const catalog = errorCatalog(files);
  const errorStatuses = [...new Set(Object.values(catalog.statusByCode))].sort();
  const errorSchemas = Object.fromEntries(errorStatuses.map((status) => {
    const codes = catalog.codes.filter((code) => catalog.statusByCode[code] === status);
    return [`Error${status}`, {
      allOf: [{ $ref: '#/components/schemas/Error' }, { properties: { code: { type: 'string', enum: codes } } }],
      description: codes.map((code) => `${code}: ${humanizeErrorCode(code)}`).join('; '),
    }];
  }));

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
      const declared = op.schema ?? {};
      const declaredParams = declared.params && typeof declared.params === 'object' ? declared.params as Record<string, unknown> : undefined;
      const declaredQuery = declared.querystring && typeof declared.querystring === 'object' ? declared.querystring as Record<string, unknown> : undefined;
      const schemaParams = declaredParams?.properties && typeof declaredParams.properties === 'object'
        ? Object.entries(declaredParams.properties as Record<string, unknown>).map(([name, schema]) => ({ name, in: 'path', required: Array.isArray(declaredParams.required) && declaredParams.required.includes(name), schema }))
        : [];
      const queryParams = declaredQuery?.properties && typeof declaredQuery.properties === 'object'
        ? Object.entries(declaredQuery.properties as Record<string, unknown>).map(([name, schema]) => ({ name, in: 'query', required: Array.isArray(declaredQuery.required) && declaredQuery.required.includes(name), schema }))
        : [];
      const declaredHeaders = declared.headers && typeof declared.headers === 'object' ? declared.headers as Record<string, unknown> : undefined;
      const headerParams = declaredHeaders?.properties && typeof declaredHeaders.properties === 'object'
        ? Object.entries(declaredHeaders.properties as Record<string, unknown>).map(([name, schema]) => ({ name, in: 'header', required: Array.isArray(declaredHeaders.required) && declaredHeaders.required.includes(name), schema }))
        : [];
      const parameters = [...params, ...schemaParams.filter((p) => !params.some((existing) => existing.name === p.name)), ...queryParams, ...headerParams];
      const contract = contractFor(method, key);
      const declaredResponses = declared.response && typeof declared.response === 'object' ? declared.response as Record<string, unknown> : undefined;
       const responses = responseObjects(enrichResponse(declaredResponses, method, key), op.mediaTypes);
      const errorStatuses = new Set(op.errorCodes.map((code) => catalog.statusByCode[code] ?? errorStatus(code)));
      const documentedErrors = Object.fromEntries([...errorStatuses].map((status) => [status, { $ref: `#/components/responses/Error${status}` }]));
      const generatedResponses = {
        ...(responses ?? {}),
        ...Object.fromEntries(op.statusCodes.filter((code) => !responses?.[code]).map((code) => [code, { description: `HTTP ${code} response observed in source.` }])),
        ...(Object.keys(responses ?? {}).length === 0 && op.statusCodes.length === 0 ? { 'default': { description: 'Response shape is not declared in route metadata.' } } : {}),
        ...(op.requiresAuth ? { '401': { description: 'Unauthenticated.' } } : {}),
      };
      const requestSchema = contract ? ref(contract) : declared.body && Object.keys(declared.body as object).length > 0 ? declared.body : { type: 'object', additionalProperties: true };
      const operation: Record<string, unknown> = {
        operationId: operationId(method, key),
        summary: op.summary,
        ...(op.description && op.description !== op.summary ? { description: op.description } : {}),
        tags: Array.isArray(declared.tags) ? declared.tags : [tagFor(path)],
        ...(parameters.length > 0 ? { parameters } : {}),
         ...((contract || declared.body) ? { requestBody: { required: true, content: { 'application/json': { schema: requestSchema } } } } : {}),
         responses: { ...generatedResponses, ...documentedErrors },
         ...(op.requiresAuth ? { security: [{ bearerAuth: [], cookieAuth: [] }] } : headerParams.some((p) => p.name.toLowerCase() === 'authorization') ? { security: [{ bearerAuth: [] }] } : headerParams.some((p) => p.name.toLowerCase().startsWith('x-catalyst-') || p.name.toLowerCase() === 'x-node-api-key') ? { security: [{ nodeApiKey: [] }] } : {}),
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

  const authWildcard = (method: string): Record<string, unknown> => ({
    operationId: operationId(method, '/api/auth/{path}'),
    summary: 'Proxy Better Auth endpoints',
    description: 'Catch-all Better Auth endpoint handled by the installed Better Auth configuration.',
    tags: ['Auth'],
    parameters: [{ name: 'path', in: 'path', required: true, schema: { type: 'string' } }],
    responses: { default: { description: 'Response generated by Better Auth.' } },
    'x-catalyst': { source: 'src/server.ts:799', wildcard: true },
  });
  paths['/api/auth/{path}'] ??= {};
  for (const method of ['get', 'post', 'put', 'patch', 'delete', 'options']) {
    paths['/api/auth/{path}'][method] = authWildcard(method);
    count++;
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
    // No server URL. A relative "/api" makes the docs site the target of
    // "Try it", and every call 404s. Readers set their own panel origin.
    servers: [] as { url: string; description?: string }[],
    security: [],
    tags: [...new Set(Object.values(paths).flatMap((ops) => Object.values(ops).flatMap((o) => (o as { tags: string[] }).tags)))].sort().map((name) => ({ name })),
    paths: Object.fromEntries(Object.entries(paths).sort(([a], [b]) => a.localeCompare(b))),
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', description: 'Admin/user API key.' },
        cookieAuth: { type: 'apiKey', in: 'cookie', name: 'session', description: 'Panel session cookie.' },
        nodeApiKey: { type: 'apiKey', in: 'header', name: 'x-catalyst-node-token', description: 'Node agent API key. The legacy x-node-api-key header is also accepted.' },
      },
      responses: Object.fromEntries([
        ['Error', {
          description: 'Standard error envelope.',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['success', 'error', 'code'],
                properties: {
                  success: { type: 'boolean', const: false },
                  error: { type: 'string' },
                  code: { $ref: '#/components/schemas/ErrorCode' },
                },
              },
            },
          },
        }],
        ...errorStatuses.map((status) => [`Error${status}`, {
          description: `${status} error response.`,
          content: { 'application/json': { schema: { $ref: `#/components/schemas/Error${status}` } } },
        }]),
      ]),
      schemas: {
        ...CONTRACTS,
        ...RESPONSE_CONTRACTS,
        ErrorCode: { type: 'string', enum: catalog.codes, description: 'Stable machine-readable API error code.' },
        Error: {
          type: 'object', required: ['success', 'error', 'code'],
          properties: { success: { type: 'boolean', const: false }, error: { type: 'string' }, code: { $ref: '#/components/schemas/ErrorCode' } },
          description: 'Standard API error envelope.',
        },
        ...errorSchemas,
      },
    },
  };

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(doc, null, 2)}\n`);
  console.log(`export-openapi: ${count} operations from ${files.length} files → ${outPath}`);
}

main();
