import fs from 'fs';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import dns from 'dns';
import net from 'net';
import fetch from 'node-fetch';
import extract from 'extract-zip';
import { validateManifest } from '../validator';

/**
 * Plugin package (.catpkg.zip) handling.
 *
 * A catpkg is a plain ZIP containing at minimum a root `plugin.json`, plus any
 * of: `backend/`, `frontend/` (with optional self-contained `frontend.mjs`
 * runtime bundle), `assets/`, `README.md`. Everything else is rejected — a
 * marketplace package can never write outside its own namespace.
 */

export const MAX_PACKAGE_BYTES = 256 * 1024 * 1024; // 256 MB compressed
export const MAX_EXTRACTED_BYTES = 512 * 1024 * 1024; // 512 MB uncompressed
export const MAX_ENTRY_COUNT = 20_000;

/** Top-level entries a package may contain. Anything else is rejected. */
const ALLOWED_TOP_LEVEL = new Set([
  'plugin.json',
  'README.md',
  'LICENSE',
  'backend',
  'frontend',
  'assets',
]);

export class PackagingError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'PackagingError';
  }
}

// ── SSRF guard ───────────────────────────────────────────────────────────────

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true; // link-local / cloud metadata
    return false;
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return true;
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // ULA
    if (lower.startsWith('fe80')) return true; // link-local
    return false;
  }
  return true; // unparseable → treat as unsafe
}

/**
 * Validate an install URL against SSRF basics. Resolve every DNS result and
 * refuse loopback/private/link-local targets. `allowLocal` exists purely for
 * tests and local dev tooling.
 */
export async function assertInstallableUrl(rawUrl: string, allowLocal = false): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new PackagingError('INVALID_URL', `Invalid download URL: ${rawUrl}`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new PackagingError('INVALID_URL', 'Download URL must be http(s)');
  }
  const host = url.hostname.toLowerCase();
  const isLiteralLocal =
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    (net.isIP(host) !== 0 && isPrivateIp(host));
  if (!allowLocal && isLiteralLocal) {
    throw new PackagingError('FORBIDDEN_HOST', 'Refusing to download from local/private hosts');
  }
  if (!allowLocal && net.isIP(host) === 0) {
    let addresses: string[];
    try {
      addresses = await dns.promises.lookup(host, { all: true }).then((r) => r.map((x) => x.address));
    } catch {
      throw new PackagingError('DNS_FAILURE', `Could not resolve host: ${host}`);
    }
    if (addresses.some((ip) => isPrivateIp(ip))) {
      throw new PackagingError('FORBIDDEN_HOST', `Host ${host} resolves to a private address`);
    }
  }
  return url;
}

// ── Download ────────────────────────────────────────────────────────────────

export interface DownloadResult {
  tmpPath: string;
  sha256: string;
  bytes: number;
}

/**
 * Stream a remote package to a temp file with hard size caps and optional
 * checksum pinning (recommended: marketplaces SHOULD publish sha256 per entry).
 */
export async function downloadPackage(
  rawUrl: string,
  opts: {
    expectedSha256?: string | null;
    allowLocal?: boolean;
    timeoutMs?: number;
  } = {},
): Promise<DownloadResult> {
  const url = await assertInstallableUrl(rawUrl, opts.allowLocal ?? false);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 60_000);

  const tmpPath = path.join(
    await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), 'catpkg-'))),
    'package.zip',
  );

  try {
    const res = await fetch(url.href, { signal: controller.signal });
    if (!res.ok || !res.body) {
      throw new PackagingError('DOWNLOAD_FAILED', `Download failed: HTTP ${res.status}`);
    }

    const declaredLength = Number(res.headers.get('content-length') ?? NaN);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_PACKAGE_BYTES) {
      throw new PackagingError('TOO_LARGE', `Package exceeds ${MAX_PACKAGE_BYTES} byte limit`);
    }

    const hash = crypto.createHash('sha256');
    let bytes = 0;
    const out = fs.createWriteStream(tmpPath);
    for await (const chunk of res.body) {
      bytes += chunk.length;
      if (bytes > MAX_PACKAGE_BYTES) {
        out.destroy();
        throw new PackagingError('TOO_LARGE', `Package exceeds ${MAX_PACKAGE_BYTES} byte limit`);
      }
      hash.update(chunk);
      if (!out.write(chunk)) {
        await new Promise<void>((resolve, reject) =>
          out.once('drain', resolve).once('error', reject),
        );
      }
    }
    await new Promise<void>((resolve, reject) => {
      out.end(resolve);
      out.once('error', reject);
    });

    const sha256 = hash.digest('hex');
    if (opts.expectedSha256 && !timingSafeEqualHex(opts.expectedSha256, sha256)) {
      throw new PackagingError(
        'CHECKSUM_MISMATCH',
        'Package checksum does not match the marketplace-pinned digest',
      );
    }
    return { tmpPath, sha256, bytes };
  } catch (err) {
    await fsp.rm(tmpPath, { force: true }).catch(() => {});
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function timingSafeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a.replace(/[^0-9a-f]/gi, ''), 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/** Plugin directory names follow the same strict rule as manifest names. */
function isValidPluginDirname(name: string): boolean {
  return typeof name === 'string' && /^[a-z0-9-]{1,50}$/.test(name);
}

// ── Extraction ──────────────────────────────────────────────────────────────

function safeEntryName(entryName: string): string | null {
  const normalized = entryName.replace(/\\/g, '/');
  // No absolute paths, drive letters, traversal segments, or shenanigans
  if (
    normalized.startsWith('/') ||
    /^[a-zA-Z]:/.test(normalized) ||
    normalized.split('/').some((seg) => seg === '..')
  ) {
    return null;
  }
  const segments = normalized.split('/');
  // Directly allowed: `plugin.json`, `backend/**`, empty dir markers, …
  if (segments[0] && ALLOWED_TOP_LEVEL.has(segments[0])) {
    return normalized;
  }
  // Optional single wrapper folder (authors zipping the directory itself):
  // accept when everything UNDER the wrapper is an allowed top-level entry.
  if (segments.length > 1 && segments[1]) {
    if (ALLOWED_TOP_LEVEL.has(segments[1])) {
      return normalized;
    }
  }
  return null;
}

export interface ExtractionResult {
  destDir: string;
  manifest: Record<string, unknown>;
}

/**
 * Extract a downloaded package into a fresh destination directory. Enforces
 * per-entry caps and the top-level allowlist BEFORE writing, then validates
 * the embedded plugin.json. Throws PackagingError with stable codes.
 */
export async function extractPackage(
  zipPath: string,
  destDir: string,
  opts: { stripRoot?: boolean } = {},
): Promise<ExtractionResult> {
  // Pre-open to fail fast on corrupt archives before creating destDir
  let totalUncompressed = 0;
  let entryCount = 0;

  await fsp.mkdir(destDir, { recursive: true });

  try {
    await extract(zipPath, {
      dir: destDir,
      onEntry: (entry) => {
        entryCount++;
        if (entryCount > MAX_ENTRY_COUNT) {
          throw new PackagingError('TOO_MANY_ENTRIES', 'Package contains too many entries');
        }
        const uncompressedSize = Number(entry.uncompressedSize ?? 0);
        totalUncompressed += uncompressedSize;
        if (totalUncompressed > MAX_EXTRACTED_BYTES) {
          throw new PackagingError('BOMB', 'Extracted size exceeds limit');
        }

        if (!safeEntryName(entry.fileName)) {
          throw new PackagingError(
            'UNSAFE_ENTRY',
            `Package contains disallowed entry: ${entry.fileName}`,
          );
        }
      },
    });
  } catch (err) {
    await fsp.rm(destDir, { recursive: true, force: true }).catch(() => {});
    if (err instanceof PackagingError) throw err;
    throw new PackagingError('BAD_ARCHIVE', `Could not read package archive: ${(err as Error).message}`);
  }

  // If everything sits under one non-reserved folder, flatten it.
  if (opts.stripRoot !== false) {
    const entries = await fsp.readdir(destDir);
    const reservedTopLevel = entries.filter((e) => ALLOWED_TOP_LEVEL.has(e));
    const others = entries.filter((e) => !ALLOWED_TOP_LEVEL.has(e));
    if (reservedTopLevel.length === 0 && others.length === 1) {
      const nestedRoot = path.join(destDir, others[0]);
      const stat = await fsp.stat(nestedRoot).catch(() => null);
      if (stat?.isDirectory()) {
        for (const child of await fsp.readdir(nestedRoot)) {
          try {
            await fsp.rename(path.join(nestedRoot, child), path.join(destDir, child));
          } catch (err: any) {
            throw new PackagingError('EXTRACT_FAILED', `Failed to flatten package root: ${err.message}`);
          }
        }
        await fsp.rmdir(nestedRoot).catch(() => {});
      }
    }
  }

  // Manifest gate — reuse the strict validator so discovery never sees junk
  const manifestPath = path.join(destDir, 'plugin.json');
  let manifestRaw: string;
  try {
    manifestRaw = await fsp.readFile(manifestPath, 'utf-8');
  } catch {
    await fsp.rm(destDir, { recursive: true, force: true }).catch(() => {});
    throw new PackagingError('NO_MANIFEST', 'Package does not contain a root plugin.json');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(manifestRaw);
  } catch {
    await fsp.rm(destDir, { recursive: true, force: true }).catch(() => {});
    throw new PackagingError('NO_MANIFEST', 'plugin.json is not valid JSON');
  }
  try {
    validateManifest(parsed);
  } catch (err: any) {
    await fsp.rm(destDir, { recursive: true, force: true }).catch(() => {});
    throw new PackagingError('INVALID_MANIFEST', `Invalid plugin.json: ${err.message}`);
  }

  return { destDir, manifest: parsed as Record<string, unknown> };
}

/**
 * Move `src` onto `dest`. `rename(2)` is atomic on the same filesystem;
 * Docker (and any split /tmp vs data volume) returns EXDEV, in which case
 * we copy then remove the source so installs still land.
 */
export async function renameOrCopy(src: string, dest: string): Promise<void> {
  try {
    await fsp.rename(src, dest);
  } catch (err: any) {
    if (err?.code !== 'EXDEV') throw err;
    await fsp.cp(src, dest, { recursive: true, errorOnExist: true, force: false });
    await fsp.rm(src, { recursive: true, force: true });
  }
}

/**
 * Place an extracted plugin directory under pluginsDir/<name>, swapping out
 * any previous installation via rename-aside + fallback restore. Falls back
 * to copy+remove when src and dest sit on different devices (EXDEV).
 */
export async function promoteIntoPlace(
  stagedDir: string,
  pluginsDir: string,
  pluginName: string,
): Promise<void> {
  const pluginsRoot = await fsp.realpath(pluginsDir).catch(() => path.resolve(pluginsDir));
  const finalDir = path.join(pluginsRoot, pluginName);
  // Defense in depth: the destination must live DIRECTLY under pluginsDir
  if (
    !isValidPluginDirname(pluginName) ||
    path.dirname(finalDir) !== pluginsRoot ||
    finalDir === pluginsRoot
  ) {
    throw new PackagingError('UNSAFE_ENTRY', `Refusing unsafe install target: ${pluginName}`);
  }
  const backups = path.join(pluginsRoot, '.backups');
  await fsp.mkdir(backups, { recursive: true });

  let movedOldTo: string | null = null;
  const stat = await fsp.stat(finalDir).catch(() => null);
  if (stat?.isDirectory()) {
    movedOldTo = path.join(backups, `${pluginName}-${Date.now()}`);
    await renameOrCopy(finalDir, movedOldTo);
  }

  try {
    await renameOrCopy(stagedDir, finalDir);
  } catch (err) {
    // Best-effort rollback so an old version is never silently lost
    await fsp.rm(finalDir, { recursive: true, force: true }).catch(() => {});
    if (movedOldTo) {
      await renameOrCopy(movedOldTo, finalDir).catch(() => {});
    }
    throw err;
  }
}
