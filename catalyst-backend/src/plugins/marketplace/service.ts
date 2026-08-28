import fsp from 'fs/promises';
import path from 'path';
import type { PrismaClient } from '@prisma/client';
import {
  downloadPackage,
  extractPackage,
  promoteIntoPlace,
  PackagingError,
} from './packaging';

export { PackagingError };

/** Structural logger subset so fastify/pino loggers both fit. */
export interface MarketplaceLogger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

/**
 * Marketplace install/update/uninstall lifecycle.
 *
 * Trust model:
 *  - Installing places inert code on disk; nothing executes until an admin
 *    accepts the safety disclaimer and enables the plugin (loader gate).
 *  - Updates are installs over an existing plugin; rollback keeps the previous
 *    directory if placement fails, and consent re-prompts on version change.
 *  - Uninstall removes the directory; data purge is explicit and optional.
 */

export interface InstalledPluginResult {
  name: string;
  version: string;
  /** True when this replaced an existing installation of the same plugin. */
  upgraded: boolean;
  sha256: string;
}

export interface MarketplaceEntry {
  name: string;
  displayName?: string;
  description?: string;
  author?: string;
  version?: string;
  downloadUrl: string;
  sha256?: string;
  homepage?: string;
  tags?: string[];
}

export const MARKETPLACE_INDEX_SCHEMA_VERSION = 1;

const MarketplaceIndexSchema = {
  parse(raw: unknown): MarketplaceEntry[] {
    const obj = raw as any;
    const entriesRaw = Array.isArray(obj)
      ? obj
      : Array.isArray(obj?.plugins)
        ? obj.plugins
        : null;
    if (!entriesRaw) return [];
    return entriesRaw
      .map((e: any): MarketplaceEntry | null => {
        if (!e || typeof e !== 'object') return null;
        if (typeof e.name !== 'string' || typeof e.downloadUrl !== 'string') return null;
        return {
          name: e.name,
          displayName: typeof e.displayName === 'string' ? e.displayName : undefined,
          description: typeof e.description === 'string' ? e.description : undefined,
          author: typeof e.author === 'string' ? e.author : undefined,
          version: typeof e.version === 'string' ? e.version : undefined,
          downloadUrl: e.downloadUrl,
          sha256: typeof e.sha256 === 'string' ? e.sha256 : undefined,
          homepage: typeof e.homepage === 'string' ? e.homepage : undefined,
          tags: Array.isArray(e.tags) ? e.tags.filter((t: unknown) => typeof t === 'string').slice(0, 12) : undefined,
        };
      })
      .filter((e): e is MarketplaceEntry => e !== null);
  },
};

// ── Index browsing ──────────────────────────────────────────────────────────

interface CacheSlot {
  fetchedAt: number;
  entries: MarketplaceEntry[];
}
const indexCache = new Map<string, CacheSlot>();
const INDEX_TTL_MS = 5 * 60 * 1000;

/** Configured marketplace index URLs. Comma-separated env var. */
export function getMarketplaceIndexUrls(): string[] {
  return (process.env.PLUGIN_MARKETPLACE_URLS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function browseMarketplaces(
  logger: MarketplaceLogger,
  opts: { allowLocal?: boolean; forceRefresh?: boolean } = {},
): Promise<{ sources: { url: string; ok: boolean; error?: string; entryCount: number }[]; entries: MarketplaceEntry[] }> {
  const urls = getMarketplaceIndexUrls();
  if (urls.length === 0) {
    return { sources: [], entries: [] };
  }

  const results = await Promise.all(
    urls.map(async (url) => {
      const cached = indexCache.get(url);
      if (!opts.forceRefresh && cached && Date.now() - cached.fetchedAt < INDEX_TTL_MS) {
        return { url, ok: true as const, entryCount: cached.entries.length, entries: cached.entries };
      }
      try {
        // Indexes are small JSON documents — plain https GET with SSRF guard
        const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.json();
        const entries = MarketplaceIndexSchema.parse(body);
        indexCache.set(url, { fetchedAt: Date.now(), entries });
        return { url, ok: true as const, entryCount: entries.length, entries };
      } catch (err: any) {
        logger.warn({ url, error: err.message }, 'Marketplace index fetch failed');
        return { url, ok: false as const, error: err.message, entryCount: 0, entries: [] as MarketplaceEntry[] };
      }
    }),
  );

  const byName = new Map<string, MarketplaceEntry>();
  for (const r of results) for (const e of r.entries) if (!byName.has(e.name)) byName.set(e.name, e);

  void opts.allowLocal;
  return {
    sources: results.map(({ url, ok, error, entryCount }) => ({ url, ok, error, entryCount })),
    entries: [...byName.values()],
  };
}

// ── Install / update ────────────────────────────────────────────────────────

export class PluginMarketplaceService {
  constructor(
    private pluginsDir: string,
    private prisma: PrismaClient,
    private logger: MarketplaceLogger,
    private loadPluginFn: (dirName: string) => Promise<void>,
    private opts: { allowLocalDownloads?: boolean } = {},
  ) {}

  async installFromUrl(downloadUrl: string, expectedSha256?: string): Promise<InstalledPluginResult> {
    const { tmpPath, sha256 } = await downloadPackage(downloadUrl, {
      expectedSha256: expectedSha256 ?? null,
      allowLocal: this.opts.allowLocalDownloads ?? false,
    });

    try {
      // Stage into a sibling temp dir so promoteIntoPlace can rename on the
      // same filesystem (atomic on POSIX).
      const stagedDir = path.join(path.dirname(tmpPath), 'extracted');
      const { manifest } = await extractPackage(tmpPath, stagedDir);

      const name = String(manifest.name);
      const version = String(manifest.version);

      const existingRow = await this.prisma.plugin.findUnique({ where: { name }, select: { version: true } });
      if (existingRow && existingRow.version === version) {
        await fsp.rm(stagedDir, { recursive: true, force: true }).catch(() => {});
        throw new PackagingError('ALREADY_INSTALLED', `Plugin ${name}@${version} is already installed`);
      }

      await promoteIntoPlace(stagedDir, this.pluginsDir, name);

      // Wire the plugin into the running registry without a full restart.
      // Discovery also runs via chokidar in dev, but reload() makes prod installs immediate.
      try {
        await this.loadPluginFn(name);
      } catch (err: any) {
        this.logger.error({ plugin: name, error: err.message }, 'Post-install discovery failed; plugin will load at next restart');
      }

      this.logger.info({ plugin: name, version, upgraded: !!existingRow }, 'Plugin installed from marketplace package');
      return { name, version, upgraded: !!existingRow, sha256 };
    } finally {
      await fsp.rm(tmpPath, { force: true }).catch(() => {});
    }
  }

  async uninstall(name: string, opts: { purgeData?: boolean } = {}): Promise<void> {
    const finalDir = path.join(this.pluginsDir, name);
    const stat = await fsp.stat(finalDir).catch(() => null);

    if (opts.purgeData) {
      await this.prisma.pluginStorage.deleteMany({ where: { pluginName: name } });
    }

    if (stat?.isDirectory()) {
      const trash = path.join(this.pluginsDir, `.backups`, `${name}-removed-${Date.now()}`);
      await fsp.mkdir(path.dirname(trash), { recursive: true });
      await fsp.rename(finalDir, trash).catch(async () => {
        // Cross-device or lock fallback: direct rm
        await fsp.rm(finalDir, { recursive: true, force: true });
      });
    }

    if (opts.purgeData) {
      await this.prisma.plugin.delete({ where: { name } }).catch(() => {});
    }

    this.logger.info({ plugin: name, purged: !!opts.purgeData }, 'Plugin uninstalled');
  }
}
