import { prisma } from '../db.js';
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { PrismaClient } from "@prisma/client";
import { v4 as uuidv4 } from "uuid";
import { randomBytes, timingSafeEqual } from "crypto";
import { listAvailableIps, summarizePool } from "../utils/ipam";
import { Prisma } from "@prisma/client";
import { auth } from "../auth";
import { serialize } from '../utils/serialize';

import { hasPermission } from "../lib/permissions";

const ensurePermission = async (
  prisma: PrismaClient,
  userId: string,
  reply: FastifyReply,
  requiredPermission: string,
  nodeId?: string
) => {
  const has = await hasPermission(prisma, userId, requiredPermission, nodeId);
  if (!has) {
    reply.status(403).send({ error: "Insufficient permissions" });
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
      if (!ipRegex.test(base) || Number.isNaN(prefix) || prefix < 0 || prefix > 32) {
        throw new Error(`Invalid CIDR: ${entry}`);
      }
      const parts = base.split(".").map((part) => Number(part));
      const ipInt =
        ((parts[0] << 24) >>> 0) +
        ((parts[1] << 16) >>> 0) +
        ((parts[2] << 8) >>> 0) +
        (parts[3] >>> 0);
      const mask = prefix === 0 ? 0 : ((~0 << (32 - prefix)) >>> 0);
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
      const hasPerm = await ensurePermission(prisma, request.user.userId, reply, "node.create");
      if (!hasPerm) return;
      const { name, description, locationId, hostname, publicAddress, maxMemoryMb, maxCpuCores, serverDataDir } =
        request.body as {
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
      if (!name || !locationId || !hostname || !publicAddress || !maxMemoryMb || !maxCpuCores) {
        return reply.status(400).send({ error: "Missing required fields" });
      }

      // Validate positive values
      if (maxMemoryMb <= 0) {
        return reply.status(400).send({ error: "maxMemoryMb must be positive" });
      }

      if (maxCpuCores <= 0) {
        return reply.status(400).send({ error: "maxCpuCores must be positive" });
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

      const { secret: _secret, ...safeNode } = node;
      reply.send(serialize({ success: true, data: safeNode }));
    }
  );

  // List nodes
  app.get(
    "/",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const hasPerm = await ensurePermission(prisma, request.user.userId, reply, "node.read");
      if (!hasPerm) return;

      const nodes = await prisma.node.findMany({
        omit: { secret: true },
        include: {
          _count: {
            select: { servers: true },
          },
        },
      });

      reply.send(serialize({ success: true, data: nodes }));
    }
  );

  // Get node details
  app.get(
    "/:nodeId",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const hasPerm = await ensurePermission(prisma, request.user.userId, reply, "node.read");
      if (!hasPerm) return;
      const { nodeId } = request.params as { nodeId: string };

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
    }
  );

  // Generate deployment token
  app.post(
    "/:nodeId/deployment-token",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const hasPerm = await ensurePermission(prisma, request.user.userId, reply, "node.create");
      if (!hasPerm) return;
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
      let apiKey: string | null = null;
      try {
        const apiKeyResponse = await auth.api.createApiKey({
          body: {
            name: `agent-${nodeId.slice(0, 8)}`,
            userId: request.user.userId,
            prefix: "catalyst",
            // No expiresIn = never expires
            metadata: {
              nodeId,
              purpose: "agent",
            },
          },
        } as any);
        apiKey = (apiKeyResponse as any)?.key ?? null;
        if (!apiKey) {
          request.log.warn({ nodeId }, "Failed to create agent API key for deployment");
        }
      } catch (error) {
        request.log.error({ error, nodeId }, "Failed to create agent API key for deployment");
      }

      reply.send({
        success: true,
        data: {
          deploymentToken: deploymentToken.token,
          secret: deploymentToken.secret,
          apiKey: apiKey ?? null,
          deployUrl,
          expiresAt,
        },
      });
    }
  );

  // Check if API key exists for agent
  app.get(
    "/:nodeId/api-key",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const hasPerm = await ensurePermission(prisma, request.user.userId, reply, "node.read");
      if (!hasPerm) return;
      const { nodeId } = request.params as { nodeId: string };

      const node = await prisma.node.findUnique({
        where: { id: nodeId },
      });

      if (!node) {
        return reply.status(404).send({ error: "Node not found" });
      }

      // Find existing API key for this node
      // Metadata is stored as stringified JSON, so use string_contains
      const existingKey = await prisma.apikey.findFirst({
        where: {
          metadata: {
            string_contains: `"nodeId":"${nodeId}"`,
          },
        },
        select: {
          id: true,
          name: true,
          start: true,
          prefix: true,
          createdAt: true,
          enabled: true,
        },
      });

      reply.send({
        success: true,
        data: {
          exists: !!existingKey,
          apiKey: existingKey ? {
            id: existingKey.id,
            name: existingKey.name,
            preview: existingKey.start ? `${existingKey.start}${'*'.repeat(40)}` : null,
            createdAt: existingKey.createdAt,
            enabled: existingKey.enabled,
          } : null,
        },
      });
    }
  );

  // Generate API key for agent
  app.post(
    "/:nodeId/api-key",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const hasPerm = await ensurePermission(prisma, request.user.userId, reply, "node.create");
      if (!hasPerm) return;
      const { nodeId } = request.params as { nodeId: string };
      const { regenerate } = (request.body as { regenerate?: boolean }) || {};

      const node = await prisma.node.findUnique({
        where: { id: nodeId },
      });

      if (!node) {
        return reply.status(404).send({ error: "Node not found" });
      }

      // Check for existing API key
      // Metadata is stored as stringified JSON, so use string_contains
      const existingKey = await prisma.apikey.findFirst({
        where: {
          metadata: {
            string_contains: `"nodeId":"${nodeId}"`,
          },
        },
      });

      if (existingKey && !regenerate) {
        return reply.status(409).send({ 
          error: "API key already exists for this node",
          existingKeyId: existingKey.id,
          existingKeyPreview: existingKey.start ? `${existingKey.start}${'*'.repeat(40)}` : null,
        });
      }

      // If regenerating, delete the old key first
      if (existingKey && regenerate) {
        try {
          await auth.api.deleteApiKey({
            body: { keyId: existingKey.id },
          } as any);
          request.log.info({ keyId: existingKey.id, nodeId }, "Deleted old API key for regeneration");
        } catch (error) {
          request.log.error({ error, keyId: existingKey.id }, "Failed to delete old API key");
          return reply.status(500).send({ error: "Failed to delete old API key" });
        }
      }

      try {
        const apiKeyResponse = await auth.api.createApiKey({
          body: {
            name: `agent-${nodeId.slice(0, 8)}`,
            userId: request.user.userId,
            prefix: "catalyst",
            metadata: {
              nodeId,
              purpose: "agent",
            },
          },
        } as any);
        request.log.info({ apiKeyResponse }, "API key creation response");
        const apiKey = (apiKeyResponse as any)?.key ?? null;
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
    }
  );

  // Update node configuration
  app.put(
    "/:nodeId",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const hasPerm = await ensurePermission(prisma, request.user.userId, reply, "node.update");
      if (!hasPerm) return;
      const { nodeId } = request.params as { nodeId: string };
      const { name, description, hostname, publicAddress, maxMemoryMb, maxCpuCores, serverDataDir } =
        request.body as {
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
        return reply.status(400).send({ error: "maxMemoryMb must be positive" });
      }

      if (maxCpuCores !== undefined && maxCpuCores <= 0) {
        return reply.status(400).send({ error: "maxCpuCores must be positive" });
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
    }
  );

  // Get node statistics
  app.get(
    "/:nodeId/stats",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const hasPerm = await ensurePermission(prisma, request.user.userId, reply, "node.view_stats");
      if (!hasPerm) return;
      const { nodeId } = request.params as { nodeId: string };

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
        0
      );
      const totalAllocatedCpu = node.servers.reduce(
        (sum, server) => sum + (server.allocatedCpuCores || 0),
        0
      );

      const runningServers = node.servers.filter(
        (s) => s.status === "running" || s.status === "starting"
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
            actualMemoryTotalMb: latestMetrics?.memoryTotalMb || node.maxMemoryMb,
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
    }
  );

  // Update node status (called by agent via heartbeat)
  app.post(
    "/:nodeId/heartbeat",
    { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { nodeId } = request.params as { nodeId: string };
      const { secret, health } = request.body as {
        secret: string;
        health: {
          cpuPercent: number;
          memoryUsageMb: number;
          memoryTotalMb?: number;
          diskUsageMb?: number;
          diskTotalMb?: number;
          containerCount: number;
        };
      };

      if (!secret) {
        return reply.status(401).send({ error: "Unauthorized" });
      }

      const node = await prisma.node.findUnique({
        where: { id: nodeId },
      });

      if (
        !node ||
        secret.length !== node.secret.length ||
        !timingSafeEqual(Buffer.from(secret), Buffer.from(node.secret))
      ) {
        return reply.status(401).send({ error: "Unauthorized" });
      }

      const cpuPercent = Number(health?.cpuPercent);
      const memoryUsageMb = Number(health?.memoryUsageMb);
      const memoryTotalMb = Number(health?.memoryTotalMb ?? node.maxMemoryMb);
      const diskUsageMb = Number(health?.diskUsageMb ?? 0);
      const diskTotalMb = Number(health?.diskTotalMb ?? 0);
      const containerCount = Number(health?.containerCount);

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
          networkRxBytes: BigInt(0),
          networkTxBytes: BigInt(0),
          containerCount: Math.max(0, Math.round(containerCount)),
        },
      });

      reply.send({ success: true });
    }
  );

  // Delete node
  app.delete(
    "/:nodeId",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const hasPerm = await ensurePermission(prisma, request.user.userId, reply, "node.delete");
      if (!hasPerm) return;
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

      await prisma.node.delete({ where: { id: nodeId } });

      reply.send({ success: true });
    }
  );

  // List IP pools (macvlan interfaces) for a node
  app.get(
    "/:nodeId/ip-pools",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const hasPerm = await ensurePermission(prisma, request.user.userId, reply, "node.read");
      if (!hasPerm) return;
      const { nodeId } = request.params as { nodeId: string };

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
          availableCount: Math.max(0, summary.total - summary.reservedCount - usedCount),
        };
      });

      reply.send(serialize({ success: true, data }));
    }
  );

  // List available IPs from IPAM pool for a node/network
  app.get(
    "/:nodeId/ip-availability",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const hasPerm = await ensurePermission(prisma, request.user.userId, reply, "node.read");
      if (!hasPerm) return;
      const { nodeId } = request.params as { nodeId: string };
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
        return reply.status(404).send({ error: "No IP pool configured for this network" });
      }

      reply.send(serialize({ success: true, data: available }));
    }
  );

  // Node allocations (Pterodactyl-style)
  app.get(
    "/:nodeId/allocations",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const hasPerm = await ensurePermission(prisma, request.user.userId, reply, "node.manage_allocation");
      if (!hasPerm) return;
      const { nodeId } = request.params as { nodeId: string };
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
                { alias: { contains: searchQuery, mode: "insensitive" as const } },
                { notes: { contains: searchQuery, mode: "insensitive" as const } },
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
    }
  );

  app.post(
    "/:nodeId/allocations",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const hasPerm = await ensurePermission(prisma, request.user.userId, reply, "node.manage_allocation");
      if (!hasPerm) return;
      const { nodeId } = request.params as { nodeId: string };
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
        return reply.status(400).send({ error: "Allocation request too large" });
      }

      const created = await prisma.$transaction(async (tx) => {
        const rows = ips.flatMap((addr) =>
          portList.map((port) => ({
            nodeId,
            ip: addr,
            port,
            alias: alias || null,
            notes: notes || null,
          }))
        );
        return tx.nodeAllocation.createMany({
          data: rows,
          skipDuplicates: true,
        });
      });

      reply.status(201).send({ success: true, data: { created: created.count } });
    }
  );

  app.patch(
    "/:nodeId/allocations/:allocationId",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const hasPerm = await ensurePermission(prisma, request.user.userId, reply, "node.manage_allocation");
      if (!hasPerm) return;
      const { nodeId, allocationId } = request.params as {
        nodeId: string;
        allocationId: string;
      };
      const { alias, notes } = request.body as { alias?: string; notes?: string };

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
    }
  );

  app.delete(
    "/:nodeId/allocations/:allocationId",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const hasPerm = await ensurePermission(prisma, request.user.userId, reply, "node.manage_allocation");
      if (!hasPerm) return;
      const { nodeId, allocationId } = request.params as {
        nodeId: string;
        allocationId: string;
      };

      const allocation = await prisma.nodeAllocation.findUnique({
        where: { id: allocationId },
      });
      if (!allocation || allocation.nodeId !== nodeId) {
        return reply.status(404).send({ error: "Allocation not found" });
      }
      if (allocation.serverId) {
        return reply.status(409).send({ error: "Allocation is assigned to a server" });
      }

      await prisma.nodeAllocation.delete({ where: { id: allocationId } });
      reply.send({ success: true });
    }
  );
}
