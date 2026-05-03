const normalizeBaseUrl = (value?: string) => {
  if (!value) return '';
  if (value === '/api') return '';
  return value.replace(/\/api\/?$/, '');
};

const BASE_URL = normalizeBaseUrl(import.meta.env.VITE_API_URL) || '';
const DEDUP_WINDOW_MS = 5000;
const MAX_MESSAGE_LENGTH = 2000;
const MAX_STACK_LENGTH = 10000;
const MAX_METADATA_BYTES = 50 * 1024;

const SENSITIVE_PATTERNS = [
  { regex: /(\bAuthorization\b["']?\s*[:=]\s*["']?Bearer\s+)[^\s"']+/gi, mask: '$1[REDACTED]' },
  { regex: /(\bset-auth-token\b["']?\s*[:=]\s*["']?)[^"']+/gi, mask: '$1[REDACTED]' },
  { regex: /(\btoken\b["']?\s*[:=]\s*["']?)[^"']+/gi, mask: '$1[REDACTED]' },
  { regex: /(\bpassword\b["']?\s*[:=]\s*["']?)[^"']+/gi, mask: '$1[REDACTED]' },
];
function redact(input: string): string {
  return SENSITIVE_PATTERNS.reduce((acc, { regex, mask }) => acc.replace(regex, mask), input);
}

function redactObject(obj: unknown): unknown {
  if (typeof obj === 'string') return redact(obj);
  if (Array.isArray(obj)) return obj.map(redactObject);
  if (obj && typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [k, redactObject(v)]),
    );
  }
  return obj;
}

const dedupMap = new Map<string, number>();

function getDedupKey(component: string, message: string): string {
  return `${component}|${message}`;
}

function sanitizeMetadata(metadata?: Record<string, any>): Record<string, any> {
  if (!metadata) return {};

  let json: string;
  try {
    json = JSON.stringify(metadata);
  } catch {
    return { _sanitized: true, _reason: 'circular_reference' };
  }

  if (new Blob([json]).size > MAX_METADATA_BYTES) {
    return { _sanitized: true, _reason: 'too_large' };
  }

  return metadata;
}

export async function reportSystemError(opts: {
  level?: 'error' | 'warn' | 'critical';
  component: string;
  message: string;
  stack?: string;
  metadata?: Record<string, any>;
}): Promise<void> {
  try {
    const { level = 'error', component, message, stack, metadata } = opts;

    const key = getDedupKey(component, message);
    const now = Date.now();
    const lastReported = dedupMap.get(key);
    if (lastReported !== undefined && now - lastReported < DEDUP_WINDOW_MS) {
      return;
    }
    dedupMap.set(key, now);

    const trimmedMessage = message.length > MAX_MESSAGE_LENGTH
      ? message.slice(0, MAX_MESSAGE_LENGTH)
      : message;
    const trimmedStack = stack && stack.length > MAX_STACK_LENGTH
      ? stack.slice(0, MAX_STACK_LENGTH)
      : stack;

    const body = {
      level,
      component,
      message: redact(trimmedMessage),
      stack: trimmedStack ? redact(trimmedStack) : trimmedStack,
      metadata: sanitizeMetadata(redactObject(metadata) as Record<string, any>),
    };

    await fetch(`${BASE_URL}/api/system-errors/report`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    // Silently swallow all errors to prevent infinite reporting loops
  }
}
