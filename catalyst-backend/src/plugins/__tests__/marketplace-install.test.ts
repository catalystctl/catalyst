/**
 * Regression tests for PluginMarketplaceService.installFromUrl staging.
 *
 * extract-zip refuses a relative target directory, so the staging root must be
 * resolved before it is handed over. PLUGINS_DIR is relative in the shipped
 * .env.example (`./plugins`), so a relative pluginsDir must still install.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';

const downloadPackage = vi.fn(async () => ({
  tmpPath: path.join(os.tmpdir(), 'fake.catpkg.zip'),
  sha256: 'a'.repeat(64),
}));
const extractPackage = vi.fn(async (_tmp: string, targetDir: string) => {
  expect(path.isAbsolute(targetDir)).toBe(true);
  return { manifest: { name: 'demo-plugin', version: '2.0.0' } };
});
const promoteIntoPlace = vi.fn(async () => {});

vi.mock('../marketplace/packaging', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../marketplace/packaging')>();
  return { ...actual, downloadPackage, extractPackage, promoteIntoPlace };
});

const { PluginMarketplaceService } = await import('../marketplace/service');

const logger = { info: () => {}, warn: () => {}, error: () => {} };

function mockPrisma() {
  return { plugin: { findUnique: vi.fn(async () => null) } } as any;
}

describe('PluginMarketplaceService.installFromUrl', () => {
  const created: string[] = [];

  afterEach(async () => {
    for (const dir of created.splice(0)) {
      await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
    vi.clearAllMocks();
  });

  it('stages through an absolute path even when pluginsDir is relative', async () => {
    const relativeDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'relative-plugins-'));
    created.push(relativeDir);
    const previousCwd = process.cwd();
    process.chdir(relativeDir);
    try {
      // Mirrors PLUGINS_DIR=./plugins in .env.example.
      const svc = new PluginMarketplaceService('./plugins', mockPrisma(), logger, async () => {});
      const result = await svc.installFromUrl('https://example.com/demo-plugin-2.0.0.catpkg.zip');

      expect(result).toMatchObject({ name: 'demo-plugin', version: '2.0.0', upgraded: false });
      expect(extractPackage).toHaveBeenCalledTimes(1);
      expect(promoteIntoPlace).toHaveBeenCalledTimes(1);
      expect(await fsp.stat(path.join(relativeDir, 'plugins', '.staging'))).toBeTruthy();
    } finally {
      process.chdir(previousCwd);
    }
  });
});
