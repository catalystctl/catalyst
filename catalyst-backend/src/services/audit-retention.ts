import type { PrismaClient } from '@prisma/client';
import type pino from 'pino';
import { getSecuritySettings } from './mailer';
import { captureSystemError } from './error-logger';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const BATCH_SIZE = 1000;

export const startAuditRetention = (prisma: PrismaClient, logger: pino.Logger) => {
  const log = logger.child({ component: 'AuditRetention' });

  const prune = async () => {
    const settings = await getSecuritySettings();
    if (!Number.isFinite(settings.auditRetentionDays) || settings.auditRetentionDays <= 0) {
      log.warn({ auditRetentionDays: settings.auditRetentionDays }, 'Invalid audit retention setting');
      return;
    }
    const cutoff = new Date(Date.now() - settings.auditRetentionDays * ONE_DAY_MS);
    let totalDeleted = 0;

    while (true) {
      const batch = await prisma.auditLog.findMany({
        where: { timestamp: { lt: cutoff } },
        take: BATCH_SIZE,
        select: { id: true },
      });
      if (batch.length === 0) break;

      const result = await prisma.auditLog.deleteMany({
        where: { id: { in: batch.map((b) => b.id) } },
      });
      totalDeleted += result.count;
      if (batch.length < BATCH_SIZE) break;
      await new Promise((r) => setTimeout(r, 50));
    }

    if (totalDeleted > 0) {
      log.info({ count: totalDeleted }, 'Pruned audit logs');
    }
  };

  const run = () => {
    prune().catch((err) => {
      captureSystemError({ level: 'error', component: 'AuditRetention', message: 'Failed to prune audit logs', stack: err instanceof Error ? err.stack : undefined }).catch(() => {});
      log.error({ err }, 'Failed to prune audit logs');
    });
  };

  run();
  return setInterval(run, ONE_DAY_MS);
};
