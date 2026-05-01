import type { PrismaClient } from '@prisma/client';
import type pino from 'pino';
import { captureSystemError } from './error-logger';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const BATCH_SIZE = 1000;

export const startAuthRetention = (prisma: PrismaClient, logger: pino.Logger) => {
  const log = logger.child({ component: 'AuthRetention' });

  const prune = async () => {
    try {
      const now = new Date();
      let totalDeleted = 0;

      // Prune expired sessions
      while (true) {
        const batch = await prisma.session.findMany({
          where: { expiresAt: { lt: now } },
          take: BATCH_SIZE,
          select: { id: true },
        });
        if (batch.length === 0) break;

        const result = await prisma.session.deleteMany({
          where: { id: { in: batch.map((b) => b.id) } },
        });
        totalDeleted += result.count;
        if (batch.length < BATCH_SIZE) break;
        await new Promise((r) => setTimeout(r, 50));
      }

      // Prune expired verifications
      while (true) {
        const batch = await prisma.verification.findMany({
          where: { expiresAt: { lt: now } },
          take: BATCH_SIZE,
          select: { id: true },
        });
        if (batch.length === 0) break;

        const result = await prisma.verification.deleteMany({
          where: { id: { in: batch.map((b) => b.id) } },
        });
        totalDeleted += result.count;
        if (batch.length < BATCH_SIZE) break;
        await new Promise((r) => setTimeout(r, 50));
      }

      if (totalDeleted > 0) {
        log.info({ count: totalDeleted }, 'Pruned expired auth records');
      }
    } catch (err) {
      captureSystemError({ level: 'error', component: 'AuthRetention', message: 'Failed to prune auth records', stack: err instanceof Error ? err.stack : undefined }).catch(() => {});
      log.error({ err }, 'Failed to prune auth records');
    }
  };

  // Run once on startup, then daily
  prune().catch((err) => {
    captureSystemError({ level: 'error', component: 'AuthRetention', message: 'Failed initial auth retention', stack: err instanceof Error ? err.stack : undefined }).catch(() => {});
    log.error({ err }, 'Failed initial auth retention');
  });
  return setInterval(prune, ONE_DAY_MS);
};
