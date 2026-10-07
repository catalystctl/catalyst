import type { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "../db.js";
import { verifyApiKey as verifyApiKeyService } from "../services/api-key-service.js";
import {
	cacheSessionUser,
	extractSessionToken,
	getCachedSessionUser,
} from "../lib/auth-session-cache";
import { resolveUserPermissions } from "../lib/permissions-catalog";
import { hasGrant } from "../lib/permissions";
import { auth } from "../auth";
import { fromNodeHeaders } from "better-auth/node";
import { captureSystemError } from "../services/error-logger";
import { apiError } from "../lib/http-error";
import { ErrorCodes } from "../shared-types";

/**
 * Route-level key-scope declaration, carried on the route's `config` object
 * (same mechanism as config.rateLimit). For API-key requests the key itself
 * must hold the declared permission(s); sessions are never checked here.
 *  - requiredPermission: single value, or an array with ANY-of semantics.
 *  - requiredAllPermissions: array with ALL-of semantics (e.g. restart =
 *    server.start + server.stop).
 *  - requiredPermission: null + keyScopeExemptReason: dynamic
 *    (owner|subuser|role-perm) routes that thread the actor through their
 *    access helper instead of faking a static permission.
 */
declare module "fastify" {
	interface FastifyContextConfig {
		requiredPermission?: string | string[] | null;
		requiredAllPermissions?: string[];
		keyScopeExemptReason?: string;
	}
}

// Rollout flag: KEY_SCOPE_ENFORCE=false disables key ceilings for
// false-positive auditing. Sessions are unaffected either way.
export const KEY_SCOPE_ENFORCED = process.env.KEY_SCOPE_ENFORCE !== "false";

/**
 * Enforce the route's declared key-scope ceiling. No-op for sessions,
 * unauthenticated routes (their own auth will 401), routes without a
 * declaration, and explicit null exemptions. Sends the 403 itself and
 * returns false when the key's scope is insufficient.
 */
export function enforceRouteKeyScope(
	request: FastifyRequest,
	reply: FastifyReply,
): boolean {
	if (!KEY_SCOPE_ENFORCED) return true;
	const user = (request as { user?: { apiKeyId?: string; permissions?: unknown } }).user;
	// Sessions and routes without authenticate have no key scope to enforce.
	if (!user?.apiKeyId) return true;
	const config = (request.routeOptions?.config ?? {}) as {
		requiredPermission?: string | string[] | null;
		requiredAllPermissions?: string[];
	};
	const required = config.requiredPermission;
	const requiredAll = config.requiredAllPermissions;
	// Dynamic routes thread the actor through their access helper instead:
	// no declaration at all (undefined AND no all-of list) means exempt.
	if ((required === null || required === undefined) && !requiredAll) return true;
	const perms: string[] = Array.isArray(user.permissions) ? user.permissions : [];
	const denied = (permission: string) => !hasGrant(perms, permission);
	if (
		(typeof required === "string" && denied(required)) ||
		(Array.isArray(required) && required.length > 0 && required.every(denied)) ||
		(requiredAll?.some(denied) ?? false)
	) {
		apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, "Forbidden");
		return false;
	}
	return true;
}

export interface AuthenticateLogger {
	warn: (obj: unknown, msg?: string) => void;
	error: (obj: unknown, msg?: string) => void;
}

/**
 * Request authentication: API key (Bearer catalyst…) or session cookie.
 * Extracted verbatim from server.ts (behavior-preserving). On the API-key
 * path request.user.permissions is the KEY's scope (validated live against
 * the owner's permissions); on the session path it is the owner's full
 * role set. The key path additionally runs enforceRouteKeyScope so routes
 * that authorize via route-level preHandler are covered regardless of
 * Fastify's app-level-before-route-level preHandler hook order.
 */
export function createAuthenticate(deps: { logger: AuthenticateLogger }) {
	const { logger } = deps;
	const authenticate = async (request: any, reply: any) => {
		const authHeader = request.headers.authorization;

		// Try API key authentication if header matches Bearer pattern
		if (authHeader?.startsWith("Bearer ")) {
			const token = authHeader.substring(7);

			// Check if it's an API key (starts with prefix)
			if (token.startsWith("catalyst")) {
				try {
					const verification = await verifyApiKeyService(token);

					if (!verification?.valid || !verification?.key || !verification?.user) {
						reply.status(401).send({ error: "Invalid API key" });
						return;
					}

					// Reject banned or locked accounts before accepting API key auth
					const account = await prisma.user.findUnique({
						where: { id: verification.user.id },
						select: { banned: true, lockedUntil: true },
					});
					if (account?.banned) {
						reply.status(403).send({ error: "Account is banned", code: "ACCOUNT_BANNED" });
						return;
					}
					if (account?.lockedUntil && new Date(account.lockedUntil) > new Date()) {
						reply.status(403).send({ error: "Account is locked", code: "ACCOUNT_LOCKED" });
						return;
					}

					// Attach user info and resolved permissions from the API key
					const currentUserPermissions = await resolveUserPermissions(
						verification.key.userId,
					);
					const hasWildcard = currentUserPermissions.includes("*");

					// Validate API key permissions don't exceed user's current permissions.
					// Applies to both scoped keys and allPermissions keys so revoked roles
					// shrink (or zero out) the effective permission set immediately.
					let permissions: string[];
					if (verification.key.allPermissions) {
						// allPermissions keys inherit live user perms only.
						if (!hasWildcard && currentUserPermissions.length === 0) {
							reply.status(403).send({
								error:
									"API key permissions revoked - user no longer has required permissions",
							});
							return;
						}
						permissions = currentUserPermissions;
					} else {
						permissions = verification.key.permissions;
						if (!hasWildcard) {
							const stalePermissions = permissions.filter(
								(p) =>
									!currentUserPermissions.includes(p) &&
									!currentUserPermissions.includes("*"),
							);
							if (stalePermissions.length > 0) {
								reply.status(403).send({
									error:
										"API key permissions revoked - user no longer has required permissions",
								});
								return;
							}
						}
					}

					request.user = {
						userId: verification.user.id,
						email: verification.user.email,
						username: verification.user.username,
						apiKeyId: verification.key.id,
						permissions,
					};
					// Key-scope ceiling for statically-declared routes. Also runs in the
					// global preHandler hook; both checks are idempotent.
					if (!enforceRouteKeyScope(request, reply)) return;
					return; // API key auth successful
				} catch (error: any) {
					captureSystemError({
						level: 'error',
						component: 'Index',
						message: error?.message || 'API key authentication error',
						stack: error?.stack,
						metadata: { context: 'api_key_auth' },
					}).catch(() => {});
					logger.error(error, "API key authentication error");
					reply.status(401).send({ error: "Invalid or expired API key" });
					return;
				}
			}
		}

		// Fall back to session authentication.
		// Short-TTL L1 cache keyed by the session cookie: a warm request skips the
		// better-auth session/user queries and the banned/locked lookup entirely
		// (2-3 SQL round trips). Revocations flush it via the 'auth-session'
		// cache-bus channel; see lib/auth-session-cache.ts for the staleness bound.
		const sessionToken = extractSessionToken(request.headers.cookie);
		if (sessionToken) {
			const cachedUser = getCachedSessionUser(sessionToken);
			if (cachedUser) {
				request.user = { ...cachedUser };
				return;
			}
		}
		try {
			const session = await auth.api.getSession({
				headers: fromNodeHeaders(
					request.headers as Record<string, string | string[] | undefined>,
				),
			});
			if (!session) {
				reply.status(401).send({ error: "Unauthorized" });
				return;
			}

			// Reject banned or locked accounts on the main session auth path
			const account = await prisma.user.findUnique({
				where: { id: session.user.id },
				select: { banned: true, lockedUntil: true },
			});
			if (account?.banned) {
				reply.status(403).send({ error: "Account is banned", code: "ACCOUNT_BANNED" });
				return;
			}
			if (account?.lockedUntil && new Date(account.lockedUntil) > new Date()) {
				reply.status(403).send({ error: "Account is locked", code: "ACCOUNT_LOCKED" });
				return;
			}

			// Resolve permissions from roles for session auth too
			let permissions: string[] = [];
			try {
				permissions = await resolveUserPermissions(session.user.id);
			} catch (permError) {
				logger.error(permError, "Failed to resolve user permissions");
				// Continue with empty permissions - better than failing auth entirely
			}
			request.user = {
				userId: session.user.id,
				email: session.user.email,
				username: (session.user as any).username,
				permissions,
			};
			if (sessionToken) {
				cacheSessionUser(sessionToken, { ...request.user });
			}
		} catch {
			reply.status(401).send({ error: "Unauthorized" });
			return;
		}
	};

	return authenticate;
}
