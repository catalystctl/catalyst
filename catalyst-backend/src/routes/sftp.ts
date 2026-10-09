import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "../db.js";
import { decideServerAccess } from "../lib/server-access.js";
import { resolveServerPermissions } from "../lib/permissions-catalog.js";
import { hasNodeAccess, enforceKeyScope } from "./servers/_helpers.js";
import {
	generateSftpToken,
	rotateSftpToken,
	listSftpTokensForServer,
	revokeSftpToken,
	revokeAllSftpTokensForServer,
	SFTP_TTL_OPTIONS,
} from "../services/sftp-token-manager.js";

/**
 * Panel-side SFTP routes, extracted from server.ts (behavior-preserving
 * move, per key-scope-impl-plan §3 / test-plan §5i).
 *
 * Authorization contract (sftp-fix-design.md C2/C3):
 * - mint/rotate gate on the caller's EFFECTIVE file.read (or file.write for
 *   write-only subusers) — file access is the SFTP capability, so the gate
 *   matches the session's minimum useful permission;
 * - API-key scope is enforced on every route via config.requiredPermission
 *   (the global key-scope hook) plus an inline enforceKeyScope on mint/rotate;
 * - token listings show metadata for all callers; raw token values only for
 *   the caller's own entries, and non-managers see only their own entries.
 */

const SFTP_FILE_ACCESS = ["file.read", "file.write"] as const;

const canManageTokensFor = (
	isOwner: boolean,
	rolePerms: string[],
): boolean =>
	isOwner ||
	rolePerms.includes("*") ||
	rolePerms.includes("admin.write") ||
	rolePerms.includes("server.update");

export async function sftpRoutes(app: FastifyInstance) {
	const authenticate = (app as any).authenticate;

	// SFTP connection info endpoint (authenticated)
	// Uses a dedicated SFTP token manager with per-user configurable expiry.
	// SFTP now runs on the node (not the backend), so we look up the
	// server's assigned node and return the node's hostname + SFTP port.
	app.get(
		"/api/sftp/connection-info",
		{
           schema: { summary: "Get SFTP connection information", tags: ["SFTP"], querystring: { type: "object", required: ["serverId"], properties: { serverId: { type: "string" }, ttl: { type: "string" } } }, response: { 200: { type: "object", additionalProperties: true }, 400: { type: "object", additionalProperties: true }, 403: { type: "object", additionalProperties: true }, 404: { type: "object", additionalProperties: true } } },
			preHandler: [authenticate],
			config: { requiredPermission: "file.read" },
		},
		async (request: FastifyRequest, reply: FastifyReply) => {
			const userId = request.user?.userId;
			const serverId = (request.query as { serverId?: string }).serverId;

			if (!userId || !serverId) {
				return reply
					.status(400)
					.send({ error: "serverId query parameter is required" });
			}

			// SECURITY: only callers with file access to this server may mint an
			// SFTP token for it. Without this check any authenticated user
			// could generate tokens bound to arbitrary server IDs (and learn
			// node host/port metadata via the response).
			const sftpServerRow = await prisma.server.findUnique({
				where: { id: serverId },
				select: { ownerId: true, nodeId: true },
			});
			if (!sftpServerRow) {
				return reply.status(404).send({ error: "Server not found" });
			}
			const sftpAccessRow = await prisma.serverAccess.findFirst({
				where: { serverId, userId },
				select: { permissions: true },
			});
			// Write-only subusers legitimately mint write-only sessions (the
			// agent denies their reads per-op), so file.write rows count too.
			const sftpHasFileAccess = Boolean(
				sftpAccessRow?.permissions?.some((p: string) =>
					(SFTP_FILE_ACCESS as readonly string[]).includes(p),
				),
			);
			const sftpRolePerms = await resolveServerPermissions(
				userId,
				serverId,
				sftpServerRow.nodeId,
			);
			const sftpHasNodeAccess = await hasNodeAccess(
				prisma,
				userId,
				sftpServerRow.nodeId,
			);
			const sftpDecision = decideServerAccess({
				isOwner: sftpServerRow.ownerId === userId,
				hasExplicitServerAccess: sftpHasFileAccess,
				rolePermissions: sftpRolePerms,
				hasNodeAccess: sftpHasNodeAccess,
				requiredPermission: "file.read",
			});
			if (!sftpDecision.allowed) {
				return reply.status(403).send({ error: "Forbidden" });
			}
			// Key-scope ceiling: a narrow API key must itself hold file.read.
			if (!enforceKeyScope(request.user, "file.read")) {
				return reply.status(403).send({ error: "Forbidden" });
			}

			// Look up the server's node for SFTP host/port
			const server = await prisma.server.findUnique({
				where: { id: serverId },
				select: {
					node: {
						select: {
							hostname: true,
							publicAddress: true,
							sftpPort: true,
							sftpEnabled: true,
						},
					},
				},
			});

			let enabled = true;
			let host = "unknown";
			let port = 2022;

			if (server?.node) {
				enabled = server.node.sftpEnabled;
				// Prefer publicAddress (IP) for SFTP, fallback to hostname
				host = server.node.publicAddress || server.node.hostname;
				port = server.node.sftpPort;
			}

			const ttlMs =
				Number((request.query as { ttl?: string }).ttl) || undefined;
			const result = generateSftpToken(userId, serverId, ttlMs);

			reply.send({
				success: true,
				data: {
					enabled,
					host,
					port,
					// SFTP login username is the server id (agent scopes the session by it)
					username: serverId,
					sftpPassword: result.token,
					expiresAt: result.expiresAt,
					ttlMs: result.ttlMs,
					ttlOptions: SFTP_TTL_OPTIONS.map((o) => ({
						label: o.label,
						value: o.value,
					})),
				},
			});
		},
	);

	// SFTP token rotation endpoint (authenticated)
	app.post(
		"/api/sftp/rotate-token",
		{
			schema: { summary: "Rotate an SFTP token", tags: ["SFTP"], body: { type: "object", required: ["serverId"], properties: { serverId: { type: "string" }, ttlMs: { type: "number" } } }, response: { 200: { type: "object" }, 400: { type: "object" }, 403: { type: "object" }, 404: { type: "object" } } },
			preHandler: [authenticate],
			config: { requiredPermission: "file.read" },
		},
		async (request: FastifyRequest, reply: FastifyReply) => {
			const userId = request.user?.userId;
			const { serverId, ttlMs } = request.body as {
				serverId: string;
				ttlMs?: number;
			};

			if (!userId || !serverId) {
				return reply.status(400).send({ error: "serverId is required" });
			}

			// SECURITY: mirror connection-info access check for rotation.
			const rotServerRow = await prisma.server.findUnique({
				where: { id: serverId },
				select: { ownerId: true, nodeId: true },
			});
			if (!rotServerRow) {
				return reply.status(404).send({ error: "Server not found" });
			}
			const rotAccessRow = await prisma.serverAccess.findFirst({
				where: { serverId, userId },
				select: { permissions: true },
			});
			const rotHasFileAccess = Boolean(
				rotAccessRow?.permissions?.some((p: string) =>
					(SFTP_FILE_ACCESS as readonly string[]).includes(p),
				),
			);
			const rotRolePerms = await resolveServerPermissions(
				userId,
				serverId,
				rotServerRow.nodeId,
			);
			const rotHasNodeAccess = await hasNodeAccess(
				prisma,
				userId,
				rotServerRow.nodeId,
			);
			const rotDecision = decideServerAccess({
				isOwner: rotServerRow.ownerId === userId,
				hasExplicitServerAccess: rotHasFileAccess,
				rolePermissions: rotRolePerms,
				hasNodeAccess: rotHasNodeAccess,
				requiredPermission: "file.read",
			});
			if (!rotDecision.allowed) {
				return reply.status(403).send({ error: "Forbidden" });
			}
			// Key-scope ceiling: a narrow API key must itself hold file.read.
			if (!enforceKeyScope(request.user, "file.read")) {
				return reply.status(403).send({ error: "Forbidden" });
			}

			const result = rotateSftpToken(userId, serverId, ttlMs);

			reply.send({
				success: true,
				data: {
					sftpPassword: result.token,
					expiresAt: result.expiresAt,
					ttlMs: result.ttlMs,
				},
			});
		},
	);

	// List all SFTP tokens for a server (metadata for all, raw values for
	// the caller's own entries; non-managers see only their own entries)
	app.get(
		"/api/sftp/tokens",
		{
			schema: { summary: "List SFTP tokens", tags: ["SFTP"], querystring: { type: "object", required: ["serverId"], properties: { serverId: { type: "string" } } }, response: { 200: { type: "object" }, 400: { type: "object" }, 403: { type: "object" }, 404: { type: "object" } } },
			preHandler: [authenticate],
			config: { requiredPermission: "file.read" },
		},
		async (request: FastifyRequest, reply: FastifyReply) => {
			const userId = request.user?.userId;
			const serverId = (request.query as { serverId?: string }).serverId;

			if (!userId || !serverId) {
				return reply
					.status(400)
					.send({ error: "serverId query parameter is required" });
			}

			const server = await prisma.server.findUnique({
				where: { id: serverId },
				select: { ownerId: true, nodeId: true },
			});
			if (!server) {
				return reply.status(404).send({ error: "Server not found" });
			}

			const isOwner = server.ownerId === userId;
			// Server-scoped role resolution: global roles + RoleServerGrant +
			// RoleNodeGrant rows covering this server. Token *values* stay
			// visible to their owner only.
			const rolePerms = await resolveServerPermissions(userId, serverId, server.nodeId);
			const sftpTokenAccessRow = await prisma.serverAccess.findFirst({
				where: { serverId, userId },
				select: { userId: true },
			});
			const sftpTokenDecision = decideServerAccess({
				isOwner,
				hasExplicitServerAccess: Boolean(sftpTokenAccessRow),
				rolePermissions: rolePerms,
				hasNodeAccess: await hasNodeAccess(prisma, userId, server.nodeId),
				// Read-classified: admin.read reaches the listing via the
				// admin_read branch (previously dead — the branch needs
				// requiredPermission to fire).
				requiredPermission: "file.read",
			});
			if (!sftpTokenDecision.allowed) {
				return reply.status(403).send({ error: "Forbidden" });
			}
			const canManageTokens = canManageTokensFor(isOwner, rolePerms);
			const tokens = listSftpTokensForServer(
				serverId,
				userId,
			).filter((t) => canManageTokens || t.userId === userId);

            // Enrich tokens with user info in one query instead of one query
            // per token.
            const userIds = [...new Set(tokens.map((token) => token.userId))];
            const users = await prisma.user.findMany({
                where: { id: { in: userIds } },
                select: { id: true, email: true, username: true },
            });
            const usersById = new Map(users.map((user) => [user.id, user]));
            const enriched = tokens.map((t) => {
                const user = usersById.get(t.userId);
                return {
						userId: t.userId,
						email: user?.email ?? t.userId,
						username: user?.username ?? null,
						expiresAt: t.expiresAt,
						ttlMs: t.ttlMs,
						createdAt: t.createdAt,
						// Raw token values are visible to their owner only.
						...(t.isSelf ? { token: t.token } : {}),
						isSelf: t.isSelf,
                };
            });

			reply.send({ success: true, data: enriched });
		},
	);

	// Revoke a specific user's SFTP token for a server (owner, manager, or self)
	app.delete(
		"/api/sftp/tokens/:targetUserId",
		{
			preHandler: [authenticate],
			config: { requiredPermission: "file.read" },
		},
		async (request: FastifyRequest, reply: FastifyReply) => {
			const userId = request.user?.userId;
			const { targetUserId } = request.params as { targetUserId: string };
			const serverId = (request.query as { serverId?: string }).serverId;

			if (!userId || !serverId || !targetUserId) {
				return reply
					.status(400)
					.send({ error: "serverId and targetUserId are required" });
			}

			const server = await prisma.server.findUnique({
				where: { id: serverId },
				select: { ownerId: true, nodeId: true },
			});
			if (!server) {
				return reply.status(404).send({ error: "Server not found" });
			}

			const isOwner = server.ownerId === userId;
			// Server-scoped role resolution (mirrors the list/revoke routes).
			const rolePerms = await resolveServerPermissions(userId, serverId, server.nodeId);
			const canManageTokens = canManageTokensFor(isOwner, rolePerms);
			// Revoking another user's token is a manage action: a narrow API
			// key must hold server.update for it (self-revoke needs only the
			// route's file.read ceiling).
			if (
				targetUserId !== userId &&
				!enforceKeyScope(request.user, "server.update")
			) {
				return reply.status(403).send({ error: "Forbidden" });
			}
			const revoked = revokeSftpToken(
				targetUserId,
				serverId,
				userId,
				canManageTokens,
			);

			if (!revoked) {
				return reply
					.status(404)
					.send({ error: "No active token found, or not authorized" });
			}

			reply.send({ success: true });
		},
	);

	// Revoke ALL SFTP tokens for a server (owner or panel-side manager)
	app.delete(
		"/api/sftp/tokens",
		{
			preHandler: [authenticate],
			config: { requiredPermission: "server.update" },
		},
		async (request: FastifyRequest, reply: FastifyReply) => {
			const userId = request.user?.userId;
			const serverId = (request.query as { serverId?: string }).serverId;

			if (!userId || !serverId) {
				return reply
					.status(400)
					.send({ error: "serverId query parameter is required" });
			}

			const server = await prisma.server.findUnique({
				where: { id: serverId },
				select: { ownerId: true, nodeId: true },
			});
			if (!server) {
				return reply.status(404).send({ error: "Server not found" });
			}

			// Server-scoped role resolution (mirrors the list/revoke routes).
			const rolePerms = await resolveServerPermissions(userId, serverId, server.nodeId);
			const canManageTokens = canManageTokensFor(server.ownerId === userId, rolePerms);
			if (!canManageTokens) {
				return reply
					.status(403)
					.send({ error: "Only the server owner can revoke all tokens" });
			}

			const count = revokeAllSftpTokensForServer(serverId);
			reply.send({ success: true, data: { revoked: count } });
		},
	);
}
