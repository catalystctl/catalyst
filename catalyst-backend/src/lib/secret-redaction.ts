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
    "SENTRY_DSN",
    "JWT_SECRET",
    "SESSION_SECRET",
    "ENCRYPTION_KEY",
    "LICENSE_KEY",
    "PANEL_LICENSE_KEY",
    "CATALYST_LICENSE_KEY",
  ].map((k) => k.toLowerCase()),
);

const REDACTED = "[REDACTED]";
const REDACTED_IP = "[IP_REDACTED]";
const REDACTED_HOST = "[HOST_REDACTED]";

/**
 * Host masking policy for troubleshooting exports. Deliberately conservative:
 * masking a filename (`config.json`) would destroy more signal than the
 * hostname leak it prevents, so only well-known TLDs are treated as hosts.
 */
const HOSTNAME_RE =
  /\b(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+(?:com|net|org|io|dev|app|co|uk|de|fr|nl|ru|xyz|online|site|local|lan|home|internal)\b/g;
const IPV4_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
// IPv6 only when it cannot be a clock time: bracketed, compressed (`fe80::1`)
// or the full 8-group form. A naive `(hex:){2,}` also matches `12:30:45` and
// would destroy every log timestamp.
const IPV6_RE =
  /\[[0-9A-Fa-f:.]{2,}\]|\b(?=[0-9A-Fa-f:]*::)[0-9A-Fa-f]{1,4}(?::[0-9A-Fa-f]{0,4}){2,}\b|\b(?:[0-9A-Fa-f]{1,4}:){7}[0-9A-Fa-f]{1,4}\b/g;

/** Redaction depth: `standard` strips secrets, `strict` also masks hosts/IPs. */
export type RedactionMode = "standard" | "strict";

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
  // Serialized / env-style key/value pairs embedded in free text
  // (`"password":"x"`, `token=abc`, `apiKey: xyz`). Keeps the key name so the
  // log line still explains what was redacted.
  out = out.replace(
    /(["']?(?:token|secret|password|passwd|pwd|api[-_]?key|access[-_]?key|private[-_]?key|credential|passphrase|license[-_]?key|authorization|cookie|set-cookie|session)["']?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;}\]]+)/gi,
    (_m, prefix) => `${prefix}${REDACTED}`,
  );
  return out;
}

/** Mask IPv4/IPv6 addresses and well-known hostnames in free text. */
export function redactHosts(value: string): string {
  return value
    .replace(IPV4_RE, REDACTED_IP)
    .replace(IPV6_RE, REDACTED_IP)
    .replace(HOSTNAME_RE, REDACTED_HOST);
}

/** Scrub one log/console string; host masking only applies in `strict` mode. */
export function redactLogText(value: string, mode: RedactionMode = "standard"): string {
  const scrubbed = redactString(value);
  return mode === "strict" ? redactHosts(scrubbed) : scrubbed;
}

/**
 * Env-var key policy for `.env` dumps. Deliberately narrower than
 * `isSensitiveKey`: `BETTER_AUTH_URL` and `PUBLIC_URL` must survive intact
 * because routing/CORS debugging depends on them.
 */
export function isSensitiveEnvKey(key: string): boolean {
  const lower = key.toLowerCase();
  if (SENSITIVE_EXACT_KEYS.has(lower)) return true;
  if (/(^|_)(password|passwd|pwd|secret|token|private_key|access_key|credential|credentials|dsn|license_key|api_key)($|_)/i.test(key)) {
    return true;
  }
  return lower.endsWith("_url") && /(database|postgres|redis|sentry|amqp|mongo)/.test(lower);
}

/** Redact the value half of one env var; returns `[REDACTED]` for secret keys. */
export function redactEnvVar(key: string, value: string, mode: RedactionMode = "standard"): string {
  if (isSensitiveEnvKey(key)) return REDACTED;
  return redactLogText(value, mode);
}

/**
 * Redact a whole `.env`-style document line by line, preserving comments,
 * blank lines and the key names. Secret values become `[REDACTED]`; URLs with
 * inline credentials are scrubbed even on non-secret keys.
 */
export function redactEnvContent(content: string, mode: RedactionMode = "standard"): string {
  return content
    .split("\n")
    .map((line) => {
      const match = /^(\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_.]*)(\s*=\s*)([\s\S]*)$/.exec(line);
      if (!match) return redactLogText(line, mode);
      const [, indent, key, separator, value] = match;
      return `${indent}${key}${separator}${redactEnvVar(key, value, mode)}`;
    })
    .join("\n");
}


/**
 * Deep-redact secrets from any value. Objects/arrays are cloned; key names
 * matching SENSITIVE_KEY_RE (or the exact high-value list) have their values
 * replaced. Strings are scrubbed for embedded bearer/query secrets.
 * Authorization/Cookie headers are always stripped, regardless of depth.
 */
export function redactSecrets<T>(value: T, depth = 0): T {
  return redactValue(value, "standard", depth);
}

/**
 * Mode-aware deep redaction. Identical to `redactSecrets` for objects, but
 * `strict` additionally masks IPs and hostnames inside every string value.
 * Use this for anything written into a troubleshooting export.
 */
export function redactValue<T>(value: T, mode: RedactionMode = "standard", depth = 0): T {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactLogText(value, mode) as unknown as T;
  if (typeof value !== "object") return value;
  if (depth > 6) return REDACTED as unknown as T;

  if (Array.isArray(value)) {
    return (value as unknown[]).map((entry) =>
      redactValue(entry, mode, depth + 1),
    ) as unknown as T;
  }

  // Build entries and materialise them with Object.fromEntries: it defines own
  // properties, so a hostile key such as "__proto__" cannot pollute a prototype.
  const entries: Array<[string, unknown]> = [];
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const lower = key.toLowerCase();
    if (lower === "authorization" || lower === "cookie" || lower === "set-cookie") {
      entries.push([key, REDACTED]);
      continue;
    }
    if (isSensitiveKey(key)) {
      entries.push([key, REDACTED]);
      continue;
    }
    entries.push([key, redactValue(entry, mode, depth + 1)]);
  }
  return Object.fromEntries(entries) as unknown as T;
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
  const out = Object.fromEntries(entries) as Record<string, unknown>;
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
