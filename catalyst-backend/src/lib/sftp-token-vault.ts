/**
 * Encryption for permanent SFTP tokens at rest.
 *
 * A permanent token is a password that must remain readable to its owner in
 * the panel, unlike a session cookie. The database stores only the ciphertext
 * (and a hash used for validation), so a database dump alone does not leak a
 * working SFTP credential. The AES key is derived from BETTER_AUTH_SECRET via
 * HKDF with a purpose-specific label, so rotating that secret invalidates the
 * display copy (existing clients can still connect by hash) and owners can
 * rotate the token.
 */

import crypto from "crypto";

const VERSION = "v1";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const HKDF_SALT = "catalyst:sftp-permanent-token";
const HKDF_INFO = "aes-256-gcm:v1";

function resolveSecret(): string {
  // BETTER_AUTH_SECRET is mandatory in production (config.ts) and is the
  // natural panel-wide secret. API_KEY_SECRET is a fallback for dev/test
  // environments that only set that one.
  const secret = process.env.BETTER_AUTH_SECRET || process.env.API_KEY_SECRET;
  if (!secret) {
    throw new Error(
      "BETTER_AUTH_SECRET is required to encrypt permanent SFTP tokens",
    );
  }
  return secret;
}

let cachedKey: { secret: string; key: Buffer } | null = null;

function getKey(): Buffer {
  const secret = resolveSecret();
  if (cachedKey?.secret === secret) return cachedKey.key;
  const key = Buffer.from(
    crypto.hkdfSync(
      "sha256",
      Buffer.from(secret, "utf8"),
      Buffer.from(HKDF_SALT, "utf8"),
      Buffer.from(HKDF_INFO, "utf8"),
      KEY_LENGTH,
    ),
  );
  cachedKey = { secret, key };
  return key;
}

/** Encrypt a raw token into the `v1:<base64(iv|tag|ciphertext)>` envelope. */
export function encryptSftpToken(token: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}:${Buffer.concat([iv, tag, encrypted]).toString("base64")}`;
}

/**
 * Decrypt a stored token. Returns null when the payload is not ours or was
 * encrypted under a different secret (e.g. BETTER_AUTH_SECRET rotated), so
 * callers can tell the owner to rotate instead of crashing the listing.
 */
export function decryptSftpToken(payload: string | null | undefined): string | null {
  if (!payload || typeof payload !== "string") return null;
  const [version, encoded] = payload.split(":", 2);
  if (version !== VERSION || !encoded) return null;
  try {
    const buffer = Buffer.from(encoded, "base64");
    if (buffer.length <= IV_LENGTH + TAG_LENGTH) return null;
    const iv = buffer.subarray(0, IV_LENGTH);
    const tag = buffer.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const encrypted = buffer.subarray(IV_LENGTH + TAG_LENGTH);
    const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
