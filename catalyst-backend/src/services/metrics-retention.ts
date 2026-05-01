import type { PrismaClient } from '@prisma/client';
import type pino from 'pino';
import { captureSystemError } from './error-logger';

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const BATCH_SIZE = 5000;
const METRICS_RETENTION_DAYS = Number(process.env.METRICS_RETENTION_DAYS || '30');

export const startMetricsRetention = (prisma: PrismaClient, logger: pino.Logger) => {
  const log = logger.child({ component: 'MetricsRetention' });

  const prune = async () => {
    try {
      const cutoff = new Date(Date.now() - METRICS_RETENTION_DAYS * 24 * 60 * 60 * 1000);

      for (const model of ['serverMetrics', 'nodeMetrics'] as const) {
        let totalDeleted = 0;

        while (true) {
          const batch = await (prisma[model] as any).findMany({
            where: { timestamp: { lt: cutoff } },
            take: BATCH_SIZE,
            select: { id: true },
          });
          if (batch.length === 0) break;

          const result = await (prisma[model] as any).deleteMany({
            where: { id: { in: batch.map((b: any) => b.id) } },
          });
          totalDeleted += result.count;
          if (batch.length < BATCH_SIZE) break;
          await new Promise((r) => setTimeout(r, 50));
        }

        if (totalDeleted > 0) {
          log.info({ model, count: totalDeleted }, 'Pruned metrics');
        }
      }
    } catch (err) {
      captureSystemError({ level: 'error', component: 'MetricsRetention', message: 'Failed to prune metrics', stack: err instanceof Error ? err.stack : undefined }).catch(() => {});
      log.error({ err }, 'Failed to prune metrics');
    }
  };

  // Run once on startup, then every 6 hours
  prune().catch((err) => {
    captureSystemError({ level: 'error', component: 'MetricsRetention', message: 'Failed initial metrics retention', stack: err instanceof Error ? err.stack : undefined }).catch(() => {});
    log.error({ err }, 'Failed initial metrics retention');
  });
  return setInterval(prune, SIX_HOURS_MS);
};
