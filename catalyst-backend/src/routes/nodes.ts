import { prisma } from "../db.js";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { v4 as uuidv4 } from "uuid";
import { randomBytes } from "crypto";
import { listAvailableIps, summarizePool } from "../utils/ipam";
import { auth } from "../auth";
import { serialize } from "../utils/serialize";
import { verifyAgentApiKey } from "../lib/agent-auth";
import { createApiKey, deleteApiKey } from "../services/api-key-service";

// ID format validation — accepts UUID, Cuid2, and other safe identifier formats.
const ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

/**
 * Safely escape a nodeId for use in JSON string queries.
 * Prevents JSON injection attacks by escaping quotes and backslashes.
 */
const escapeForJsonQuery = (nodeId: string): string => {
	// Validate ID format — must be alphanumeric (no quotes, backslashes, etc.)
	if (!ID_PATTERN.test(nodeId)) {
		throw new Error("Invalid nodeId format");
	}
	// Escape backslashes first, then quotes (defense in depth)
	return nodeId.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
};

import {
	hasNodeAccess,
	getUserAccessibleNodes,
	getNodeAssignments,
	assignNode,
	removeNodeAssignment,
} from "../lib/permissions";

const ensurePermission = (
	request: any,
	reply: FastifyReply,
	requiredPermission: string,
): boolean => {
	const perms: string[] = request.user?.permissions ?? [];
	if (perms.includes("*") || perms.includes(requiredPermission)) return true;
	reply.status(403).send({ error: "Insufficient permissions" });
	return false;
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

const parseAllocationIps = async (input: string): Promise<string[]> => {
	const entries = input
		.split(/[,\s]+/)
		.map((entry) => entry.trim())
		.filter(Boolean);
	const ips: string[] = [];
	const ipRegex =
		/^(?:(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)$/;
	for (const entry of entries) {
		if (entry.includes("/")) {
			const [base, prefixRaw] = entry.split("/");
			const prefix = Number(prefixRaw);
			if (
				!ipRegex.test(base) ||
				Number.isNaN(prefix) ||
				prefix < 0 ||
				prefix > 32
			) {
				throw new Error(`Invalid CIDR: ${entry}`);
			}
			const parts = base.split(".").map((part) => Number(part));
			const ipInt =
				((parts[0] << 24) >>> 0) +
				((parts[1] << 16) >>> 0) +
				((parts[2] << 8) >>> 0) +
				(parts[3] >>> 0);
			const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
			const network = ipInt & mask;
			const broadcast = (network | (~mask >>> 0)) >>> 0;
			if (prefix >= 31) {
				ips.push(
					`${(network >>> 24) & 0xff}.${(network >>> 16) & 0xff}.${(network >>> 8) & 0xff}.${network & 0xff}`,
					`${(broadcast >>> 24) & 0xff}.${(broadcast >>> 16) & 0xff}.${(broadcast >>> 8) & 0xff}.${broadcast & 0xff}`,
				);
				continue;
			}
			for (let value = network + 1; value <= broadcast - 1; value += 1) {
				ips.push(
					`${(value >>> 24) & 0xff}.${(value >>> 16) & 0xff}.${(value >>> 8) & 0xff}.${value & 0xff}`,
				);
			}
			continue;
		}
		if (ipRegex.test(entry)) {
			ips.push(entry);
			continue;
		}
		throw new Error(`Unsupported host entry: ${entry}`);
	}
	return ips;
};

export async function nodeRoutes(app: FastifyInstance) {
	// Using shared prisma instance from db.ts

	// Create node
	app.post(
		"/",
		{ onRequest: [app.authenticate] },
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
			} = request.body as {
				name: string;
				description?: string;
				locationId: string;
				hostname: string;
				publicAddress: string;
				maxMemoryMb: number;
				maxCpuCores: number;
				serverDataDir?: string;
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
				return reply.status(400).send({ error: "Missing required fields" });
			}

			// Validate positive values
			if (maxMemoryMb <= 0) {
				return reply
					.status(400)
					.send({ error: "maxMemoryMb must be positive" });
			}

			if (maxCpuCores <= 0) {
				return reply
					.status(400)
					.send({ error: "maxCpuCores must be positive" });
			}

			// Check for duplicate name
			const existingNode = await prisma.node.findFirst({
				where: { name },
			});

			if (existingNode) {
				return reply.status(400).send({ error: "Node name already exists" });
			}

			const location = await prisma.location.findUnique({
				where: { id: locationId },
			});

			if (!location) {
				return reply.status(404).send({ error: "Location not found" });
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
					serverDataDir: serverDataDir || undefined,
				},
			});

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
				await prisma.auditLog.create({
					data: {
						userId: request.user.userId,
						action: "node.created.wildcard_warning",
						resource: "node",
						resourceId: node.id,
						details: {
							nodeName: node.name,
							wildcardAssignmentCount: wildcardAssignments.length,
							message:
								"Node created while wildcard assignments exist - users/roles may have implicit access",
						},
					},
				});
			}

			const { secret: _secret, ...safeNode } = node;
			reply.send(serialize({ success: true, data: safeNode }));

			// Broadcast node_created event
			const wsGatewayNodeCreated = (app as any).wsGateway;
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
		{ onRequest: [app.authenticate] },
		async (request: FastifyRequest, reply: FastifyReply) => {
			if (!ensurePermission(request, reply, "node.read")) return;

			const userId = request.user.userId;

			// Check if user is admin - admins see all nodes
			const perms: string[] = request.user?.permissions ?? [];
			const isAdmin =
				perms.includes("*") ||
				perms.includes("admin.write") ||
				perms.includes("admin.read");

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

			reply.send(serialize({ success: true, data: nodes }));
		},
	);

	// Get node details
	app.get(
		"/:nodeId",
		{ onRequest: [app.authenticate] },
		async (request: FastifyRequest, reply: FastifyReply) => {
			if (!ensurePermission(request, reply, "node.read")) return;
			const { nodeId } = request.params as { nodeId: string };
			const userId = request.user.userId;

			// Check if user has access to this specific node
			const hasAccess = await hasNodeAccess(prisma, userId, nodeId);
			if (!hasAccess) {
				return reply
					.status(403)
					.send({ error: "You don't have access to this node" });
			}

			const node = await prisma.node.findUnique({
				where: { id: nodeId },
				omit: { secret: true },
				include: {
					servers: {
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
				return reply.status(404).send({ error: "Node not found" });
			}

			reply.send(serialize({ success: true, data: node }));
		},
	);

	// Generate deployment token
	app.post(
		"/:nodeId/deployment-token",
		{ onRequest: [app.authenticate] },
		async (request: FastifyRequest, reply: FastifyReply) => {
			if (!ensurePermission(request, reply, "node.create")) return;
			const { nodeId } = request.params as { nodeId: string };

			const node = await prisma.node.findUnique({
				where: { id: nodeId },
			});

			if (!node) {
				return reply.status(404).send({ error: "Node not found" });
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

			const deployUrl = `${process.env.BACKEND_URL || "http://localhost:3000"}/api/deploy/${token}`;
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
					return reply
						.status(500)
						.send({ error: "Failed to create agent API key" });
				}
			} catch (error) {
				request.log.error(
					{ error, nodeId },
					"Failed to create agent API key for deployment",
				);
				return reply
					.status(500)
					.send({ error: "Failed to create agent API key" });
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
		{ onRequest: [app.authenticate] },
		async (request: FastifyRequest, reply: FastifyReply) => {
			if (!ensurePermission(request, reply, "node.read")) return;
			const { nodeId } = request.params as { nodeId: string };

			const node = await prisma.node.findUnique({
				where: { id: nodeId },
			});

			if (!node) {
				return reply.status(404).send({ error: "Node not found" });
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
		{ onRequest: [app.authenticate] },
		async (request: FastifyRequest, reply: FastifyReply) => {
			if (!ensurePermission(request, reply, "node.create")) return;
			const { nodeId } = request.params as { nodeId: string };
			const { regenerate } = (request.body as { regenerate?: boolean }) || {};

			const node = await prisma.node.findUnique({
				where: { id: nodeId },
			});

			if (!node) {
				return reply.status(404).send({ error: "Node not found" });
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
				} catch (error) {
					request.log.error(
						{ error, keyId: existingKey.id },
						"Failed to delete old API key",
					);
					return reply
						.status(500)
						.send({ error: "Failed to delete old API key" });
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
					return reply.status(500).send({ error: "Failed to create API key" });
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
				return reply.status(500).send({ error: "Failed to create API key" });
			}
		},
	);

	// Update node configuration
	app.put(
		"/:nodeId",
		{ onRequest: [app.authenticate] },
		async (request: FastifyRequest, reply: FastifyReply) => {
			if (!ensurePermission(request, reply, "node.update")) return;
			const { nodeId } = request.params as { nodeId: string };
			const {
				name,
				description,
				hostname,
				publicAddress,
				maxMemoryMb,
				maxCpuCores,
				serverDataDir,
			} = request.body as {
				name?: string;
				description?: string;
				hostname?: string;
				publicAddress?: string;
				maxMemoryMb?: number;
				maxCpuCores?: number;
				serverDataDir?: string;
			};

			const node = await prisma.node.findUnique({
				where: { id: nodeId },
			});

			if (!node) {
				return reply.status(404).send({ error: "Node not found" });
			}

			// Validate inputs
			if (maxMemoryMb !== undefined && maxMemoryMb <= 0) {
				return reply
					.status(400)
					.send({ error: "maxMemoryMb must be positive" });
			}

			if (maxCpuCores !== undefined && maxCpuCores <= 0) {
				return reply
					.status(400)
					.send({ error: "maxCpuCores must be positive" });
			}

			// Check for duplicate name
			if (name && name !== node.name) {
				const existing = await prisma.node.findFirst({
					where: { name, id: { not: nodeId } },
				});
				if (existing) {
					return reply.status(400).send({ error: "Node name already exists" });
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
				},
			});

			reply.send(serialize({ success: true, data: updated }));

			// Broadcast node_updated event
			const wsGatewayNodeUpdated = (app as any).wsGateway;
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
		{ onRequest: [app.authenticate] },
		async (request: FastifyRequest, reply: FastifyReply) => {
			if (!ensurePermission(request, reply, "node.view_stats")) return;
			const { nodeId } = request.params as { nodeId: string };
			const userId = request.user.userId;

			// Check if user has access to this specific node
			const hasAccess = await hasNodeAccess(prisma, userId, nodeId);
			if (!hasAccess) {
				return reply
					.status(403)
					.send({ error: "You don't have access to this node" });
			}

			const node = await prisma.node.findUnique({
				where: { id: nodeId },
				include: {
					servers: {
						select: {
							id: true,
							status: true,
							allocatedMemoryMb: true,
							allocatedCpuCores: true,
						},
					},
				},
			});

			if (!node) {
				return reply.status(404).send({ error: "Node not found" });
			}

			// Calculate resource usage
			const totalAllocatedMemory = node.servers.reduce(
				(sum, server) => sum + (server.allocatedMemoryMb || 0),
				0,
			);
			const totalAllocatedCpu = node.servers.reduce(
				(sum, server) => sum + (server.allocatedCpuCores || 0),
				0,
			);

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
						allocatedMemoryMb: totalAllocatedMemory,
						allocatedCpuCores: totalAllocatedCpu,
						availableMemoryMb: node.maxMemoryMb - totalAllocatedMemory,
						availableCpuCores: node.maxCpuCores - totalAllocatedCpu,
						memoryUsagePercent: (totalAllocatedMemory / node.maxMemoryMb) * 100,
						cpuUsagePercent: (totalAllocatedCpu / node.maxCpuCores) * 100,
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
				},
			});
		},
	);

	// Update node status (called by agent via heartbeat)
	app.post(
		"/:nodeId/heartbeat",
		{ config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
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
				return reply.status(401).send({ error: "Unauthorized" });
			}

			const apiKeyValid = await verifyAgentApiKey(prisma, nodeId, apiKey);
			if (!apiKeyValid) {
				return reply.status(401).send({ error: "Unauthorized" });
			}

			const node = await prisma.node.findUnique({
				where: { id: nodeId },
			});

			if (!node) {
				return reply.status(401).send({ error: "Unauthorized" });
			}

			const cpuPercent = Number(health?.cpuPercent);
			const memoryUsageMb = Number(health?.memoryUsageMb);
			const memoryTotalMb = Number(health?.memoryTotalMb ?? node.maxMemoryMb);
			const diskUsageMb = Number(health?.diskUsageMb ?? 0);
			const diskTotalMb = Number(health?.diskTotalMb ?? 0);
			const containerCount = Number(health?.containerCount);
			const networkRxBytes = BigInt(
				Math.max(0, Number(health?.networkRxBytes ?? 0)),
			);
			const networkTxBytes = BigInt(
				Math.max(0, Number(health?.networkTxBytes ?? 0)),
			);

			if (
				!Number.isFinite(cpuPercent) ||
				!Number.isFinite(memoryUsageMb) ||
				!Number.isFinite(memoryTotalMb) ||
				!Number.isFinite(diskUsageMb) ||
				!Number.isFinite(diskTotalMb) ||
				!Number.isFinite(containerCount)
			) {
				return reply.status(400).send({ error: "Invalid health payload" });
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

			reply.send({ success: true });
		},
	);

	// Delete node
	app.delete(
		"/:nodeId",
		{ onRequest: [app.authenticate] },
		async (request: FastifyRequest, reply: FastifyReply) => {
			if (!ensurePermission(request, reply, "node.delete")) return;
			const { nodeId } = request.params as { nodeId: string };

			const node = await prisma.node.findUnique({
				where: { id: nodeId },
			});

			if (!node) {
				return reply.status(404).send({ error: "Node not found" });
			}

			// Check if node has running servers
			const runningServers = await prisma.server.findMany({
				where: { nodeId, status: { not: "stopped" } },
			});

			if (runningServers.length > 0) {
				return reply.status(409).send({
					error: "Cannot delete node with running servers",
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
			}

			await prisma.node.delete({ where: { id: nodeId } });

			reply.send({ success: true, deletedApiKeys: deletedKeys });

			// Broadcast node_deleted event
			const wsGatewayNodeDeleted = (app as any).wsGateway;
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
		{ onRequest: [app.authenticate] },
		async (request: FastifyRequest, reply: FastifyReply) => {
			if (!ensurePermission(request, reply, "node.read")) return;
			const { nodeId } = request.params as { nodeId: string };
			const userId = request.user.userId;

			// Check if user has access to this specific node
			const hasAccess = await hasNodeAccess(prisma, userId, nodeId);
			if (!hasAccess) {
				return reply
					.status(403)
					.send({ error: "You don't have access to this node" });
			}

			const node = await prisma.node.findUnique({ where: { id: nodeId } });
			if (!node) {
				return reply.status(404).send({ error: "Node not found" });
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
		{ onRequest: [app.authenticate] },
		async (request: FastifyRequest, reply: FastifyReply) => {
			if (!ensurePermission(request, reply, "node.read")) return;
			const { nodeId } = request.params as { nodeId: string };
			const userId = request.user.userId;

			// Check if user has access to this specific node
			const hasAccess = await hasNodeAccess(prisma, userId, nodeId);
			if (!hasAccess) {
				return reply
					.status(403)
					.send({ error: "You don't have access to this node" });
			}

			const { networkName, limit = "200" } = request.query as {
				networkName?: string;
				limit?: string;
			};
			const resolvedNetwork = (networkName || "").trim();
			if (!resolvedNetwork) {
				return reply.status(400).send({ error: "networkName is required" });
			}

			const node = await prisma.node.findUnique({ where: { id: nodeId } });
			if (!node) {
				return reply.status(404).send({ error: "Node not found" });
			}

			const parsedLimit = Math.max(1, Math.min(1000, Number(limit) || 200));
			const available = await listAvailableIps(prisma, {
				nodeId,
				networkName: resolvedNetwork,
				limit: parsedLimit,
			});

			if (!available) {
				return reply
					.status(404)
					.send({ error: "No IP pool configured for this network" });
			}

			reply.send(serialize({ success: true, data: available }));
		},
	);

	// Node allocations (Pterodactyl-style)
	app.get(
		"/:nodeId/allocations",
		{ onRequest: [app.authenticate] },
		async (request: FastifyRequest, reply: FastifyReply) => {
			if (!ensurePermission(request, reply, "node.manage_allocation")) return;
			const { nodeId } = request.params as { nodeId: string };
			const userId = request.user.userId;

			// Check if user has access to this specific node
			const hasAccess = await hasNodeAccess(prisma, userId, nodeId);
			if (!hasAccess) {
				return reply
					.status(403)
					.send({ error: "You don't have access to this node" });
			}

			const { serverId, search } = request.query as {
				serverId?: string;
				search?: string;
			};

			const node = await prisma.node.findUnique({ where: { id: nodeId } });
			if (!node) {
				return reply.status(404).send({ error: "Node not found" });
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

			const allocations = await prisma.nodeAllocation.findMany({
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
			});

			reply.send(serialize({ success: true, data: allocations }));
		},
	);

	app.post(
		"/:nodeId/allocations",
		{ onRequest: [app.authenticate] },
		async (request: FastifyRequest, reply: FastifyReply) => {
			if (!ensurePermission(request, reply, "node.manage_allocation")) return;
			const { nodeId } = request.params as { nodeId: string };
			const userId = request.user.userId;

			// Check if user has access to this specific node
			const hasAccess = await hasNodeAccess(prisma, userId, nodeId);
			if (!hasAccess) {
				return reply
					.status(403)
					.send({ error: "You don't have access to this node" });
			}

			const { ip, ports, alias, notes } = request.body as {
				ip: string;
				ports: string;
				alias?: string;
				notes?: string;
			};

			if (!ip || !ports) {
				return reply.status(400).send({ error: "ip and ports are required" });
			}

			const node = await prisma.node.findUnique({ where: { id: nodeId } });
			if (!node) {
				return reply.status(404).send({ error: "Node not found" });
			}

			let ips: string[] = [];
			let portList: number[] = [];
			try {
				ips = await parseAllocationIps(ip);
				portList = parsePortRanges(ports);
			} catch (error: any) {
				return reply.status(400).send({ error: error.message });
			}

			if (ips.length * portList.length > 5000) {
				return reply
					.status(400)
					.send({ error: "Allocation request too large" });
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

			reply
				.status(201)
				.send({ success: true, data: { created: created.count } });
		},
	);

	app.patch(
		"/:nodeId/allocations/:allocationId",
		{ onRequest: [app.authenticate] },
		async (request: FastifyRequest, reply: FastifyReply) => {
			if (!ensurePermission(request, reply, "node.manage_allocation")) return;
			const { nodeId, allocationId } = request.params as {
				nodeId: string;
				allocationId: string;
			};
			const userId = request.user.userId;

			// Check if user has access to this specific node
			const hasAccess = await hasNodeAccess(prisma, userId, nodeId);
			if (!hasAccess) {
				return reply
					.status(403)
					.send({ error: "You don't have access to this node" });
			}

			const { alias, notes } = request.body as {
				alias?: string;
				notes?: string;
			};

			const allocation = await prisma.nodeAllocation.findUnique({
				where: { id: allocationId },
			});
			if (!allocation || allocation.nodeId !== nodeId) {
				return reply.status(404).send({ error: "Allocation not found" });
			}

			const updated = await prisma.nodeAllocation.update({
				where: { id: allocationId },
				data: {
					alias: alias !== undefined ? alias : allocation.alias,
					notes: notes !== undefined ? notes : allocation.notes,
				},
			});

			reply.send(serialize({ success: true, data: updated }));
		},
	);

	app.delete(
		"/:nodeId/allocations/:allocationId",
		{ onRequest: [app.authenticate] },
		async (request: FastifyRequest, reply: FastifyReply) => {
			if (!ensurePermission(request, reply, "node.manage_allocation")) return;
			const { nodeId, allocationId } = request.params as {
				nodeId: string;
				allocationId: string;
			};
			const userId = request.user.userId;

			// Check if user has access to this specific node
			const hasAccess = await hasNodeAccess(prisma, userId, nodeId);
			if (!hasAccess) {
				return reply
					.status(403)
					.send({ error: "You don't have access to this node" });
			}

			const allocation = await prisma.nodeAllocation.findUnique({
				where: { id: allocationId },
			});
			if (!allocation || allocation.nodeId !== nodeId) {
				return reply.status(404).send({ error: "Allocation not found" });
			}
			if (allocation.serverId) {
				return reply
					.status(409)
					.send({ error: "Allocation is assigned to a server" });
			}

			await prisma.nodeAllocation.delete({ where: { id: allocationId } });
			reply.send({ success: true });
		},
	);

	// ============================================================================
	// NODE ASSIGNMENT ROUTES
	// ============================================================================

	// Get all assignments for a node
	app.get(
		"/:nodeId/assignments",
		{ onRequest: [app.authenticate] },
		async (request: FastifyRequest, reply: FastifyReply) => {
			if (!ensurePermission(request, reply, "node.assign")) return;

			const { nodeId } = request.params as { nodeId: string };

			// Verify node exists
			const node = await prisma.node.findUnique({
				where: { id: nodeId },
			});

			if (!node) {
				return reply.status(404).send({ error: "Node not found" });
			}

			const assignments = await getNodeAssignments(prisma, nodeId);
			reply.send(serialize({ success: true, data: assignments }));
		},
	);

	// Assign node to user or role
	app.post(
		"/:nodeId/assign",
		{ onRequest: [app.authenticate] },
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
				return reply.status(404).send({ error: "Node not found" });
			}

			// Check if the user assigning the node has access to that node
			// This prevents users with node.assign permission from assigning nodes they can't access
			const assignerHasAccess = await hasNodeAccess(
				prisma,
				request.user.userId,
				nodeId,
			);
			if (!assignerHasAccess) {
				return reply
					.status(403)
					.send({ error: "You don't have access to this node" });
			}

			// Validate targetType
			if (targetType !== "user" && targetType !== "role") {
				return reply
					.status(400)
					.send({ error: "targetType must be 'user' or 'role'" });
			}

			if (!targetId) {
				return reply
					.status(400)
					.send({ error: "targetId is required" });
			}

			// Verify target exists
			if (targetType === "user") {
				const user = await prisma.user.findUnique({
					where: { id: targetId },
				});
				if (!user) {
					return reply.status(404).send({ error: "User not found" });
				}
			} else {
				const role = await prisma.role.findUnique({
					where: { id: targetId },
				});
				if (!role) {
					return reply.status(404).send({ error: "Role not found" });
				}
			}

			// Parse expiration date if provided
			let expirationDate: Date | undefined;
			if (expiresAt) {
				expirationDate = new Date(expiresAt);
				if (isNaN(expirationDate.getTime())) {
					return reply.status(400).send({ error: "Invalid expiresAt date" });
				}
				if (expirationDate <= new Date()) {
					return reply
						.status(400)
						.send({ error: "expiresAt must be in the future" });
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
			await prisma.auditLog.create({
				data: {
					userId: request.user.userId,
					action: `node.assign.${targetType}`,
					resource: "node",
					resourceId: nodeId,
					details: {
						targetType,
						targetId,
						assignmentId: assignment.id,
						expiresAt: expirationDate?.toISOString(),
					},
				},
			});

			reply.status(201).send(serialize({ success: true, data: assignment }));

			// Broadcast node_assigned event
			const wsGatewayNodeAssigned = (app as any).wsGateway;
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
		{ onRequest: [app.authenticate] },
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
				return reply.status(404).send({ error: "Assignment not found" });
			}

			if (assignment.nodeId !== nodeId) {
				return reply
					.status(404)
					.send({ error: "Assignment not found for this node" });
			}

			// Delete the assignment
			await removeNodeAssignment(prisma, assignmentId);

			// Log the action
			await prisma.auditLog.create({
				data: {
					userId: request.user.userId,
					action: "node.unassign",
					resource: "node",
					resourceId: nodeId,
					details: {
						assignmentId,
						wasUserAssignment: !!assignment.userId,
						wasRoleAssignment: !!assignment.roleId,
					},
				},
			});

			reply.send({ success: true });

			// Broadcast node_unassigned event
			const wsGatewayNodeUnassigned = (app as any).wsGateway;
			if (wsGatewayNodeUnassigned?.pushToAdminSubscribers) {
				wsGatewayNodeUnassigned.pushToAdminSubscribers('node_unassigned', {
					type: 'node_unassigned',
					nodeId,
					targetType: assignment.userId ? 'user' : 'role',
					targetId: assignment.userId || assignment.roleId!,
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
		{ onRequest: [app.authenticate] },
		async (request: FastifyRequest, reply: FastifyReply) => {
			const userId = request.user.userId;

			// Check if user has node.read permission
			if (!ensurePermission(request, reply, "node.read")) return;

			// Get accessible node IDs
			const accessibleResult = await getUserAccessibleNodes(prisma, userId);

			// Fetch node details
			const nodes = await prisma.node.findMany({
				where: {
					id: { in: accessibleResult.nodeIds },
				},
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
					hasWildcard: accessibleResult.hasWildcard,
				}),
			);
		},
	);

	// ============================================================================
	// WILDCARD ASSIGNMENT ROUTE
	// ============================================================================

	// Assign all nodes (wildcard) to user or role
	app.post(
		"/assign-wildcard",
		{ onRequest: [app.authenticate] },
		async (request: FastifyRequest, reply: FastifyReply) => {
			if (!ensurePermission(request, reply, "node.assign")) return;

			const { targetType, targetId, expiresAt } = request.body as {
				targetType: "user" | "role";
				targetId: string;
				expiresAt?: string; // ISO date string
			};

			// Validate targetType
			if (targetType !== "user" && targetType !== "role") {
				return reply
					.status(400)
					.send({ error: "targetType must be 'user' or 'role'" });
			}

			if (!targetId) {
				return reply
					.status(400)
					.send({ error: "targetId is required" });
			}

			// Verify target exists
			if (targetType === "user") {
				const user = await prisma.user.findUnique({
					where: { id: targetId },
				});
				if (!user) {
					return reply.status(404).send({ error: "User not found" });
				}
			} else {
				const role = await prisma.role.findUnique({
					where: { id: targetId },
				});
				if (!role) {
					return reply.status(404).send({ error: "Role not found" });
				}
			}

			// Parse expiration date if provided
			let expirationDate: Date | undefined;
			if (expiresAt) {
				expirationDate = new Date(expiresAt);
				if (isNaN(expirationDate.getTime())) {
					return reply.status(400).send({ error: "Invalid expiresAt date" });
				}
				if (expirationDate <= new Date()) {
					return reply
						.status(400)
						.send({ error: "expiresAt must be in the future" });
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
			await prisma.auditLog.create({
				data: {
					userId: request.user.userId,
					action: `node.assign_wildcard.${targetType}`,
					resource: "node",
					resourceId: "*", // Wildcard indicator
					details: {
						targetType,
						targetId,
						assignmentId: assignment.id,
						expiresAt: expirationDate?.toISOString(),
					},
				},
			});

			reply.status(201).send(serialize({ success: true, data: assignment }));

			// Broadcast wildcard_assigned event
			const wsGatewayWildcardAssigned = (app as any).wsGateway;
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
		{ onRequest: [app.authenticate] },
		async (request: FastifyRequest, reply: FastifyReply) => {
			if (!ensurePermission(request, reply, "node.assign")) return;

			const { targetType, targetId } = request.params as {
				targetType: "user" | "role";
				targetId: string;
			};

			// Validate targetType
			if (targetType !== "user" && targetType !== "role") {
				return reply
					.status(400)
					.send({ error: "targetType must be 'user' or 'role'" });
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
				return reply
					.status(404)
					.send({ error: "Wildcard assignment not found" });
			}

			// Delete the wildcard assignment
			await removeNodeAssignment(prisma, wildcardAssignment.id);

			// Log the action
			await prisma.auditLog.create({
				data: {
					userId: request.user.userId,
					action: "node.unassign_wildcard",
					resource: "node",
					resourceId: "*",
					details: {
						targetType,
						targetId,
						assignmentId: wildcardAssignment.id,
					},
				},
			});

			reply.send({ success: true });

			// Broadcast wildcard_removed event
			const wsGatewayWildcardRemoved = (app as any).wsGateway;
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
}
