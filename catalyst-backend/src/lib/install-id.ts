import { randomBytes } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';

/**
 * Stable, opaque install identity for this panel.
 *
 * Generated once and persisted in `PanelIdentity`, so it survives restarts and
 * plugin reinstalls. Plugins receive it as `ctx.installId`; third-party vendor
 * license servers bind seats to it. It is an identifier, not a secret — it is
 * deliberately not derived from anything an operator could leak (host name,
 * licence key, MAC address) and it never rotates.
 */
const ROW_ID = 'local';
const PREFIX = 'inst_';

let cached: string | null = null;

/** Test hook: drop the in-process memo so a test can exercise first-run. */
export function resetInstallIdCache(): void {
  cached = null;
}

export async function getInstallId(prisma: PrismaClient): Promise<string> {
  if (cached) return cached;

  const existing = await prisma.panelIdentity.findUnique({ where: { id: ROW_ID } });
  if (existing?.installId) {
    cached = existing.installId;
    return cached;
  }

  const installId = `${PREFIX}${randomBytes(12).toString('hex')}`;
  try {
    await prisma.panelIdentity.create({ data: { id: ROW_ID, installId } });
    cached = installId;
  } catch {
    // Lost a race with another process (or a restart mid-write) — the winner
    // holds the canonical id and we must adopt it, never invent a second one.
    const winner = await prisma.panelIdentity.findUnique({ where: { id: ROW_ID } });
    cached = winner?.installId ?? installId;
  }
  return cached;
}
