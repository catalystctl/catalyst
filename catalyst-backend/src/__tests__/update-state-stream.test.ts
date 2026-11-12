/**
 * Panel update state-stream alignment (auto-updater ↔ UpdateProgressModal).
 *
 * Regression (customer report, 1.85.0 → 1.85.1 update):
 *  1. The backend emitted SSE states (`downloading`/`installing`) that the
 *     frontend modal does not know, plus a premature `completed` fired right
 *     after spawning `docker compose up -d` — while the panel was about to go
 *     DOWN, not after it came back.
 *  2. Completion is now reported by the NEXT process at boot
 *     (emitUpdateCompletedFromBoot): the dying process writes the in-flight
 *     marker, the new process clears it and emits `completed`.
 *
 * These tests pin the wire contract the frontend relies on.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SOURCE = readFileSync(
  resolve(__dirname, '../services/auto-updater.ts'),
  'utf8',
);
const SERVER_SOURCE = readFileSync(resolve(__dirname, '../server.ts'), 'utf8');

describe('panel update state stream contract', () => {

  it('SSE event states are exactly the frontend modal phases', () => {
    // UpdateProgressModal maps `phase` against these names; anything else
    // (checking/downloading/installing) leaves it in an unknown state.
    const states = [...SOURCE.matchAll(/"(idle|pulling|restarting|failed|completed)"/g)].map(
      (m) => m[1],
    );
    const typeUnion = SOURCE.match(
      /type PanelUpdateEventState[\s\S]*?;/,
    )?.[0];
    expect(typeUnion).toBeDefined();
    for (const phase of ['idle', 'pulling', 'restarting', 'failed', 'completed']) {
      expect(typeUnion).toContain(`"${phase}"`);
    }
    // The old vocabulary must be gone.
    expect(typeUnion).not.toContain('"downloading"');
    expect(typeUnion).not.toContain('"installing"');
    expect(typeUnion).not.toContain('"checking"');
    expect(states.length).toBeGreaterThan(0);
  });

  it('UPDATE_STATE_EVENT maps every internal state 1:1 (no null swallowing)', () => {
    const map = SOURCE.match(
      /const UPDATE_STATE_EVENT[\s\S]*?\};/,
    )?.[0];
    expect(map).toBeDefined();
    for (const state of ['idle', 'pulling', 'restarting', 'failed']) {
      expect(map).toContain(`${state}:`);
    }
    // idle must now map to "idle" (previously null — silent transitions).
    expect(map).toMatch(/idle:\s*"idle"/);
    expect(map).toMatch(/pulling:\s*"pulling"/);
    expect(map).toMatch(/restarting:\s*"restarting"/);
  });

  it('performUpdate does NOT emit completed while the panel is going down', () => {
    const performUpdateBody = SOURCE.match(
      /export async function performUpdate[\s\S]*?\n\}/,
    )?.[0];
    expect(performUpdateBody).toBeDefined();
    expect(performUpdateBody).not.toContain('"completed"');
  });

  it('restarting writes the in-flight marker for the next process', () => {
    const setUpdateStateBody = SOURCE.match(
      /function setUpdateState\([\s\S]*?\n\}/,
    )?.[0];
    expect(setUpdateStateBody).toBeDefined();
    expect(setUpdateStateBody).toContain('markUpdateInFlight()');
    expect(SOURCE).toContain('markUpdateInFlight');
    expect(SOURCE).toContain('UPDATE_IN_FLIGHT_MARKER');
  });

  it('boot reports completion only when the previous process died mid-update', () => {
    const bootFn = SOURCE.match(
      /export function emitUpdateCompletedFromBoot[\s\S]*?\n\}/,
    )?.[0];
    expect(bootFn).toBeDefined();
    // Reads AND clears the marker, then emits the terminal event.
    expect(bootFn).toContain('existsSync');
    expect(bootFn).toContain('rmSync');
    expect(bootFn).toContain('emitPanelUpdateState("completed"');
  });

  it('server.ts calls emitUpdateCompletedFromBoot after boot', () => {
    expect(SERVER_SOURCE).toContain('emitUpdateCompletedFromBoot');
  });

  it('marker lives in the panel state dir, not a shared temp directory', () => {
    // A predictable name under /tmp is a symlink target for any other local
    // user (CWE-377, CodeQL js/insecure-temporary-file): the writer would
    // follow a planted link. The panel's own state root is writable by the
    // backend user only, and in the compose stack only its subdirectories are
    // volumes — so the marker still does not survive container recreation,
    // which is what it wants: it describes the previous process's update.
    expect(SOURCE).toContain('process.env.CATALYST_STATE_DIR || "/var/lib/catalyst"');
    expect(SOURCE).toContain('"update-in-flight"');
    expect(SOURCE).not.toContain('/tmp/catalyst-update-in-flight');
    // O_CREAT|O_EXCL: an existing path (or a symlink) is never truncated through.
    expect(SOURCE).toMatch(/writeFileSync\(\s*UPDATE_IN_FLIGHT_MARKER,[\s\S]{0,160}flag: "wx"/);
  });

  it('marker is only written on the restarting transition, never at import', () => {
    // A top-level write would announce a completed update on every boot: the
    // marker must appear exactly once, inside setUpdateState's restarting
    // branch (asserted above).
    expect([...SOURCE.matchAll(/markUpdateInFlight\(\);/g)]).toHaveLength(1);
  });
});
