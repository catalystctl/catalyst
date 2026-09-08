/**
 * Minimal Redis client (RESP2 over TCP, no external dependencies).
 *
 * Role: OPTIONAL shared infrastructure. Every caller must fall back to the
 * database or process-local path when Redis is disabled or unreachable —
 * Redis must never become a single point of failure forcached data.
 *
 * Supported commands: PING, GET, SET (EX/PX/NX/XX), DEL, EXPIRE, PEXPIRE,
 * INCR, EVAL (Lua), PUBLISH, SUBSCRIBE, INFO, SELECT, AUTH, QUIT.
 * Pub/sub uses a dedicated connection (Redis requirement).
 *
 * Reconnect uses exponential backoff with jitter plus a circuit breaker so
 * a down Redis does not cause retry storms on request paths.
 */

import net from 'net';
import tls from 'tls';

export type RedisStatus = 'disabled' | 'connecting' | 'ready' | 'degraded' | 'closed';

type Pending = {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type RedisUrlParts = {
  host: string;
  port: number;
  username?: string;
  password?: string;
  db: number;
  tls: boolean;
};

function parseRedisUrl(raw: string): RedisUrlParts {
  const url = new URL(raw);
  const tlsOn = url.protocol === 'rediss:';
  const db = Number(url.pathname?.replace('/', '') || '0') || 0;
  const username = url.username && url.username !== 'default'
    ? decodeURIComponent(url.username)
    : undefined;
  const password = url.password ? decodeURIComponent(url.password) : undefined;
  return {
    host: url.hostname || '127.0.0.1',
    port: Number(url.port || '6379'),
    username,
    password,
    db,
    tls: tlsOn,
  };
}

function encodeCommand(...args: Array<string | number>): Buffer {
  const parts: string[] = [`*${args.length}\r\n`];
  for (const a of args) {
    const s = String(a);
    const len = Buffer.byteLength(s);
    parts.push(`$${len}\r\n${s}\r\n`);
  }
  return Buffer.from(parts.join(''), 'utf8');
}

/** Incremental RESP2 parser (handles push messages for pub/sub too). */
class RespParser {
  private buf = Buffer.alloc(0);

  feed(chunk: Buffer): unknown[] {
    this.buf = Buffer.concat([this.buf, chunk]);
    const out: unknown[] = [];
    while (true) {
      const before = this.buf.length;
      const value = this.tryParse(0);
      if (value === undefined) break;
      out.push(value.parsed);
      this.buf = this.buf.subarray(value.next);
      if (this.buf.length === before) break;
    }
    return out;
  }

  private tryParse(pos: number): { parsed: unknown; next: number } | undefined {
    if (pos >= this.buf.length) return undefined;
    const type = String.fromCharCode(this.buf[pos]);
    const lineEnd = this.buf.indexOf('\r\n', pos);
    if (lineEnd === -1) return undefined;
    const line = this.buf.subarray(pos + 1, lineEnd).toString('utf8');
    if (type === '+') return { parsed: line, next: lineEnd + 2 };
    if (type === '-') return { parsed: new Error(line), next: lineEnd + 2 };
    if (type === ':') return { parsed: Number(line), next: lineEnd + 2 };
    if (type === '$') {
      const len = Number(line);
      if (len === -1) return { parsed: null, next: lineEnd + 2 };
      if (this.buf.length < lineEnd + 2 + len + 2) return undefined;
      const str = this.buf.subarray(lineEnd + 2, lineEnd + 2 + len).toString('utf8');
      return { parsed: str, next: lineEnd + 2 + len + 2 };
    }
    if (type === '*') {
      const count = Number(line);
      if (count === -1) return { parsed: null, next: lineEnd + 2 };
      let cursor = lineEnd + 2;
      const items: unknown[] = [];
      for (let i = 0; i < count; i++) {
        const inner = this.tryParse(cursor);
        if (!inner) return undefined;
        items.push(inner.parsed);
        cursor = inner.next;
      }
      return { parsed: items, next: cursor };
    }
    throw new Error(`Unsupported RESP type: ${type}`);
  }
}

const COMMAND_TIMEOUT_MS = 2500;
const MAX_BACKOFF_MS = 30_000;
const CIRCUIT_FAILURES = 5;
const CIRCUIT_COOLDOWN_MS = 10_000;
/** Failure events are emitted (logged/alerted) at most this often. */
const FAILURE_LOG_WINDOW_MS = 30_000;

export class CatalystRedis {
  private parts: RedisUrlParts;
  private socket: net.Socket | null = null;
  private parser = new RespParser();
  private queue: Pending[] = [];
  private status: RedisStatus = 'connecting';
  private reconnects = 0;
  private consecutiveFailures = 0;
  private circuitOpenUntil = 0;
  private backoffMs = 500;
  private closed = false;
  private connectPromise: Promise<void> | null = null;
  /** In-flight dial shared by concurrent commands/reconnects. */
  private connecting: Promise<void> | null = null;
  /** In-flight subscriber dial shared by concurrent subscribe() calls. */
  private subConnecting: Promise<void> | null = null;
  /** Last recordFailure log time — Redis failures are logged at most once per window. */
  private lastFailureLogAt = 0;
  /** Hook for structured observability (circuit opens, sustained failures). */
  failureEventSink: ((event: 'failure' | 'circuit-open') => void) | null = null;

  commandsTotal = 0;
  errorsTotal = 0;
  unavailableTotal = 0;
  circuitOpensTotal = 0;
  latencyTotalMs = 0;
  lastError: string | null = null;
  connectedAt: string | null = null;

  private subSocket: net.Socket | null = null;
  private subParser = new RespParser();
  private subHandlers = new Map<string, Set<(message: string) => void>>();
  private subChannels: string[] = [];
  private subAckWaiters: Array<{
    command: string;
    channel: string;
    resolve: (v: unknown) => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = [];

  constructor(redisUrl: string) {
    this.parts = parseRedisUrl(redisUrl);
  }

  getStatus(): RedisStatus {
    return this.status;
  }

  isClosed(): boolean {
    return this.closed;
  }

  async connect(): Promise<void> {
    if (this.connectPromise) return this.connectPromise;
    this.connectPromise = this.dial(false).then(() => undefined);
    try {
      await this.connectPromise;
    } finally {
      this.connectPromise = null;
    }
  }

  private dial(_isSubscriber: boolean): Promise<net.Socket> {
    void _isSubscriber;
    return new Promise((resolve, reject) => {
      const onError = (err: Error): void => {
        reject(err);
      };
      const useTls = this.parts.tls;
      const sock: net.Socket = useTls
        ? tls.connect({ host: this.parts.host, port: this.parts.port } as tls.ConnectionOptions) as unknown as net.Socket
        : net.createConnection({ host: this.parts.host, port: this.parts.port });
      // Client-side keepalive: detects half-open peers (NAT idle drops) on
      // split-host deployments where the server-side probe may not reach us.
      sock.setKeepAlive(true, 30_000);
      const timer = setTimeout(() => {
        try { sock.destroy(); } catch { /* ignore */ }
        reject(new Error('Redis connect timeout'));
      }, 5000);
      sock.once('error', onError);
      sock.once('connect', () => {
        clearTimeout(timer);
        sock.removeListener('error', onError);
        resolve(sock);
      });
      (sock as unknown as { once(o: string, f: () => void): void }).once('secureConnect', () => {
        clearTimeout(timer);
        sock.removeListener('error', onError);
        resolve(sock);
      });
    });
  }

  private authArgs(): Array<string | number> {
    // ACL-style AUTH [username] password; falls back to AUTH password for
    // classic requirepass-only instances.
    return this.parts.username
      ? ['AUTH', this.parts.username, this.parts.password ?? '']
      : ['AUTH', this.parts.password ?? ''];
  }

  private async ensureConnected(): Promise<void> {
    if (this.closed) throw new Error('Redis client closed');
    if (Date.now() < this.circuitOpenUntil) {
      this.unavailableTotal += 1;
      throw new Error('Redis circuit open (recent failures)');
    }
    if (this.socket && !this.socket.destroyed && this.status === 'ready') return;
    // Single-flight: concurrent commands during a reconnect share one dial
    // instead of each opening (and leaking) its own socket.
    if (this.connecting) return this.connecting;
    this.connecting = this.doConnect();
    try {
      await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  private async doConnect(): Promise<void> {
    this.status = 'connecting';
    try {
      const sock = await this.dial(false);
      this.socket = sock;
      this.parser = new RespParser();
      this.attach(sock, false);
      if (this.parts.password) {
        await this.raw(...this.authArgs());
      }
      if (this.parts.db) {
        await this.raw('SELECT', String(this.parts.db));
      }
      this.status = 'ready';
      this.connectedAt = new Date().toISOString();
      this.backoffMs = 500;
      this.consecutiveFailures = 0;
      // First healthy data connection after boot/degradation: recover a
      // subscriber subscription that failed while Redis was down. Without
      // this, cross-instance fan-out stays dead for the process lifetime.
      if (this.subChannels.length > 0 && (!this.subSocket || this.subSocket.destroyed)) {
        void this.resubscribe();
      }
    } catch (err) {
      this.status = 'degraded';
      throw err;
    }
  }

  private attach(sock: net.Socket, isSubscriber: boolean): void {
    sock.on('data', (chunk: Buffer) => {
      // A protocol desync leaves the parser buffer wedged (every subsequent
      // chunk would re-throw at the same offset) — destroy the socket so a
      // clean reconnect replaces silently-dropped replies.
      let msgs: unknown[];
      try {
        msgs = isSubscriber ? this.subParser.feed(chunk) : this.parser.feed(chunk);
      } catch {
        this.recordFailure(new Error('Redis protocol desync'));
        try { sock.destroy(); } catch { /* ignore */ }
        return;
      }
      if (isSubscriber) {
        for (const msg of msgs) this.handlePush(msg);
        return;
      }
      for (const msg of msgs) {
        const pending = this.queue.shift();
        if (!pending) continue;
        clearTimeout(pending.timer);
        if (msg instanceof Error) pending.reject(msg);
        else pending.resolve(msg);
      }
    });
    // Per-command failures are counted in command(); counting here too would
    // double-count one failure. Subscriber failures have no command wrapper.
    sock.on('error', (err) => {
      if (isSubscriber) {
        this.recordFailure(err);
        return;
      }
      this.status = 'degraded';
      this.socket = null;
      this.failQueue(err);
    });
    sock.on('close', () => {
      if (!isSubscriber) {
        this.status = this.closed ? 'closed' : 'degraded';
        this.socket = null;
        this.failQueue(new Error('Redis connection closed'));
        if (!this.closed) void this.scheduleReconnect();
      } else {
        this.subSocket = null;
        this.failSubWaiters(new Error('Redis subscriber connection closed'));
        if (!this.closed) void this.resubscribe();
      }
    });
  }

  private failSubWaiters(err: Error): void {
    while (this.subAckWaiters.length > 0) {
      const waiter = this.subAckWaiters.shift();
      if (!waiter) break;
      clearTimeout(waiter.timer);
      waiter.reject(err);
    }
  }

  private failQueue(err: Error): void {
    while (this.queue.length > 0) {
      const pending = this.queue.shift();
      if (!pending) break;
      clearTimeout(pending.timer);
      pending.reject(err);
    }
  }

  private recordFailure(err: unknown): void {
    this.errorsTotal += 1;
    const message = err instanceof Error ? err.message : String(err);
    this.lastError = message.slice(0, 300);
    // During circuit-open cooldown rejections are fast-fails without fresh
    // evidence; counting them would let the first failure after cooldown
    // instantly re-open the circuit.
    if (Date.now() < this.circuitOpenUntil) return;
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= CIRCUIT_FAILURES) {
      this.circuitOpenUntil = Date.now() + CIRCUIT_COOLDOWN_MS;
      this.consecutiveFailures = 0;
      this.circuitOpensTotal += 1;
      this.emitFailureEvent('circuit-open');
    } else {
      this.emitFailureEvent('failure');
    }
  }

  /**
   * Emit a failure event at most once per FAILURE_LOG_WINDOW_MS so a Redis
   * outage produces a bounded number of log/system-error records instead of
   * one per request.
   */
  private emitFailureEvent(event: 'failure' | 'circuit-open'): void {
    const now = Date.now();
    const sink = this.failureEventSink;
    if (!sink) return;
    if (event === 'failure' && now - this.lastFailureLogAt < FAILURE_LOG_WINDOW_MS) return;
    this.lastFailureLogAt = now;
    try {
      sink(event);
    } catch { /* observability must not throw into the data path */ }
  }

  private async scheduleReconnect(): Promise<void> {
    if (this.closed) return;
    this.reconnects += 1;
    const jitter = Math.random() * 300;
    await new Promise((r) => setTimeout(r, Math.min(MAX_BACKOFF_MS, this.backoffMs) + jitter));
    this.backoffMs = Math.min(MAX_BACKOFF_MS, this.backoffMs * 2);
    if (this.closed) return;
    try {
      await this.ensureConnected();
      if (this.subChannels.length > 0) await this.resubscribe();
    } catch { /* stay degraded; next command retries */ }
  }

  private raw(...args: Array<string | number>): Promise<unknown> {
    const sock = this.socket;
    if (!sock || sock.destroyed) return Promise.reject(new Error('Redis not connected'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.queue.findIndex((p) => p.resolve === resolve);
        if (idx >= 0) this.queue.splice(idx, 1);
        reject(new Error('Redis command timeout'));
      }, COMMAND_TIMEOUT_MS);
      this.queue.push({ resolve: resolve as (v: unknown) => void, reject, timer });
      try {
        sock.write(encodeCommand(...args));
      } catch (err) {
        clearTimeout(timer);
        this.queue.pop();
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  async command<T = unknown>(...args: Array<string | number>): Promise<T> {
    const started = Date.now();
    try {
      await this.ensureConnected();
      const result = (await this.raw(...args)) as T;
      this.commandsTotal += 1;
      this.latencyTotalMs += Date.now() - started;
      this.consecutiveFailures = 0;
      return result;
    } catch (err) {
      this.recordFailure(err);
      throw err instanceof Error ? err : new Error(String(err));
    }
  }

  async ping(): Promise<boolean> {
    const res = await this.command<string>('PING');
    return res === 'PONG';
  }

  async get(key: string): Promise<string | null> {
    return this.command<string | null>('GET', key);
  }

  async set(key: string, value: string, ttlSec?: number, nx = false): Promise<boolean> {
    const args: Array<string | number> = ['SET', key, value];
    if (nx) args.push('NX');
    if (ttlSec && ttlSec > 0) args.push('EX', Math.max(1, Math.round(ttlSec)));
    const res = await this.command<string | null>(...args);
    return res === 'OK';
  }

  async del(...keys: string[]): Promise<number> {
    if (keys.length === 0) return 0;
    return this.command<number>('DEL', ...keys);
  }

  async incr(key: string): Promise<number> {
    return this.command<number>('INCR', key);
  }

  async expire(key: string, ttlSec: number): Promise<boolean> {
    const res = await this.command<number>('EXPIRE', key, Math.max(1, Math.round(ttlSec)));
    return res === 1;
  }

  async evalSha<T = unknown>(script: string, keys: string[], args: Array<string | number>): Promise<T> {
    return this.command<T>('EVAL', script, String(keys.length), ...keys, ...args);
  }

  async publish(channel: string, message: string): Promise<number> {
    return this.command<number>('PUBLISH', channel, message);
  }

  async info(section = 'memory'): Promise<string> {
    const res = await this.command<string>('INFO', section);
    return res ?? '';
  }

  private handlePush(msg: unknown): void {
    if (msg instanceof Error) {
      const waiter = this.subAckWaiters.shift();
      if (waiter) {
        clearTimeout(waiter.timer);
        waiter.reject(msg);
      }
      return;
    }
    if (typeof msg === 'string') {
      // +OK replies to AUTH / SELECT on the subscriber connection.
      const waiter = this.subAckWaiters.shift();
      if (waiter) {
        clearTimeout(waiter.timer);
        waiter.resolve(msg);
      }
      return;
    }
    if (!Array.isArray(msg) || msg.length < 3) return;
    const [kind, channel, payload] = msg as [string, string, string];
    if (kind === 'subscribe' || kind === 'unsubscribe') {
      const idx = this.subAckWaiters.findIndex(
        (w) => (w.command === 'SUBSCRIBE' || w.command === 'UNSUBSCRIBE') && w.channel === String(channel),
      );
      if (idx >= 0) {
        const [waiter] = this.subAckWaiters.splice(idx, 1);
        clearTimeout(waiter.timer);
        waiter.resolve(msg);
      }
      return;
    }
    if (kind !== 'message' && kind !== 'pmessage') return;
    const handlers = this.subHandlers.get(String(channel));
    if (!handlers) return;
    for (const fn of handlers) {
      try { fn(String(payload)); } catch { /* subscriber must not throw */ }
    }
  }

  async subscribe(channel: string, handler: (message: string) => void): Promise<void> {
    let set = this.subHandlers.get(channel);
    if (!set) {
      set = new Set();
      this.subHandlers.set(channel, set);
    }
    set.add(handler);
    if (!this.subChannels.includes(channel)) this.subChannels.push(channel);
    await this.ensureSubscriber();
    await this.subCommand('SUBSCRIBE', channel);
  }

  async unsubscribe(channel: string, handler?: (message: string) => void): Promise<void> {
    if (handler) {
      this.subHandlers.get(channel)?.delete(handler);
      if ((this.subHandlers.get(channel)?.size ?? 0) > 0) return;
    }
    this.subHandlers.delete(channel);
    this.subChannels = this.subChannels.filter((c) => c !== channel);
    if (this.subSocket && !this.subSocket.destroyed) {
      try { await this.subCommand('UNSUBSCRIBE', channel); } catch { /* degraded */ }
    }
  }

  private async ensureSubscriber(): Promise<void> {
    if (this.subSocket && !this.subSocket.destroyed) return;
    // Single-flight: concurrent subscribe() calls (fanout + cache
    // invalidations at boot) must share one dial instead of leaking a
    // duplicate subscriber socket and interleaving two parsers.
    if (this.subConnecting) return this.subConnecting;
    this.subConnecting = this.doConnectSubscriber();
    try {
      await this.subConnecting;
    } finally {
      this.subConnecting = null;
    }
  }

  private async doConnectSubscriber(): Promise<void> {
    const sock = await this.dial(true);
    this.subSocket = sock;
    this.subParser = new RespParser();
    this.attach(sock, true);
    if (this.parts.password) {
      await this.subCommand(...this.authArgs());
    }
    if (this.parts.db) {
      await this.subCommand('SELECT', String(this.parts.db));
    }
  }

  private subCommand(...args: Array<string | number>): Promise<unknown> {
    const sock = this.subSocket;
    if (!sock || sock.destroyed) return Promise.reject(new Error('Redis subscriber not connected'));
    // Single-consumer protocol: attach() owns the subscriber parser. Handshake
    // replies resolve via handlePush() so bytes are never fed twice.
    return new Promise((resolve, reject) => {
      const command = String(args[0] ?? '').toUpperCase();
      const channel = String(args[1] ?? '');
      const timer = setTimeout(() => {
        const idx = this.subAckWaiters.findIndex((w) => w.resolve === resolve);
        if (idx >= 0) this.subAckWaiters.splice(idx, 1);
        reject(new Error('Redis subscribe timeout'));
      }, COMMAND_TIMEOUT_MS);
      this.subAckWaiters.push({ command, channel, resolve: resolve as (v: unknown) => void, reject, timer });
      try {
        sock.write(encodeCommand(...args));
      } catch (err) {
        clearTimeout(timer);
        const idx = this.subAckWaiters.findIndex((w) => w.resolve === resolve);
        if (idx >= 0) this.subAckWaiters.splice(idx, 1);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  private async resubscribe(): Promise<void> {
    const channels = [...this.subChannels];
    if (channels.length === 0) return;
    try {
      await this.ensureSubscriber();
      for (const channel of channels) {
        try { await this.subCommand('SUBSCRIBE', channel); } catch { /* retry later */ }
      }
    } catch { /* stay degraded */ }
  }

  async quit(): Promise<void> {
    this.closed = true;
    this.status = 'closed';
    try {
      if (this.socket && !this.socket.destroyed) {
        try { await this.raw('QUIT'); } catch { /* ignore */ }
        this.socket.destroy();
      }
    } catch { /* ignore */ }
    try {
      this.subSocket?.destroy();
    } catch { /* ignore */ }
    this.socket = null;
    this.subSocket = null;
    this.failQueue(new Error('Redis client closed'));
    this.failSubWaiters(new Error('Redis client closed'));
  }

  stats(): {
    status: RedisStatus;
    commandsTotal: number;
    errorsTotal: number;
    unavailableTotal: number;
    circuitOpensTotal: number;
    avgLatencyMs: number;
    reconnects: number;
    lastError: string | null;
    connectedAt: string | null;
  } {
    return {
      status: this.status,
      commandsTotal: this.commandsTotal,
      errorsTotal: this.errorsTotal,
      unavailableTotal: this.unavailableTotal,
      circuitOpensTotal: this.circuitOpensTotal,
      avgLatencyMs: this.commandsTotal > 0 ? Math.round((this.latencyTotalMs / this.commandsTotal) * 10) / 10 : 0,
      reconnects: this.reconnects,
      lastError: this.lastError,
      connectedAt: this.connectedAt,
    };
  }
}

let singleton: CatalystRedis | null = null;
let disabledReason: string | null = null;

export function getRedisUrl(): string | null {
  if (process.env.REDIS_ENABLED === 'false' || process.env.REDIS_ENABLED === '0') {
    disabledReason = 'REDIS_ENABLED is false';
    return null;
  }
  const url = (process.env.REDIS_URL || '').trim();
  if (!url) {
    disabledReason = 'REDIS_URL is not set';
    return null;
  }
  return url;
}

export function isRedisConfigured(): boolean {
  return getRedisUrl() !== null;
}

/** Singleton client, or null when Redis is disabled (degraded mode). */
export function getRedis(): CatalystRedis | null {
  const url = getRedisUrl();
  if (!url) {
    // Runtime kill switch: drop the live singleton so its sockets and
    // reconnect loop do not outlive the disabled state.
    if (singleton && !singleton.isClosed()) {
      void singleton.quit();
    }
    singleton = null;
    return null;
  }
  if (!singleton) {
    singleton = new CatalystRedis(url);
  }
  return singleton;
}

export function getRedisDisabledReason(): string | null {
  return disabledReason;
}

export async function closeRedis(): Promise<void> {
  if (singleton) {
    await singleton.quit();
    singleton = null;
  }
}

/**
 * Run a Redis operation with graceful fallback.
 * Redis is OPTIONAL for cached/coordination data: on any failure, log once
 * at debug level, count the event, and return the fallback value so the
 * caller uses the database or process-local path instead.
 */
export async function withRedisFallback<T>(fn: (redis: CatalystRedis) => Promise<T>, fallback: T): Promise<T> {
  const redis = getRedis();
  if (!redis) return fallback;
  try {
    return await fn(redis);
  } catch {
    redis.unavailableTotal += 1;
    return fallback;
  }
}

export function getRedisStats(): {
  configured: boolean;
  disabledReason: string | null;
  status: RedisStatus;
  commandsTotal: number;
  errorsTotal: number;
  unavailableTotal: number;
  circuitOpensTotal: number;
  avgLatencyMs: number;
  reconnects: number;
  lastError: string | null;
  connectedAt: string | null;
} {
  const redis = getRedis();
  if (!redis) {
    return {
      configured: false,
      disabledReason: getRedisDisabledReason(),
      status: 'disabled',
      commandsTotal: 0,
      errorsTotal: 0,
      unavailableTotal: 0,
      circuitOpensTotal: 0,
      avgLatencyMs: 0,
      reconnects: 0,
      lastError: null,
      connectedAt: null,
    };
  }
  return { configured: true, disabledReason: null, ...redis.stats() };
}
