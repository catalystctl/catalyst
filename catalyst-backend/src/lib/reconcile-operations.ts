/**
 * Boot-time reconciliation for servers stuck in a transitional state.
 *
 * Clone/transfer data movement runs outside the request transaction, so a panel
 * restart mid-copy would otherwise leave a server in `cloning`/`transferring`
 * forever — the agent state sync deliberately ignores transitional states
 * (see the gateway lifecycle guards). Any such row older than the grace period
 * is moved back to `stopped` with an explanatory system log so the user can
 * retry or delete it.
 */

import type { PrismaClient } from '@prisma/client';
import type pino from 'pino';
import { ServerState } from '../shared-types';

const DEFAULT_GRACE_MS = 10 * 60 * 1000;

const STUCK_STATES: string[] = [ServerState.CLONING, ServerState.TRANSFERRING];

export async function reconcileStuckOperations(
  prisma: PrismaClient,
  logger: pino.Logger,
  options: { graceMs?: number; now?: Date } = {},
): Promise<number> {
  const graceMs = options.graceMs ?? DEFAULT_GRACE_MS;
  const cutoff = new Date((options.now?.getTime() ?? Date.now()) - graceMs);

  const stuck = await prisma.server.findMany({
    where: { status: { in: STUCK_STATES }, updatedAt: { lt: cutoff } },
    select: { id: true, name: true, status: true },
  });

  for (const server of stuck) {
    await prisma.server.update({
      where: { id: server.id },
      data: { status: ServerState.STOPPED },
    });
    await prisma.serverLog.create({
      data: {
        serverId: server.id,
        stream: 'system',
        data: `Operation interrupted by a panel restart (status ${server.status}). Files may be incomplete — retry or delete this server.`,
      },
    });
  }

  if (stuck.length > 0) {
    logger.warn(
      { count: stuck.length, servers: stuck.map((s) => s.id) },
      'Reconciled servers stuck in a transitional state',
    );
  }

  return stuck.length;
}
