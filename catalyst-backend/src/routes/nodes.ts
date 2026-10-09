import { prisma } from "../db.js";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { v4 as uuidv4 } from "uuid";
import { randomBytes } from "crypto";
import { listAvailableIps, summarizePool, parseCidr, parseIp, formatIp } from "../utils/ipam";
import { serialize } from "../utils/serialize";
import { verifyAgentApiKey } from "../lib/agent-auth";
import { createApiKey, deleteApiKey } from "../services/api-key-service";
import { captureSystemError } from "../services/error-logger";
import { invalidateNodeAutoUpdateCache } from "../services/node-update-policy";
import { getUpdateStatus } from "../services/auto-updater";
import { getCurrentVersion } from "../lib/panel-version";
import { createAuditLog } from "../middleware/audit.js";
import { openSseStream } from "../utils/sse.js";
import { SERVER_CGROUP_MEMORY_SELECT, sumCgroupMemoryMb } from "../utils/java-memory.js";
import { apiError } from "../lib/http-error";
import { ErrorCodes } from "../shared-types";
import { config } from "../config.js";

// ID format validation — accepts UUID, Cuid2, and other safe identifier formats.
const ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

/** Ceiling for a single bulk auto-update selection change. */
const MAX_AUTO_UPDATE_BATCH = 200;

const validateOverallocatePercent = (value: unknown): number | null => {
	if (value === undefined || value === null) return null;
	if (!Number.isInteger(value) || (value as number) < -1) {
		return null;
	}
	return value as number;
};

import {
	hasGrant,
	hasNodeAccess,
	getUserAccessibleNodes,
	getNodeAssignments,
	assignNode,
	removeNodeAssignment,
	invalidateNodeAccessCache,
} from "../lib/permissions";
import { SimpleCache } from "../lib/cache";
import { broadcastCacheInvalidate, onCacheInvalidate } from "../lib/cache-bus";

// Pre-serialized node-list responses (GET /), 5s TTL. Node create/update/
// delete and assignment mutations flush it via the 'node-list' cache-bus
// channel; the TTL bounds drift for anything that only changes the per-node
// server _count (server create/delete elsewhere).
const nodeListCache = new SimpleCache<string, string>(5_000, 200);

function invalidateNodeListCache(): void {
	nodeListCache.clear();
	broadcastCacheInvalidate("node-list", { flushAll: true });
}

onCacheInvalidate("node-list", () => nodeListCache.clear());

const ensurePermission = (
	request: any,
	reply: FastifyReply,
	requiredPermission: string | string[],
): boolean => {
	const perms: string[] = request.user?.permissions ?? [];
	const required = Array.isArray(requiredPermission)
		? requiredPermission
		: [requiredPermission];
	// hasGrant: '*' passes everything, admin.write any concrete permission,
	// admin.read any read permission. Reading request.user.permissions makes
	// this the API-key scope ceiling for static-permission routes.
	if (required.some((permission) => hasGrant(perms, permission))) return true;
	apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, "Insufficient permissions");
	return false;
};

// Admin bits pass the request gate; every other caller needs node access
// (assignment, or the admin fast path inside hasNodeAccess — read mode
// also counts admin.read).
const hasNodeScope = async (
	request: any,
	nodeId: string,
	mode: "read" | "write",
): Promise<boolean> => {
	const perms: string[] = request.user?.permissions ?? [];
	if (hasGrant(perms, mode === "read" ? "admin.read" : "admin.write")) {
		return true;
	}
	return hasNodeAccess(prisma, request.user.userId, nodeId, mode);
};

// Hierarchy guard (audit/permission-audit/TARGET-VOCABULARY.md §2.7):
// assignments touching admin-tier principals are '*'-only to modify.
const assertCanAffectAssignmentTarget = async (
	request: any,
	targetType: "user" | "role",
	targetId: string,
	reply: FastifyReply,
): Promise<boolean> => {
	const actorPerms: string[] = request.user?.permissions ?? [];
	if (actorPerms.includes("*")) return true;
	const targetPerms =
		targetType === "user"
			? (
					await prisma.user.findUnique({
						where: { id: targetId },
						select: { roles: { select: { permissions: true } } },
					})
				)?.roles.flatMap((role) => role.permissions) ?? []
			: (
					await prisma.role.findUnique({
						where: { id: targetId },
						select: { permissions: true },
					})
				)?.permissions ?? [];
	if (targetPerms.includes("*") || targetPerms.includes("admin.write")) {
		apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, "Cannot modify admin-tier assignments");
		return false;
	}
	return true;
};

const PORT_FLOOR = 1024;
const PORT_CEIL = 65535;
const MAX_PORT_RANGE = 200;

const isValidPort = (value: number) =>
	Number.isInteger(value) && value >= PORT_FLOOR && value <= PORT_CEIL;

const parsePortRanges = (input: string): number[] => {
	const entries = input
		.split(/[,\s]+/)
		.map((entry) => entry.trim())
		.filter(Boolean);
	const ports = new Set<number>();
	for (const entry of entries) {
		if (entry.includes("-")) {
			const [startRaw, endRaw] = entry.split("-");
			const start = Number(startRaw);
			const end = Number(endRaw);
			if (!isValidPort(start) || !isValidPort(end) || start > end) {
				throw new Error(`Invalid port range: ${entry}`);
			}
			if (end - start + 1 > MAX_PORT_RANGE) {
				throw new Error(`Port range too large: ${entry}`);
			}
			for (let port = start; port <= end; port += 1) {
				ports.add(port);
			}
			continue;
		}
		const port = Number(entry);
		if (!isValidPort(port)) {
			throw new Error(`Invalid port: ${entry}`);
		}
		ports.add(port);
	}
	return Array.from(ports);
};

const MAX_CIDR_EXPAND = 5000;

const parseAllocationIps = async (input: string): Promise<string[]> => {
	const entries = input
		.split(/[,\s]+/)
		.map((entry) => entry.trim())
		.filter(Boolean);
	const ips: string[] = [];

	for (const entry of entries) {
		if (entry.includes("/")) {
			let range: ReturnType<typeof parseCidr>;
			try {
				range = parseCidr(entry);
			} catch {
				throw new Error(`Invalid CIDR: ${entry}`);
			}

			let count = 0;
			if (range.family === 'v6') {
				let value = range.start as bigint;
				const end = range.end as bigint;
				while (value <= end) {
					if (count >= MAX_CIDR_EXPAND) {
						throw new Error(`CIDR expansion too large: ${entry}`);
					}
					ips.push(formatIp(value, range.family));
					value += 1n;
					count++;
				}
			} else {
				for (let value = range.start as number; value <= (range.end as number); value += 1) {
					if (count >= MAX_CIDR_EXPAND) {
						throw new Error(`CIDR expansion too large: ${entry}`);
					}
					ips.push(formatIp(value, range.family));
					count++;
				}
			}
			continue;
		}

		try {
			parseIp(entry);
			ips.push(entry);
			continue;
		} catch {
			throw new Error(`Unsupported host entry: ${entry}`);
		}
	}
	return ips;
};

/**
 * Push node_updated to admin SSE after node-scoped edits (allocations,
 * agent config, host networking). The FE node_updated handler invalidates
 * the node + allocations queries keyed by nodeId.
 */
const pushNodeUpdated = (app: FastifyInstance, nodeId: string, userId: string, change: string): void => {
	try {
		app.wsGateway?.pushToAdminSubscribers?.("node_updated", {
			type: "node_updated",
			nodeId,
			change,
			updatedBy: userId,
			timestamp: new Date().toISOString(),
		});
	} catch {
		/* WS push is best-effort */
	}
};

/**
 * Push allocation CRUD events to admin SSE (P0-F). FE contract payload:
 * {type, nodeId, allocationIds?, timestamp}. allocationIds is omitted when
 * the write path doesn't produce ids (bulk createMany).
 */
const pushAllocationEvent = (
	app: FastifyInstance,
	type: "allocation_created" | "allocation_updated" | "allocation_deleted",
	nodeId: string,
	allocationIds?: string[],
): void => {
	try {
		app.wsGateway?.pushToAdminSubscribers?.(type, {
			type,
			nodeId,
			...(allocationIds ? { allocationIds } : {}),
			timestamp: new Date().toISOString(),
		});
	} catch {
		/* WS push is best-effort */
	}
};

// ── Shared agent-log tail plumbing ──────────────────────────────────────────
// One requestFromAgent poll per node every 2s, fanned out to every viewer
// (ref-counted). Viewers keep their own dedupe set so a joining viewer still
// receives the current log window as fresh lines. Per-worker maps/cap.
const MAX_AGENT_LOG_VIEWERS_PER_NODE = 20; // per worker

type AgentLogPusher = (kind: "logs" | "offline" | "error", logs: unknown[]) => void;

const agentLogStreams = new Map<
	string,
	{ pushers: Set<AgentLogPusher>; timer: ReturnType<typeof setInterval> }
>();

function createAgentLogStream(
	nodeId: string,
	gateway: { requestFromAgent: (nodeId: string, message: Record<string, unknown>) => Promise<any> },
	firstPusher: AgentLogPusher,
): { pushers: Set<AgentLogPusher>; timer: ReturnType<typeof setInterval> } {
	// The first pusher is registered synchronously so the initial pull below
	// never sees an empty stream (which would tear the loop down immediately).
	const entry = { pushers: new Set<AgentLogPusher>([firstPusher]), timer: undefined as unknown as ReturnType<typeof setInterval> };
	agentLogStreams.set(nodeId, entry);
	const cleanupIfEmpty = () => {
		if (entry.pushers.size === 0 && agentLogStreams.get(nodeId) === entry) {
			clearInterval(entry.timer);
			agentLogStreams.delete(nodeId);
		}
	};
	const pull = async () => {
		if (agentLogStreams.get(nodeId) !== entry) return;
		const broadcast = (kind: "logs" | "offline" | "error", logs: unknown[]) => {
			for (const p of [...entry.pushers]) {
				try {
					p(kind, logs);
				} catch {
					// Viewer socket died between pulls — drop it.
					entry.pushers.delete(p);
				}
			}
			cleanupIfEmpty();
		};
		try {
			const online = (await prisma.node.findUnique({ where: { id: nodeId }, select: { isOnline: true } }))?.isOnline;
			if (!online) {
				broadcast("offline", []);
				return;
			}
			const response = await gateway.requestFromAgent(nodeId, {
				type: "agent_logs",
				lines: 150,
			});
			const logs: unknown[] = Array.isArray(response?.logs) ? response.logs : [];
			broadcast("logs", logs);
		} catch {
			broadcast("error", []);
		}
	};
	entry.timer = setInterval(() => void pull(), 2000);
	void pull();
	return entry;
}

export async function nodeRoutes(app: FastifyInstance) {
	// Using shared prisma instance from db.ts

	// Update the automatic-agent-update opt-in for a set of nodes.
	//
	// Updating a node's agent can break a workload, so the panel no longer
	// updates every outdated node on its own. Admins approve nodes here; the
	// rest stay on "update available" until someone applies it manually via
	// POST /:nodeId/agent/update.
	app.patch(
		"/auto-update",
		{ schema: { summary: "Manage automatic updates", description: "Manage automatic updates.", tags: ["Nodes"], response: { 200: { type: "object", additionalProperties: true } } },  onRequest: [app.authenticate] },
		async (request: FastifyRequest, reply: FastifyReply) => {
			if (!ensurePermission(request, reply, "node.update")) return;

			const { nodeIds, enabled } = (request.body ?? {}) as {
				nodeIds?: unknown;
				enabled?: unknown;
			};

			if (!Array.isArray(nodeIds)) {
				return apiError(reply, 400, ErrorCodes.VALIDATION_ERROR, "nodeIds must be an array");
			}
			if (typeof enabled !== "boolean") {
				return apiError(reply, 400, ErrorCodes.VALIDATION_ERROR, "enabled must be a boolean");
			}

			const ids = Array.from(
				new Set(
					nodeIds
						.filter((id): id is string => typeof id === "string")
						.map((id) => id.trim())
						.filter((id) => ID_PATTERN.test(id)),
				),
			);
			if (ids.length !== nodeIds.length || ids.length === 0) {
				return apiError(reply, 400, ErrorCodes.VALIDATION_ERROR, "nodeIds must be a non-empty list of valid node ids");
			}
			if (ids.length > MAX_AUTO_UPDATE_BATCH) {
				return apiError(reply, 400, ErrorCodes.VALIDATION_ERROR, `At most ${MAX_AUTO_UPDATE_BATCH} nodes can be changed at once`);
			}

			const found = await prisma.node.findMany({
				where: { id: { in: ids } },
				select: { id: true, name: true },
			});
			if (found.length !== ids.length) {
				return apiError(reply, 404, ErrorCodes.NODE_NOT_FOUND, "One or more nodes were not found");
			}

			const result = await prisma.node.updateMany({
				where: { id: { in: ids } },
				data: { autoUpdateEnabled: enabled },
			});

			// The gateway caches this flag per node; drop it so the change bites
			// on the next health report instead of after the TTL.
			for (const id of ids) invalidateNodeAutoUpdateCache(id);

			await createAuditLog(request.user.userId, {
				action: "node.auto_update.update",
				resource: "node",
				resourceId: ids.length === 1 ? ids[0] : undefined,
				request,
				details: {
					nodeIds: ids,
					nodeNames: found.map((node) => node.name),
					autoUpdateEnabled: enabled,
					updated: result.count,
				},
			});

			// Best-effort fan-out so open panels re-render the new selection.
			const gateway = app.wsGateway;
			try {
				gateway?.pushToAdminSubscribers?.("node_updated", {
					type: "node_updated",
					nodeIds: ids,
					updatedBy: request.user.userId,
					timestamp: new Date().toISOString(),
				});
			} catch {
				/* non-fatal */
			}

			reply.send({ success: true, data: { updated: result.count, enabled } });
		},
	);

	// Create node
	app.post(
		"/",
		{ schema: { summary: "Retrieve nodes", description: "Retrieve nodes.", tags: ["Nodes"], response: { 200: { type: "object", additionalProperties: true } } },  onRequest: [app.authenticate] },
		async (request: FastifyRequest, reply: FastifyReply) => {
			if (!ensurePermission(request, reply, "node.create")) return;
			const {
				name,
				description,
				locationId,
				hostname,
				publicAddress,
				maxMemoryMb,
				maxCpuCores,
				serverDataDir,
				consoleLogDir,
				cniDir,
				cniBinDir,
				cniDataDir,
				cniResultsDir,
				cniBridgeName,
				cniBridgeSubnet,
				systemdOverrideDir,
				agentConfigPath,
				agentReleaseRepo,
				memoryOverallocatePercent,
				cpuOverallocatePercent,
				sftpPort,
				sftpEnabled,
			} = request.body as {
				name: string;
				description?: string;
				locationId: string;
				hostname: string;
				publicAddress: string;
				maxMemoryMb: number;
				maxCpuCores: number;
				serverDataDir?: string;
				consoleLogDir?: string;
				cniDir?: string;
				cniBinDir?: string;
				cniDataDir?: string;
				cniResultsDir?: string;
				cniBridgeName?: string;
				cniBridgeSubnet?: string;
				systemdOverrideDir?: string;
				agentConfigPath?: string;
				agentReleaseRepo?: string;
				memoryOverallocatePercent?: number;
				cpuOverallocatePercent?: number;
				sftpPort?: number;
				sftpEnabled?: boolean;
			};

			// Validate required fields
			if (
				!name ||
				!locationId ||
				!hostname ||
				!publicAddress ||
				!maxMemoryMb ||
				!maxCpuCores
			) {
				return apiError(reply, 400, ErrorCodes.VALIDATION_ERROR, "Missing required fields");
			}

			// Validate positive values
			if (maxMemoryMb <= 0) {
				return apiError(reply, 400, ErrorCodes.VALIDATION_ERROR, "maxMemoryMb must be positive");
			}

			if (maxCpuCores <= 0) {
				return apiError(reply, 400, ErrorCodes.VALIDATION_ERROR, "maxCpuCores must be positive");
			}

			let validatedMemoryOverallocatePercent = 0;
			let validatedCpuOverallocatePercent = 0;

			if (memoryOverallocatePercent !== undefined) {
				const validated = validateOverallocatePercent(memoryOverallocatePercent);
				if (validated === null) {
					return apiError(reply, 400, ErrorCodes.VALIDATION_ERROR, "memoryOverallocatePercent must be an integer >= -1");
				}
				validatedMemoryOverallocatePercent = validated;
			}
			if (cpuOverallocatePercent !== undefined) {
				const validated = validateOverallocatePercent(cpuOverallocatePercent);
				if (validated === null) {
					return apiError(reply, 400, ErrorCodes.VALIDATION_ERROR, "cpuOverallocatePercent must be an integer >= -1");
				}
				validatedCpuOverallocatePercent = validated;
			}

			// Check for duplicate name
			const existingNode = await prisma.node.findFirst({
				where: { name },
			});

			if (existingNode) {
				return apiError(reply, 400, ErrorCodes.NODE_NAME_TAKEN, "Node name already exists");
			}

			const location = await prisma.location.findUnique({
				where: { id: locationId },
			});

			if (!location) {
				return apiError(reply, 404, ErrorCodes.LOCATION_NOT_FOUND, "Location not found");
			}

			const secret = randomBytes(32).toString("hex");

			const node = await prisma.node.create({
				data: {
					name,
					description,
					locationId,
					hostname,
					publicAddress,
					secret,
					maxMemoryMb,
					maxCpuCores,
					sftpPort: sftpPort ?? 2022,
					sftpEnabled: sftpEnabled ?? true,
					serverDataDir: serverDataDir || undefined,
					consoleLogDir: consoleLogDir || undefined,
					cniDir: cniDir || undefined,
					cniBinDir: cniBinDir || undefined,
					cniDataDir: cniDataDir || undefined,
					cniResultsDir: cniResultsDir || undefined,
					cniBridgeName: cniBridgeName || undefined,
					cniBridgeSubnet: cniBridgeSubnet || undefined,
					systemdOverrideDir: systemdOverrideDir || undefined,
					agentConfigPath: agentConfigPath || undefined,
					agentReleaseRepo: agentReleaseRepo || undefined,
					memoryOverallocatePercent: validatedMemoryOverallocatePercent,
					cpuOverallocatePercent: validatedCpuOverallocatePercent,
				},
			});

			// A new node changes wildcard-assignment reachability — evict
			// node-access caches so accessible-node lists include it now.
			invalidateNodeAccessCache();
			invalidateNodeListCache();

			// Log warning about wildcard node assignments if any exist
			const wildcardAssignments = await prisma.nodeAssignment.findMany({
				where: {
					nodeId: null,
					OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
				},
				include: {
					user: { select: { id: true, email: true } },
					role: { select: { id: true, name: true } },
				},
			});

			if (wildcardAssignments.length > 0) {
				request.log.warn(
					{
						nodeId: node.id,
						nodeName: node.name,
						wildcardUsers: wildcardAssignments
							.filter((a) => a.userId)
							.map((a) => a.user?.email || a.userId),
						wildcardRoles: wildcardAssignments
							.filter((a) => a.roleId)
							.map((a) => a.role?.name || a.roleId),
					},
					"Node created with existing wildcard node assignments - users/roles may have implicit access",
				);

				// Audit log the security event
				await createAuditLog(request.user.userId, {
					action: "node.created.wildcard_warning",
					resource: "node",
					resourceId: node.id,
					request,
					details: {
						nodeName: node.name,
						locationId,
						wildcardAssignmentCount: wildcardAssignments.length,
						wildcardUsers: wildcardAssignments
							.filter((a) => a.userId)
							.map((a) => a.user?.email || a.userId),
						wildcardRoles: wildcardAssignments
							.filter((a) => a.roleId)
							.map((a) => a.role?.name || a.roleId),
						message:
							"Node created while wildcard assignments exist - users/roles may have implicit access",
					},
				});
			}

			const { secret: _secret, ...safeNode } = node;
			reply.send(serialize({ success: true, data: safeNode }));

			// Broadcast node_created event
			const wsGatewayNodeCreated = app.wsGateway;
			if (wsGatewayNodeCreated?.pushToAdminSubscribers) {
				wsGatewayNodeCreated.pushToAdminSubscribers('node_created', {
					type: 'node_created',
					nodeId: node.id,
					nodeName: node.name,
					locationId,
					createdBy: request.user.userId,
					timestamp: new Date().toISOString(),
				});
			}
		},
	);

	// List nodes
	app.get(
		"/",
		{ schema: { summary: "Retrieve nodes", description: "Retrieve nodes.", tags: ["Nodes"], response: { 200: { type: "object", additionalProperties: true } } },  onRequest: [app.authenticate] },
		async (request: FastifyRequest, reply: FastifyReply) => {
			if (!ensurePermission(request, reply, "node.read")) return;

			const userId = request.user.userId;

			// Admins (admin.read+) see all nodes
			const perms: string[] = request.user?.permissions ?? [];
			const isAdmin = hasGrant(perms, "admin.read");

			// Short TTL on the pre-serialized response: this list is polled by
			// the dashboard and each node card, and every miss pays a findMany
			// with a _count GROUP BY per node. Mutations flush it via the
			// 'node-list' cache-bus channel; the 5s TTL bounds any drift.
			const cacheKey = isAdmin ? "admin" : `user:${userId}`;
			const cached = nodeListCache.get(cacheKey);
			if (cached !== undefined) {
				reply.header("X-Cache", "HIT");
				reply.header("content-type", "application/json; charset=utf-8");
				return reply.send(cached);
			}

			let nodes;
			if (isAdmin) {
				// Admins see all nodes
				nodes = await prisma.node.findMany({
					omit: { secret: true },
					include: {
						_count: {
							select: { servers: true },
						},
						location: { select: { id: true, name: true } },
					},
				});
			} else {
				// Non-admins only see nodes they have access to
				const accessibleResult = await getUserAccessibleNodes(prisma, userId);
				nodes = await prisma.node.findMany({
					where: {
						id: { in: accessibleResult.nodeIds },
					},
					omit: { secret: true },
					include: {
						_count: {
							select: { servers: true },
						},
						location: { select: { id: true, name: true } },
					},
				});
			}

			const responseStr = JSON.stringify(serialize({ success: true, data: nodes }));
			nodeListCache.set(cacheKey, responseStr);
			reply.header("X-Cache", "MISS");
			reply.header("content-type", "application/json; charset=utf-8");
			reply.send(responseStr);
		},
	);

	// Get node details
	app.get(
		"/:nodeId",
		{ schema: { summary: "Retrieve nodes", description: "Retrieve nodes.", tags: ["Nodes"], params: { type: "object", required: ['nodeId'], properties: { nodeId: { type: "string" } } }, response: { 200: { type: "object", additionalProperties: true } } },  onRequest: [app.authenticate] },
		async (request: FastifyRequest, reply: FastifyReply) => {
			if (!ensurePermission(request, reply, "node.read")) return;
			const { nodeId } = request.params as { nodeId: string };
			const { page, limit } = request.query as { page?: number | string; limit?: number | string };
			const paginated = page !== undefined || limit !== undefined;
			const pageNumber = Math.max(1, Number(page ?? 1) || 1);
			const pageSize = Math.min(100, Math.max(1, Number(limit ?? 50) || 50));

			// Admin bits see every node; everyone else needs node access.
			if (!(await hasNodeScope(request, nodeId, "read"))) {
				return apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, "You don't have access to this node");
			}

			const node = await prisma.node.findUnique({
				where: { id: nodeId },
				omit: { secret: true },
				include: {
					servers: {
						...(paginated ? { skip: (pageNumber - 1) * pageSize, take: pageSize } : {}),
						select: {
							id: true,
							uuid: true,
							name: true,
							status: true,
						},
					},
				},
			});

			if (!node) {
				return apiError(reply, 404, ErrorCodes.NODE_NOT_FOUND, "Node not found");
			}
			const total = paginated ? await prisma.server.count({ where: { nodeId } }) : 0;
			reply.send(serialize({
				success: true,
				data: node,
				...(paginated
					? { pagination: { page: pageNumber, limit: pageSize, total, totalPages: Math.ceil(total / pageSize) } }
					: {}),
			}));
		},
	);

	// Generate deployment token
	app.post(
		"/:nodeId/deployment-token",
		{ schema: { summary: "Generate a deployment token", description: "Generate a deployment token.", tags: ["Nodes"], params: { type: "object", required: ['nodeId'], properties: { nodeId: { type: "string" } } }, response: { 200: { type: "object", additionalProperties: true } } },  onRequest: [app.authenticate] },
		async (request: FastifyRequest, reply: FastifyReply) => {
			if (!ensurePermission(request, reply, "node.server_manage")) return;
			const { nodeId } = request.params as { nodeId: string };

			// SECURITY: the deployment flow provisions an agent API key for this
			// node. Require the node-manage path (write-admin, or node
			// assignment + node.server_manage — hasGrant honors the legacy
			// node.update grant), not just a catalog create permission.
			const { resolveServerPermissions } = await import(
				"../lib/permissions-catalog.js"
			);
			const rolePerms = await resolveServerPermissions(
				request.user.userId,
				"",
				nodeId,
			);
			const nodeManageAllowed =
				(await hasNodeAccess(prisma, request.user.userId, nodeId)) &&
				hasGrant(rolePerms, "node.server_manage");
			if (!nodeManageAllowed) {
				return apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, "Node management access required");
			}

			const node = await prisma.node.findUnique({
				where: { id: nodeId },
			});

			if (!node) {
				return apiError(reply, 404, ErrorCodes.NODE_NOT_FOUND, "Node not found");
			}

			const token = randomBytes(32).toString("hex");
			const secret = randomBytes(32).toString("hex");
			const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

			const deploymentToken = await prisma.deploymentToken.create({
				data: {
					nodeId,
					token,
					secret,
					expiresAt,
				},
			});

			const deployUrl = `${config.backend.url || config.backend.externalAddress}/api/deploy/${token}`;
			let apiKey = "";
			try {
				const apiKeyResponse = await createApiKey({
					name: `agent-${nodeId.slice(0, 8)}`,
					userId: request.user.userId,
					prefix: "catalyst",
					metadata: {
						nodeId,
						purpose: "agent",
					},
				});
				apiKey = apiKeyResponse.key;
				if (!apiKey) {
					request.log.error(
						{ nodeId },
						"Failed to create agent API key for deployment",
					);
					captureSystemError({
						level: 'error',
						component: 'NodeService',
						message: 'Failed to create agent API key for deployment',
						metadata: { nodeId },
					}).catch(() => {});
					return apiError(reply, 500, ErrorCodes.INTERNAL_ERROR, "Failed to create agent API key");
				}
			} catch (error) {
				request.log.error(
					{ error, nodeId },
					"Failed to create agent API key for deployment",
				);
				captureSystemError({
					level: 'error',
					component: 'NodeService',
					message: 'Failed to create agent API key for deployment',
					stack: (error as Error)?.stack,
					metadata: { nodeId },
				}).catch(() => {});
				return apiError(reply, 500, ErrorCodes.INTERNAL_ERROR, "Failed to create agent API key");
			}

			reply.send({
				success: true,
				data: {
					deploymentToken: deploymentToken.token,
					apiKey,
					deployUrl,
					expiresAt,
				},
			});
		},
	);

	// Check if API key exists for agent
	app.get(
		"/:nodeId/api-key",
		{ schema: { summary: "Manage the node API key", description: "Manage the node API key.", tags: ["Nodes"], params: { type: "object", required: ['nodeId'], properties: { nodeId: { type: "string" } } }, response: { 200: { type: "object", additionalProperties: true } } },  onRequest: [app.authenticate] },
		async (request: FastifyRequest, reply: FastifyReply) => {
			if (!ensurePermission(request, reply, "node.read")) return;
			const { nodeId } = request.params as { nodeId: string };
			if (!(await hasNodeScope(request, nodeId, "read"))) {
				return apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, "Insufficient permissions");
			}

			const node = await prisma.node.findUnique({
				where: { id: nodeId },
			});

			if (!node) {
				return apiError(reply, 404, ErrorCodes.NODE_NOT_FOUND, "Node not found");
			}

			// Find existing API key for this node via JSON path query
			const existingKey = await prisma.apikey.findFirst({
				where: {
					metadata: {
						path: ["nodeId"],
						equals: nodeId,
					},
				},
				select: {
					id: true,
					name: true,
					start: true,
					prefix: true,
					createdAt: true,
					enabled: true,
					requestCount: true,
					lastRequest: true,
				},
			});

			reply.send({
				success: true,
				data: {
					exists: !!existingKey,
					apiKey: existingKey
						? {
								id: existingKey.id,
								name: existingKey.name,
								preview: existingKey.start
									? `${existingKey.start}${"*".repeat(40)}`
									: null,
								createdAt: existingKey.createdAt,
								enabled: existingKey.enabled,
								requestCount: existingKey.requestCount,
								lastRequest: existingKey.lastRequest,
							}
						: null,
				},
			});
		},
	);

	// Generate API key for agent
	app.post(
		"/:nodeId/api-key",
		{ schema: { summary: "Manage the node API key", description: "Manage the node API key.", tags: ["Nodes"], params: { type: "object", required: ['nodeId'], properties: { nodeId: { type: "string" } } }, response: { 200: { type: "object", additionalProperties: true } } },  onRequest: [app.authenticate] },
		async (request: FastifyRequest, reply: FastifyReply) => {
			if (!ensurePermission(request, reply, "node.server_manage")) return;
			const { nodeId } = request.params as { nodeId: string };
			const { regenerate } = (request.body as { regenerate?: boolean }) || {};

			// SECURITY: minting an agent API key makes the caller a valid agent
			// for this node (verifyAgentApiKey keys on nodeId+key). Require the
			// node-manage path (write-admin, or node assignment +
			// node.server_manage — hasGrant honors the legacy node.update
			// grant), not just a catalog create permission.
			const { resolveServerPermissions } = await import(
				"../lib/permissions-catalog.js"
			);
			const rolePerms = await resolveServerPermissions(
				request.user.userId,
				"",
				nodeId,
			);
			const nodeManageAllowed =
				(await hasNodeAccess(prisma, request.user.userId, nodeId)) &&
				hasGrant(rolePerms, "node.server_manage");
			if (!nodeManageAllowed) {
				return apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, "Node management access required");
			}

			const node = await prisma.node.findUnique({
				where: { id: nodeId },
			});

			if (!node) {
				return apiError(reply, 404, ErrorCodes.NODE_NOT_FOUND, "Node not found");
			}

			// Check for existing API key
			// Check for existing API key via JSON path query
			const existingKey = await prisma.apikey.findFirst({
				where: {
					metadata: {
						path: ["nodeId"],
						equals: nodeId,
					},
				},
			});

			if (existingKey && !regenerate) {
				return reply.status(409).send({
					error: "API key already exists for this node",
					code: ErrorCodes.NODE_API_KEY_EXISTS,
					existingKeyId: existingKey.id,
					existingKeyPreview: existingKey.start
						? `${existingKey.start}${"*".repeat(40)}`
						: null,
				});
			}

			// If regenerating, delete the old key first
			if (existingKey && regenerate) {
				try {
					await deleteApiKey(existingKey.id);
					request.log.info(
						{ keyId: existingKey.id, nodeId },
						"Deleted old API key for regeneration",
					);
					// F18: same payload shape as routes/api-keys.ts delete.
					try {
						(app as any).wsGateway?.pushToAdminSubscribers?.("api_key_deleted", {
							type: "api_key_deleted",
							keyId: existingKey.id,
							keyName: existingKey.name,
							deletedBy: request.user.userId,
							timestamp: new Date().toISOString(),
						});
					} catch {
						/* WS push is best-effort */
					}
				} catch (error) {
					captureSystemError({
						level: 'error',
						component: 'NodeRoutes',
						message: error instanceof Error ? error.message : 'Failed to delete old API key',
						stack: error instanceof Error ? error.stack : undefined,
						metadata: { keyId: existingKey.id, context: 'api_key_delete' },
					}).catch(() => {});
					request.log.error(
						{ error, keyId: existingKey.id },
						"Failed to delete old API key",
					);
					return apiError(reply, 500, ErrorCodes.INTERNAL_ERROR, "Failed to delete old API key");
				}
			}

			try {
				const apiKeyResponse = await createApiKey({
					name: `agent-${nodeId.slice(0, 8)}`,
					userId: request.user.userId,
					prefix: "catalyst",
					metadata: {
						nodeId,
						purpose: "agent",
					},
				});
				request.log.info({ nodeId }, "API key created");
				const apiKey = apiKeyResponse.key;
				if (!apiKey) {
					return apiError(reply, 500, ErrorCodes.INTERNAL_ERROR, "Failed to create API key");
				}

				// F18: same payload shape as routes/api-keys.ts create.
				try {
					app.wsGateway?.pushToAdminSubscribers?.("api_key_created", {
						type: "api_key_created",
						keyId: apiKeyResponse.id,
						keyName: apiKeyResponse.name ?? `agent-${nodeId.slice(0, 8)}`,
						createdBy: request.user.userId,
						timestamp: new Date().toISOString(),
					});
				} catch {
					/* WS push is best-effort */
				}

				reply.send({
					success: true,
					data: {
						apiKey,
						nodeId,
						regenerated: !!regenerate,
					},
				});
			} catch (error) {
				request.log.error({ error, nodeId }, "Failed to create agent API key");
				captureSystemError({
					level: 'error',
					component: 'NodeService',
					message: 'Failed to create agent API key',
					stack: (error as Error)?.stack,
					metadata: { nodeId },
				}).catch(() => {});
				return apiError(reply, 500, ErrorCodes.INTERNAL_ERROR, "Failed to create API key");
			}
		},
	);

	// Update node configuration
	app.put(
		"/:nodeId",
		{ schema: { summary: "Retrieve nodes", description: "Retrieve nodes.", tags: ["Nodes"], params: { type: "object", required: ['nodeId'], properties: { nodeId: { type: "string" } } }, response: { 200: { type: "object", additionalProperties: true } } },  onRequest: [app.authenticate] },
		async (request: FastifyRequest, reply: FastifyReply) => {
			if (!ensurePermission(request, reply, "node.update")) return;
			const { nodeId } = request.params as { nodeId: string };
			if (!(await hasNodeScope(request, nodeId, "write"))) {
				return apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, "Insufficient permissions");
			}
			const {
				name,
				description,
				hostname,
				publicAddress,
				maxMemoryMb,
				maxCpuCores,
				serverDataDir,
				consoleLogDir,
				cniDir,
				cniBinDir,
				cniDataDir,
				cniResultsDir,
				cniBridgeName,
				cniBridgeSubnet,
				systemdOverrideDir,
				agentConfigPath,
				agentReleaseRepo,
				memoryOverallocatePercent,
				cpuOverallocatePercent,
				sftpPort,
				sftpEnabled,
			} = request.body as {
				name?: string;
				description?: string;
				hostname?: string;
				publicAddress?: string;
				maxMemoryMb?: number;
				maxCpuCores?: number;
				serverDataDir?: string;
				consoleLogDir?: string;
				cniDir?: string;
				cniBinDir?: string;
				cniDataDir?: string;
				cniResultsDir?: string;
				cniBridgeName?: string;
				cniBridgeSubnet?: string;
				systemdOverrideDir?: string;
				agentConfigPath?: string;
				agentReleaseRepo?: string;
				memoryOverallocatePercent?: number;
				cpuOverallocatePercent?: number;
				sftpPort?: number;
				sftpEnabled?: boolean;
			};

			const node = await prisma.node.findUnique({
				where: { id: nodeId },
			});

			if (!node) {
				return apiError(reply, 404, ErrorCodes.NODE_NOT_FOUND, "Node not found");
			}

			// Validate inputs
			if (maxMemoryMb !== undefined && maxMemoryMb <= 0) {
				return apiError(reply, 400, ErrorCodes.VALIDATION_ERROR, "maxMemoryMb must be positive");
			}

			if (maxCpuCores !== undefined && maxCpuCores <= 0) {
				return apiError(reply, 400, ErrorCodes.VALIDATION_ERROR, "maxCpuCores must be positive");
			}

			if (memoryOverallocatePercent !== undefined) {
				const validated = validateOverallocatePercent(memoryOverallocatePercent);
				if (validated === null) {
					return apiError(reply, 400, ErrorCodes.VALIDATION_ERROR, "memoryOverallocatePercent must be an integer >= -1");
				}
			}
			if (cpuOverallocatePercent !== undefined) {
				const validated = validateOverallocatePercent(cpuOverallocatePercent);
				if (validated === null) {
					return apiError(reply, 400, ErrorCodes.VALIDATION_ERROR, "cpuOverallocatePercent must be an integer >= -1");
				}
			}

			// Check for duplicate name
			if (name && name !== node.name) {
				const existing = await prisma.node.findFirst({
					where: { name, id: { not: nodeId } },
				});
				if (existing) {
					return apiError(reply, 400, ErrorCodes.NODE_NAME_TAKEN, "Node name already exists");
				}
			}

			const updated = await prisma.node.update({
				where: { id: nodeId },
				data: {
					name,
					description,
					hostname,
					publicAddress,
					maxMemoryMb,
					maxCpuCores,
					serverDataDir,
					consoleLogDir,
					cniDir,
					cniBinDir,
					cniDataDir,
					cniResultsDir,
					cniBridgeName,
					cniBridgeSubnet,
					systemdOverrideDir,
					agentConfigPath,
					agentReleaseRepo,
					memoryOverallocatePercent,
					cpuOverallocatePercent,
					sftpPort,
					sftpEnabled,
				},
			});

			// SECURITY: never echo the node secret back — every GET route omits
			// it via `omit: { secret: true }`; the update response must match.
			invalidateNodeListCache();
			reply.send(
				serialize({ success: true, data: { ...updated, secret: undefined } })
			);

			// Broadcast node_updated event
			const wsGatewayNodeUpdated = app.wsGateway;
			if (wsGatewayNodeUpdated?.pushToAdminSubscribers) {
				wsGatewayNodeUpdated.pushToAdminSubscribers('node_updated', {
					type: 'node_updated',
					nodeId,
					updatedBy: request.user.userId,
					timestamp: new Date().toISOString(),
				});
			}
		},
	);

	// Get node statistics
	app.get(
		"/:nodeId/stats",
		{ schema: { summary: "View node statistics", description: "View node statistics.", tags: ["Nodes"], params: { type: "object", required: ['nodeId'], properties: { nodeId: { type: "string" } } }, response: { 200: { type: "object", additionalProperties: true } } },  onRequest: [app.authenticate] },
		async (request: FastifyRequest, reply: FastifyReply) => {
			if (!ensurePermission(request, reply, "node.view_stats")) return;
			const { nodeId } = request.params as { nodeId: string };

			// node.view_stats holders need node access; admin bits read stats
			// for every node without an assignment.
			if (!(await hasNodeScope(request, nodeId, "read"))) {
				return apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, "You don't have access to this node");
			}

			const node = await prisma.node.findUnique({
				where: { id: nodeId },
				include: {
					servers: {
						select: {
							id: true,
							status: true,
							allocatedCpuCores: true,
							...SERVER_CGROUP_MEMORY_SELECT,
						},
					},
				},
			});

			if (!node) {
				return apiError(reply, 404, ErrorCodes.NODE_NOT_FOUND, "Node not found");
			}

			// Calculate resource usage
			const totalAllocatedMemory = sumCgroupMemoryMb(node.servers);
			const totalAllocatedCpu = node.servers.reduce(
				(sum, server) => sum + (server.allocatedCpuCores || 0),
				0,
			);

			const effectiveMaxMemoryMb = node.memoryOverallocatePercent === -1
				? Infinity
				: Math.floor(node.maxMemoryMb * (1 + node.memoryOverallocatePercent / 100));
			const effectiveMaxCpuCores = node.cpuOverallocatePercent === -1
				? Infinity
				: node.maxCpuCores * (1 + node.cpuOverallocatePercent / 100);

			const availableMemoryMb = effectiveMaxMemoryMb === Infinity
				? Infinity
				: effectiveMaxMemoryMb - totalAllocatedMemory;
			const availableCpuCores = effectiveMaxCpuCores === Infinity
				? Infinity
				: effectiveMaxCpuCores - totalAllocatedCpu;

			// Allocation ratios, not measured usage: live host percentages come
			// from the actual* fields below (agent health_report).
			const memoryUsagePercent = effectiveMaxMemoryMb === Infinity
				? 0
				: (totalAllocatedMemory / effectiveMaxMemoryMb) * 100;
			const cpuUsagePercent = effectiveMaxCpuCores === Infinity
				? 0
				: (totalAllocatedCpu / effectiveMaxCpuCores) * 100;

			const runningServers = node.servers.filter(
				(s) => s.status === "running" || s.status === "starting",
			).length;

			// Get latest metrics from database
			const latestMetrics = await prisma.nodeMetrics.findFirst({
				where: { nodeId },
				orderBy: { timestamp: "desc" },
			});

			reply.send({
				success: true,
				data: {
					nodeId,
					isOnline: node.isOnline,
					lastSeenAt: node.lastSeenAt,
					resources: {
						maxMemoryMb: node.maxMemoryMb,
						maxCpuCores: node.maxCpuCores,
						memoryOverallocatePercent: node.memoryOverallocatePercent,
						cpuOverallocatePercent: node.cpuOverallocatePercent,
						effectiveMaxMemoryMb,
						effectiveMaxCpuCores,
						allocatedMemoryMb: totalAllocatedMemory,
						allocatedCpuCores: totalAllocatedCpu,
						availableMemoryMb,
						availableCpuCores,
						memoryUsagePercent,
						cpuUsagePercent,
						// Real-time metrics from agent
						actualMemoryUsageMb: latestMetrics?.memoryUsageMb || 0,
						actualMemoryTotalMb:
							latestMetrics?.memoryTotalMb || node.maxMemoryMb,
						actualCpuPercent: latestMetrics?.cpuPercent || 0,
						actualDiskUsageMb: latestMetrics?.diskUsageMb || 0,
						actualDiskTotalMb: latestMetrics?.diskTotalMb || 0,
					},
					servers: {
						total: node.servers.length,
						running: runningServers,
						stopped: node.servers.filter((s) => s.status === "stopped").length,
					},
					lastMetricsUpdate: latestMetrics?.timestamp || null,
					agentVersion: node.agentVersion || null,
					agentUpdateAvailable: node.agentVersion
						? (() => {
								const agentVersion = node.agentVersion;
								if (!agentVersion) return null;
								const agentParts = agentVersion.replace(/^v/, "").split(".").map(Number);
								const latestTag = getUpdateStatus().latestVersion;
								if (!latestTag) return null; // unknown — haven't checked yet
								const latestParts = latestTag.replace(/^v/, "").split(".").map(Number);
								const maxLen = Math.max(agentParts.length, latestParts.length);
								for (let i = 0; i < maxLen; i++) {
									const cur = agentParts[i] || 0;
									const lat = latestParts[i] || 0;
									if (lat > cur) return true;
									if (lat < cur) return false;
								}
								return false;
							})()
						: null,
					latestAgentVersion: getUpdateStatus().latestVersion || null,
				},
			});
		},
	);

	// Update node status (called by agent via heartbeat)
	app.post(
		"/:nodeId/heartbeat",
		{ schema: { summary: "Record a node heartbeat", description: "Record a node heartbeat.", tags: ["Nodes"], params: { type: "object", required: ['nodeId'], properties: { nodeId: { type: "string" } } }, response: { 200: { type: "object", additionalProperties: true } } },  config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
		async (request: FastifyRequest, reply: FastifyReply) => {
			const { nodeId } = request.params as { nodeId: string };
			const { health } = request.body as {
				health: {
					cpuPercent: number;
					memoryUsageMb: number;
					memoryTotalMb?: number;
					diskUsageMb?: number;
					diskTotalMb?: number;
					containerCount: number;
					networkRxBytes?: number;
					networkTxBytes?: number;
				};
			};

			const headerApiKey =
				typeof request.headers["x-node-api-key"] === "string"
					? request.headers["x-node-api-key"].trim()
					: typeof request.headers["x-catalyst-node-token"] === "string"
						? request.headers["x-catalyst-node-token"].trim()
						: "";
			const authHeader =
				typeof request.headers.authorization === "string"
					? request.headers.authorization.trim()
					: "";
			const bearerApiKey = authHeader.toLowerCase().startsWith("bearer ")
				? authHeader.slice(7).trim()
				: "";
			const apiKey = headerApiKey || bearerApiKey;

			if (!apiKey) {
				return apiError(reply, 401, ErrorCodes.UNAUTHORIZED, "Unauthorized");
			}

			const apiKeyValid = await verifyAgentApiKey(prisma, nodeId, apiKey);
			if (!apiKeyValid) {
				return apiError(reply, 401, ErrorCodes.UNAUTHORIZED, "Unauthorized");
			}

			const node = await prisma.node.findUnique({
				where: { id: nodeId },
			});

			if (!node) {
				return apiError(reply, 401, ErrorCodes.UNAUTHORIZED, "Unauthorized");
			}

			const INT4_MAX = 2_147_483_647;
			const INT8_MAX = 9_223_372_036_854_775_807n;
			const clampInt4 = (n: number, fallback = 0) =>
				!Number.isFinite(n) ? fallback : Math.min(INT4_MAX, Math.max(0, Math.round(n)));
			const toByteCounter = (v: unknown): bigint => {
				const n = Number(v);
				if (!Number.isFinite(n) || n <= 0) return 0n;
				const bytes = BigInt(Math.floor(n));
				return bytes > INT8_MAX ? INT8_MAX : bytes;
			};
			const cpuPercent = !Number.isFinite(Number(health?.cpuPercent))
				? 0
				: Math.min(100, Math.max(0, Number(health.cpuPercent)));
			const memoryUsageMb = clampInt4(Number(health?.memoryUsageMb));
			const memoryTotalMb = clampInt4(Number(health?.memoryTotalMb ?? node.maxMemoryMb), node.maxMemoryMb);
			const diskUsageMb = clampInt4(Number(health?.diskUsageMb ?? 0));
			const diskTotalMb = clampInt4(Number(health?.diskTotalMb ?? 0));
			const containerCount = Number(health?.containerCount);
			const networkRxBytes = toByteCounter(health?.networkRxBytes);
			const networkTxBytes = toByteCounter(health?.networkTxBytes);

			if (
				!Number.isFinite(cpuPercent) ||
				!Number.isFinite(memoryUsageMb) ||
				!Number.isFinite(memoryTotalMb) ||
				!Number.isFinite(diskUsageMb) ||
				!Number.isFinite(diskTotalMb) ||
				!Number.isFinite(containerCount)
			) {
				return apiError(reply, 400, ErrorCodes.VALIDATION_ERROR, "Invalid health payload");
			}

			await prisma.node.update({
				where: { id: nodeId },
				data: {
					isOnline: true,
					lastSeenAt: new Date(),
				},
			});

			await prisma.nodeMetrics.create({
				data: {
					nodeId,
					cpuPercent,
					memoryUsageMb: Math.round(memoryUsageMb),
					memoryTotalMb: Math.round(memoryTotalMb),
					diskUsageMb: Math.round(diskUsageMb),
					diskTotalMb: Math.round(diskTotalMb),
					networkRxBytes,
					networkTxBytes,
					containerCount: Math.max(0, Math.round(containerCount)),
				},
			});

			// P1-32: fan out node liveness + metrics so admin dashboards refresh
			// on the HTTP heartbeat path too. Payload mirrors the gateway's WS
			// health_report emission (node_metrics_updated); uptimeSeconds is
			// not part of the HTTP heartbeat body and is omitted.
			try {
				const wsGateway = app.wsGateway;
				wsGateway?.pushToAdminSubscribers?.("node_updated", {
					type: "node_updated",
					nodeId,
					isOnline: true,
					timestamp: Date.now(),
				});
				wsGateway?.pushToAdminSubscribers?.("node_metrics_updated", {
					type: "node_metrics_updated",
					nodeId,
					isOnline: true,
					agentVersion: node.agentVersion ?? undefined,
					cpuPercent,
					memoryUsageMb: Math.round(memoryUsageMb),
					memoryTotalMb: Math.round(memoryTotalMb),
					diskUsageMb: Math.round(diskUsageMb),
					diskTotalMb: Math.round(diskTotalMb),
					networkRxBytes: Number(networkRxBytes),
					networkTxBytes: Number(networkTxBytes),
					containerCount: Math.max(0, Math.round(containerCount)),
					timestamp: new Date().toISOString(),
				});
			} catch {
				/* WS push is best-effort */
			}

			reply.send({ success: true });
		},
	);

	// Delete node
	app.delete(
		"/:nodeId",
		{ schema: { summary: "Retrieve nodes", description: "Retrieve nodes.", tags: ["Nodes"], params: { type: "object", required: ['nodeId'], properties: { nodeId: { type: "string" } } }, response: { 200: { type: "object", additionalProperties: true } } },  onRequest: [app.authenticate] },
		async (request: FastifyRequest, reply: FastifyReply) => {
			if (!ensurePermission(request, reply, "node.delete")) return;
			const { nodeId } = request.params as { nodeId: string };
			if (!(await hasNodeScope(request, nodeId, "write"))) {
				return apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, "Insufficient permissions");
			}

			const node = await prisma.node.findUnique({
				where: { id: nodeId },
			});

			if (!node) {
				return apiError(reply, 404, ErrorCodes.NODE_NOT_FOUND, "Node not found");
			}

			// Check if node has running servers
			const runningServers = await prisma.server.findMany({
				where: { nodeId, status: { not: "stopped" } },
			});

			if (runningServers.length > 0) {
				return reply.status(409).send({
					error: "Cannot delete node with running servers",
					code: ErrorCodes.NODE_HAS_SERVERS,
				});
			}

			// Clean up agent API keys associated with this node
			const agentKeys = await prisma.apikey.findMany({
				where: {
					metadata: {
						path: ["nodeId"],
						equals: nodeId,
					},
				},
				select: { id: true },
			});

			let deletedKeys = 0;
			if (agentKeys.length > 0) {
				const result = await prisma.apikey.deleteMany({
					where: { id: { in: agentKeys.map((k) => k.id) } },
				});
				deletedKeys = result.count;

				// Invalidate agent-auth cache so deleted keys are immediately rejected
				const { invalidateAgentApiKeyCache } = await import("../lib/agent-auth");
				invalidateAgentApiKeyCache(nodeId);
			}

			await prisma.node.delete({ where: { id: nodeId } });

			// Immediate revoke: close live agent sockets + fail pending
			// requests so a deleted node stops receiving commands now.
			try {
				const gw = app.wsGateway as {
					closeAgentConnections?: (id: string, reason: string) => void;
					failPendingRequestsForNodePublic?: (id: string, reason: string) => void;
				} | undefined;
				gw?.closeAgentConnections?.(nodeId, "Node deleted");
				gw?.failPendingRequestsForNodePublic?.(nodeId, "Node deleted");
			} catch { /* best-effort */ }

			invalidateNodeListCache();
			reply.send({ success: true, deletedApiKeys: deletedKeys });

			// Broadcast node_deleted event
			const wsGatewayNodeDeleted = app.wsGateway;
			if (wsGatewayNodeDeleted?.pushToAdminSubscribers) {
				wsGatewayNodeDeleted.pushToAdminSubscribers('node_deleted', {
					type: 'node_deleted',
					nodeId,
					nodeName: node.name,
					deletedBy: request.user.userId,
					timestamp: new Date().toISOString(),
				});
			}
		},
	);

	// List IP pools (macvlan interfaces) for a node
	app.get(
		"/:nodeId/ip-pools",
		{ schema: { summary: "List IP pools", description: "List IP pools.", tags: ["Nodes"], params: { type: "object", required: ['nodeId'], properties: { nodeId: { type: "string" } } }, response: { 200: { type: "object", additionalProperties: true } } },  onRequest: [app.authenticate] },
		async (request: FastifyRequest, reply: FastifyReply) => {
			if (!ensurePermission(request, reply, "node.read")) return;
			const { nodeId } = request.params as { nodeId: string };

			// Admin bits see every node; everyone else needs node access.
			if (!(await hasNodeScope(request, nodeId, "read"))) {
				return apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, "You don't have access to this node");
			}

			const node = await prisma.node.findUnique({ where: { id: nodeId } });
			if (!node) {
				return apiError(reply, 404, ErrorCodes.NODE_NOT_FOUND, "Node not found");
			}

			const pools = await prisma.ipPool.findMany({
				where: { nodeId },
				include: {
					allocations: { where: { releasedAt: null } },
				},
				orderBy: { networkName: "asc" },
			});

			const data = pools.map((pool) => {
				const summary = summarizePool(pool);
				const usedCount = pool.allocations.length;
				return {
					id: pool.id,
					networkName: pool.networkName,
					cidr: pool.cidr,
					availableCount: Math.max(
						0,
						summary.total - summary.reservedCount - usedCount,
					),
				};
			});

			reply.send(serialize({ success: true, data }));
		},
	);

	// List available IPs from IPAM pool for a node/network
	app.get(
		"/:nodeId/ip-availability",
		{ schema: { summary: "Check IP availability", description: "Check IP availability.", tags: ["Nodes"], params: { type: "object", required: ['nodeId'], properties: { nodeId: { type: "string" } } }, response: { 200: { type: "object", additionalProperties: true } } },  onRequest: [app.authenticate] },
		async (request: FastifyRequest, reply: FastifyReply) => {
			if (!ensurePermission(request, reply, "node.read")) return;
			const { nodeId } = request.params as { nodeId: string };

			// Admin bits see every node; everyone else needs node access.
			if (!(await hasNodeScope(request, nodeId, "read"))) {
				return apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, "You don't have access to this node");
			}

			const { networkName, limit = "200" } = request.query as {
				networkName?: string;
				limit?: string;
			};
			const resolvedNetwork = (networkName || "").trim();
			if (!resolvedNetwork) {
				return apiError(reply, 400, ErrorCodes.VALIDATION_ERROR, "networkName is required");
			}

			const node = await prisma.node.findUnique({ where: { id: nodeId } });
			if (!node) {
				return apiError(reply, 404, ErrorCodes.NODE_NOT_FOUND, "Node not found");
			}

			const parsedLimit = Math.max(1, Math.min(1000, Number(limit) || 200));
			const available = await listAvailableIps(prisma, {
				nodeId,
				networkName: resolvedNetwork,
				limit: parsedLimit,
			});

			if (!available) {
				return apiError(reply, 404, ErrorCodes.NODE_IP_POOL_NOT_FOUND, "No IP pool configured for this network");
			}

			reply.send(serialize({ success: true, data: available }));
		},
	);

	// Node allocations (Pterodactyl-style)
	app.get(
		"/:nodeId/allocations",
		{ schema: { summary: "Manage allocations", description: "Manage allocations.", tags: ["Nodes"], params: { type: "object", required: ['nodeId'], properties: { nodeId: { type: "string" } } }, response: { 200: { type: "object", additionalProperties: true } } },  onRequest: [app.authenticate] },
		async (request: FastifyRequest, reply: FastifyReply) => {
			if (!ensurePermission(request, reply, ["node.read", "node.manage_allocation"])) return;
			const { nodeId } = request.params as { nodeId: string };

			// Read route: node.read holders (and admin bits) may list
			// allocations for a node they can access.
			if (!(await hasNodeScope(request, nodeId, "read"))) {
				return apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, "You don't have access to this node");
			}

			const { serverId, search, limit, offset } = request.query as {
				serverId?: string;
				search?: string;
				limit?: string;
				offset?: string;
			};

			const node = await prisma.node.findUnique({ where: { id: nodeId } });
			if (!node) {
				return apiError(reply, 404, ErrorCodes.NODE_NOT_FOUND, "Node not found");
			}

			const searchQuery = typeof search === "string" ? search.trim() : "";
			const where = {
				nodeId,
				...(serverId ? { serverId } : {}),
				...(searchQuery
					? {
							OR: [
								{ ip: { contains: searchQuery } },
								{
									alias: {
										contains: searchQuery,
										mode: "insensitive" as const,
									},
								},
								{
									notes: {
										contains: searchQuery,
										mode: "insensitive" as const,
									},
								},
							],
						}
					: {}),
			};

			// Add pagination with reasonable defaults (max 1000)
			const take = Math.min(Number(limit) || 1000, 1000);
			const skip = Math.max(0, Number(offset) || 0);

			const [allocations, total] = await Promise.all([
				prisma.nodeAllocation.findMany({
					where,
					select: {
						id: true,
						nodeId: true,
						serverId: true,
						ip: true,
						port: true,
						alias: true,
						notes: true,
						createdAt: true,
						updatedAt: true,
						server: {
							select: {
								id: true,
								name: true,
								status: true,
							},
						},
					},
					orderBy: [{ ip: "asc" }, { port: "asc" }],
					take,
					skip,
				}),
				prisma.nodeAllocation.count({ where }),
			]);

			reply.send(serialize({ success: true, data: allocations, pagination: { limit: take, offset: skip, total } }));
		},
	);

	app.post(
		"/:nodeId/allocations",
		{ schema: { summary: "Manage allocations", description: "Manage allocations.", tags: ["Nodes"], params: { type: "object", required: ['nodeId'], properties: { nodeId: { type: "string" } } }, response: { 200: { type: "object", additionalProperties: true } } },  onRequest: [app.authenticate] },
		async (request: FastifyRequest, reply: FastifyReply) => {
			if (!ensurePermission(request, reply, "node.manage_allocation")) return;
			const { nodeId } = request.params as { nodeId: string };
			const userId = request.user.userId;

			if (!(await hasNodeScope(request, nodeId, "write"))) {
				return apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, "You don't have access to this node");
			}

			const { ip, ports, alias, notes } = request.body as {
				ip: string;
				ports: string;
				alias?: string;
				notes?: string;
			};

			if (!ip || !ports) {
				return apiError(reply, 400, ErrorCodes.VALIDATION_ERROR, "ip and ports are required");
			}

			const node = await prisma.node.findUnique({ where: { id: nodeId } });
			if (!node) {
				return apiError(reply, 404, ErrorCodes.NODE_NOT_FOUND, "Node not found");
			}

			let ips: string[] = [];
			let portList: number[] = [];
			try {
				ips = await parseAllocationIps(ip);
				portList = parsePortRanges(ports);
			} catch (error: any) {
				return apiError(reply, 400, ErrorCodes.VALIDATION_ERROR, error.message);
			}

			if (ips.length * portList.length > 5000) {
				return apiError(reply, 400, ErrorCodes.VALIDATION_ERROR, "Allocation request too large");
			}

			const created = await prisma.$transaction(async (tx) => {
				const rows = ips.flatMap((addr) =>
					portList.map((port) => ({
						nodeId,
						ip: addr,
						port,
						alias: alias || null,
						notes: notes || null,
					})),
				);
				return tx.nodeAllocation.createMany({
					data: rows,
					skipDuplicates: true,
				});
			});

			pushNodeUpdated(app, nodeId, userId, "allocation_created");
			pushAllocationEvent(app, "allocation_created", nodeId);

			reply
				.status(201)
				.send({ success: true, data: { created: created.count } });
		},
	);

	app.patch(
		"/:nodeId/allocations/:allocationId",
		{ schema: { summary: "Manage allocations", description: "Manage allocations.", tags: ["Nodes"], params: { type: "object", required: ['nodeId', 'allocationId'], properties: { nodeId: { type: "string" }, allocationId: { type: "string" } } }, response: { 200: { type: "object", additionalProperties: true } } },  onRequest: [app.authenticate] },
		async (request: FastifyRequest, reply: FastifyReply) => {
			if (!ensurePermission(request, reply, "node.manage_allocation")) return;
			const { nodeId, allocationId } = request.params as {
				nodeId: string;
				allocationId: string;
			};
			const userId = request.user.userId;

			if (!(await hasNodeScope(request, nodeId, "write"))) {
				return apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, "You don't have access to this node");
			}

			const { alias, notes } = request.body as {
				alias?: string;
				notes?: string;
			};

			const allocation = await prisma.nodeAllocation.findUnique({
				where: { id: allocationId },
			});
			if (!allocation || allocation.nodeId !== nodeId) {
				return apiError(reply, 404, ErrorCodes.ALLOCATION_NOT_FOUND, "Allocation not found");
			}

			const updated = await prisma.nodeAllocation.update({
				where: { id: allocationId },
				data: {
					alias: alias !== undefined ? alias : allocation.alias,
					notes: notes !== undefined ? notes : allocation.notes,
				},
			});

			pushNodeUpdated(app, nodeId, userId, "allocation_updated");
			pushAllocationEvent(app, "allocation_updated", nodeId, [allocationId]);

			reply.send(serialize({ success: true, data: updated }));
		},
	);

	app.delete(
		"/:nodeId/allocations/:allocationId",
		{ schema: { summary: "Manage allocations", description: "Manage allocations.", tags: ["Nodes"], params: { type: "object", required: ['nodeId', 'allocationId'], properties: { nodeId: { type: "string" }, allocationId: { type: "string" } } }, response: { 200: { type: "object", additionalProperties: true } } },  onRequest: [app.authenticate] },
		async (request: FastifyRequest, reply: FastifyReply) => {
			if (!ensurePermission(request, reply, "node.manage_allocation")) return;
			const { nodeId, allocationId } = request.params as {
				nodeId: string;
				allocationId: string;
			};
			const userId = request.user.userId;

			if (!(await hasNodeScope(request, nodeId, "write"))) {
				return apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, "You don't have access to this node");
			}

			const allocation = await prisma.nodeAllocation.findUnique({
				where: { id: allocationId },
			});
			if (!allocation || allocation.nodeId !== nodeId) {
				return apiError(reply, 404, ErrorCodes.ALLOCATION_NOT_FOUND, "Allocation not found");
			}
			if (allocation.serverId) {
				return apiError(reply, 409, ErrorCodes.ALLOCATION_IN_USE, "Allocation is assigned to a server");
			}

			await prisma.nodeAllocation.delete({ where: { id: allocationId } });
			pushNodeUpdated(app, nodeId, userId, "allocation_deleted");
			pushAllocationEvent(app, "allocation_deleted", nodeId, [allocationId]);
			reply.send({ success: true });
		},
	);

	app.post(
		"/:nodeId/allocations/bulk-delete",
		{ schema: { summary: "Delete allocations in bulk", description: "Delete allocations in bulk.", tags: ["Nodes"], params: { type: "object", required: ['nodeId'], properties: { nodeId: { type: "string" } } }, response: { 200: { type: "object", additionalProperties: true } } },  onRequest: [app.authenticate] },
		async (request: FastifyRequest, reply: FastifyReply) => {
			if (!ensurePermission(request, reply, "node.manage_allocation")) return;
			const { nodeId } = request.params as { nodeId: string };
			const userId = request.user.userId;

			if (!(await hasNodeScope(request, nodeId, "write"))) {
				return apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, "You don't have access to this node");
			}

			const node = await prisma.node.findUnique({ where: { id: nodeId } });
			if (!node) {
				return apiError(reply, 404, ErrorCodes.NODE_NOT_FOUND, "Node not found");
			}

			const { allocationIds } = (request.body ?? {}) as { allocationIds?: unknown };
			if (!Array.isArray(allocationIds) || allocationIds.length === 0) {
				return apiError(reply, 400, ErrorCodes.VALIDATION_ERROR, "allocationIds must be a non-empty array");
			}
			if (allocationIds.length > 5000) {
				return apiError(reply, 400, ErrorCodes.VALIDATION_ERROR, "Bulk delete limit is 5000 allocations");
			}
			if (!allocationIds.every((id): id is string => typeof id === "string" && id.length > 0)) {
				return apiError(reply, 400, ErrorCodes.VALIDATION_ERROR, "allocationIds must be an array of ids");
			}
			const uniqueIds = Array.from(new Set(allocationIds));

			const existing = await prisma.nodeAllocation.findMany({
				where: { id: { in: uniqueIds }, nodeId },
				select: { id: true, serverId: true },
			});
			const deletableIds = existing.filter((a) => !a.serverId).map((a) => a.id);
			const skippedAssigned = existing.length - deletableIds.length;
			const notFound = uniqueIds.length - existing.length;

			if (deletableIds.length > 0) {
				await prisma.nodeAllocation.deleteMany({
					where: { id: { in: deletableIds }, nodeId, serverId: null },
				});
			}

			pushNodeUpdated(app, nodeId, userId, "allocation_bulk_deleted");
			if (deletableIds.length > 0) {
				pushAllocationEvent(app, "allocation_deleted", nodeId, deletableIds);
			}

			reply.send({
				success: true,
				data: { deleted: deletableIds.length, skippedAssigned, notFound },
			});
		},
	);

	// ============================================================================
	// NODE ASSIGNMENT ROUTES
	// ============================================================================

	// Get all assignments for a node
	app.get(
		"/:nodeId/assignments",
		{ schema: { summary: "List assignments", description: "List assignments.", tags: ["Nodes"], params: { type: "object", required: ['nodeId'], properties: { nodeId: { type: "string" } } }, response: { 200: { type: "object", additionalProperties: true } } },  onRequest: [app.authenticate] },
		async (request: FastifyRequest, reply: FastifyReply) => {
			if (!ensurePermission(request, reply, ["node.read", "node.assign"])) return;

			const { nodeId } = request.params as { nodeId: string };

			// Read route: node.read holders (and admin bits) may view
			// assignments; plain node.assign alone still requires node access.
			if (!(await hasNodeScope(request, nodeId, "read"))) {
				return apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, "You don't have access to this node");
			}

			// Verify node exists
			const node = await prisma.node.findUnique({
				where: { id: nodeId },
			});

			if (!node) {
				return apiError(reply, 404, ErrorCodes.NODE_NOT_FOUND, "Node not found");
			}

			const assignments = await getNodeAssignments(prisma, nodeId);
			reply.send(serialize({ success: true, data: assignments }));
		},
	);

	// Assign node to user or role
	app.post(
		"/:nodeId/assign",
		{ schema: { summary: "Assign a resource", description: "Assign a resource.", tags: ["Nodes"], params: { type: "object", required: ['nodeId'], properties: { nodeId: { type: "string" } } }, response: { 200: { type: "object", additionalProperties: true } } },  onRequest: [app.authenticate] },
		async (request: FastifyRequest, reply: FastifyReply) => {
			if (!ensurePermission(request, reply, "node.assign")) return;

			const { nodeId } = request.params as { nodeId: string };
			const { targetType, targetId, expiresAt } = request.body as {
				targetType: "user" | "role";
				targetId: string;
				expiresAt?: string; // ISO date string
			};

			// Verify node exists
			const node = await prisma.node.findUnique({
				where: { id: nodeId },
			});

			if (!node) {
				return apiError(reply, 404, ErrorCodes.NODE_NOT_FOUND, "Node not found");
			}

			// The assigner must have access to that node — node.assign alone
			// must not assign nodes the caller cannot access.
			if (!(await hasNodeScope(request, nodeId, "write"))) {
				return apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, "You don't have access to this node");
			}

			// Validate targetType
			if (targetType !== "user" && targetType !== "role") {
				return apiError(reply, 400, ErrorCodes.VALIDATION_ERROR, "targetType must be 'user' or 'role'");
			}

			if (!targetId) {
				return apiError(reply, 400, ErrorCodes.VALIDATION_ERROR, "targetId is required");
			}

			// Verify target exists
			if (targetType === "user") {
				const user = await prisma.user.findUnique({
					where: { id: targetId },
				});
				if (!user) {
					return apiError(reply, 404, ErrorCodes.USER_NOT_FOUND, "User not found");
				}
			} else {
				const role = await prisma.role.findUnique({
					where: { id: targetId },
				});
				if (!role) {
					return apiError(reply, 404, ErrorCodes.ROLE_NOT_FOUND, "Role not found");
				}
			}

			// Parse expiration date if provided
			let expirationDate: Date | undefined;
			if (expiresAt) {
				expirationDate = new Date(expiresAt);
				if (isNaN(expirationDate.getTime())) {
					return apiError(reply, 400, ErrorCodes.VALIDATION_ERROR, "Invalid expiresAt date");
				}
				if (expirationDate <= new Date()) {
					return apiError(reply, 400, ErrorCodes.VALIDATION_ERROR, "expiresAt must be in the future");
				}
			}

			// Check if assignment already exists
			const existingAssignment = await prisma.nodeAssignment.findFirst({
				where: {
					nodeId,
					...(targetType === "user"
						? { userId: targetId }
						: { roleId: targetId }),
				},
			});

			if (existingAssignment) {
				return reply.status(409).send({
					error: "Assignment already exists",
					code: ErrorCodes.NODE_ASSIGNMENT_EXISTS,
					existingAssignmentId: existingAssignment.id,
				});
			}

			// Create the assignment
			const assignment = await assignNode(
				prisma,
				nodeId,
				targetType,
				targetId,
				request.user.userId,
				expirationDate,
			);

			// Log the action
			await createAuditLog(request.user.userId, {
				action: `node.assign.${targetType}`,
				resource: "node",
				resourceId: nodeId,
				request,
				details: {
					nodeName: node?.name,
					targetType,
					targetId,
					assignmentId: assignment.id,
					expiresAt: expirationDate?.toISOString(),
				},
			});

			reply.status(201).send(serialize({ success: true, data: assignment }));

			// Broadcast node_assigned event
			const wsGatewayNodeAssigned = app.wsGateway;
			if (wsGatewayNodeAssigned?.pushToAdminSubscribers) {
				wsGatewayNodeAssigned.pushToAdminSubscribers('node_assigned', {
					type: 'node_assigned',
					nodeId,
					targetType,
					targetId,
					assignmentId: assignment.id,
					assignedBy: request.user.userId,
					timestamp: new Date().toISOString(),
				});
			}
		},
	);

	// Remove a node assignment
	app.delete(
		"/:nodeId/assignments/:assignmentId",
		{ schema: { summary: "List assignments", description: "List assignments.", tags: ["Nodes"], params: { type: "object", required: ['nodeId', 'assignmentId'], properties: { nodeId: { type: "string" }, assignmentId: { type: "string" } } }, response: { 200: { type: "object", additionalProperties: true } } },  onRequest: [app.authenticate] },
		async (request: FastifyRequest, reply: FastifyReply) => {
			if (!ensurePermission(request, reply, "node.assign")) return;

			const { nodeId, assignmentId } = request.params as {
				nodeId: string;
				assignmentId: string;
			};

			// Verify assignment exists and belongs to this node
			const assignment = await prisma.nodeAssignment.findUnique({
				where: { id: assignmentId },
			});

			if (!assignment) {
				return apiError(reply, 404, ErrorCodes.NODE_ASSIGNMENT_NOT_FOUND, "Assignment not found");
			}

			if (assignment.nodeId !== nodeId) {
				return apiError(reply, 404, ErrorCodes.NODE_ASSIGNMENT_NOT_FOUND, "Assignment not found for this node");
			}

			// Scope: mirror POST /assign — node.assign alone must not remove
			// assignments on nodes the caller cannot access.
			if (!(await hasNodeScope(request, nodeId, "write"))) {
				return apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, "You don't have access to this node");
			}
			// Hierarchy: admin-tier targets are '*'-only (audit TARGET-§2.7).
			if (
				!(await assertCanAffectAssignmentTarget(
					request,
					assignment.userId ? "user" : "role",
					assignment.userId ?? assignment.roleId ?? "",
					reply,
				))
			) {
				return;
			}

			// Delete the assignment
			await removeNodeAssignment(prisma, assignmentId);

			// Log the action
			await createAuditLog(request.user.userId, {
				action: "node.unassign",
				resource: "node",
				resourceId: nodeId,
				request,
				details: {
					assignmentId,
					wasUserAssignment: !!assignment.userId,
					wasRoleAssignment: !!assignment.roleId,
					userId: assignment.userId ?? undefined,
					roleId: assignment.roleId ?? undefined,
				},
			});

			reply.send({ success: true });

			// Broadcast node_unassigned event
			const wsGatewayNodeUnassigned = app.wsGateway;
			if (wsGatewayNodeUnassigned?.pushToAdminSubscribers) {
				wsGatewayNodeUnassigned.pushToAdminSubscribers('node_unassigned', {
					type: 'node_unassigned',
					nodeId,
					targetType: assignment.userId ? 'user' : 'role',
					targetId: assignment.userId || assignment.roleId || '',
					assignmentId,
					removedBy: request.user.userId,
					timestamp: new Date().toISOString(),
				});
			}
		},
	);

	// Get nodes accessible to current user
	// This endpoint is used by the frontend to populate node selection dropdowns
	app.get(
		"/accessible",
		{ schema: { summary: "List accessible nodes", description: "List accessible nodes.", tags: ["Nodes"], response: { 200: { type: "object", additionalProperties: true } } },  onRequest: [app.authenticate] },
		async (request: FastifyRequest, reply: FastifyReply) => {
			const userId = request.user.userId;

			// Check if user has node.read permission
			if (!ensurePermission(request, reply, "node.read")) return;

			// admin.read+ reads every node; others see their assignments only.
			const isAdminReader = hasGrant(
				request.user?.permissions ?? [],
				"admin.read",
			);
			const accessibleResult = isAdminReader
				? null
				: await getUserAccessibleNodes(prisma, userId);

			// Fetch node details
			const nodes = await prisma.node.findMany({
				where: accessibleResult
					? { id: { in: accessibleResult.nodeIds } }
					: undefined,
				omit: { secret: true },
				include: {
					location: {
						select: {
							id: true,
							name: true,
						},
					},
					_count: {
						select: { servers: true },
					},
				},
				orderBy: { name: "asc" },
			});

			reply.send(
				serialize({
					success: true,
					data: nodes,
					hasWildcard: accessibleResult ? accessibleResult.hasWildcard : true,
				}),
			);
		},
	);

	// ============================================================================
	// AUTO-IMPORT: UNREGISTERED CONTAINERS
	// ============================================================================

	// Get unregistered containers discovered on a node (containers without DB server records)
	app.get(
		"/:nodeId/unregistered-containers",
		{ schema: { summary: "List unregistered containers", description: "List unregistered containers.", tags: ["Nodes"], params: { type: "object", required: ['nodeId'], properties: { nodeId: { type: "string" } } }, response: { 200: { type: "object", additionalProperties: true } } },  onRequest: [app.authenticate] },
		async (request: FastifyRequest, reply: FastifyReply) => {
			if (!ensurePermission(request, reply, "node.read")) return;
			const { nodeId } = request.params as { nodeId: string };

			// Container discovery is read-only node visibility.
			if (!(await hasNodeScope(request, nodeId, "read"))) {
				return apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, "You don't have access to this node");
			}

			const node = await prisma.node.findUnique({
				where: { id: nodeId },
				select: { id: true, locationId: true },
			});
			if (!node) {
				return apiError(reply, 404, ErrorCodes.NODE_NOT_FOUND, "Node not found");
			}

			// Get registered server IDs for this node
			const registeredServers = await prisma.server.findMany({
				where: { nodeId },
				select: { id: true },
			});
			const registeredIds = new Set(registeredServers.map((s) => s.id));

			// Get discovered containers from gateway
			const wsGateway = app.wsGateway;
			const discovered = wsGateway?.getDiscoveredContainers?.(nodeId) ?? [];

			// Filter out containers that are already registered
			const unregistered = discovered
				.filter((c: any) => !registeredIds.has(c.containerId))
				.map((c: any) => ({
					containerId: c.containerId,
					image: c.image,
					status: c.status,
					labels: c.labels,
					networkMode: c.networkMode,
					memoryLimitMb: c.memoryLimitMb,
					cpuCores: c.cpuCores,
					startupCommand: c.startupCommand,
					envVarNames: c.envVarNames,
					discoveredAt: c.discoveredAt,
				}));

			reply.send({ success: true, data: unregistered });
		},
	);

	// Suggest template match for an unregistered container
	app.get(
		"/:nodeId/unregistered-containers/:containerId/suggest-template",
		{ schema: { summary: "Suggest a template", description: "Suggest a template.", tags: ["Nodes"], params: { type: "object", required: ['nodeId', 'containerId'], properties: { nodeId: { type: "string" }, containerId: { type: "string" } } }, response: { 200: { type: "object", additionalProperties: true } } },  onRequest: [app.authenticate] },
		async (request: FastifyRequest, reply: FastifyReply) => {
			if (!ensurePermission(request, reply, "node.read")) return;
			const { nodeId, containerId } = request.params as { nodeId: string; containerId: string };

			// Template matching is read-only node visibility.
			if (!(await hasNodeScope(request, nodeId, "read"))) {
				return apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, "You don't have access to this node");
			}

			// Verify node exists
			const node = await prisma.node.findUnique({
				where: { id: nodeId },
				select: { id: true },
			});
			if (!node) {
				return apiError(reply, 404, ErrorCodes.NODE_NOT_FOUND, "Node not found");
			}

			const wsGateway = app.wsGateway;
			const discovered = wsGateway?.getDiscoveredContainers?.(nodeId) ?? [];
			const container = discovered.find((c: any) => c.containerId === containerId);
			if (!container) {
				return apiError(reply, 404, ErrorCodes.NODE_CONTAINER_NOT_FOUND, "Container not found");
			}

			// Fetch all templates to match against
			const templates = await prisma.serverTemplate.findMany({
				select: {
					id: true,
					name: true,
					startup: true,
					variables: true,
					image: true,
					images: true,
				},
			});

			// Score each template based on matching signals
			const results = templates.map((template) => {
				let score = 0;
				const matchReasons: string[] = [];

				// 1. Match startup command pattern
				if (container.startupCommand && template.startup) {
					const templateStartup = template.startup.toLowerCase();
					const containerStartup = container.startupCommand.toLowerCase();

					// Extract structural parts of the template startup (non-variable tokens)
					const structuralTokens = templateStartup
						.split(/[\s]+/)
						.filter((t) => !t.startsWith("{{"))
						.filter((t) => t.length > 1);

					let matchedTokens = 0;
					for (const token of structuralTokens) {
						if (containerStartup.includes(token)) {
							matchedTokens++;
						}
					}
					if (structuralTokens.length > 0 && matchedTokens > 0) {
						const tokenScore = matchedTokens / structuralTokens.length;
						score += tokenScore * 50; // Up to 50 points for startup match
						if (tokenScore > 0.5) {
							matchReasons.push(`Startup command matches ${Math.round(tokenScore * 100)}%`);
						}
					}
				}

				// 2. Match env var names
				if (container.envVarNames && container.envVarNames.length > 0) {
					const templateVars = (template.variables as any[]) || [];
					const templateVarNames = new Set(
						templateVars.map((v: any) => v?.name).filter(Boolean),
					);

					if (templateVarNames.size > 0) {
						let matchedVars = 0;
						for (const varName of templateVarNames) {
							if (container.envVarNames.includes(varName)) {
								matchedVars++;
							}
						}
						if (matchedVars > 0) {
							const varScore = matchedVars / templateVarNames.size;
							score += varScore * 30; // Up to 30 points for env var match
							if (varScore > 0.3) {
								matchReasons.push(`${matchedVars}/${templateVarNames.size} env variables match`);
							}
						}
					}
				}

				// 3. Match image name
				if (container.image && template.image) {
					const containerImage = container.image.toLowerCase();
					const templateImages = [
						template.image,
						...((template.images as any[]) || []).map((i: any) => i?.image || ""),
					].map((i) => i.toLowerCase());

					for (const templateImage of templateImages) {
						if (!templateImage) continue;
						const containerRepoTag = containerImage.split(":")[0];
						const templateRepoTag = templateImage.split(":")[0];
						if (containerRepoTag === templateRepoTag) {
							score += 20;
							matchReasons.push(`Image matches: ${containerImage}`);
							break;
						}
						if (containerRepoTag.includes(templateRepoTag) || templateRepoTag.includes(containerRepoTag)) {
							score += 10;
							matchReasons.push(`Image repo similar: ${containerImage}`);
							break;
						}
					}
				}

				return {
					templateId: template.id,
					templateName: template.name,
					score: Math.round(score),
					matchReasons,
				};
			})
				.filter((r) => r.score > 0)
				.sort((a, b) => b.score - a.score)
				.slice(0, 5); // Top 5 matches

			reply.send({ success: true, data: results });
		},
	);

	// Import a discovered container as a server
	app.post(
		"/:nodeId/import-server",
		{ schema: { summary: "Import a server", description: "Import a server.", tags: ["Nodes"], params: { type: "object", required: ['nodeId'], properties: { nodeId: { type: "string" } } }, response: { 200: { type: "object", additionalProperties: true } } },  onRequest: [app.authenticate] },
		async (request: FastifyRequest, reply: FastifyReply) => {
			const { nodeId } = request.params as { nodeId: string };

			// Server creation contract (audit TARGET-§2.4): server.create, or
			// the node-manage path (node access + node.server_manage).
			const actorPerms: string[] = request.user?.permissions ?? [];
			if (!hasGrant(actorPerms, "server.create")) {
				const { resolveServerPermissions } = await import(
					"../lib/permissions-catalog.js"
				);
				const rolePerms = await resolveServerPermissions(
					request.user.userId,
					"",
					nodeId,
				);
				const nodeManage =
					(await hasNodeAccess(prisma, request.user.userId, nodeId)) &&
					hasGrant(rolePerms, "node.server_manage");
				if (!nodeManage) {
					return apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, "Insufficient permissions");
				}
			}
			const {
				containerId,
				name,
				templateId,
				ownerId,
				allocatedMemoryMb,
				allocatedCpuCores,
				allocatedDiskMb,
				primaryPort,
				portBindings,
				environment,
			} = request.body as {
				containerId: string;
				name: string;
				templateId: string;
				ownerId: string;
				allocatedMemoryMb?: number;
				allocatedCpuCores?: number;
				allocatedDiskMb?: number;
				primaryPort?: number;
				portBindings?: Record<number, number>;
				environment?: Record<string, string>;
			};

			// Validate required fields
			if (!containerId || !name || !templateId || !ownerId) {
				return apiError(reply, 400, ErrorCodes.VALIDATION_ERROR, "containerId, name, templateId, and ownerId are required");
			}

			// Validate node
			const node = await prisma.node.findUnique({
				where: { id: nodeId },
				select: { id: true, locationId: true },
			});
			if (!node) {
				return apiError(reply, 404, ErrorCodes.NODE_NOT_FOUND, "Node not found");
			}

			// Verify container was discovered on this node
			const wsGateway = app.wsGateway;
			const discovered = wsGateway?.getDiscoveredContainers?.(nodeId) ?? [];
			const container = discovered.find((c: any) => c.containerId === containerId);
			if (!container) {
				return apiError(reply, 400, ErrorCodes.NODE_CONTAINER_NOT_FOUND, "Container not found on node. Agent reconciliation may be needed.");
			}

			// Verify no existing server with this container ID
			const existing = await prisma.server.findUnique({
				where: { id: containerId },
			});
			if (existing) {
				return apiError(reply, 409, ErrorCodes.CONFLICT, "A server with this container ID already exists");
			}

			// Validate template
			const template = await prisma.serverTemplate.findUnique({
				where: { id: templateId },
			});
			if (!template) {
				return apiError(reply, 404, ErrorCodes.TEMPLATE_NOT_FOUND, "Template not found");
			}

			// Validate owner
			const owner = await prisma.user.findUnique({
				where: { id: ownerId },
			});
			if (!owner) {
				return apiError(reply, 404, ErrorCodes.USER_NOT_FOUND, "Owner not found");
			}

			// Resolve environment with template defaults
			const templateVariables = (template.variables as any[]) || [];
			const templateDefaults = templateVariables.reduce((acc: Record<string, string>, variable: any) => {
				if (variable?.name && variable?.default !== undefined) {
					acc[variable.name] = String(variable.default);
				}
				return acc;
			}, {} as Record<string, string>);
			const resolvedEnvironment = {
				...templateDefaults,
				...(environment || {}),
			};

			// Derive status from container
			const status = container.status.includes("Up") ? "running" : "stopped";

			// Use discovered resource defaults if user didn't specify values
			const resolvedMemoryMb = allocatedMemoryMb ?? container.memoryLimitMb ?? template.allocatedMemoryMb;
			// Clamp cpu cores to >= 1: a 0 or missing value (unlimited imported
			// container) reaches the agent as quota 0, which runc treats as "no
			// CFS cap" — a silently uncapped noisy neighbor. Template default
			// remains the fallback when the container exposes no quota.
			const resolvedCpuCores = Math.max(1, Math.ceil(
				allocatedCpuCores
					?? (container.cpuCores ? Math.ceil(container.cpuCores) : undefined)
					?? template.allocatedCpuCores
					?? 1,
			));

			// Create server record — containerId IS the server.id (critical for agent sync)
			const server = await prisma.server.create({
				data: {
					id: containerId,                    // MUST match container name for agent sync
					uuid: uuidv4(),
					name,
					templateId,
					nodeId,
					locationId: node.locationId,
					ownerId,
					status,
					allocatedMemoryMb: resolvedMemoryMb,
					allocatedCpuCores: resolvedCpuCores,
					allocatedDiskMb: allocatedDiskMb ?? 10240,
					containerId,
					containerName: containerId,
					networkMode: container.networkMode || "bridge",
					primaryPort: primaryPort ?? 25565,
					portBindings: portBindings ?? {},
					environment: resolvedEnvironment,
					startupCommand: template.startup,
				},
			});

			// Create system log entry
			await prisma.serverLog.create({
				data: {
					serverId: server.id,
					stream: "system",
					data: `[Import] Server imported from existing container ${containerId}`,
				},
			});

			// Audit log
			await createAuditLog(request.user.userId, {
				action: "server.import",
				resource: "server",
				resourceId: server.id,
				request,
				details: {
					serverName: server.name,
					serverUuid: server.uuid,
					containerId,
					nodeId,
					templateId,
					ownerId,
					source: "auto_import",
				},
			});

			reply.status(201).send(serialize({ success: true, data: server }));

			// Broadcast via WS
			if (wsGateway?.pushToAdminSubscribers) {
				wsGateway.pushToAdminSubscribers('server_created', {
					type: 'server_created',
					serverId: server.id,
					nodeId,
					ownerId,
					timestamp: new Date().toISOString(),
				});
			}
			// Global stream too — the importer's owner list must see the row
			// without a manual refresh (mirrors routes/servers/core.ts).
			if (wsGateway?.pushToGlobalSubscribers) {
				wsGateway.pushToGlobalSubscribers('server_created', {
					type: 'server_created',
					serverId: server.id,
					serverName: server.name,
					nodeId,
					ownerId,
					createdBy: request.user.userId,
					timestamp: new Date().toISOString(),
				});
			}
		},
	);

	// ============================================================================
	// WILDCARD ASSIGNMENT ROUTE
	// ============================================================================

	// Assign all nodes (wildcard) to user or role
	app.post(
		"/assign-wildcard",
		{ schema: { summary: "Assign wildcard access", description: "Assign wildcard access.", tags: ["Nodes"], response: { 200: { type: "object", additionalProperties: true } } },  onRequest: [app.authenticate] },
		async (request: FastifyRequest, reply: FastifyReply) => {
			if (!ensurePermission(request, reply, "node.assign")) return;

			const { targetType, targetId, expiresAt } = request.body as {
				targetType: "user" | "role";
				targetId: string;
				expiresAt?: string; // ISO date string
			};

			// SECURITY: a wildcard grant spans every node — require write-admin
			// or the caller's own wildcard reach, never a bare node.assign.
			const wildcardActorPerms: string[] = request.user?.permissions ?? [];
			if (!hasGrant(wildcardActorPerms, "admin.write")) {
				const reach = await getUserAccessibleNodes(prisma, request.user.userId);
				if (!reach.hasWildcard) {
					return apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, "Wildcard node reach required");
				}
			}
			// Self-target: granting yourself all-node access is the escalation.
			if (targetType === "user" && targetId === request.user.userId) {
				return apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, "Cannot assign wildcard access to yourself");
			}
			// Hierarchy: admin-tier targets are '*'-only.
			if (!(await assertCanAffectAssignmentTarget(request, targetType, targetId, reply))) {
				return;
			}

			// Validate targetType
			if (targetType !== "user" && targetType !== "role") {
				return apiError(reply, 400, ErrorCodes.VALIDATION_ERROR, "targetType must be 'user' or 'role'");
			}

			if (!targetId) {
				return apiError(reply, 400, ErrorCodes.VALIDATION_ERROR, "targetId is required");
			}

			// Verify target exists
			if (targetType === "user") {
				const user = await prisma.user.findUnique({
					where: { id: targetId },
				});
				if (!user) {
					return apiError(reply, 404, ErrorCodes.USER_NOT_FOUND, "User not found");
				}
			} else {
				const role = await prisma.role.findUnique({
					where: { id: targetId },
				});
				if (!role) {
					return apiError(reply, 404, ErrorCodes.ROLE_NOT_FOUND, "Role not found");
				}
			}

			// Parse expiration date if provided
			let expirationDate: Date | undefined;
			if (expiresAt) {
				expirationDate = new Date(expiresAt);
				if (isNaN(expirationDate.getTime())) {
					return apiError(reply, 400, ErrorCodes.VALIDATION_ERROR, "Invalid expiresAt date");
				}
				if (expirationDate <= new Date()) {
					return apiError(reply, 400, ErrorCodes.VALIDATION_ERROR, "expiresAt must be in the future");
				}
			}

			// Check if wildcard assignment already exists
			const existingWildcard = await prisma.nodeAssignment.findFirst({
				where: {
					nodeId: null,
					...(targetType === "user"
						? { userId: targetId }
						: { roleId: targetId }),
				},
			});

			if (existingWildcard) {
				return reply.status(409).send({
					error: "Wildcard assignment already exists",
					code: ErrorCodes.NODE_ASSIGNMENT_EXISTS,
					existingAssignmentId: existingWildcard.id,
				});
			}

			// Create the wildcard assignment (nodeId = null means all nodes)
			const assignment = await assignNode(
				prisma,
				null, // null = wildcard (all nodes)
				targetType,
				targetId,
				request.user.userId,
				expirationDate,
			);

			// Log the action
			await createAuditLog(request.user.userId, {
				action: `node.assign_wildcard.${targetType}`,
				resource: "node",
				resourceId: "*", // Wildcard indicator
				request,
				details: {
					targetType,
					targetId,
					assignmentId: assignment.id,
					expiresAt: expirationDate?.toISOString(),
					wildcard: true,
				},
			});

			reply.status(201).send(serialize({ success: true, data: assignment }));

			// Broadcast wildcard_assigned event
			const wsGatewayWildcardAssigned = app.wsGateway;
			if (wsGatewayWildcardAssigned?.pushToAdminSubscribers) {
				wsGatewayWildcardAssigned.pushToAdminSubscribers('wildcard_assigned', {
					type: 'wildcard_assigned',
					targetType,
					targetId,
					assignmentId: assignment.id,
					assignedBy: request.user.userId,
					timestamp: new Date().toISOString(),
				});
			}
		},
	);

	// Remove wildcard assignment from user or role
	app.delete(
		"/assign-wildcard/:targetType/:targetId",
		{ schema: { summary: "Assign wildcard access", description: "Assign wildcard access.", tags: ["Nodes"], params: { type: "object", required: ['targetType', 'targetId'], properties: { targetType: { type: "string" }, targetId: { type: "string" } } }, response: { 200: { type: "object", additionalProperties: true } } },  onRequest: [app.authenticate] },
		async (request: FastifyRequest, reply: FastifyReply) => {
			if (!ensurePermission(request, reply, "node.assign")) return;

			const { targetType, targetId } = request.params as {
				targetType: "user" | "role";
				targetId: string;
			};

			// Validate targetType
			if (targetType !== "user" && targetType !== "role") {
				return apiError(reply, 400, ErrorCodes.VALIDATION_ERROR, "targetType must be 'user' or 'role'");
			}

			// SECURITY: wildcard grants span every node — write-admin or own
			// wildcard reach, never a bare node.assign; admin-tier targets
			// are '*'-only (self-removal stays allowed: it is self-demotion).
			const wildcardActorPerms: string[] = request.user?.permissions ?? [];
			if (!hasGrant(wildcardActorPerms, "admin.write")) {
				const reach = await getUserAccessibleNodes(prisma, request.user.userId);
				if (!reach.hasWildcard) {
					return apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, "Wildcard node reach required");
				}
			}
			if (!(await assertCanAffectAssignmentTarget(request, targetType, targetId, reply))) {
				return;
			}

			// Find the wildcard assignment
			const wildcardAssignment = await prisma.nodeAssignment.findFirst({
				where: {
					nodeId: null,
					...(targetType === "user"
						? { userId: targetId }
						: { roleId: targetId }),
				},
			});

			if (!wildcardAssignment) {
				return apiError(reply, 404, ErrorCodes.NODE_ASSIGNMENT_NOT_FOUND, "Wildcard assignment not found");
			}

			// Delete the wildcard assignment
			await removeNodeAssignment(prisma, wildcardAssignment.id);

			// Log the action
			await createAuditLog(request.user.userId, {
				action: "node.unassign_wildcard",
				resource: "node",
				resourceId: "*",
				request,
				details: {
					targetType,
					targetId,
					assignmentId: wildcardAssignment.id,
					wildcard: true,
				},
			});

			reply.send({ success: true });

			// Broadcast wildcard_removed event
			const wsGatewayWildcardRemoved = app.wsGateway;
			if (wsGatewayWildcardRemoved?.pushToAdminSubscribers) {
				wsGatewayWildcardRemoved.pushToAdminSubscribers('wildcard_removed', {
					type: 'wildcard_removed',
					targetType,
					targetId,
					assignmentId: wildcardAssignment.id,
					removedBy: request.user.userId,
					timestamp: new Date().toISOString(),
				});
			}
		},
	);

	// ── Agent Control Endpoints ────────────────────────────────────────────

	// Get detailed agent status
	app.get(
		"/:nodeId/agent/status",
		{ schema: { summary: "View status", description: "View status.", tags: ["Nodes"], params: { type: "object", required: ['nodeId'], properties: { nodeId: { type: "string" } } }, response: { 200: { type: "object", additionalProperties: true } } },  onRequest: [app.authenticate] },
		async (request: FastifyRequest, reply: FastifyReply) => {
			if (!ensurePermission(request, reply, "node.read")) return;
			const { nodeId } = request.params as { nodeId: string };

			// Agent visibility is node-scoped: admin bits or node access.
			if (!(await hasNodeScope(request, nodeId, "read"))) {
				return apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, "You don't have access to this node");
			}

			const node = await prisma.node.findUnique({
				where: { id: nodeId },
				select: {
					id: true,
					isOnline: true,
					agentVersion: true,
					lastSeenAt: true,
					hostname: true,
					sftpEnabled: true,
					sftpPort: true,
					agentConfigPath: true,
					_count: { select: { servers: true } },
					servers: { select: { status: true } },
				},
			});

			if (!node) {
				return apiError(reply, 404, ErrorCodes.NODE_NOT_FOUND, "Node not found");
			}

			const currentPanel = getCurrentVersion();
			const panelVersion = currentPanel === "unknown" ? null : currentPanel;
			const runningContainers = node.servers.filter((s: any) => s.status === "running").length;

			// Base data from DB
			const data: any = {
				nodeId: node.id,
				connected: node.isOnline,
				agentVersion: node.agentVersion,
				panelVersion,
				updateAvailable: panelVersion && node.agentVersion
					? (() => {
						const ap = node.agentVersion.replace(/^v/, '').split('.').map(Number);
						const pp = panelVersion.replace(/^v/, '').split('.').map(Number);
						for (let i = 0; i < Math.max(ap.length, pp.length); i++) {
							if ((pp[i] || 0) > (ap[i] || 0)) return true;
							if ((pp[i] || 0) < (ap[i] || 0)) break;
						}
						return false;
					})()
					: false,
				latestVersion: panelVersion,
				uptime: null,
				lastSeenAt: node.lastSeenAt,
				osInfo: null,
				kernelVersion: null,
				containerRuntime: null,
				runningContainers,
				totalContainers: node._count.servers,
				configPath: node.agentConfigPath,
				sftpPort: node.sftpPort,
				sftpEnabled: node.sftpEnabled,
			};

			// If agent is online, query it for rich system info
			if (node.isOnline) {
				const gateway = app.wsGateway;
				if (gateway) {
					try {
						const agentData = await gateway.requestFromAgent(nodeId, {
							type: "agent_status",
						});

						if (agentData) {
							// Merge agent-provided fields over the DB defaults
							if (agentData.uptime !== null && agentData.uptime !== undefined) data.uptime = agentData.uptime;
							if (agentData.osInfo) data.osInfo = agentData.osInfo;
							if (agentData.kernelVersion) data.kernelVersion = agentData.kernelVersion;
							if (agentData.containerRuntime) data.containerRuntime = agentData.containerRuntime;
							if (agentData.configPath) data.configPath = agentData.configPath;
							if (agentData.sftpEnabled !== null && agentData.sftpEnabled !== undefined) data.sftpEnabled = agentData.sftpEnabled;
							if (agentData.sftpPort !== null && agentData.sftpPort !== undefined) data.sftpPort = agentData.sftpPort;
						}
					} catch {
						// Agent may not support this request type yet — fall through with DB-only data
					}
				}
			}

			reply.send({ success: true, data });
		},
	);

	// Get agent logs (initial batch)
	app.get(
		"/:nodeId/agent/logs",
		{ schema: { summary: "View agent logs", description: "View agent logs.", tags: ["Nodes"], params: { type: "object", required: ['nodeId'], properties: { nodeId: { type: "string" } } }, response: { 200: { type: "object", additionalProperties: true } } },  onRequest: [app.authenticate] },
		async (request: FastifyRequest, reply: FastifyReply) => {
			if (!ensurePermission(request, reply, "node.read")) return;
			const { nodeId } = request.params as { nodeId: string };
			const { lines } = request.query as { lines?: string };

			// Agent visibility is node-scoped: admin bits or node access.
			if (!(await hasNodeScope(request, nodeId, "read"))) {
				return apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, "You don't have access to this node");
			}

			const node = await prisma.node.findUnique({ where: { id: nodeId } });
			if (!node) {
				return apiError(reply, 404, ErrorCodes.NODE_NOT_FOUND, "Node not found");
			}

			if (!node.isOnline) {
				return reply.send({ success: true, data: [] });
			}

			const gateway = (app as any).wsGateway;
			if (!gateway) {
				return apiError(reply, 503, ErrorCodes.WEBSOCKET_GATEWAY_UNAVAILABLE, "WebSocket gateway unavailable");
			}

			try {
				const response = await gateway.requestFromAgent(nodeId, {
					type: "agent_logs",
					lines: Number(lines) || 200,
				});

				if (response?.logs) {
					return reply.send({ success: true, data: response.logs });
				}
				return reply.send({ success: true, data: [] });
			} catch {
				return apiError(reply, 503, ErrorCodes.NODE_AGENT_UNREACHABLE, "Failed to request logs from agent");
			}
		},
	);

	// Live agent log tail (SSE) — panel pulls from agent and pushes to browser.
	// Agents do not open a dedicated log socket; this is the true stream surface.
	app.get(
		"/:nodeId/agent/logs/stream",
		{ schema: { summary: "Stream agent logs", description: "Stream agent logs.", tags: ["Nodes"], produces: ["text/event-stream"], params: { type: "object", required: ['nodeId'], properties: { nodeId: { type: "string" } } }, response: { 200: { type: "string" }, 403: { type: "object" }, 404: { type: "object" }, 503: { type: "object" } } },
			onRequest: [app.authenticate],
			config: { rateLimit: false },
		},
		async (request: FastifyRequest, reply: FastifyReply) => {
			if (!ensurePermission(request, reply, "node.read")) return;
			const { nodeId } = request.params as { nodeId: string };

			// Agent visibility is node-scoped: admin bits or node access.
			if (!(await hasNodeScope(request, nodeId, "read"))) {
				return apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, "You don't have access to this node");
			}

			const node = await prisma.node.findUnique({ where: { id: nodeId } });
			if (!node) {
				return apiError(reply, 404, ErrorCodes.NODE_NOT_FOUND, "Node not found");
			}

			const gateway = (app as any).wsGateway;
			if (!gateway) {
				return apiError(reply, 503, ErrorCodes.WEBSOCKET_GATEWAY_UNAVAILABLE, "WebSocket gateway unavailable");
			}

			// Cap viewers per node BEFORE hijacking so a full stream still
			// returns JSON 503 (per-worker cap, like the console/admin streams).
			if ((agentLogStreams.get(nodeId)?.pushers.size ?? 0) >= MAX_AGENT_LOG_VIEWERS_PER_NODE) {
				return apiError(
					reply,
					503,
					ErrorCodes.SSE_SUBSCRIBER_LIMIT_REACHED,
					"Too many agent log viewers. Please try again later.",
				);
			}

			const sse = openSseStream(request, reply);
			sse.comment("connected");
			const writeEvent = (event: string, data: unknown) => {
				sse.push(event, data);
			};
			writeEvent("connected", { nodeId, timestamp: new Date().toISOString() });

			// Per-viewer dedupe: a joining viewer receives the current log
			// window as fresh lines, then only new ones.
			const seen = new Set<string>();
			const keyOf = (l: any) =>
				`${l?.timestamp ?? ""}|${l?.target ?? ""}|${l?.message ?? ""}`;

			const deliver: AgentLogPusher = (kind, logs) => {
				if (kind === "offline") {
					writeEvent("agent_logs", { nodeId, logs: [], offline: true });
					return;
				}
				if (kind === "error") {
					writeEvent("agent_logs_error", { nodeId, error: "pull_failed" });
					return;
				}
				const fresh: unknown[] = [];
				for (const l of logs) {
					const k = keyOf(l);
					if (seen.has(k)) continue;
					seen.add(k);
					fresh.push(l);
				}
				// Cap seen set
				if (seen.size > 5000) {
					const keep = [...seen].slice(-2000);
					seen.clear();
					for (const k of keep) seen.add(k);
				}
				if (fresh.length > 0) {
					writeEvent("agent_logs", { nodeId, logs: fresh });
				}
			};

			// Shared pull loop: one 2s poll per node across all viewers.
			const existingStream = agentLogStreams.get(nodeId);
			if (existingStream && existingStream.pushers.size >= MAX_AGENT_LOG_VIEWERS_PER_NODE) {
				// Cap TOCTOU between the pre-hijack check and registration.
				try {
					sse.push("error", {
						type: "error",
						error: ErrorCodes.SSE_SUBSCRIBER_LIMIT_REACHED,
						code: ErrorCodes.SSE_SUBSCRIBER_LIMIT_REACHED,
						timestamp: Date.now(),
					});
				} catch {
					/* socket already gone */
				}
				request.raw.destroy();
				return;
			}
			if (existingStream) {
				existingStream.pushers.add(deliver);
			} else {
				createAgentLogStream(nodeId, gateway, deliver);
			}

			let detached = false;
			const detach = () => {
				if (detached) return;
				detached = true;
				const entry = agentLogStreams.get(nodeId);
				if (!entry) return;
				entry.pushers.delete(deliver);
				if (entry.pushers.size === 0) {
					clearInterval(entry.timer);
					agentLogStreams.delete(nodeId);
				}
			};

			const heartbeat = setInterval(() => {
				try {
					sse.comment("heartbeat");
					// Named-event heartbeat: the FE half-open watchdog (P2.5)
					// needs a dispatched event, not just an SSE comment.
					sse.push("ping", { t: Date.now() });
				} catch {
					clearInterval(heartbeat);
					detach();
				}
			}, 25_000);

			request.raw.on("close", () => {
				clearInterval(heartbeat);
				detach();
			});
		},
	);

	// Restart agent
	app.post(
		"/:nodeId/agent/restart",
		{ schema: { summary: "Restart the agent", description: "Restart the agent.", tags: ["Nodes"], params: { type: "object", required: ['nodeId'], properties: { nodeId: { type: "string" } } }, response: { 200: { type: "object", additionalProperties: true } } },  onRequest: [app.authenticate] },
		async (request: FastifyRequest, reply: FastifyReply) => {
			if (!ensurePermission(request, reply, "node.agent_control")) return;
			const { nodeId } = request.params as { nodeId: string };

			// Agent control is node-scoped: write-admin or node access.
			if (!(await hasNodeScope(request, nodeId, "write"))) {
				return apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, "You don't have access to this node");
			}

			const node = await prisma.node.findUnique({ where: { id: nodeId } });
			if (!node) {
				return apiError(reply, 404, ErrorCodes.NODE_NOT_FOUND, "Node not found");
			}

			if (!node.isOnline) {
				return apiError(reply, 409, ErrorCodes.NODE_OFFLINE, "Agent is offline");
			}

			const gateway = (app as any).wsGateway;
			if (!gateway) {
				return apiError(reply, 503, ErrorCodes.WEBSOCKET_GATEWAY_UNAVAILABLE, "WebSocket gateway unavailable");
			}

			const sent = await gateway.sendToAgent(nodeId, {
				type: "restart_agent",
			});

			if (!sent) {
				return apiError(reply, 503, ErrorCodes.NODE_AGENT_UNREACHABLE, "Failed to send restart command to agent");
			}

			await createAuditLog(request.user.userId, {
				action: "agent.restart",
				resource: "node",
				resourceId: nodeId,
				request,
				details: {
					nodeName: node.name,
					publicAddress: node.publicAddress,
					isOnline: node.isOnline,
					agentVersion: (node as any).agentVersion ?? undefined,
				},
			});

			reply.send({ success: true, data: { sent: true } });
		},
	);

	// Trigger agent update
	app.post(
		"/:nodeId/agent/update",
		{ schema: { summary: "Retrieve update for agent", description: "Retrieve update for agent.", tags: ["Nodes"], params: { type: "object", required: ['nodeId'], properties: { nodeId: { type: "string" } } }, response: { 200: { type: "object", additionalProperties: true } } },  onRequest: [app.authenticate] },
		async (request: FastifyRequest, reply: FastifyReply) => {
			if (!ensurePermission(request, reply, "node.agent_control")) return;
			const { nodeId } = request.params as { nodeId: string };
			const { targetVersion } = request.body as { targetVersion?: string };

			// Agent control is node-scoped: write-admin or node access.
			if (!(await hasNodeScope(request, nodeId, "write"))) {
				return apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, "You don't have access to this node");
			}

			const node = await prisma.node.findUnique({ where: { id: nodeId } });
			if (!node) {
				return apiError(reply, 404, ErrorCodes.NODE_NOT_FOUND, "Node not found");
			}

			if (!node.isOnline) {
				return apiError(reply, 409, ErrorCodes.NODE_OFFLINE, "Agent is offline");
			}

			const gateway = (app as any).wsGateway;
			if (!gateway) {
				return apiError(reply, 503, ErrorCodes.WEBSOCKET_GATEWAY_UNAVAILABLE, "WebSocket gateway unavailable");
			}

			const currentPanel = getCurrentVersion();
			// GitHub tags are v-prefixed ("v1.50.3"); the agent's updater only
			// accepts digits and dots, so normalize before forwarding. The
			// panel's latestVersion field is a raw tag_name.
			const requested = typeof targetVersion === "string"
				? targetVersion.trim().replace(/^v/i, "")
				: "";
			if (requested && !/^\d+(\.\d+)+$/.test(requested)) {
				return apiError(
					reply,
					400,
					ErrorCodes.VALIDATION_ERROR,
					"targetVersion must be a version like 1.50.3",
				);
			}
			const version =
				requested ||
				(currentPanel === "unknown" ? undefined : currentPanel);
			const sent = await gateway.sendToAgent(nodeId, {
				type: "update_agent",
				targetVersion: version,
			});

			if (!sent) {
				return apiError(reply, 503, ErrorCodes.NODE_AGENT_UNREACHABLE, "Failed to send update command to agent");
			}

			// Optimistic admin SSE so the control panel flips to "updating" immediately.
			try {
				gateway.pushToAdminSubscribers?.("agent_update_started", {
					type: "agent_update_started",
					nodeId,
					targetVersion: version ?? null,
					progress: 0,
					timestamp: new Date().toISOString(),
				});
			} catch {
				/* non-fatal */
			}

			await createAuditLog(request.user.userId, {
				action: "agent.update",
				resource: "node",
				resourceId: nodeId,
				request,
				details: {
					nodeName: node.name,
					publicAddress: node.publicAddress,
					targetVersion: version,
					previousVersion: (node as any).agentVersion ?? undefined,
				},
			});

			reply.send({ success: true, data: { sent: true } });
		},
	);

	// Get agent update status
	app.get(
		"/:nodeId/agent/update-status",
		{ schema: { summary: "View update status", description: "View update status.", tags: ["Nodes"], params: { type: "object", required: ['nodeId'], properties: { nodeId: { type: "string" } } }, response: { 200: { type: "object", additionalProperties: true } } },  onRequest: [app.authenticate] },
		async (request: FastifyRequest, reply: FastifyReply) => {
			if (!ensurePermission(request, reply, "node.read")) return;
			const { nodeId } = request.params as { nodeId: string };

			// Agent visibility is node-scoped: admin bits or node access.
			if (!(await hasNodeScope(request, nodeId, "read"))) {
				return apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, "You don't have access to this node");
			}

			const node = await prisma.node.findUnique({ where: { id: nodeId } });
			if (!node) {
				return apiError(reply, 404, ErrorCodes.NODE_NOT_FOUND, "Node not found");
			}

			const gateway = (app as any).wsGateway;
			if (!gateway || !node.isOnline) {
				return reply.send({
					success: true,
					data: {
						currentVersion: node.agentVersion,
						targetVersion: null,
						status: "idle",
						progress: 0,
						error: null,
						startedAt: null,
					},
				});
			}

			try {
				const response = await gateway.requestFromAgent(nodeId, {
					type: "agent_update_status",
				});

				if (response) {
					return reply.send({ success: true, data: response });
				}
			} catch {
				// Agent might not support this request type yet
			}

			return reply.send({
				success: true,
				data: {
					currentVersion: node.agentVersion,
					targetVersion: null,
					status: "idle",
					progress: 0,
					error: null,
					startedAt: null,
				},
			});
		},
	);

	// Ping agent
	app.post(
		"/:nodeId/agent/ping",
		{ schema: { summary: "Ping the agent", description: "Ping the agent.", tags: ["Nodes"], params: { type: "object", required: ['nodeId'], properties: { nodeId: { type: "string" } } }, response: { 200: { type: "object", additionalProperties: true } } },  onRequest: [app.authenticate] },
		async (request: FastifyRequest, reply: FastifyReply) => {
			if (!ensurePermission(request, reply, "node.read")) return;
			const { nodeId } = request.params as { nodeId: string };

			// Agent visibility is node-scoped: admin bits or node access.
			if (!(await hasNodeScope(request, nodeId, "read"))) {
				return apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, "You don't have access to this node");
			}

			const node = await prisma.node.findUnique({ where: { id: nodeId } });
			if (!node) {
				return apiError(reply, 404, ErrorCodes.NODE_NOT_FOUND, "Node not found");
			}

			if (!node.isOnline) {
				return apiError(reply, 409, ErrorCodes.NODE_OFFLINE, "Agent is offline");
			}

			const gateway = (app as any).wsGateway;
			if (!gateway) {
				return apiError(reply, 503, ErrorCodes.WEBSOCKET_GATEWAY_UNAVAILABLE, "WebSocket gateway unavailable");
			}

			const start = Date.now();
			try {
				const response = await gateway.requestFromAgent(nodeId, {
					type: "ping",
				});
				const latencyMs = Date.now() - start;

				if (response) {
					return reply.send({ success: true, data: { latencyMs } });
				}
			} catch {
				// fall through
			}

			apiError(reply, 504, ErrorCodes.NODE_AGENT_UNREACHABLE, "Agent did not respond to ping");
		},
	);

	// Get agent config
	app.get(
		"/:nodeId/agent/config",
		{ schema: { summary: "Manage agent configuration", description: "Manage agent configuration.", tags: ["Nodes"], params: { type: "object", required: ['nodeId'], properties: { nodeId: { type: "string" } } }, response: { 200: { type: "object", additionalProperties: true } } },  onRequest: [app.authenticate] },
		async (request: FastifyRequest, reply: FastifyReply) => {
			if (!ensurePermission(request, reply, "node.read")) return;
			const { nodeId } = request.params as { nodeId: string };

			// Agent config is node-scoped read visibility (admin.read or node
			// access) per audit TARGET-§2.6.
			if (!(await hasNodeScope(request, nodeId, "read"))) {
				return apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, "You don't have access to this node");
			}

			const node = await prisma.node.findUnique({ where: { id: nodeId } });
			if (!node) {
				return apiError(reply, 404, ErrorCodes.NODE_NOT_FOUND, "Node not found");
			}

			if (!node.isOnline) {
				return apiError(reply, 409, ErrorCodes.NODE_OFFLINE, "Agent is offline");
			}

			const gateway = (app as any).wsGateway;
			if (!gateway) {
				return apiError(reply, 503, ErrorCodes.WEBSOCKET_GATEWAY_UNAVAILABLE, "WebSocket gateway unavailable");
			}

			try {
				const response = await gateway.requestFromAgent(nodeId, {
					type: "agent_config",
				});

				if (response) {
					return reply.send({ success: true, data: response });
				}
			} catch {
				// Agent might not support this yet
			}

			apiError(reply, 503, ErrorCodes.NODE_AGENT_UNREACHABLE, "Failed to retrieve agent config");
		},
	);

	// Update agent config
	app.put(
		"/:nodeId/agent/config",
		{ schema: { summary: "Manage agent configuration", description: "Manage agent configuration.", tags: ["Nodes"], params: { type: "object", required: ['nodeId'], properties: { nodeId: { type: "string" } } }, response: { 200: { type: "object", additionalProperties: true } } },  onRequest: [app.authenticate] },
		async (request: FastifyRequest, reply: FastifyReply) => {
			if (!ensurePermission(request, reply, "node.agent_control")) return;
			const { nodeId } = request.params as { nodeId: string };
			const { content, allowUnsafe } = request.body as {
				content: string;
				allowUnsafe?: boolean;
			};

			// Agent config writes are node-scoped: write-admin or node access.
			if (!(await hasNodeScope(request, nodeId, "write"))) {
				return apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, "You don't have access to this node");
			}

			if (!content || typeof content !== 'string') {
				return apiError(reply, 400, ErrorCodes.VALIDATION_ERROR, "Config content is required");
			}

			const node = await prisma.node.findUnique({ where: { id: nodeId } });
			if (!node) {
				return apiError(reply, 404, ErrorCodes.NODE_NOT_FOUND, "Node not found");
			}

			if (!node.isOnline) {
				return apiError(reply, 409, ErrorCodes.NODE_OFFLINE, "Agent is offline");
			}

			const gateway = (app as any).wsGateway;
			if (!gateway) {
				return apiError(reply, 503, ErrorCodes.WEBSOCKET_GATEWAY_UNAVAILABLE, "WebSocket gateway unavailable");
			}

			try {
				const response = await gateway.requestFromAgent(nodeId, {
					type: "agent_config_update",
					content,
					// The editor round-trips the whole file, which always contains
					// security-sensitive keys (release_repo, sftp, cni_*, systemd,
					// config_path). The agent accepts those only with this explicit
					// opt-in, which also makes it back up the current config.
					allowUnsafe: allowUnsafe === true,
				});

				if (response?.saved) {
					await createAuditLog(request.user.userId, {
						action: "agent.config_update",
						resource: "node",
						resourceId: nodeId,
						request,
						details: {
							nodeName: node.name,
							publicAddress: node.publicAddress,
							configBytes: content.length,
							allowUnsafe: allowUnsafe === true,
						},
					});

					pushNodeUpdated(app, nodeId, request.user.userId, "agent_config_updated");

					return reply.send({ success: true, data: { saved: true } });
				}

				if (typeof response?.error === 'string' && response.error) {
					return apiError(
						reply,
						400,
						ErrorCodes.AGENT_CONFIG_REJECTED,
						`Agent rejected the config: ${response.error}`,
						{ params: { reason: response.error } },
					);
				}
			} catch {
				// fall through
			}

			apiError(reply, 503, ErrorCodes.NODE_AGENT_UNREACHABLE, "Failed to update agent config");
		},
	);

	// Enable/disable host networking on the node (agent network policy).
	// The agent applies it live and persists it to config.toml, so servers
	// using networkMode "host" can start without an agent restart.
	app.post(
		"/:nodeId/host-network",
		{ schema: { summary: "View host networking", description: "View host networking.", tags: ["Nodes"], params: { type: "object", required: ['nodeId'], properties: { nodeId: { type: "string" } } }, response: { 200: { type: "object", additionalProperties: true } } },  onRequest: [app.authenticate] },
		async (request: FastifyRequest, reply: FastifyReply) => {
			if (!ensurePermission(request, reply, "node.agent_control")) return;
			const { nodeId } = request.params as { nodeId: string };
			const body = request.body as { enabled?: unknown } | undefined;

			// Host-network rewrites are node-scoped: write-admin or node access.
			if (!(await hasNodeScope(request, nodeId, "write"))) {
				return apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, "You don't have access to this node");
			}

			if (typeof body?.enabled !== "boolean") {
				return apiError(reply, 400, ErrorCodes.VALIDATION_ERROR, "enabled (boolean) is required");
			}
			const enabled = body.enabled;

			const node = await prisma.node.findUnique({ where: { id: nodeId } });
			if (!node) {
				return apiError(reply, 404, ErrorCodes.NODE_NOT_FOUND, "Node not found");
			}

			if (!node.isOnline) {
				return apiError(reply, 409, ErrorCodes.NODE_OFFLINE, "Agent is offline");
			}

			const gateway = (app as any).wsGateway;
			if (!gateway) {
				return apiError(reply, 503, ErrorCodes.WEBSOCKET_GATEWAY_UNAVAILABLE, "WebSocket gateway unavailable");
			}

			try {
				const response = await gateway.requestFromAgent(nodeId, {
					type: "set_host_network",
					enabled,
				});

				if (response?.success) {
					await createAuditLog(request.user.userId, {
						action: "node.host_network.update",
						resource: "node",
						resourceId: nodeId,
						request,
						details: {
							nodeName: node.name,
							enabled,
							persisted: response.persisted ?? false,
						},
					});

					pushNodeUpdated(app, nodeId, request.user.userId, "host_network_updated");

					return reply.send({
						success: true,
						data: {
							allowHostNetwork: response.allowHostNetwork ?? enabled,
							persisted: response.persisted ?? false,
						},
					});
				}

				if (response && response.success === false) {
					return apiError(reply, 400, ErrorCodes.VALIDATION_ERROR,
						typeof response.error === "string" ? response.error : "Agent rejected the request");
				}
			} catch {
				// Older agents do not know this command.
			}

			apiError(reply, 503, ErrorCodes.NODE_AGENT_UNREACHABLE, "Agent did not respond to the host-network update");
		},
	);
}
