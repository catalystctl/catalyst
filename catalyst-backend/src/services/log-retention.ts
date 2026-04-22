import type { PrismaClient } from '@prisma/client';
import type pino from 'pino';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const BATCH_SIZE = 1000;
const LOG_RETENTION_DAYS = 7;

export const startLogRetention = (prisma: PrismaClient, logger: pino.Logger) => {
  const log = logger.child({ component: 'LogRetention' });

  const prune = async () => {
    const cutoff = new Date(Date.now() - LOG_RETENTION_DAYS * ONE_DAY_MS);
    let totalDeleted = 0;

    while (true) {
      const batch = await prisma.serverLog.findMany({
        where: { timestamp: { lt: cutoff } },
        take: BATCH_SIZE,
        select: { id: true },
      });
      if (batch.length === 0) break;

      const result = await prisma.serverLog.deleteMany({
        where: { id: { in: batch.map((b) => b.id) } },
      });
      totalDeleted += result.count;
      if (batch.length < BATCH_SIZE) break;
      await new Promise((r) => setTimeout(r, 50));
    }

    if (totalDeleted > 0) {
      log.info({ count: totalDeleted }, 'Pruned old server logs');
    }
  };

  const run = () => {
    prune().catch((err) => log.error({ err }, 'Failed to prune server logs'));
  };

  run();
  return setInterval(run, ONE_DAY_MS);
};
