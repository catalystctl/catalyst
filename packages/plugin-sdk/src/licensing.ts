/// <reference types="node" />
/**
 * Vendor-owned licensing primitives for Catalyst plugins.
 *
 * Import from `@catalyst/plugin-sdk/licensing` (backend only — uses
 * `node:crypto`). Vendors bundle this into their bootstrap at build time; it
 * is never a runtime dependency of the panel.
 *
 * Catalyst deliberately issues no keys and validates none. The panel's only
 * jobs are: declare the phone-home in `plugin.json` so admins see it before
 * enabling, hand the plugin `ctx.installId`, and refuse to install a package
 * marked `licensing.encrypted` that ships no `backend/*.enc` payload.
 *
 * Wire format (shared with any vendor license server — reimplementable in any
 * language):
 *
 *   KEK   = HKDF-SHA256(ikm=UTF-8(licenseKey),
 *                       salt=UTF-8(installId),
 *                       info=UTF-8("catalyst-catpkg-dek-wrap-v1"),
 *                       len=32)
 *   wrap  = AES-256-GCM(KEK, DEK)      AAD = UTF-8(name + "\0" + version)
 *   payload envelope = nonce(12) || ciphertext || tag(16)
 *
 * The DEK is a per-version random 32-byte content key the vendor encrypts the
 * payload with at build time and stores on the license server. It travels to
 * the plugin *wrapped* (encrypted to KEK), never in the clear — a log leak or
 * a MITM on the activation call cannot recover it. AES-GCM's auth tag is the
 * integrity check, so a forged response simply fails to unwrap.
 */

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

// ── Types ───────────────────────────────────────────────────────────────────

/** Mirrors `PluginLicensing` in the panel's plugin manifest types. */
export interface PluginLicensing {
  licenseServer: string;
  buyUrl?: string;
  contact?: string[];
  encrypted?: boolean;
  failMode?: 'closed' | 'open';
  cacheTtlHours?: number;
}

/** The slice of the plugin runtime context this module needs. */
export interface PluginRuntimeContext {
  manifest: { name: string; version: string; licensing?: PluginLicensing };
  installId: string;
  getConfig<T = unknown>(key: string): T | undefined;
  getStorage<T = unknown>(key: string): Promise<T | null>;
  setStorage(key: string, value: unknown): Promise<void>;
  logger?: {
    info(obj: unknown, msg: string): void;
    warn(obj: unknown, msg: string): void;
    error(obj: unknown, msg: string): void;
  };
}

export interface ActivateOptions {
  /** Config field holding the license key. Default `'licenseKey'`. */
  keyField?: string;
  /** Activation request timeout. Default 10 000 ms. */
  timeoutMs?: number;
  /** Clock seam for tests. */
  now?: () => Date;
  /** Override the activation URL (defaults to `manifest.licensing.licenseServer`). */
  licenseServer?: string;
  /** Override the payload location used by `loadLicensedModule`. */
  payload?: Uint8Array;
}

export interface Activation {
  /** False only for a non-encrypted plugin that chose `failMode: 'open'`. */
  enabled: boolean;
  /** Content key, or null when the plugin is running unentitled. */
  dek: Uint8Array | null;
  entitlements: string[];
  expiresAt: string | null;
  /** True when served from the activation cache rather than the network. */
  cached: boolean;
  error?: string;
}

/** Cache key in the plugin's own key-value storage. */
const CACHE_KEY = 'licensing.activation';

/** HKDF `info` — bump to version the whole wrap format. */
export const DEK_WRAP_INFO = 'catalyst-catpkg-dek-wrap-v1';

const GCM_NONCE_BYTES = 12;
const GCM_TAG_BYTES = 16;
const DEK_BYTES = 32;
const KEK_BYTES = 32;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_CACHE_TTL_HOURS = 168;

interface CacheRecord {
  installId: string;
  wrappedDek: string;
  expiresAt: string;
  entitlements: string[];
  activatedAt: string;
}

// ── Manifest helper ─────────────────────────────────────────────────────────

/**
 * Build the `licensing` block for `plugin.json`.
 *
 * ```ts
 * const licensing = defineLicensing({
 *   licenseServer: 'https://licenses.vendor.example/v1/activate',
 *   buyUrl: 'https://vendor.example/buy',
 *   encrypted: true,
 * });
 * ```
 */
export function defineLicensing(def: PluginLicensing): PluginLicensing {
  return def;
}

// ── Codec helpers (Uint8Array only — no Buffer types leak into the API) ─────

const B64_STD = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function encodeBase64(bytes: Uint8Array, alphabet: string = B64_STD): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : undefined;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : undefined;
    out += alphabet[b0 >> 2];
    out += alphabet[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)];
    out += b1 === undefined ? '=' : alphabet[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)];
    out += b2 === undefined ? '=' : alphabet[b2 & 0x3f];
  }
  return out;
}

function decodeBase64(text: string): Uint8Array {
  const clean = text.replace(/[^A-Za-z0-9+/\-_]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n = (idx: number) => {
      const c = clean[idx];
      if (c === undefined) return 0;
      const v = B64_STD.indexOf(c) !== -1 ? B64_STD.indexOf(c) : B64_URL.indexOf(c);
      return v === -1 ? 0 : v;
    };
    const c0 = n(i);
    const c1 = n(i + 1);
    const c2 = n(i + 2);
    const c3 = n(i + 3);
    out[o++] = (c0 << 2) | (c1 >> 4);
    if (i + 2 < clean.length) out[o++] = ((c1 & 0x0f) << 4) | (c2 >> 2);
    if (i + 3 < clean.length) out[o++] = ((c2 & 0x03) << 6) | c3;
  }
  return out.subarray(0, o);
}

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** base64url, unpadded — the transport encoding for `wrappedDek`. */
export function toBase64Url(bytes: Uint8Array): string {
  return encodeBase64(bytes, B64_URL).replace(/=+$/, '');
}

export function fromBase64Url(text: string): Uint8Array {
  return decodeBase64(text);
}

// ── Crypto ──────────────────────────────────────────────────────────────────

/**
 * KEK = HKDF-SHA256(ikm=UTF-8(licenseKey), salt=UTF-8(installId),
 *                    info=DEK_WRAP_INFO, len=32).
 *
 * Never leaves the plugin: the license server derives the same value from the
 * credentials it already holds, so the wrap key is not a shared secret sent
 * over the wire.
 */
export function deriveKek(licenseKey: string, installId: string): Uint8Array {
  return new Uint8Array(hkdfSync('sha256', utf8(licenseKey), utf8(installId), utf8(DEK_WRAP_INFO), KEK_BYTES));
}

/** AAD binds a wrapped key or payload to one plugin name + version. */
export function licensingAad(pluginName: string, pluginVersion: string): Uint8Array {
  return utf8(`${pluginName}\u0000${pluginVersion}`);
}

/** Envelope: nonce(12) || ciphertext || tag(16). */
function seal(key: Uint8Array, plaintext: Uint8Array, aad: Uint8Array): Uint8Array {
  const nonce = randomBytes(GCM_NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(aad);
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return new Uint8Array(Buffer.concat([nonce, body, tag]));
}

function open(key: Uint8Array, envelope: Uint8Array, aad: Uint8Array): Uint8Array {
  if (envelope.length < GCM_NONCE_BYTES + GCM_TAG_BYTES) {
    throw new Error('licensing: envelope is too short');
  }
  const nonce = envelope.subarray(0, GCM_NONCE_BYTES);
  const tag = envelope.subarray(envelope.length - GCM_TAG_BYTES);
  const body = envelope.subarray(GCM_NONCE_BYTES, envelope.length - GCM_TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  return new Uint8Array(Buffer.concat([decipher.update(body), decipher.final()]));
}

/** Wrap a content key to `kek`. Returns base64url. Vendor server side. */
export function wrapDek(kek: Uint8Array, dek: Uint8Array, aad: Uint8Array): string {
  return toBase64Url(seal(kek, dek, aad));
}

/**
 * Unwrap a content key. Throws when the license key/installId is wrong or the
 * wrap was tampered with — GCM's auth tag is the integrity check.
 */
export function unwrapDek(kek: Uint8Array, wrappedDek: string, aad: Uint8Array): Uint8Array {
  return open(kek, fromBase64Url(wrappedDek), aad);
}

/**
 * Decrypt a `backend/payload.enc` envelope back to ESM source.
 * Envelope: nonce(12) || ciphertext || tag(16), AAD as `licensingAad`.
 */
export function decryptPayload(dek: Uint8Array, payload: Uint8Array, aad: Uint8Array): string {
  return new TextDecoder().decode(open(dek, payload, aad));
}

/**
 * Import an ESM module from source text.
 *
 * Loaded via a `data:` URL so the plaintext never lands on disk — the panel's
 * hot-reload staging directory (`…/.cache/backend/…`) never sees the
 * unencrypted module. The payload must therefore be a single bundled ESM file
 * with no bare imports (same constraint as `frontend.mjs`).
 */
export async function importPayload(code: string): Promise<Record<string, unknown>> {
  const url = `data:text/javascript;base64,${encodeBase64(utf8(code))}`;
  return (await import(/* @vite-ignore */ url)) as Record<string, unknown>;
}

// ── Activation ──────────────────────────────────────────────────────────────

function cacheValid(rec: unknown, installId: string, now: Date): rec is CacheRecord {
  if (!rec || typeof rec !== 'object') return false;
  const c = rec as Partial<CacheRecord>;
  return (
    typeof c.installId === 'string' &&
    c.installId === installId &&
    typeof c.wrappedDek === 'string' &&
    typeof c.expiresAt === 'string' &&
    new Date(c.expiresAt).getTime() > now.getTime()
  );
}

/**
 * Validate a license key against the vendor's server and recover the content
 * key. Caches the wrapped key for `manifest.licensing.cacheTtlHours` (default
 * 7 days) in the plugin's own storage, so a vendor outage does not become a
 * Catalyst incident — the plugin keeps working until the cache expires.
 *
 * Failure behaviour:
 *  - `licensing.encrypted` (or default) → throws; there is no key, so there is
 *    nothing to fall open to.
 *  - `failMode: 'open'` on a non-encrypted plugin → resolves
 *    `{ enabled: false }` so the plugin can degrade instead of dying.
 */
export async function activateLicense(
  ctx: PluginRuntimeContext,
  opts: ActivateOptions = {},
): Promise<Activation> {
  const lic = ctx.manifest.licensing;
  const keyField = opts.keyField ?? 'licenseKey';
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const now = (opts.now ?? (() => new Date()))();
  const encrypted = lic?.encrypted === true;
  const failOpen = !encrypted && lic?.failMode === 'open';
  const aad = licensingAad(ctx.manifest.name, ctx.manifest.version);

  const bail = (message: string): Activation => {
    ctx.logger?.error({ plugin: ctx.manifest.name, reason: message }, 'licensing: activation failed');
    if (failOpen) {
      return { enabled: false, dek: null, entitlements: [], expiresAt: null, cached: false, error: message };
    }
    throw new Error(`licensing: ${message}`);
  };

  // 1. Cached activation first — survives vendor outages and panel restarts.
  const cached = await ctx.getStorage<CacheRecord>(CACHE_KEY);
  if (cacheValid(cached, ctx.installId, now)) {
    try {
      const dek = unwrapDek(deriveKek(String(ctx.getConfig(keyField) ?? ''), ctx.installId), cached.wrappedDek, aad);
      return {
        enabled: true,
        dek,
        entitlements: Array.isArray(cached.entitlements) ? cached.entitlements : [],
        expiresAt: cached.expiresAt,
        cached: true,
      };
    } catch {
      // Cache present but unwrappable (key changed, or installId moved with a
      // copied database) — fall through to a fresh activation.
      await ctx.setStorage(CACHE_KEY, null).catch(() => {});
    }
  }

  // 2. Need a key.
  const licenseKey = String(ctx.getConfig(keyField) ?? '').trim();
  if (!licenseKey) {
    return bail(
      `no license key set — open this plugin's config in the panel and fill in the "${keyField}" field, then reload it`,
    );
  }

  const url = opts.licenseServer ?? lic?.licenseServer;
  if (!url) return bail('plugin.json declares no licensing.licenseServer');

  // 3. Ask the vendor.
  let body: Record<string, unknown>;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': `catalyst-plugin/${ctx.manifest.name}` },
      body: JSON.stringify({
        licenseKey,
        installId: ctx.installId,
        pluginName: ctx.manifest.name,
        pluginVersion: ctx.manifest.version,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || body.ok !== true) {
      return bail(`activation rejected (${res.status} ${String(body.code ?? 'UNKNOWN')})`);
    }
  } catch (err) {
    return bail(`license server unreachable (${(err as Error).message})`);
  }

  const wrappedDek = String(body.wrappedDek ?? '');
  const expiresAt = typeof body.expiresAt === 'string' ? body.expiresAt : null;
  if (!wrappedDek || !expiresAt) return bail('license server returned no wrappedDek/expiresAt');

  // 4. Unwrap — this is the integrity check.
  let dek: Uint8Array;
  try {
    dek = unwrapDek(deriveKek(licenseKey, ctx.installId), wrappedDek, aad);
  } catch {
    return bail('content key did not unwrap — wrong license key or tampered response');
  }

  const entitlements = Array.isArray(body.entitlements)
    ? body.entitlements.filter((e): e is string => typeof e === 'string')
    : [];

  await ctx.setStorage(CACHE_KEY, {
    installId: ctx.installId,
    wrappedDek,
    expiresAt,
    entitlements,
    activatedAt: now.toISOString(),
  } satisfies CacheRecord);

  ctx.logger?.info(
    { plugin: ctx.manifest.name, expiresAt, entitlements },
    'licensing: activated',
  );

  return { enabled: true, dek, entitlements, expiresAt, cached: false };
}

/**
 * One call for a bootstrap: activate, decrypt `backend/payload.enc`, import
 * the real module and hand back its default export (the plugin object).
 *
 * ```ts
 * // backend/index.js (built bootstrap)
 * import { readFileSync } from 'node:fs';
 * import { loadLicensedModule } from '@catalyst/plugin-sdk/licensing';
 *
 * let real;
 * async function boot(ctx) {
 *   if (!real) {
 *     real = await loadLicensedModule(ctx, {
 *       payload: new Uint8Array(readFileSync(new URL('./payload.enc', import.meta.url))),
 *     });
 *   }
 *   return real;
 * }
 * export default {
 *   async onLoad(ctx) { (await boot(ctx))?.onLoad?.(ctx); },
 *   // …onEnable / onDisable / onUnload
 * };
 * ```
 */
export async function loadLicensedModule(
  ctx: PluginRuntimeContext,
  opts: ActivateOptions & { payload: Uint8Array },
): Promise<any> {
  const act = await activateLicense(ctx, opts);
  if (!act.enabled || !act.dek) {
    ctx.logger?.warn({ plugin: ctx.manifest.name }, 'licensing: running without an entitlement');
    return null;
  }
  const code = decryptPayload(act.dek, opts.payload, licensingAad(ctx.manifest.name, ctx.manifest.version));
  const mod = await importPayload(code);
  return (mod as { default?: unknown }).default ?? mod;
}
