import { describe, expect, it, beforeAll, afterAll } from 'vitest';

import { prisma } from '../../db';
import { getInstallId, resetInstallIdCache } from '../install-id';

/**
 * PanelIdentity is a deliberate singleton — the id must persist across
 * restarts. So this suite snapshots whatever is there and restores it,
 * rather than deleting the row it creates (which would rotate every other
 * consumer's installId mid-run).
 */
type Row = { id: string; installId: string } | null;
let saved: Row = null;

describe('getInstallId', () => {
  beforeAll(async () => {
    saved = await prisma.panelIdentity.findUnique({ where: { id: 'local' } });
    resetInstallIdCache();
  });

  afterAll(async () => {
    resetInstallIdCache();
    if (saved) {
      await prisma.panelIdentity.upsert({
        where: { id: 'local' },
        create: saved,
        update: { installId: saved.installId },
      });
    } else {
      await prisma.panelIdentity.deleteMany({ where: { id: 'local' } });
    }
  });

  it('returns the same id on every call', async () => {
    const a = await getInstallId(prisma);
    const b = await getInstallId(prisma);
    expect(a).toBe(b);
  });

  it('uses the inst_ prefix and enough entropy to be unguessable', async () => {
    const id = await getInstallId(prisma);
    // 12 random bytes as hex = 24 chars after the prefix.
    expect(id).toMatch(/^inst_[0-9a-f]{24}$/);
  });

  it('survives an in-process cache reset (persisted, not per-process)', async () => {
    const before = await getInstallId(prisma);
    resetInstallIdCache();
    const after = await getInstallId(prisma);
    expect(after).toBe(before);
  });

  it('never rotates across concurrent reads', async () => {
    resetInstallIdCache();
    const ids = await Promise.all([
      getInstallId(prisma),
      getInstallId(prisma),
      getInstallId(prisma),
    ]);
    expect(new Set(ids).size).toBe(1);
  });

  it('is readable from the database after generation', async () => {
    const id = await getInstallId(prisma);
    const row = await prisma.panelIdentity.findUnique({ where: { id: 'local' } });
    expect(row?.installId).toBe(id);
  });
});
