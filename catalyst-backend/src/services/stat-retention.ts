import type { PrismaClient } from '@prisma/client';
import type pino from 'pino';
import { captureSystemError } from './error-logger';

const MAX_RETENTION = 7 * 24 * 60 * 60 * 1000; // 7 days
const BATCH_SIZE = 1000;

export const startStatRetention = (prisma: PrismaClient, logger: pino.Logger) => {
  const log = logger.child({ component: 'StatRetention' });

  const retain = async () => {
    try {
      const cutoff = new Date(Date.now() - MAX_RETENTION);
      let totalDeleted = 0;

      while (true) {
        const batch = await prisma.serverStat.findMany({
          where: { createdAt: { lt: cutoff } },
          take: BATCH_SIZE,
          select: { id: true },
        });
        if (batch.length === 0) break;

        const result = await prisma.serverStat.deleteMany({
          where: { id: { in: batch.map((b) => b.id) } },
        });
        totalDeleted += result.count;
        if (batch.length < BATCH_SIZE) break;
        await new Promise((r) => setTimeout(r, 50));
      }

      if (totalDeleted > 0) {
        log.info({ count: totalDeleted }, 'Pruned old server stats');
      }
    } catch (err) {
      captureSystemError({ level: 'error', component: 'StatRetention', message: 'Failed to prune server stats', stack: err instanceof Error ? err.stack : undefined }).catch(() => {});
      log.error({ err }, 'Failed to prune server stats');
    }
  };

  // Run once on startup, then every hour
  retain().catch((err) => {
    captureSystemError({ level: 'error', component: 'StatRetention', message: 'Failed initial stat retention', stack: err instanceof Error ? err.stack : undefined }).catch(() => {});
    log.error({ err }, 'Failed initial stat retention');
  });
  return setInterval(retain, 60 * 60 * 1000);
};
