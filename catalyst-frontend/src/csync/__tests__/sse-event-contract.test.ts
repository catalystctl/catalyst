/**
 * Contract tests: backend SSE subscription lists must include every event
 * the frontend listens for on the global/per-server stream.
 *
 * Regression: server_files_changed + backup_*_started were emitted by the API
 * but filtered out of EVENT_TYPES, so FE handlers never fired.
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
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
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

  const beTypes = extractStringArray(beSse, 'EVENT_TYPES');
  const feTypes = extractStringArray(feServerEvents, 'SERVER_EVENT_TYPES');
  const beAdminTypes = extractStringArray(beAdmin, 'ADMIN_EVENT_TYPES');
  const feAdminTypes = extractStringArray(feAdmin, 'ADMIN_EVENT_TYPES');

  it('backend subscribes to server_files_changed (file manager realtime)', () => {
    expect(beTypes).toContain('server_files_changed');
  });

  it('backend subscribes to backup start events', () => {
    expect(beTypes).toContain('backup_started');
    expect(beTypes).toContain('backup_restore_started');
    expect(beTypes).toContain('backup_delete_started');
  });

  it('backend EVENT_TYPES covers every FE server-event listener type', () => {
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
});
