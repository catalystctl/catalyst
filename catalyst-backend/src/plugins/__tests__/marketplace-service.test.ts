/**
 * Tests for PluginMarketplaceService uninstall lifecycle.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import { PluginMarketplaceService, PackagingError } from '../marketplace/service';

const logger = { info: () => {}, warn: () => {}, error: () => {} };

let pluginsDir: string;

function mockPrisma(opts: { hasRow?: boolean } = {}) {
  return {
    plugin: {
      findUnique: vi.fn(async () => (opts.hasRow ? { name: 'demo-plugin' } : null)),
      delete: vi.fn(async () => ({ name: 'demo-plugin' })),
    },
    pluginStorage: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
  } as any;
}

beforeEach(async () => {
  pluginsDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'plugins-'));
});

afterEach(async () => {
  await fsp.rm(pluginsDir, { recursive: true, force: true }).catch(() => {});
});

describe('PluginMarketplaceService.uninstall', () => {
  it('rejects invalid plugin names', async () => {
    const svc = new PluginMarketplaceService(pluginsDir, mockPrisma(), logger, async () => {});
    await expect(svc.uninstall('../escape')).rejects.toMatchObject({ code: 'INVALID_NAME' });
    await expect(svc.uninstall('UPPERCASE')).rejects.toMatchObject({ code: 'INVALID_NAME' });
  });

  it('throws NOT_FOUND when neither directory nor DB row exists', async () => {
    const svc = new PluginMarketplaceService(pluginsDir, mockPrisma({ hasRow: false }), logger, async () => {});
    await expect(svc.uninstall('demo-plugin')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('removes the directory but keeps the DB row without purge', async () => {
    await fsp.mkdir(path.join(pluginsDir, 'demo-plugin'), { recursive: true });
    await fsp.writeFile(path.join(pluginsDir, 'demo-plugin', 'plugin.json'), '{}');
    const prisma = mockPrisma({ hasRow: true });
    const svc = new PluginMarketplaceService(pluginsDir, prisma, logger, async () => {});
    await svc.uninstall('demo-plugin');
    await expect(fsp.stat(path.join(pluginsDir, 'demo-plugin')).catch(() => null)).resolves.toBeNull();
    expect(prisma.plugin.delete).not.toHaveBeenCalled();
    expect(prisma.pluginStorage.deleteMany).not.toHaveBeenCalled();
  });

  it('purges storage and the Plugin row when purgeData is true', async () => {
    await fsp.mkdir(path.join(pluginsDir, 'demo-plugin'), { recursive: true });
    const prisma = mockPrisma({ hasRow: true });
    const svc = new PluginMarketplaceService(pluginsDir, prisma, logger, async () => {});
    await svc.uninstall('demo-plugin', { purgeData: true });
    await expect(fsp.stat(path.join(pluginsDir, 'demo-plugin')).catch(() => null)).resolves.toBeNull();
    expect(prisma.pluginStorage.deleteMany).toHaveBeenCalledWith({ where: { pluginName: 'demo-plugin' } });
    expect(prisma.plugin.delete).toHaveBeenCalledWith({ where: { name: 'demo-plugin' } });
  });

  it('allows DB-only cleanup when the directory is already gone', async () => {
    const prisma = mockPrisma({ hasRow: true });
    const svc = new PluginMarketplaceService(pluginsDir, prisma, logger, async () => {});
    await svc.uninstall('demo-plugin', { purgeData: true });
    expect(prisma.plugin.delete).toHaveBeenCalled();
  });

  it('still throws PackagingError with stable codes', () => {
    expect(new PackagingError('NOT_FOUND', 'x').code).toBe('NOT_FOUND');
  });
});
