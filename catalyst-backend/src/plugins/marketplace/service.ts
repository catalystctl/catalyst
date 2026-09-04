import fsp from 'fs/promises';
import path from 'path';
import type { PrismaClient } from '@prisma/client';
import {
  downloadPackage,
  extractPackage,
  promoteIntoPlace,
  PackagingError,
} from './packaging';
import { compareVersions, isValidPluginName } from '../validator';

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
  /** Index URL the entry was merged from, so multi-source browsing stays attributable. */
  sourceUrl?: string;
}

/** Marketplace listing annotated with the panel's currently installed copy. */
export interface AnnotatedMarketplaceEntry extends MarketplaceEntry {
  installed: boolean;
  installedVersion: string | null;
  updateAvailable: boolean;
}

/**
 * True when the marketplace version is a strictly newer semver than the
 * installed copy. Missing/invalid versions never count as an update.
 */
export function isPluginUpdateAvailable(
  installedVersion: string | null | undefined,
  marketplaceVersion: string | null | undefined,
): boolean {
  if (!installedVersion || !marketplaceVersion) return false;
  if (!/^\d+\.\d+\.\d+$/.test(installedVersion) || !/^\d+\.\d+\.\d+$/.test(marketplaceVersion)) {
    return installedVersion !== marketplaceVersion;
  }
  return compareVersions(marketplaceVersion, installedVersion) > 0;
}

/** Attach installed/update flags so the UI can tell 1.0.0 vs marketplace 1.0.1 apart. */
export function annotateMarketplaceEntries(
  entries: MarketplaceEntry[],
  installedVersions: Map<string, string>,
): AnnotatedMarketplaceEntry[] {
  return entries.map((entry) => {
    const installedVersion = installedVersions.get(entry.name) ?? null;
    return {
      ...entry,
      installed: installedVersion !== null,
      installedVersion,
      updateAvailable: isPluginUpdateAvailable(installedVersion, entry.version),
    };
  });
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

/** Test hook: drop cached index documents so browse tests fetch fresh. */
export function clearMarketplaceCache(): void {
  indexCache.clear();
}

/** Drop one cached index (after a source is removed/disabled) or all. */
export function invalidateMarketplaceCache(url?: string): void {
  if (url) indexCache.delete(url);
  else indexCache.clear();
}

export const MAX_MARKETPLACE_URL_LENGTH = 2048;
export const MAX_MARKETPLACE_LABEL_LENGTH = 100;

/**
 * Normalize and validate a marketplace index URL added from the panel.
 * Throws a plain Error with an admin-readable message on invalid input.
 */
export function normalizeMarketplaceUrl(raw: string): string {
  const url = raw.trim();
  if (!url) throw new Error('Marketplace URL is required');
  if (url.length > MAX_MARKETPLACE_URL_LENGTH) {
    throw new Error(`Marketplace URL must be under ${MAX_MARKETPLACE_URL_LENGTH} characters`);
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Marketplace URL must be a valid http(s) URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Marketplace URL must start with http:// or https://');
  }
  return url;
}

/** Where a marketplace source came from. Env and official stay read-only. */
export type MarketplaceSourceOrigin = 'official' | 'env' | 'custom';

/** Panel-facing source row: configured indexes plus their editability. */
export interface MarketplaceSourceInfo {
  id: string;
  url: string;
  label?: string | null;
  enabled: boolean;
  origin: MarketplaceSourceOrigin;
  removable: boolean;
}

/**
 * Official first-party marketplace index, served from the public
 * catalyst-plugins repository. Always included first unless explicitly
 * disabled via PLUGIN_MARKETPLACE_DISABLE_OFFICIAL=true, so custom sources
 * configured via PLUGIN_MARKETPLACE_URLS are browsed together with it.
 * When several sources list the same plugin name, the newest semver wins.
 */
export const OFFICIAL_MARKETPLACE_INDEX_URL =
  'https://raw.githubusercontent.com/catalystctl/catalyst-plugins/main/index.json';

/** True when PLUGIN_MARKETPLACE_DISABLE_OFFICIAL opts out of the official index. */
export function isOfficialMarketplaceDisabled(): boolean {
  const raw = (process.env.PLUGIN_MARKETPLACE_DISABLE_OFFICIAL ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

/**
 * Configured marketplace index URLs, official first unless disabled.
 * PLUGIN_MARKETPLACE_URLS is a comma-separated list; entries are trimmed,
 * empties dropped and duplicates removed so every configured marketplace is
 * fetched together on each browse.
 */
export function getMarketplaceIndexUrls(): string[] {
  const seen = new Set<string>();
  const configured: string[] = [];
  for (const part of (process.env.PLUGIN_MARKETPLACE_URLS ?? '').split(',')) {
    const url = part.trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    configured.push(url);
  }
  if (isOfficialMarketplaceDisabled()) return configured;
  if (seen.has(OFFICIAL_MARKETPLACE_INDEX_URL)) {
    return [OFFICIAL_MARKETPLACE_INDEX_URL, ...configured.filter((u) => u !== OFFICIAL_MARKETPLACE_INDEX_URL)];
  }
  return [OFFICIAL_MARKETPLACE_INDEX_URL, ...configured];
}

/** Minimal Prisma surface used for panel-managed sources (keeps tests mockable). */
type MarketplaceSourceClient = Pick<PrismaClient, 'marketplaceSource'>;

/** Enabled custom URLs added from the panel. Never throws — DB issues yield []. */
async function getPanelMarketplaceUrls(prisma?: MarketplaceSourceClient): Promise<string[]> {
  if (!prisma) return [];
  try {
    const rows = await prisma.marketplaceSource.findMany({
      where: { enabled: true },
      select: { url: true },
    });
    return rows.map((r) => r.url).filter((u): u is string => typeof u === 'string' && u.length > 0);
  } catch {
    return [];
  }
}

/**
 * Effective browse list: official first (unless disabled), then env URLs,
 * then enabled panel-added sources. Deduped so every marketplace is fetched
 * together exactly once.
 */
export async function getEffectiveMarketplaceUrls(prisma?: MarketplaceSourceClient): Promise<string[]> {
  const base = getMarketplaceIndexUrls();
  const panel = await getPanelMarketplaceUrls(prisma);
  if (panel.length === 0) return base;
  const seen = new Set(base);
  const merged = [...base];
  for (const url of panel) {
    if (!seen.has(url)) {
      seen.add(url);
      merged.push(url);
    }
  }
  return merged;
}

/**
 * Panel-facing source list: official + env (read-only) plus DB rows added
 * from the panel (editable). Never throws — DB issues yield env-only rows.
 */
export async function listMarketplaceSources(prisma?: MarketplaceSourceClient): Promise<MarketplaceSourceInfo[]> {
  const officialEnabled = !isOfficialMarketplaceDisabled();
  const sources: MarketplaceSourceInfo[] = [];
  if (officialEnabled) {
    sources.push({
      id: 'official',
      url: OFFICIAL_MARKETPLACE_INDEX_URL,
      label: 'Official',
      enabled: true,
      origin: 'official',
      removable: false,
    });
  }
  for (const url of getMarketplaceIndexUrls().filter((u) => u !== OFFICIAL_MARKETPLACE_INDEX_URL)) {
    sources.push({ id: `env:${url}`, url, enabled: true, origin: 'env', removable: false });
  }
  if (!prisma) return sources;
  try {
    const rows = await prisma.marketplaceSource.findMany({ orderBy: { createdAt: 'asc' } });
    for (const row of rows) {
      sources.push({
        id: row.id,
        url: row.url,
        label: row.label ?? null,
        enabled: row.enabled,
        origin: 'custom',
        removable: true,
      });
    }
  } catch {
    // Table missing or DB down — panel still shows env sources.
  }
  return sources;
}

/** Add a panel-managed marketplace source. Throws on invalid/duplicate URLs. */
export async function addMarketplaceSource(
  prisma: MarketplaceSourceClient,
  rawUrl: string,
  label?: string | null,
  createdBy?: string | null,
) {
  const url = normalizeMarketplaceUrl(rawUrl);
  const cleanLabel = label?.trim() ? label.trim().slice(0, MAX_MARKETPLACE_LABEL_LENGTH) : null;
  const existing = new Set(await getEffectiveMarketplaceUrls(prisma));
  if (existing.has(url)) throw new Error('That marketplace is already configured');
  const created = await prisma.marketplaceSource.create({
    data: { url, label: cleanLabel, enabled: true, createdBy: createdBy ?? null },
  });
  invalidateMarketplaceCache(url);
  return created;
}

/** Enable or disable a panel-added source. */
export async function setMarketplaceSourceEnabled(
  prisma: MarketplaceSourceClient,
  id: string,
  enabled: boolean,
) {
  const updated = await prisma.marketplaceSource.update({ where: { id }, data: { enabled } });
  invalidateMarketplaceCache(updated.url);
  return updated;
}

/** Remove a panel-added source. */
export async function removeMarketplaceSource(prisma: MarketplaceSourceClient, id: string) {
  const removed = await prisma.marketplaceSource.delete({ where: { id } });
  invalidateMarketplaceCache(removed.url);
  return removed;
}

export async function browseMarketplaces(
  logger: MarketplaceLogger,
  opts: { allowLocal?: boolean; forceRefresh?: boolean; prisma?: MarketplaceSourceClient; urls?: string[] } = {},
): Promise<{ sources: { url: string; ok: boolean; error?: string; entryCount: number }[]; entries: MarketplaceEntry[] }> {
  const urls = opts.urls ?? (opts.prisma ? await getEffectiveMarketplaceUrls(opts.prisma) : getMarketplaceIndexUrls());
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
        const res = await fetch(url, {
          signal: AbortSignal.timeout(15_000),
          cache: 'no-store',
          headers: opts.forceRefresh
            ? { 'Cache-Control': 'no-cache', Pragma: 'no-cache' }
            : undefined,
        });
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
  for (const r of results) {
    for (const e of r.entries) {
      const existing = byName.get(e.name);
      if (!existing) {
        byName.set(e.name, { ...e, sourceUrl: r.url });
        continue;
      }
      // Same plugin listed by several marketplaces: keep the newest semver so
      // a newer release on any one source is visible when browsed together.
      // Non-semver versions are not comparable — keep the first source's copy.
      const prev = existing.version ?? '';
      const next = e.version ?? '';
      const comparable = /^\d+\.\d+\.\d+$/.test(prev) && /^\d+\.\d+\.\d+$/.test(next);
      if (comparable && compareVersions(next, prev) > 0) {
        byName.set(e.name, { ...e, sourceUrl: r.url });
      }
    }
  }

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

    // Extract onto the plugins volume (hidden `.staging`) so the final
    // promote is a same-filesystem rename. `/tmp` is a different device in
    // the Docker image, and rename(2) then fails with EXDEV.
    const stagingRoot = path.join(this.pluginsDir, '.staging');
    await fsp.mkdir(stagingRoot, { recursive: true });
    const stagedDir = await fsp.mkdtemp(path.join(stagingRoot, 'catpkg-'));

    try {
      const { manifest } = await extractPackage(tmpPath, stagedDir);

      const name = String(manifest.name);
      const version = String(manifest.version);

      const existingRow = await this.prisma.plugin.findUnique({ where: { name }, select: { version: true } });
      if (existingRow && existingRow.version === version) {
        // A leftover Plugin row from an uninstall without purge must not
        // block reinstalling the same version — only skip when the code is
        // still on disk.
        const onDisk = await fsp.stat(path.join(this.pluginsDir, name)).catch(() => null);
        if (onDisk?.isDirectory()) {
          throw new PackagingError('ALREADY_INSTALLED', `Plugin ${name}@${version} is already installed`);
        }
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
      await fsp.rm(stagedDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  async uninstall(name: string, opts: { purgeData?: boolean } = {}): Promise<void> {
    if (!isValidPluginName(name)) {
      throw new PackagingError('INVALID_NAME', `Invalid plugin name: ${name}`);
    }
    const pluginsRoot = path.resolve(this.pluginsDir);
    const finalDir = path.join(pluginsRoot, name);
    if (path.dirname(finalDir) !== pluginsRoot || finalDir === pluginsRoot) {
      throw new PackagingError('INVALID_NAME', `Invalid plugin name: ${name}`);
    }
    const stat = await fsp.stat(finalDir).catch(() => null);
    const existingRow = await this.prisma.plugin.findUnique({ where: { name }, select: { name: true } }).catch(() => null);
    if (!stat?.isDirectory() && !existingRow) {
      throw new PackagingError('NOT_FOUND', `Plugin ${name} is not installed`);
    }

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
