/**
 * Unified frontend error capture: window errors, unhandled rejections,
 * and React error-boundary reports.
 *
 * Logs to console and POSTs to /api/client-errors, then the existing
 * /api/system-errors/report endpoint. Deduplicates backend bursts and
 * queues while offline.
 */

const normalizeBaseUrl = (value?: string) => {
  if (!value) return '';
  if (value === '/api') return '';
  return value.replace(/\/api\/?$/, '');
};

const BASE_URL = normalizeBaseUrl(import.meta.env.VITE_API_URL) || '';
const CLIENT_ERRORS_PATH = '/api/client-errors';
const LEGACY_REPORT_PATH = '/api/system-errors/report';

const DEDUP_WINDOW_MS = 5000;
const MAX_QUEUE = 20;
const MAX_MESSAGE_LENGTH = 2000;
const MAX_STACK_LENGTH = 10000;
const MAX_RETRIES = 3;

const SENSITIVE_PATTERNS = [
  { regex: /(\bAuthorization\b["']?\s*[:=]\s*["']?Bearer\s+)[^\s"']+/gi, mask: '$1[REDACTED]' },
  { regex: /(\bset-auth-token\b["']?\s*[:=]\s*["']?)[^"']+/gi, mask: '$1[REDACTED]' },
  { regex: /(\btoken\b["']?\s*[:=]\s*["']?)[^"']+/gi, mask: '$1[REDACTED]' },
  { regex: /(\bpassword\b["']?\s*[:=]\s*["']?)[^"']+/gi, mask: '$1[REDACTED]' },
];

// describeError lives in utils/errors.ts but importing it here would create a
// cycle risk with queryClient → systemErrors → this module's consumers, so the
// same stringify-not-String() behavior is inlined via a tiny local helper.
function describeError(reason: unknown): string {
  if (typeof reason === 'string') return reason;
  if (reason instanceof Error) return reason.message;
  if (reason === null || reason === undefined) return 'Unhandled rejection';
  if (typeof reason !== 'object') return String(reason);
  const message = (reason as { message?: unknown }).message;
  if (typeof message === 'string' && message.length > 0) return message;
  try {
    const json = JSON.stringify(reason);
    return json === undefined || json === '' ? String(reason) : json;
  } catch {
    return String(reason);
  }
}

function redact(input: string): string {
  return SENSITIVE_PATTERNS.reduce((acc, { regex, mask }) => acc.replace(regex, mask), input);
}

export interface ClientErrorPayload {
  message: string;
  stack?: string;
  componentStack?: string;
  url?: string;
  userAgent?: string;
  component?: string;
  metadata?: Record<string, unknown>;
}

interface QueuedError {
  payload: ClientErrorPayload;
  retries: number;
}

let installed = false;
/** True while a POST is in flight so fetch failures do not re-enter window handlers. */
let delivering = false;
/** null = unknown (try client-errors); false = 404'd, skip thereafter */
let clientErrorsAvailable: boolean | null = null;
let flushing = false;

const queue: QueuedError[] = [];
const dedupMap = new Map<string, number>();
const inflight: Promise<void>[] = [];

let onWindowError: ((event: ErrorEvent) => void) | null = null;
let onUnhandledRejection: ((event: Event & { reason?: unknown }) => void) | null = null;
let onOnline: (() => void) | null = null;

function trim(value: string | undefined, max: number): string | undefined {
  if (!value) return value;
  return value.length > max ? value.slice(0, max) : value;
}

function contextFields(): Pick<ClientErrorPayload, 'url' | 'userAgent'> {
  if (typeof window === 'undefined') return {};
  return {
    url: window.location.href,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
  };
}

function getDedupKey(payload: ClientErrorPayload): string {
  return [
    payload.component ?? '',
    payload.message,
    payload.stack?.slice(0, 200) ?? '',
    payload.componentStack?.slice(0, 200) ?? '',
  ].join('|');
}

function isDuplicate(payload: ClientErrorPayload): boolean {
  const key = getDedupKey(payload);
  const now = Date.now();
  const last = dedupMap.get(key);
  if (last !== undefined && now - last < DEDUP_WINDOW_MS) {
    return true;
  }
  dedupMap.set(key, now);
  if (dedupMap.size > 200) {
    const cutoff = now - DEDUP_WINDOW_MS;
    for (const [k, ts] of dedupMap) {
      if (ts < cutoff) dedupMap.delete(k);
    }
  }
  return false;
}

function enqueue(payload: ClientErrorPayload, retries = 0): void {
  if (queue.length >= MAX_QUEUE) {
    queue.shift();
  }
  queue.push({ payload, retries });
}

function toClientBody(payload: ClientErrorPayload) {
  return {
    message: redact(trim(payload.message, MAX_MESSAGE_LENGTH) || 'Unknown error'),
    stack: payload.stack ? redact(trim(payload.stack, MAX_STACK_LENGTH)!) : undefined,
    componentStack: payload.componentStack
      ? redact(trim(payload.componentStack, MAX_STACK_LENGTH)!)
      : undefined,
    url: payload.url,
    userAgent: payload.userAgent,
    component: payload.component,
    metadata: payload.metadata,
  };
}

function toLegacyBody(payload: ClientErrorPayload) {
  const body = toClientBody(payload);
  return {
    level: 'error' as const,
    component: body.component || 'Frontend',
    message: body.message,
    stack: body.stack,
    metadata: {
      componentStack: body.componentStack,
      url: body.url,
      userAgent: body.userAgent,
      ...(body.metadata ?? {}),
    },
  };
}

type PostResult = 'ok' | 'missing' | 'fail';

async function postJson(path: string, body: unknown): Promise<PostResult> {
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) return 'ok';
    if (res.status === 404 || res.status === 405) return 'missing';
    return 'fail';
  } catch {
    return 'fail';
  }
}

function logToConsole(payload: ClientErrorPayload): void {
  console.error('[client-error]', {
    message: payload.message,
    stack: payload.stack,
    componentStack: payload.componentStack,
    url: payload.url,
    userAgent: payload.userAgent,
    component: payload.component,
    metadata: payload.metadata,
  });
}

async function deliver(payload: ClientErrorPayload): Promise<'ok' | 'fail' | 'logged'> {
  delivering = true;
  try {
    if (clientErrorsAvailable !== false) {
      const result = await postJson(CLIENT_ERRORS_PATH, toClientBody(payload));
      if (result === 'ok') {
        clientErrorsAvailable = true;
        return 'ok';
      }
      if (result === 'missing') {
        clientErrorsAvailable = false;
      } else {
        return 'fail';
      }
    }

    const legacy = await postJson(LEGACY_REPORT_PATH, toLegacyBody(payload));
    if (legacy === 'ok') return 'ok';
    if (legacy === 'fail') return 'fail';

    return 'logged';
  } finally {
    delivering = false;
  }
}

async function flushQueue(): Promise<void> {
  if (flushing || queue.length === 0) return;
  flushing = true;
  try {
    while (queue.length > 0) {
      const item = queue[0];
      const result = await deliver(item.payload);
      if (result === 'fail') {
        item.retries += 1;
        if (item.retries >= MAX_RETRIES) {
          queue.shift();
        }
        break;
      }
      queue.shift();
    }
  } finally {
    flushing = false;
  }
}

function normalizePayload(partial: ClientErrorPayload): ClientErrorPayload {
  const ctx = contextFields();
  return {
    message: partial.message || 'Unknown error',
    stack: partial.stack,
    componentStack: partial.componentStack,
    url: partial.url ?? ctx.url,
    userAgent: partial.userAgent ?? ctx.userAgent,
    component: partial.component,
    metadata: partial.metadata,
  };
}

/** Report a captured client error (React or ad-hoc). Fire-and-forget. */
export function reportClientError(partial: ClientErrorPayload): void {
  const payload = normalizePayload(partial);
  try {
    logToConsole(payload);
  } catch {
    // console is best-effort
  }
  if (isDuplicate(payload)) return;

  const task = (async () => {
    const result = await deliver(payload);
    if (result === 'fail') {
      enqueue(payload);
    }
  })();
  inflight.push(task);
  void task.finally(() => {
    const idx = inflight.indexOf(task);
    if (idx >= 0) inflight.splice(idx, 1);
  });
}

/** React error-boundary capture (componentDidCatch). */
export function reportReactError(
  error: Error,
  info?: { componentStack?: string | null },
): void {
  reportClientError({
    component: 'ReactErrorBoundary',
    message: error.message || 'Unknown error',
    stack: error.stack,
    componentStack: info?.componentStack ?? undefined,
  });
}

function handleWindowError(event: ErrorEvent): void {
  if (delivering) return;
  const err = event.error instanceof Error ? event.error : undefined;
  reportClientError({
    component: 'GlobalWindowError',
    message: event.message || err?.message || 'Unknown error',
    stack: err?.stack,
    metadata: {
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
    },
  });
}

function handleUnhandledRejection(event: Event & { reason?: unknown }): void {
  if (delivering) return;
  const reason = event.reason;
  const err = reason instanceof Error ? reason : undefined;
  reportClientError({
    component: 'UnhandledRejection',
    message: describeError(reason),
    stack: err?.stack,
    metadata: { type: 'unhandledrejection' },
  });
}

/** Install window `error` / `unhandledrejection` listeners once. Call before render. */
export function initErrorReporter(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  onWindowError = handleWindowError;
  onUnhandledRejection = handleUnhandledRejection;
  onOnline = () => {
    void flushQueue();
  };

  window.addEventListener('error', onWindowError);
  window.addEventListener('unhandledrejection', onUnhandledRejection);
  window.addEventListener('online', onOnline);
}

/** @internal test helper — drain the offline queue. */
export function flushErrorReporterForTests(): Promise<void> {
  return Promise.allSettled(inflight).then(() => flushQueue());
}

/** @internal test helper — removes listeners and clears queue/dedup. */
export function resetErrorReporterForTests(): void {
  if (typeof window !== 'undefined') {
    if (onWindowError) window.removeEventListener('error', onWindowError);
    if (onUnhandledRejection) window.removeEventListener('unhandledrejection', onUnhandledRejection);
    if (onOnline) window.removeEventListener('online', onOnline);
  }
  onWindowError = null;
  onUnhandledRejection = null;
  onOnline = null;
  installed = false;
  delivering = false;
  clientErrorsAvailable = null;
  flushing = false;
  queue.length = 0;
  inflight.length = 0;
  dedupMap.clear();
}
