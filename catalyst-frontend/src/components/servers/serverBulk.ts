/**
 * Fleet bulk power selection helpers (audit D9).
 *
 * The fleet list had no selection model, so putting eight servers away meant
 * eight clicks through per-row controls. These helpers decide, for one bulk
 * action, which of the selected servers may actually receive it — with the
 * SAME rules the per-row controls use (server.start / server.stop on the
 * server's own effective grants, and the statuses each action applies to).
 *
 * The backend answers `POST /api/admin/servers/actions` per action with its own
 * permission check (`server.start`, `server.stop`, then the scoped-access
 * decision), so an ineligible id here would be a 403 for the whole selection:
 * the UI filters instead of relying on the error.
 */
import type { Server, ServerStatus } from '../../types/server';

export type BulkServerAction = 'start' | 'stop' | 'restart';

/** Permissions each action needs, mirroring `ServerControls`. */
export const BULK_ACTION_PERMISSIONS: Record<BulkServerAction, string[]> = {
  start: ['server.start'],
  // `kill` is covered by server.stop on the backend alias window.
  stop: ['server.stop'],
  restart: ['server.start', 'server.stop'],
};

// Same status windows as components/servers/ServerControls.tsx.
const STARTABLE: ServerStatus[] = ['stopped', 'crashed', 'unhealthy', 'error'];
const STOPPABLE: ServerStatus[] = ['running', 'starting', 'error', 'crashed', 'unhealthy'];
const RESTARTABLE: ServerStatus[] = ['running', 'stopped', 'error', 'crashed', 'unhealthy'];

const APPLIES: Record<BulkServerAction, ServerStatus[]> = {
  start: STARTABLE,
  stop: STOPPABLE,
  restart: RESTARTABLE,
};

type BulkCandidate = Pick<Server, 'id' | 'status' | 'effectivePermissions'>;

/** One server's own grants: wildcard covers every action. */
export function serverHasPermission(server: Pick<Server, 'effectivePermissions'>, permission: string): boolean {
  const grants = server.effectivePermissions ?? [];
  return grants.includes('*') || grants.includes(permission);
}

/** True when `action` is both permitted and meaningful for this server. */
export function serverEligibleForBulkAction(server: BulkCandidate, action: BulkServerAction): boolean {
  if (!APPLIES[action].includes(server.status)) return false;
  return BULK_ACTION_PERMISSIONS[action].every((permission) => serverHasPermission(server, permission));
}

/** Ids of `servers` that `action` may be sent for, in their given order. */
export function bulkActionTargets(servers: readonly BulkCandidate[], action: BulkServerAction): string[] {
  return servers.filter((server) => serverEligibleForBulkAction(server, action)).map((server) => server.id);
}

/**
 * Per-action target lists for the bulk bar: a button stays enabled only when at
 * least one selected server accepts that action.
 */
export function bulkActionPlan(servers: readonly BulkCandidate[]): Record<BulkServerAction, string[]> {
  return {
    start: bulkActionTargets(servers, 'start'),
    stop: bulkActionTargets(servers, 'stop'),
    restart: bulkActionTargets(servers, 'restart'),
  };
}

/** Select-all state for the current (filtered) list. */
export type SelectAllState = 'none' | 'some' | 'all';

export function selectAllState(selectedIds: ReadonlySet<string>, visibleIds: readonly string[]): SelectAllState {
  if (visibleIds.length === 0) return 'none';
  let selected = 0;
  for (const id of visibleIds) {
    if (selectedIds.has(id)) selected += 1;
  }
  if (selected === 0) return 'none';
  return selected === visibleIds.length ? 'all' : 'some';
}

/** Toggle every visible id at once, leaving selections outside the filter alone. */
export function toggleAllVisible(
  selectedIds: ReadonlySet<string>,
  visibleIds: readonly string[],
  next: boolean,
): Set<string> {
  const result = new Set(selectedIds);
  for (const id of visibleIds) {
    if (next) result.add(id);
    else result.delete(id);
  }
  return result;
}