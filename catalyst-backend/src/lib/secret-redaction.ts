/**
 * Central secret redaction for logs, system-error records, and agent reports.
 *
 * Anything persisted (SystemError rows, admin SSE fan-out) or logged must pass
 * through `redactSecrets` first: deployment tokens, API keys, and DB URLs are
 * the highest-value exfiltration targets in this codebase.
 */

const SENSITIVE_KEY_RE =
  /(token|secret|password|passwd|pwd|api[-_]?key|auth|cookie|session|private[-_]?key|passphrase|credential|bearer|set-cookie)/i;

// High-value env/config keys redacted even when the key name does not match
// the generic pattern (e.g. `url` fields holding credentials).
const SENSITIVE_EXACT_KEYS = new Set(
  [
    "DATABASE_URL",
    "BETTER_AUTH_SECRET",
    "API_KEY_SECRET",
    "BACKUP_CREDENTIALS_ENCRYPTION_KEY",
    "BACKUP_ENCRYPTION_KEY",
    "BACKUP_S3_SECRET_KEY",
    "BACKUP_S3_ACCESS_KEY",
    "REDIS_PASSWORD",
    "POSTGRES_PASSWORD",
  ].map((k) => k.toLowerCase()),
);

const REDACTED = "[REDACTED]";

/** Max serialized metadata size kept on a SystemError record (bytes). */
export const MAX_ERROR_METADATA_BYTES = 4096;
/** Max top-level metadata keys kept (prevents key-spam DoS on the column). */
export const MAX_ERROR_METADATA_KEYS = 20;

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE_EXACT_KEYS.has(lower) || SENSITIVE_KEY_RE.test(key);
}

function redactString(value: string): string {
  // Bearer tokens / Basic auth in free text.
  let out = value.replace(
    /(bearer\s+)[A-Za-z0-9\-._~+/=]{8,}/gi,
    (_m, prefix) => `${prefix}${REDACTED}`,
  );
  out = out.replace(
    /(basic\s+)[A-Za-z0-9+/=]{8,}/gi,
    (_m, prefix) => `${prefix}${REDACTED}`,
  );
  // Query-string / body fragments carrying secrets (?apiKey=, &token=, ...).
  out = out.replace(
    /([?&#;](?:api[-_]?key|token|secret|password|auth)[^=]*=)([^&#;\s"']+)/gi,
    (_m, prefix) => `${prefix}${REDACTED}`,
  );
  return out;
}

/**
 * Deep-redact secrets from any value. Objects/arrays are cloned; key names
 * matching SENSITIVE_KEY_RE (or the exact high-value list) have their values
 * replaced. Strings are scrubbed for embedded bearer/query secrets.
 * Authorization/Cookie headers are always stripped, regardless of depth.
 */
export function redactSecrets<T>(value: T, depth = 0): T {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactString(value) as unknown as T;
  if (typeof value !== "object") return value;
  if (depth > 6) return REDACTED as unknown as T;

  if (Array.isArray(value)) {
    return (value as unknown[]).map((entry) =>
      redactSecrets(entry, depth + 1),
    ) as unknown as T;
  }

  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const lower = key.toLowerCase();
    if (lower === "authorization" || lower === "cookie" || lower === "set-cookie") {
      out[key] = REDACTED;
      continue;
    }
    if (isSensitiveKey(key)) {
      out[key] = REDACTED;
      continue;
    }
    out[key] = redactSecrets(entry, depth + 1);
  }
  return out as unknown as T;
}

/** Redact a URL for logs: strip query string entirely (may carry apiKey). */
export function redactUrlForLog(url: string): string {
  const queryIndex = url.indexOf("?");
  return queryIndex >= 0 ? url.slice(0, queryIndex) : url;
}

/**
 * Cap metadata for persistence: at most MAX_ERROR_METADATA_KEYS top-level
 * keys and MAX_ERROR_METADATA_BYTES serialized. Returns a redacted clone.
 */
export function capMetadata(metadata: unknown): unknown {
  const redacted = redactSecrets(metadata);
  if (redacted === null || redacted === undefined) return redacted;
  if (typeof redacted !== "object") {
    const text = String(redacted);
    return text.length > MAX_ERROR_METADATA_BYTES
      ? `${text.slice(0, MAX_ERROR_METADATA_BYTES)}…[truncated]`
      : text;
  }
  let entries = Array.isArray(redacted)
    ? (redacted as unknown[]).map((value, index) => [String(index), value] as const)
    : Object.entries(redacted as Record<string, unknown>);
  let truncatedKeys = 0;
  if (entries.length > MAX_ERROR_METADATA_KEYS) {
    truncatedKeys = entries.length - MAX_ERROR_METADATA_KEYS;
    entries = entries.slice(0, MAX_ERROR_METADATA_KEYS);
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of entries) out[key] = value;
  let serialized = "";
  try {
    serialized = JSON.stringify(out);
  } catch {
    return { redacted: true };
  }
  if (serialized.length > MAX_ERROR_METADATA_BYTES) {
    return {
      redacted: true,
      preview: serialized.slice(0, MAX_ERROR_METADATA_BYTES),
      truncated: true,
    };
  }
  if (truncatedKeys > 0) {
    (out as Record<string, unknown>).__truncatedKeys = truncatedKeys;
  }
  return out;
}
