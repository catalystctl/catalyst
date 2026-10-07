/**
 * ROUTE-CONTRACT SUITE — table-driven runner (test-plan.md §4).
 *
 * Executes every CONTRACT_ROWS entry against a single app instance carrying
 * all production route modules: for each row × persona (AR/AW/PU/STAR) it
 * injects a request and asserts the cell contract —
 *   deny   → 403 exactly;
 *   allow  → anything but 403 (200/400/404/409 all prove the gate opened);
 *   scoped → non-403 (own-rows; emptiness is §5's job, not the runner's);
 *   skip   → not asserted (NA rows carry naReason).
 *
 * Allow-sides never execute real writes: the default payload is {} and rows
 * that validate before the gate carry schema-valid-but-dead payloads
 * (nonexistent referenced ids → 404/409 after the gate). T3 rows assert the
 * deny side only (SSE hijacks, destructive triggers, multipart).
 *
 * The final drift guard diffs api/openapi.json against the matrix: a new
 * route without a matrix row (or a matrix row without a route) fails here —
 * that is the lock that makes this suite fail on FUTURE drift.
 */
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ALL_CONTRACT_ROWS } from './route-contract.matrix.js';
import type { ContractRow, ContractCell } from './route-contract.matrix.js';
import {
  provisionContractFixtures,
  teardownContractFixtures,
  resetFixtureServer,
} from './route-contract-fixtures.js';
import type { ContractFixtures } from './route-contract-fixtures.js';
import { buildContractApp, setContractPersona } from './route-contract-harness.js';
import type { PersonaId } from './route-contract-harness.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(HERE, '../..');

// Well-formed but non-existent cuid-shaped ids: referenced rows 404 AFTER
// the gate, proving it opened without executing anything.
const NON_EXISTENT = 'cnonexistent00000000contract';

let app: FastifyInstance;
let fx: ContractFixtures;

beforeAll(async () => {
  fx = await provisionContractFixtures();
  app = buildContractApp(fx);
  await app.ready();
}, 120_000);

afterAll(async () => {
  await app.close().catch(() => {});
  await teardownContractFixtures(fx);
});

// ── Path/payload preparation ───────────────────────────────────────────────

/** Write-class rows target the throwaway server; reads the primary fixture. */
function resolveParam(name: string): string {
  switch (name) {
    case 'serverId':
    case 'id':
      return fx.serverId;
    case 'nodeId':
      return fx.nodeId;
    case 'templateId':
      return fx.templateId;
    case 'locationId':
      return fx.locationId;
    case 'ruleId':
      return fx.alertRuleId;
    case 'alertId':
      return fx.alertId;
    case 'taskId':
      return fx.taskId;
    case 'name':
      return 'no-such-plugin';
    case 'token':
      return 'no-such-token';
    default:
      return NON_EXISTENT;
  }
}

function resolvePlaceholders(value: string): string {
  return value
    .replace(/__SERVER__/g, fx.serverId)
    .replace(/__NODE__/g, fx.nodeId)
    .replace(/__RULE__/g, fx.alertRuleId)
    .replace(/__TASK__/g, fx.taskId);
}

function buildUrl(row: ContractRow): string {
  const url = row.path.replace(/\{(\w+)\}/g, (_m, name: string) => {
    const override = row.params?.[name];
    if (override !== undefined) {
      return resolvePlaceholders(override);
    }
    return resolveParam(name);
  });
  if (!row.query) return url;
  const qs = Object.entries(row.query)
    .map(([k, v]) => `${k}=${encodeURIComponent(resolvePlaceholders(String(v)))}`)
    .join('&');
  return `${url}?${qs}`;
}

function buildBody(row: ContractRow): Record<string, unknown> | undefined {
  // GET never carries a body; DELETE only when the row declares one
  // (e.g. bulk delete needs { serverIds }); writes default to {} so the
  // route's own validation answers 400 after the gate instead of executing.
  if (row.method === 'GET') return undefined;
  if (row.method === 'DELETE' && row.payload === undefined) return undefined;
  const payload = row.payload ?? {};
  return Object.fromEntries(
    Object.entries(payload).map(([k, v]) => [
      k,
      typeof v === 'string' ? resolvePlaceholders(v) : v,
    ]),
  );
}

// ── Table-driven execution ─────────────────────────────────────────────────

const PERSONA_ORDER: readonly PersonaId[] = ['pu', 'ar', 'aw', 'star'];

function cellFor(row: ContractRow, persona: PersonaId): ContractCell {
  return row[persona] as ContractCell;
}

function groupOf(row: ContractRow): string {
  const segs = row.path.split('/');
  // '/api/servers/{serverId}/start' → '/api/servers'; '/api/admin/…' keeps 3.
  const group = segs.slice(0, 4).join('/');
  return group.startsWith('/api/') && segs.length > 4 ? group : segs.slice(0, 3).join('/');
}

const runnableRows = ALL_CONTRACT_ROWS.filter((r) => r.tier !== 'NA');
const naRows = ALL_CONTRACT_ROWS.filter((r) => r.tier === 'NA');

describe('route contract', () => {
  for (const row of runnableRows) {
    const group = groupOf(row);
    describe(group, () => {
      it(`${row.op} [ar:${row.ar} aw:${row.aw} pu:${row.pu} star:${row.star}]`, async () => {
        // Every row starts from the baseline fixture state — write rows
        // legitimately mutate/delete it on the allow side.
        await resetFixtureServer(fx);
        for (const persona of PERSONA_ORDER) {
          const cell = cellFor(row, persona);
          if (cell === 'skip') continue;
          // T3 rows (SSE hijack / destructive / multipart) never run an
          // allow side in this suite — §5 targeted tests own those.
          if (row.denySideOnly && cell !== 'deny') continue;

          setContractPersona(persona);
          const res = await app.inject({
            method: row.method,
            url: buildUrl(row),
            payload: buildBody(row),
          });
          const label = `${row.op} [${persona} expected ${cell}] got ${res.statusCode}`;
          // A 404 whose body is Fastify's route-not-found is always a failure:
          // the path is not registered — never a valid contract outcome.
          if (res.statusCode === 404 && /Route .* not found/.test(String(res.body))) {
            throw new Error(`${label} — route not registered in the contract harness`);
          }
          if (cell === 'deny') {
            expect(res.statusCode, label).toBe(403);
          } else if (cell === 'masked') {
            // Deliberate masquerade denial: 403, or 404 hiding existence.
            expect([403, 404], label).toContain(res.statusCode);
          } else {
            // allow / scoped — the gate must have opened.
            expect(res.statusCode, label).not.toBe(403);
          }
        }
      }, 20_000);
    });
  }

  it('documents every N/A row with a reason (no silent skips)', () => {
    for (const row of naRows) {
      expect(
        row.naReason,
        `${row.op} is tier NA but carries no naReason`,
      ).toBeTruthy();
    }
  });

  it('route-level rateLimit config is inert without the plugin (smoke)', async () => {
    // e.g. /api/update/check declares config.rateLimit in server.ts — without
    // the rate-limit plugin registered the route must still respond normally.
    setContractPersona('aw');
    const res = await app.inject({ method: 'POST', url: '/api/admin/update/check' });
    expect(res.statusCode).not.toBe(429);
  });
});

// ── Drift guard: matrix ↔ openapi.json must stay in lockstep ──────────────

describe('openapi drift guard', () => {
  const candidates = [
    path.resolve(BACKEND_ROOT, '../api/openapi.json'),
    path.resolve(BACKEND_ROOT, '../catalyst-doc/api/openapi.json'),
    path.resolve(BACKEND_ROOT, '../../catalyst-doc/api/openapi.json'),
  ];

  it('matrix covers every openapi operation (new route without a row fails)', () => {
    const specPath = candidates.find((c) => {
      try {
        readFileSync(c, 'utf8');
        return true;
      } catch {
        return false;
      }
    });
    expect(
      specPath,
      `no openapi.json found (looked in: ${candidates.join(', ')})`,
    ).toBeTruthy();
    const spec = JSON.parse(readFileSync(specPath!, 'utf8')) as {
      paths: Record<string, Record<string, unknown>>;
    };

    const specOps = new Set<string>();
    for (const [p, item] of Object.entries(spec.paths)) {
      for (const m of ['get', 'post', 'put', 'patch', 'delete'] as const) {
        if (m in item) specOps.add(`${m.toUpperCase()} ${p}`);
      }
    }
    const matrixOps = new Set(ALL_CONTRACT_ROWS.filter((r) => !r.nonOpenapi).map((r) => r.op));

    const missingRow = [...specOps].filter((op) => !matrixOps.has(op)).sort();
    expect(
      missingRow,
      `openapi operations without a contract-matrix row — add rows to route-contract.matrix.ts: ${missingRow.join(', ')}`,
    ).toEqual([]);

    const staleRow = [...matrixOps].filter((op) => !specOps.has(op)).sort();
    expect(
      staleRow,
      `matrix rows whose operation no longer exists in openapi.json — remove or update: ${staleRow.join(', ')}`,
    ).toEqual([]);
  });
});
