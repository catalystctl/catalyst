/**
 * Short-lived L1 cache for the authenticated request context.
 *
 * Better-auth validates the session cookie against Postgres on every request
 * (session row + user row, plus a separate banned/locked lookup in
 * server.ts `authenticate`). On hot endpoints that is 2-3 SQL round trips of
 * pure auth overhead per request even when every downstream cache hits.
 * This module caches the resolved `request.user` payload keyed by the raw
 * session-cookie value (hashed) for a short TTL (default 10s).
 *
 * Correctness: the TTL is the staleness bound for OUT-OF-BAND changes
 * (direct DB edits). Panel-initiated revocations flush immediately via the
 * 'auth-session' cache-bus channel (cluster IPC + Redis pub/sub), emitted
 * from sign-out, admin ban/unban, password resets and session revocation.
 * Permission mutations already broadcast on the 'permissions' channel; the
 * cached entries embed the resolved permission set, so that channel flushes
 * this cache too. Set AUTH_SESSION_CACHE_TTL_MS=0 to disable entirely.
 */

import { createHash } from 'crypto';
import { SimpleCache } from './cache';
import { registerCacheStats } from './cache';
import { broadcastCacheInvalidate, onCacheInvalidate } from './cache-bus';

export type CachedRequestUser = {
	userId: string;
	email: string;
	username?: string;
	apiKeyId?: string;
	permissions: string[];
};

const DEFAULT_TTL_MS = 10_000;
const MAX_TTL_MS = 300_000;

const sessionCache = new SimpleCache<string, CachedRequestUser>(DEFAULT_TTL_MS, 5000);

registerCacheStats('auth.session', () => sessionCache.stats());

function resolvedTtl(): number {
	const raw = Number(process.env.AUTH_SESSION_CACHE_TTL_MS);
	if (!Number.isFinite(raw)) return DEFAULT_TTL_MS;
	if (raw <= 0) return 0;
	return Math.min(MAX_TTL_MS, Math.floor(raw));
}

/** Cookie better-auth reads the session token from (see auth.ts cookiePrefix). */
export const SESSION_COOKIE_NAME = 'better-auth.session_token';

export function hashSessionToken(token: string): string {
	return createHash('sha256').update(token).digest('hex');
}

/** Extract the raw session token from a cookie header value, if present. */
export function extractSessionToken(cookieHeader: unknown): string | null {
	if (typeof cookieHeader !== 'string') return null;
	const match = cookieHeader.match(
		new RegExp(`(?:^|;\\s*)${SESSION_COOKIE_NAME.replace(/\./g, '\\.')}=([^;]+)`),
	);
	if (!match) return null;
	try {
		return decodeURIComponent(match[1]);
	} catch {
		return match[1];
	}
}

export function getCachedSessionUser(token: string): CachedRequestUser | undefined {
	if (resolvedTtl() === 0) return undefined;
	return sessionCache.get(hashSessionToken(token));
}

export function cacheSessionUser(token: string, user: CachedRequestUser): void {
	if (resolvedTtl() === 0) return;
	sessionCache.set(hashSessionToken(token), user, resolvedTtl());
}

function flushLocal(): void {
	// Keys are token hashes with no userId index; a targeted flush would need
	// a value scan. Entries re-populate with a single query per active
	// session, so a full clear is the cheap-and-correct choice.
	sessionCache.clear();
}

/**
 * Flush cached request contexts (optionally "for a user" — see flushLocal for
 * why that is a full clear) and broadcast to sibling workers/hosts.
 */
export function invalidateAuthSessionCache(userId?: string): void {
	flushLocal();
	broadcastCacheInvalidate('auth-session', userId ? { userId } : { flushAll: true });
}

onCacheInvalidate('auth-session', () => flushLocal());
// Cached entries embed resolved permissions; role changes must not leave a
// stale permission set attached to live sessions.
onCacheInvalidate('permissions', () => flushLocal());
