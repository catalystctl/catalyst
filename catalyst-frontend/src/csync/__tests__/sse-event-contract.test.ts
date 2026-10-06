/**
 * Contract tests: backend SSE subscription lists must include every event
 * the frontend listens for on the global/per-server stream — and every
 * allowlisted admin event must actually be HANDLED by a frontend handler
 * (P2.4: allowlist parity alone hid "emitted but dropped" and
 * "allowlisted but unhandled" gaps alike).
 *
 * Regression: server_files_changed + backup_*_started were emitted by the API
 * but filtered out of EVENT_TYPES, so FE handlers never fired.
 * Regression: env/mcp/node_flapping/templates_batch/network_* were emitted
 * but missing from the admin allowlist and from useSseAdminEvents.
 *
 * Known dead/alias entries on the FE server-stream list (documented here):
 *  - `console_output`: only ever delivered on the dedicated console stream
 *    (/api/servers/:id/console); the /events stream cannot carry it. It is
 *    therefore exempted from the FE⊆BE server-event check below.
 *  - `server_state`: legacy alias of `server_state_update`, never emitted by
 *    either side and now pruned from BOTH allowlists (audit §6.2 / P1.4) —
 *    the tests below pin it as absent so the dead entry cannot return.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../../../..');

function extractStringArray(source: string, constName: string): string[] {
  const re = new RegExp(
    `const ${constName}(?:\\s*:\\s*[\\w<>,\\s\\[\\]|]+)?\\s*=\\s*\\[([\\s\\S]*?)\\];`,
  );
  const m = source.match(re);
  if (!m) throw new Error(`Could not find ${constName}`);
  // Strip `//` comments before extracting: an apostrophe inside a comment
  // (e.g. "userId's") shifts the naive quote pairing and swallows real
  // entries. Event-type strings never contain `//`, so this is safe.
  const code = m[1]
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
  return [...code.matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

describe('SSE event subscription contract', () => {
  const beSse = readFileSync(
    resolve(ROOT, 'catalyst-backend/src/routes/sse-events.ts'),
    'utf8',
  );
  const feServerEvents = readFileSync(
    resolve(ROOT, 'catalyst-frontend/src/services/api/server-events.ts'),
    'utf8',
  );
  const beAdmin = readFileSync(
    resolve(ROOT, 'catalyst-backend/src/routes/admin-events.ts'),
    'utf8',
  );
  const feAdmin = readFileSync(
    resolve(ROOT, 'catalyst-frontend/src/services/api/admin-events.ts'),
    'utf8',
  );
  const feAdminHandlers = readFileSync(
    resolve(ROOT, 'catalyst-frontend/src/hooks/useSseAdminEvents.ts'),
    'utf8',
  );

  const beTypes = extractStringArray(beSse, 'EVENT_TYPES');
  const feTypes = extractStringArray(feServerEvents, 'SERVER_EVENT_TYPES');
  const beAdminTypes = extractStringArray(beAdmin, 'ADMIN_EVENT_TYPES');
  const feAdminTypes = extractStringArray(feAdmin, 'ADMIN_EVENT_TYPES');
  const handledAdminTypes = extractStringArray(feAdminHandlers, 'HANDLED_ADMIN_EVENTS');

  /**
   * Admin event types the FE allowlists but deliberately does NOT handle.
   * Every entry must carry a reason; the list is empty today — the rule is
   * "allowlisted ⇒ handled", and new allowlist entries without a handler
   * fail the tests below.
   */
  const KNOWN_UNHANDLED: string[] = [];

  it('backend subscribes to server_files_changed (file manager realtime)', () => {
    expect(beTypes).toContain('server_files_changed');
  });

  it('backend subscribes to backup start events', () => {
    expect(beTypes).toContain('backup_started');
    expect(beTypes).toContain('backup_restore_started');
    expect(beTypes).toContain('backup_delete_started');
  });

  it('backend EVENT_TYPES covers every FE server-event listener type', () => {
    // console_output is exempt: it belongs to the console stream only.
    const required = feTypes.filter((t) => t !== 'console_output');
    const missing = required.filter((t) => !beTypes.includes(t));
    expect(missing).toEqual([]);
  });

  it('admin stream includes migration + agent update events on both sides', () => {
    for (const t of [
      'migration_job_updated',
      'migration_step_updated',
      'agent_update_started',
      'agent_update_failed',
      'agent_update_progress',
    ]) {
      expect(beAdminTypes).toContain(t);
      expect(feAdminTypes).toContain(t);
    }
  });

  it('FE admin listeners are a subset of BE admin EVENT_TYPES', () => {
    const missing = feAdminTypes.filter((t) => !beAdminTypes.includes(t));
    expect(missing).toEqual([]);
  });

  it('P0.2 wave-2 admin events are allowlisted on both sides', () => {
    for (const t of [
      'env_settings_updated',
      'mcp_settings_updated',
      'templates_batch_imported',
      'node_flapping',
      'network_created',
      'network_updated',
      'network_deleted',
      'system_error_resolved',
    ]) {
      expect(feAdminTypes).toContain(t);
      expect(beAdminTypes).toContain(t);
    }
  });

  it('every FE admin event type is handled or an explicit exception', () => {
    const unhandled = feAdminTypes.filter(
      (t) => !handledAdminTypes.includes(t) && !KNOWN_UNHANDLED.includes(t),
    );
    expect(unhandled).toEqual([]);
  });

  it('HANDLED_ADMIN_EVENTS contains no type outside the admin allowlist', () => {
    const orphans = handledAdminTypes.filter((t) => !feAdminTypes.includes(t));
    expect(orphans).toEqual([]);
  });

  it('ADMIN_EVENT_TYPES is exactly HANDLED ∪ KNOWN_UNHANDLED', () => {
    const expected = [...new Set([...handledAdminTypes, ...KNOWN_UNHANDLED])].sort();
    expect([...feAdminTypes].sort()).toEqual(expected);
  });

  it('HANDLED_ADMIN_EVENTS has no duplicates', () => {
    expect(handledAdminTypes.length).toBe(new Set(handledAdminTypes).size);
  });

  it('documents the dead FE server-stream entry console_output and the server_state alias', () => {
    // `console_output` — dead on /events (console stream only): present on
    // the FE list, absent from the backend allowlist, exempted above.
    expect(feTypes).toContain('console_output');
    expect(beTypes).not.toContain('console_output');
    // `server_state` — legacy alias of `server_state_update`, never emitted
    // by either side; pruned from BOTH lists (audit §6.2 / P1.4). Re-adding
    // it to either list would re-open the dead-entry gap.
    expect(feTypes).not.toContain('server_state');
    expect(beTypes).not.toContain('server_state');
    expect(feTypes).toContain('server_state_update');
    expect(beTypes).toContain('server_state_update');
  });
});
