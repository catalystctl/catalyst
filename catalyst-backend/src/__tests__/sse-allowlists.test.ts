/**
 * SSE allowlist regression guards (REALTIME_AUDIT P0.2 / P1.4).
 *
 * - ADMIN_EVENT_TYPES must carry every event the backend already pushes to
 *   the admin stream (the FE keeps an identical list; parity is asserted on
 *   the FE side in csync/__tests__/sse-event-contract.test.ts).
 * - EVENT_TYPES (per-server + global stream) must carry clone_failed and
 *   must NOT carry the five dead entries that were never routed to this
 *   stream (P1.4 pruning).
 */
import { describe, it, expect } from 'vitest';
import { ADMIN_EVENT_TYPES } from '../routes/admin-events.js';
import { EVENT_TYPES } from '../routes/sse-events.js';

describe('ADMIN_EVENT_TYPES allowlist (P0.2)', () => {
  const required = [
    'env_settings_updated',
    'mcp_settings_updated',
    'node_flapping',
    'templates_batch_imported',
    'network_created',
    'network_updated',
    'network_deleted',
    'system_error_resolved',
  ] as const;

  for (const eventType of required) {
    it(`contains ${eventType}`, () => {
      expect(ADMIN_EVENT_TYPES).toContain(eventType);
    });
  }

  it('keeps the pre-existing core entries', () => {
    expect(ADMIN_EVENT_TYPES).toContain('alert_created');
    expect(ADMIN_EVENT_TYPES).toContain('alert_resolved');
    expect(ADMIN_EVENT_TYPES).toContain('alert_deleted');
    expect(ADMIN_EVENT_TYPES).toContain('server_created');
  });

  it('has no duplicate entries', () => {
    expect(new Set(ADMIN_EVENT_TYPES).size).toBe(ADMIN_EVENT_TYPES.length);
  });
});

describe('EVENT_TYPES allowlist (per-server + global stream)', () => {
  it('contains clone_failed (P0.2)', () => {
    expect(EVENT_TYPES).toContain('clone_failed');
  });

  it("keeps 'alert' — emitted for creation AND resolution (U1/P1.3)", () => {
    expect(EVENT_TYPES).toContain('alert');
  });

  it.each(['server_log', 'server_state', 'user_created', 'user_deleted', 'user_updated'])(
    'no longer contains the dead entry %s (P1.4)',
    (eventType) => {
      expect(EVENT_TYPES).not.toContain(eventType);
    },
  );

  it('has no duplicate entries', () => {
    expect(new Set(EVENT_TYPES).size).toBe(EVENT_TYPES.length);
  });
});
