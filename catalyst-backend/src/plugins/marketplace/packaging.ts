import fs from 'fs';
import { Transform, type Readable } from 'stream';
import { pipeline } from 'stream/promises';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import dns from 'dns';
import net from 'net';
import fetch from 'node-fetch';
import extract from 'extract-zip';
import { validateManifest } from '../validator';
import { hasEncryptedPayload } from '../licensing';

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

/**
 * Expand an IPv6 literal into its eight 16-bit groups, or null if unparseable.
 * Handles `::` compression and a trailing dotted-quad (`::ffff:127.0.0.1`).
 */
function expandIpv6(ip: string): number[] | null {
  let text = ip.toLowerCase();
  // Strip a zone id (`fe80::1%eth0`).
  const pct = text.indexOf('%');
  if (pct !== -1) text = text.slice(0, pct);

  let tail: number[] = [];
  const lastColon = text.lastIndexOf(':');
  const maybeV4 = text.slice(lastColon + 1);
  if (net.isIPv4(maybeV4)) {
    const [a, b, c, d] = maybeV4.split('.').map(Number);
    tail = [(a << 8) | b, (c << 8) | d];
    text = text.slice(0, lastColon + 1);
    // `::ffff:1.2.3.4` leaves a trailing ':' we must drop before splitting.
    if (text.endsWith(':') && !text.endsWith('::')) text = text.slice(0, -1);
  }

  const halves = text.split('::');
  if (halves.length > 2) return null;

  const parse = (part: string): number[] | null => {
    if (part === '') return [];
    const out: number[] = [];
    for (const group of part.split(':')) {
      if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
      out.push(parseInt(group, 16));
    }
    return out;
  };

  const head = parse(halves[0]);
  if (!head) return null;
  const rest = halves.length === 2 ? parse(halves[1]) : [];
  if (!rest) return null;

  // Order matters: `head` then `rest` then the dotted-quad `tail`.
  const explicit = [...head, ...rest, ...tail];
  if (halves.length === 2) {
    const missing = 8 - explicit.length;
    if (missing < 0) return null;
    return [...head, new Array(missing).fill(0), ...rest, ...tail].flat();
  }
  return explicit.length === 8 ? explicit : null;
}

/** True for an IPv4 address string in a private/loopback/link-local range. */
function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true; // unparseable → unsafe
  }
  const [a, b] = parts;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true; // link-local / cloud metadata
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  if (a >= 224) return true; // multicast + reserved
  return false;
}

export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) return isPrivateIpv4(ip);
  if (net.isIPv6(ip)) {
    const g = expandIpv6(ip);
    if (!g) return true; // unparseable → unsafe

    // :: and ::1
    if (g.every((x) => x === 0)) return true;
    if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true;

    // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d).
    // This is the form that bypassed the previous prefix check: an AAAA record
    // of ::ffff:169.254.169.254 reached the cloud metadata service.
    if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) {
      const v4 = `${g[6] >> 8}.${g[6] & 0xff}.${g[7] >> 8}.${g[7] & 0xff}`;
      if (isPrivateIpv4(v4)) return true;
    }

    // 6to4 (2002::/16) embeds an IPv4 address in groups 1-2.
    if (g[0] === 0x2002) {
      const v4 = `${g[1] >> 8}.${g[1] & 0xff}.${g[2] >> 8}.${g[2] & 0xff}`;
      if (isPrivateIpv4(v4)) return true;
    }

    // NAT64 (64:ff9b::/96) embeds an IPv4 address in the last 32 bits.
    if (g[0] === 0x0064 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) {
      const v4 = `${g[6] >> 8}.${g[6] & 0xff}.${g[7] >> 8}.${g[7] & 0xff}`;
      if (isPrivateIpv4(v4)) return true;
    }

    // fc00::/7 unique-local, fe80::/10 link-local, fec0::/10 site-local,
    // ff00::/8 multicast.
    if ((g[0] & 0xfe00) === 0xfc00) return true;
    if ((g[0] & 0xffc0) === 0xfe80) return true;
    if ((g[0] & 0xffc0) === 0xfec0) return true;
    if ((g[0] & 0xff00) === 0xff00) return true;

    return false;
  }
  return true; // unparseable → treat as unsafe
}

/**
 * Validate an install URL against SSRF basics. Resolve every DNS result and
 * refuse loopback/private/link-local targets. `allowLocal` permits local
 * targets for explicitly trusted cases (tests, dev tooling, downloads from
 * a configured marketplace index host, PLUGIN_MARKETPLACE_ALLOW_LOCAL).
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
  // Plaintext http is only permitted for explicitly trusted local/dev hosts
  // (allowLocal). Public and untrusted hosts must use https so the transport
  // cannot be silently downgraded or MITM'd before the SSRF check runs.
  if (url.protocol === 'http:' && !allowLocal) {
    throw new PackagingError(
      'INSECURE_PROTOCOL',
      'Download URL must use https; plaintext http is only allowed for trusted local hosts',
    );
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

/**
 * Minimal fetch surface the downloader needs. Structural on purpose: the
 * global `fetch` in this project resolves to node-fetch's `Response`, which is
 * not assignable to the DOM/undici `Response` type, and tests inject fakes.
 */
export interface PackageFetchResponse {
  status: number;
  ok: boolean;
  headers: { get(name: string): string | null };
  body: unknown;
}

export type PackageFetch = (
  url: string,
  init: { redirect: 'manual'; signal: AbortSignal },
) => Promise<PackageFetchResponse>;

/**
 * Fetch a URL, following redirects MANUALLY so every hop is re-validated
 * against the same SSRF + protocol allowlist as the original URL.
 *
 * Why not `redirect: 'error'`: legitimate package hosts redirect (GitHub
 * Releases 302s to objects.githubusercontent.com, S3 presigned URLs redirect),
 * so refusing all redirects would break third-party marketplaces. Why not
 * `redirect: 'follow'`: undici follows 302s transparently, so a first-hop
 * public host could point at a private/metadata address that the allowlist
 * never saw.
 */
export async function fetchFollowingValidatedRedirects(
  startUrl: URL,
  opts: {
    allowLocal: boolean;
    signal: AbortSignal;
    maxHops?: number;
    /** Injectable for tests; defaults to the global fetch. */
    fetchImpl?: PackageFetch;
  },
): Promise<PackageFetchResponse> {
  const maxHops = opts.maxHops ?? 5;
  const doFetch: PackageFetch = opts.fetchImpl ?? ((u, init) => fetch(u, init));
  let current = startUrl;
  for (let hop = 0; ; hop++) {
    const res = await doFetch(current.href, { redirect: 'manual', signal: opts.signal });
    const isRedirect = res.status >= 300 && res.status < 400;
    if (!isRedirect) return res;

    const location = res.headers.get('location');
    // Drain the redirect body so the socket can be reused.
    const body = res.body as { cancel?: () => Promise<void> } | null | undefined;
    await body?.cancel?.().catch(() => {});
    if (!location) {
      throw new PackagingError('DOWNLOAD_FAILED', `Redirect ${res.status} without a Location header`);
    }
    if (hop >= maxHops) {
      throw new PackagingError('TOO_MANY_REDIRECTS', `Package download exceeded ${maxHops} redirects`);
    }
    // Re-validate the next hop: https-only (unless allowLocal) and not a
    // private/loopback/link-local address.
    current = await assertInstallableUrl(new URL(location, current).href, opts.allowLocal);
  }
}

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
    /** Injectable for tests; defaults to the global fetch. */
    fetchImpl?: PackageFetch;
  } = {},
): Promise<DownloadResult> {
  const url = await assertInstallableUrl(rawUrl, opts.allowLocal ?? false);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 60_000);

  const tmpDir = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), 'catpkg-')));
  const tmpPath = path.join(tmpDir, 'package.zip');

  try {
    // Redirects are followed hop-by-hop with the SSRF/protocol allowlist
    // re-applied to every Location, so a 302 cannot re-point the fetch at a
    // private/metadata address after the first URL was validated.
    const res = await fetchFollowingValidatedRedirects(url, {
      allowLocal: opts.allowLocal ?? false,
      signal: controller.signal,
      fetchImpl: opts.fetchImpl,
    });
    if (!res.ok || !res.body) {
      // Drain so the socket is released on these early-failure paths too.
      await (res.body as { cancel?: () => Promise<void> } | null | undefined)?.cancel?.().catch(() => {});
      throw new PackagingError('DOWNLOAD_FAILED', `Download failed: HTTP ${res.status}`);
    }

    const declaredLength = Number(res.headers.get('content-length') ?? NaN);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_PACKAGE_BYTES) {
      await (res.body as { cancel?: () => Promise<void> }).cancel?.().catch(() => {});
      throw new PackagingError('TOO_LARGE', `Package exceeds ${MAX_PACKAGE_BYTES} byte limit`);
    }

    const hash = crypto.createHash('sha256');
    let bytes = 0;
    const out = fs.createWriteStream(tmpPath);
    // Metering pass: enforce the byte cap and hash each chunk on its way to the
    // temp file. `pipeline` owns backpressure, completion and teardown.
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length;
        if (bytes > MAX_PACKAGE_BYTES) {
          callback(new PackagingError('TOO_LARGE', `Package exceeds ${MAX_PACKAGE_BYTES} byte limit`));
          return;
        }
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    await pipeline(res.body as unknown as Readable, meter, out);

    const sha256 = hash.digest('hex');
    if (opts.expectedSha256 && !timingSafeEqualHex(opts.expectedSha256, sha256)) {
      throw new PackagingError(
        'CHECKSUM_MISMATCH',
        'Package checksum does not match the marketplace-pinned digest',
      );
    }
    return { tmpPath, sha256, bytes };
  } catch (err) {
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
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

        // Regular files and directories only. extract-zip materializes symlink
        // entries verbatim (GHSA-jmr9-qjv8-65gv), so a link planted by a
        // package would redirect a later write outside destDir. A .catpkg has
        // no legitimate need for links, devices or FIFOs. Mode 0 means the
        // archive recorded no attributes (common for Windows-built zips) and
        // extract-zip falls back to name-based detection, so allow it.
        const entryType = (entry.externalFileAttributes >>> 16) & 0o170000;
        if (entryType !== 0 && entryType !== 0o040000 && entryType !== 0o100000) {
          throw new PackagingError(
            'UNSAFE_ENTRY',
            `Package contains a non-regular file entry: ${entry.fileName}`,
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

  // `licensing.encrypted` is a promise to the panel and to the admin: the
  // valuable code ships as `backend/*.enc` and is only readable after vendor
  // activation. Enforce it here so a mispackaged plugin fails at install time
  // instead of at enable time, in front of an admin who cannot fix it.
  const licensing = (parsed as { licensing?: { encrypted?: boolean } }).licensing;
  if (licensing?.encrypted === true) {
    let backendNames: string[] = [];
    try {
      backendNames = await fsp.readdir(path.join(destDir, 'backend'));
    } catch {
      backendNames = [];
    }
    if (!hasEncryptedPayload(backendNames)) {
      await fsp.rm(destDir, { recursive: true, force: true }).catch(() => {});
      throw new PackagingError(
        'PAYLOAD_MISSING',
        'plugin.json sets licensing.encrypted but the package ships no backend/*.enc payload',
      );
    }
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
