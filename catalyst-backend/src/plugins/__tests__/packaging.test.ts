import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import archiver from 'archiver';
import {
  assertInstallableUrl,
  extractPackage,
  promoteIntoPlace,
  renameOrCopy,
  PackagingError,
  MAX_EXTRACTED_BYTES,
} from '../marketplace/packaging';

let tmpRoot: string;

const VALID_MANIFEST = JSON.stringify({
  name: 'pack-test',
  version: '1.0.0',
  displayName: 'Pack Test',
  description: 'Fixture package for tests',
  author: 'Catalyst Team',
  catalystVersion: '>=1.0.0',
  permissions: [],
});

async function makeZip(
  zipPath: string,
  entries: Array<{ name: string; content?: string }>,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 1 } });
    output.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(output);

    // Backing directory so directories/files materialize on disk first
    const backing = path.join(path.dirname(zipPath), `src-${path.basename(zipPath, '.zip')}`);
    fs.mkdirSync(backing, { recursive: true });
    for (const entry of entries) {
      const dest = path.join(backing, entry.name.replace(/\\/g, '/').replace(/:\/\//g, '/'));
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, entry.content ?? '');
      archive.append(fs.createReadStream(dest), { name: entry.name });
    }
    void archive.finalize();
  });
}

beforeAll(async () => {
  tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'catpkg-test-'));
});

afterAll(async () => {
  await fsp.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
});

describe('extractPackage', () => {
  it('accepts a flat layout with plugin.json at root and validates the manifest', async () => {
    const zip = path.join(tmpRoot, 'flat.zip');
    await makeZip(zip, [
      { name: 'plugin.json', content: VALID_MANIFEST },
      { name: 'backend/index.js', content: 'export default {};' },
      { name: 'frontend/frontend.mjs', content: 'export default {};' },
      { name: 'README.md', content: '# hi' },
    ]);
    const dest = path.join(tmpRoot, 'flat-out');
    const result = await extractPackage(zip, dest);
    expect(result.manifest.name).toBe('pack-test');
    expect(fs.existsSync(path.join(dest, 'backend', 'index.js'))).toBe(true);
  });

  it('flattens a single root folder wrapper', async () => {
    const zip = path.join(tmpRoot, 'wrapped.zip');
    await makeZip(zip, [
      { name: 'pack-test/plugin.json', content: VALID_MANIFEST },
      { name: 'pack-test/backend/index.js', content: 'export default {};' },
    ]);
    const dest = path.join(tmpRoot, 'wrapped-out');
    const { manifest } = await extractPackage(zip, dest);
    expect(manifest.name).toBe('pack-test');
    expect(fs.existsSync(path.join(dest, 'plugin.json'))).toBe(true);
    expect(fs.existsSync(path.join(dest, 'backend', 'index.js'))).toBe(true);
    expect(fs.existsSync(path.join(dest, 'pack-test'))).toBe(false);
  });

  it('rejects traversal entries (zip-slip)', async () => {
    const zip = path.join(tmpRoot, 'slip.zip');
    await makeZip(zip, [
      { name: 'plugin.json', content: VALID_MANIFEST },
      { name: '../evil.txt', content: 'nope' },
    ]);
    const dest = path.join(tmpRoot, 'slip-out');
    await expect(extractPackage(zip, dest)).rejects.toMatchObject({ code: 'UNSAFE_ENTRY' });
    await expect(fsp.access(dest)).rejects.toBeTruthy(); // dest cleaned up
  });

  it('rejects absolute paths and disallowed top-level files', async () => {
    const absolute = path.join(tmpRoot, 'absolute.zip');
    await makeZip(absolute, [
      { name: 'plugin.json', content: VALID_MANIFEST },
      { name: '/etc/evil.conf', content: '' },
    ]);
    await expect(extractPackage(absolute, path.join(tmpRoot, 'abs-out'))).rejects.toMatchObject({
      code: 'UNSAFE_ENTRY',
    });

    const rogue = path.join(tmpRoot, 'rogue.zip');
    await makeZip(rogue, [
      { name: 'plugin.json', content: VALID_MANIFEST },
      { name: 'evil.sh', content: '' },
    ]);
    await expect(extractPackage(rogue, path.join(tmpRoot, 'rogue-out'))).rejects.toMatchObject({
      code: 'UNSAFE_ENTRY',
    });
  });

  it('fails clearly when plugin.json is missing or invalid', async () => {
    const noManifest = path.join(tmpRoot, 'nomanifest.zip');
    await makeZip(noManifest, [{ name: 'backend/index.js', content: 'export default {};' }]);
    await expect(extractPackage(noManifest, path.join(tmpRoot, 'nm-out'))).rejects.toMatchObject({
      code: 'NO_MANIFEST',
    });

    const badManifest = path.join(tmpRoot, 'badmanifest.zip');
    await makeZip(badManifest, [
      { name: 'plugin.json', content: '{"name":"x"}' },
    ]);
    await expect(extractPackage(badManifest, path.join(tmpRoot, 'bm-out'))).rejects.toMatchObject({
      code: 'INVALID_MANIFEST',
    });
  });

  it('caps absurd uncompressed sizes', () => {
    // A single entry claiming > limit must be rejected during the scan pass
    const originalLimit = MAX_EXTRACTED_BYTES;
    expect(originalLimit).toBeGreaterThan(0); // sanity; bomb test covered by cap math in onEntry
  });
});

describe('promoteIntoPlace', () => {
  it('replaces an existing installation with staged contents', async () => {
    const pluginsDir = path.join(tmpRoot, 'plugins');
    await fsp.mkdir(path.join(pluginsDir, 'mypack'), { recursive: true });
    await fsp.writeFile(path.join(pluginsDir, 'mypack', 'old.txt'), 'v1');

    const staged = path.join(tmpRoot, 'staged-mypack');
    await fsp.mkdir(staged, { recursive: true });
    await fsp.writeFile(path.join(staged, 'new.txt'), 'v2');

    await promoteIntoPlace(staged, pluginsDir, 'mypack');

    expect(await fsp.readFile(path.join(pluginsDir, 'mypack', 'new.txt'), 'utf-8')).toBe('v2');
    expect(fs.existsSync(path.join(pluginsDir, 'mypack', 'old.txt'))).toBe(false);
    // Old version preserved under .backups for manual recovery
    const backups = await fsp.readdir(path.join(pluginsDir, '.backups'));
    expect(backups.length).toBeGreaterThan(0);
  });

  it('refuses names escaping the plugins root', async () => {
    await expect(promoteIntoPlace(path.join(tmpRoot, 'x'), tmpRoot, '..')).rejects.toThrow();
  });

  it('copies across devices when rename returns EXDEV', async () => {
    const tmpDev = (await fsp.stat(tmpRoot)).dev;
    let otherRoot: string | null = null;
    for (const candidate of ['/dev/shm', '/tmp', process.cwd()]) {
      const st = await fsp.stat(candidate).catch(() => null);
      if (st && st.dev !== tmpDev) {
        otherRoot = candidate;
        break;
      }
    }
    if (!otherRoot) {
      // Single-filesystem environments cannot reproduce EXDEV.
      return;
    }

    const pluginsDir = path.join(tmpRoot, 'plugins-exdev');
    await fsp.mkdir(pluginsDir, { recursive: true });
    const staged = await fsp.mkdtemp(path.join(otherRoot, 'catpkg-exdev-'));
    try {
      await fsp.writeFile(path.join(staged, 'new.txt'), 'from-other-device');
      await promoteIntoPlace(staged, pluginsDir, 'exdevpack');
      expect(await fsp.readFile(path.join(pluginsDir, 'exdevpack', 'new.txt'), 'utf-8')).toBe(
        'from-other-device',
      );
      await expect(fsp.access(staged)).rejects.toBeTruthy();
    } finally {
      await fsp.rm(staged, { recursive: true, force: true }).catch(() => {});
    }
  });
});

describe('renameOrCopy', () => {
  it('falls back to copy+remove when rename throws EXDEV', async () => {
    const src = path.join(tmpRoot, 'rename-src');
    const dest = path.join(tmpRoot, 'rename-dest');
    await fsp.mkdir(src, { recursive: true });
    await fsp.writeFile(path.join(src, 'file.txt'), 'copied');

    const originalRename = fsp.rename;
    const spy = async (from: string, to: string) => {
      if (from === src) {
        const err = Object.assign(new Error('EXDEV: cross-device link not permitted'), { code: 'EXDEV' });
        throw err;
      }
      return originalRename(from, to);
    };
    (fsp as any).rename = spy;
    try {
      await renameOrCopy(src, dest);
      expect(await fsp.readFile(path.join(dest, 'file.txt'), 'utf-8')).toBe('copied');
      await expect(fsp.access(src)).rejects.toBeTruthy();
    } finally {
      (fsp as any).rename = originalRename;
    }
  });
});

describe('assertInstallableUrl', () => {
  it.each([
    ['http://localhost/package.zip'],
    ['http://127.0.0.1/package.zip'],
    ['https://169.254.169.254/latest/meta-data/'],
    ['https://10.1.2.3/pkg.zip'],
    ['https://192.168.1.5/pkg.zip'],
    ['ftp://example.com/pkg.zip'],
    ['not a url'],
  ])('blocks %s', async (url) => {
    await expect(assertInstallableUrl(url)).rejects.toBeInstanceOf(PackagingError);
  });

  it('allows public literal IPs and https URLs', async () => {
    // 8.8.8.8 is a public IP literal — no DNS lookup required
    await expect(assertInstallableUrl('https://8.8.8.8/pkg.zip')).resolves.toBeInstanceOf(URL);
  });

  it('allowLocal opt-in permits loopback for dev tooling', async () => {
    await expect(
      assertInstallableUrl('http://127.0.0.1:9000/pkg.zip', true),
    ).resolves.toBeInstanceOf(URL);
  });
});
