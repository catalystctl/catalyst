import type { PrismaClient } from '@prisma/client';
import type pino from 'pino';

const MAX_RETENTION = 7 * 24 * 60 * 60 * 1000; // 7 days

export const startStatRetention = (prisma: PrismaClient, logger: pino.Logger) => {
  const log = logger.child({ component: 'StatRetention' });

  const retain = async () => {
    try {
      const cutoff = new Date(Date.now() - MAX_RETENTION);
      const result = await prisma.serverStat.deleteMany({
        where: { createdAt: { lt: cutoff } },
      });
      if (result.count > 0) {
        log.info({ count: result.count }, 'Pruned old server stats');
      }
    } catch (err) {
      log.error({ err }, 'Failed to prune server stats');
    }
  };

  // Run once on startup, then every hour
  retain().catch((err) => log.error({ err }, 'Failed initial stat retention'));
  return setInterval(retain, 60 * 60 * 1000);
};
