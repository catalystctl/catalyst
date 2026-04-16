/**
 * Migration API Routes — Admin endpoints for Pterodactyl → Catalyst migration
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { randomUUID } from "crypto";
import { prisma } from "../db.js";
import { MigrationService } from "../services/migration/index.js";
import { hasPermission } from "../lib/permissions.js";
import { serialize } from "../utils/serialize.js";

// Singleton migration service
let migrationService: MigrationService | null = null;

function getMigrationService(logger: any, app?: any): MigrationService {
  // Always pass the latest app reference so file tunnel is accessible
  if (migrationService && app) {
    migrationService.setApp(app);
  }
  if (!migrationService) {
    migrationService = new MigrationService(prisma, logger, app);
  }
  return migrationService;
}

export async function migrationRoutes(app: FastifyInstance) {
  const logger = app.log;
  const authenticate = (app as any).authenticate;

  // Helper to check admin permission (runs after authenticate preHandler)
  const requireAdmin = async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = (request as any).user?.userId;
    if (!userId) {
      reply.status(401).send({ error: "Not authenticated" });
      return false;
    }
    const isAdmin = await hasPermission(prisma, userId, "admin.write");
    if (!isAdmin) {
      reply.status(403).send({ error: "Admin permission required" });
      return false;
    }
    return true;
  };

  // Auth wrapper: authenticate + admin check
  const withAuth = { preHandler: authenticate };

  /**
   * GET /api/admin/migration/catalyst-nodes
   * List Catalyst nodes available as migration targets (online only)
   */
  app.get("/api/admin/migration/catalyst-nodes", { ...withAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await requireAdmin(request, reply))) return;

    try {
      const nodes = await prisma.node.findMany({
        select: {
          id: true,
          name: true,
          hostname: true,
          publicAddress: true,
          isOnline: true,
          lastSeenAt: true,
          maxMemoryMb: true,
          location: { select: { name: true } },
          servers: { select: { id: true } },
        },
        orderBy: { name: "asc" },
      });

      // Calculate used memory from server allocations
      const nodesWithUsage = await Promise.all(
        nodes.map(async (node) => {
          const serverMemory = await prisma.server.aggregate({
            where: { nodeId: node.id },
            _sum: { allocatedMemoryMb: true },
          });
          return {
            id: node.id,
            name: node.name,
            hostname: node.hostname,
            isOnline: node.isOnline,
            lastSeenAt: node.lastSeenAt?.toISOString() ?? null,
            maxMemoryMb: node.maxMemoryMb,
            usedMemoryMb: serverMemory._sum?.allocatedMemoryMb ?? 0,
            serverCount: node.servers.length,
            locationName: node.location?.name,
          };
        })
      );

      reply.send(serialize(nodesWithUsage));
    } catch (err: any) {
      reply.status(500).send({ error: err.message });
    }
  });

  /**
   * POST /api/admin/migration/test
   * Test Pterodactyl connection
   */
  app.post("/api/admin/migration/test", { ...withAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await requireAdmin(request, reply))) return;

    const body = request.body as any;
    const { url, key, clientApiKey } = body;

    if (!url || !key) {
      reply.status(400).send({ error: "Panel URL and API key are required" });
      return;
    }

    try {
      const service = getMigrationService(logger);
      const result = await service.testConnection(url, key, clientApiKey);
      reply.send(serialize(result));
    } catch (err: any) {
      logger.error({ err }, "Migration test failed");
      reply.status(500).send({ error: err.message || "Connection test failed" });
    }
  });

  /**
   * POST /api/admin/migration/start
   * Start a new migration
   *
   * Body: { url, key, clientApiKey, scope, nodeMappings, serverMappings }
   *   - key: Application API key (ptla_*)
   *   - clientApiKey: Client API key (ptlc_*) — required for backup/file migration
   *   - scope: "full" | "node" | "server"
   *   - nodeMappings: { [pteroNodeId]: catalystNodeId }
   *     Required for "full" and "node" scopes. Maps Ptero nodes to existing Catalyst nodes.
   *   - serverMappings: { [pteroServerId]: catalystNodeId }
   *     Required for "server" scope. Maps individual Ptero servers to Catalyst nodes.
   */
  app.post("/api/admin/migration/start", { ...withAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await requireAdmin(request, reply))) return;

    const body = request.body as any;
    const { url, key, clientApiKey, scope, nodeMappings, serverMappings } = body;

    if (!url || !key) {
      reply.status(400).send({ error: "Panel URL and API key are required" });
      return;
    }

    const migrationScope = scope || "full";
    if (!["full", "node", "server"].includes(migrationScope)) {
      reply.status(400).send({ error: "scope must be full, node, or server" });
      return;
    }

    const mappings = nodeMappings || {};
    const srvMappings = serverMappings || {};

    // Validate mappings based on scope
    if (migrationScope === "full" || migrationScope === "node") {
      if (Object.keys(mappings).length === 0) {
        reply.status(400).send({ error: "nodeMappings is required — map each Pterodactyl node to a Catalyst node" });
        return;
      }
    }
    if (migrationScope === "server") {
      if (Object.keys(srvMappings).length === 0) {
        reply.status(400).send({ error: "serverMappings is required — map each Pterodactyl server to a Catalyst node" });
        return;
      }
    }

    // Validate all target Catalyst nodes exist and are online
    const allTargetNodeIds = new Set<string>();
    for (const catalystId of Object.values(mappings)) allTargetNodeIds.add(String(catalystId));
    for (const catalystId of Object.values(srvMappings)) allTargetNodeIds.add(String(catalystId));

    const targetNodes = await prisma.node.findMany({
      where: { id: { in: [...allTargetNodeIds] } },
      select: { id: true, name: true, isOnline: true },
    });

    const offlineTargets = targetNodes.filter((n) => !n.isOnline);
    if (offlineTargets.length > 0) {
      reply.status(400).send({
        error: "Target Catalyst nodes must be online before migration",
        offlineNodes: offlineTargets.map((n) => ({ id: n.id, name: n.name })),
      });
      return;
    }

    const missingIds = [...allTargetNodeIds].filter((id) => !targetNodes.some((n) => n.id === id));
    if (missingIds.length > 0) {
      reply.status(400).send({ error: "One or more target Catalyst nodes do not exist" });
      return;
    }

    try {
      // Check if there's already a running migration
      const activeJob = await prisma.migrationJob.findFirst({
        where: { status: { in: ["pending", "running", "validating"] } },
      });
      if (activeJob) {
        reply.status(409).send({
          error: "A migration is already in progress",
          jobId: activeJob.id,
        });
        return;
      }

      // Create migration job with a bypass token for file-tunnel size limits
      const bypassToken = randomUUID();
      const job = await prisma.migrationJob.create({
        data: {
          sourceUrl: url,
          sourceKey: key,
          bypassToken,
          config: {
            scope: migrationScope,
            nodeMappings: mappings,
            serverMappings: srvMappings,
            clientApiKey: clientApiKey || null,
            phases: [],
            dryRun: false,
          },
          status: "pending",
          progress: {
            total: 0,
            completed: 0,
            failed: 0,
            skipped: 0,
          },
        },
      });

      // Start migration asynchronously
      const service = getMigrationService(logger, app);
      service.startMigration(job.id).catch(async (err) => {
        logger.error({ jobId: job.id, err }, "Migration failed to start");
        // Mark the job as failed so it doesn't block future migrations
        try {
          await prisma.migrationJob.update({
            where: { id: job.id },
            data: { status: "failed", error: err.message || "Failed to start migration" },
          });
        } catch (updateErr) {
          logger.error({ jobId: job.id, err: updateErr }, "Failed to update job status after start error");
        }
      });

      reply.send({ jobId: job.id });
    } catch (err: any) {
      logger.error({ err }, "Failed to start migration");
      reply.status(500).send({ error: err.message || "Failed to start migration" });
    }
  });

  /**
   * GET /api/admin/migration
   * List all migration jobs
   */
  app.get("/api/admin/migration", { ...withAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await requireAdmin(request, reply))) return;

    try {
      const service = getMigrationService(logger);
      const jobs = await service.listMigrations();
      reply.send(serialize(jobs));
    } catch (err: any) {
      reply.status(500).send({ error: err.message });
    }
  });

  /**
   * GET /api/admin/migration/:jobId
   * Get migration job status
   */
  app.get("/api/admin/migration/:jobId", { ...withAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await requireAdmin(request, reply))) return;

    const { jobId } = request.params as any;

    try {
      const service = getMigrationService(logger);
      const job = await service.getMigrationStatus(jobId);
      if (!job) {
        reply.status(404).send({ error: "Migration job not found" });
        return;
      }
      reply.send(serialize(job));
    } catch (err: any) {
      reply.status(500).send({ error: err.message });
    }
  });

  /**
   * POST /api/admin/migration/:jobId/pause
   */
  app.post("/api/admin/migration/:jobId/pause", { ...withAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await requireAdmin(request, reply))) return;

    const { jobId } = request.params as any;

    try {
      const service = getMigrationService(logger);
      await service.pauseMigration(jobId);
      reply.send({ success: true });
    } catch (err: any) {
      reply.status(500).send({ error: err.message });
    }
  });

  /**
   * POST /api/admin/migration/:jobId/resume
   */
  app.post("/api/admin/migration/:jobId/resume", { ...withAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await requireAdmin(request, reply))) return;

    const { jobId } = request.params as any;

    try {
      const service = getMigrationService(logger);
      await service.resumeMigration(jobId);
      reply.send({ success: true });
    } catch (err: any) {
      reply.status(400).send({ error: err.message });
    }
  });

  /**
   * POST /api/admin/migration/:jobId/cancel
   */
  app.post("/api/admin/migration/:jobId/cancel", { ...withAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await requireAdmin(request, reply))) return;

    const { jobId } = request.params as any;

    try {
      const service = getMigrationService(logger);
      await service.cancelMigration(jobId);
      reply.send({ success: true });
    } catch (err: any) {
      reply.status(500).send({ error: err.message });
    }
  });

  /**
   * GET /api/admin/migration/:jobId/steps
   * Get steps for a migration job
   */
  app.get("/api/admin/migration/:jobId/steps", { ...withAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await requireAdmin(request, reply))) return;

    const { jobId } = request.params as any;
    const query = request.query as any;

    try {
      const where: any = { jobId };
      if (query.phase) where.phase = query.phase;
      if (query.status) where.status = query.status;

      const page = parseInt(query.page || "1", 10);
      const limit = parseInt(query.limit || "50", 10);

      const [steps, total] = await Promise.all([
        prisma.migrationStep.findMany({
          where,
          orderBy: [{ phase: "asc" }, { startedAt: "asc" }],
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.migrationStep.count({ where }),
      ]);

      reply.send(serialize({
        steps,
        total,
        page,
        totalPages: Math.ceil(total / limit),
      }));
    } catch (err: any) {
      reply.status(500).send({ error: err.message });
    }
  });

  /**
   * POST /api/admin/migration/:jobId/retry/:stepId
   * Retry a failed step
   */
  app.post("/api/admin/migration/:jobId/retry/:stepId", { ...withAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await requireAdmin(request, reply))) return;

    const { jobId, stepId } = request.params as any;

    try {
      const step = await prisma.migrationStep.findUnique({
        where: { id: stepId },
      });

      if (!step || step.jobId !== jobId) {
        reply.status(404).send({ error: "Step not found" });
        return;
      }

      if (step.status !== "failed") {
        reply.status(400).send({ error: "Only failed steps can be retried" });
        return;
      }

      const service = getMigrationService(logger);
      await service.retryStep(jobId, stepId);
      reply.send({ success: true });
    } catch (err: any) {
      reply.status(500).send({ error: err.message });
    }
  });
}
