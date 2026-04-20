import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db";
import { createApiKey, deleteApiKey as deleteApiKeyService } from "../services/api-key-service";
import { PERMISSION_CATEGORIES, hasPermission } from "../lib/permissions-catalog";
import { serialize } from '../utils/serialize';

const createApiKeySchema = z.object({
  name: z.string().min(1).max(100),
  expiresIn: z.number().min(3600).max(31536000).optional(),
  allPermissions: z.boolean().optional().default(false),
  permissions: z.array(z.string()).optional().default([]),
  metadata: z.record(z.string(), z.any()).optional(),
  rateLimitMax: z.number().min(1).max(10000).default(100),
  rateLimitTimeWindow: z.number().min(1000).max(3600000).default(60000),
});

const updateApiKeySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  enabled: z.boolean().optional(),
});

export async function apiKeyRoutes(app: FastifyInstance) {
  const authenticate = (app as any).authenticate;

  // Middleware: authenticate + check apikey.manage permission
  const requireApiKeyManage = async (request: any, reply: any) => {
    if (!hasPermission(request, 'apikey.manage')) {
      return reply.status(403).send({ success: false, error: "Requires apikey.manage permission" });
    }
  };

  // ── GET /permissions-catalog ──
  // Returns the full list of permission categories + individual permissions.
  // Used by the frontend to render the permission selector.
  app.get("/api/admin/api-keys/permissions-catalog", {
    preHandler: [authenticate, requireApiKeyManage],
  }, async (_request, reply) => {
    return reply.send({ success: true, data: PERMISSION_CATEGORIES });
  });

  // ── GET /my-permissions ──
  // Returns the current user's effective permissions (resolved from roles).
  // Used by the frontend to cap what permissions can be granted to an API key.
  app.get("/api/admin/api-keys/my-permissions", {
    preHandler: [authenticate, requireApiKeyManage],
  }, async (request: any, reply) => {
    const permissions: string[] = request.user.permissions ?? [];
    return reply.send({ success: true, data: permissions });
  });

  // ── POST / ──
  // Create a new API key with optional permission scoping.
  app.post("/api/admin/api-keys", {
    preHandler: [authenticate, requireApiKeyManage],
  }, async (request: any, reply) => {
    try {
      const body = createApiKeySchema.parse(request.body);
      const userId = request.user.userId;

      // If allPermissions is requested, no need to validate specific permissions.
      // If specific permissions are requested, validate they don't exceed creator's permissions.
      if (!body.allPermissions) {
        const creatorPerms: string[] = request.user.permissions ?? [];
        const hasWildcard = creatorPerms.includes('*');
        const invalidPerms = body.permissions.filter(
          (p) => !hasWildcard && !creatorPerms.includes(p),
        );
        if (invalidPerms.length > 0) {
          return reply.status(403).send({
            success: false,
            error: `Cannot grant permissions you don't have: ${invalidPerms.join(', ')}`,
          });
        }
      }

      const apiKeyData = await createApiKey({
        name: body.name,
        userId,
        expiresIn: body.expiresIn,
        allPermissions: body.allPermissions,
        permissions: body.allPermissions ? [] : body.permissions,
        metadata: body.metadata,
        rateLimitEnabled: true,
        rateLimitMax: body.rateLimitMax,
        rateLimitTimeWindow: body.rateLimitTimeWindow,
      });

      // Audit log
      await prisma.auditLog.create({
        data: {
          userId,
          action: "api_key.create",
          resource: "apikey",
          resourceId: apiKeyData.id,
          details: {
            name: body.name,
            allPermissions: body.allPermissions,
            permissionCount: body.allPermissions ? -1 : body.permissions.length,
            expiresAt: apiKeyData.expiresAt,
          },
        },
      });

      // Broadcast api_key_created event
      const wsGatewayApiKeyCreated = (app as any).wsGateway;
      if (wsGatewayApiKeyCreated?.pushToAdminSubscribers) {
        wsGatewayApiKeyCreated.pushToAdminSubscribers('api_key_created', {
          type: 'api_key_created',
          keyId: apiKeyData.id,
          keyName: body.name,
          createdBy: request.user.userId,
          timestamp: new Date().toISOString(),
        });
      }

      return reply.send(serialize({ success: true, data: apiKeyData }));
    } catch (error: any) {
      request.log.error(error, "Failed to create API key");
      return reply.status(500).send({
        success: false,
        error: error.message || "Failed to create API key",
      });
    }
  });

  // ── GET / ──
  // List all API keys.
  app.get("/api/admin/api-keys", {
    preHandler: [authenticate, requireApiKeyManage],
  }, async (request, reply) => {
    try {
      const apiKeys = await prisma.apikey.findMany({
        select: {
          id: true,
          name: true,
          prefix: true,
          start: true,
          enabled: true,
          expiresAt: true,
          lastRequest: true,
          requestCount: true,
          rateLimitMax: true,
          rateLimitTimeWindow: true,
          allPermissions: true,
          permissions: true,
          metadata: true,
          createdAt: true,
          updatedAt: true,
          userId: true,
          user: {
            select: { id: true, username: true, email: true },
          },
        },
        orderBy: { createdAt: "desc" },
      });

      return reply.send(serialize({ success: true, data: apiKeys }));
    } catch (error: any) {
      request.log.error(error, "Failed to list API keys");
      return reply.status(500).send({ success: false, error: "Failed to list API keys" });
    }
  });

  // ── GET /:id ──
  app.get<{ Params: { id: string } }>("/api/admin/api-keys/:id", {
    preHandler: [authenticate, requireApiKeyManage],
  }, async (request, reply) => {
    try {
      const { id } = request.params;
      const apiKey = await prisma.apikey.findUnique({
        where: { id },
        select: {
          id: true, name: true, prefix: true, start: true, enabled: true,
          expiresAt: true, lastRequest: true, requestCount: true, remaining: true,
          rateLimitMax: true, rateLimitTimeWindow: true,
          allPermissions: true, permissions: true, metadata: true,
          createdAt: true, updatedAt: true, userId: true,
        },
      });

      if (!apiKey) {
        return reply.status(404).send({ success: false, error: "API key not found" });
      }

      return reply.send(serialize({ success: true, data: apiKey }));
    } catch (error: any) {
      request.log.error(error, "Failed to get API key");
      return reply.status(500).send({ success: false, error: "Failed to get API key" });
    }
  });

  // ── PATCH /:id ──
  app.patch<{ Params: { id: string } }>("/api/admin/api-keys/:id", {
    preHandler: [authenticate, requireApiKeyManage],
  }, async (request: any, reply) => {
    try {
      const { id } = request.params;
      const body = updateApiKeySchema.parse(request.body);

      const apiKey = await prisma.apikey.update({
        where: { id },
        data: { name: body.name, enabled: body.enabled, updatedAt: new Date() },
        select: { id: true, name: true, enabled: true, expiresAt: true, lastRequest: true, updatedAt: true },
      });

      await prisma.auditLog.create({
        data: {
          userId: request.user.userId,
          action: "api_key.update",
          resource: "apikey",
          resourceId: id,
          details: body,
        },
      });

      // Broadcast api_key_updated event
      const wsGatewayApiKeyUpdated = (app as any).wsGateway;
      if (wsGatewayApiKeyUpdated?.pushToAdminSubscribers) {
        wsGatewayApiKeyUpdated.pushToAdminSubscribers('api_key_updated', {
          type: 'api_key_updated',
          keyId: apiKey.id,
          keyName: apiKey.name,
          updatedBy: request.user.userId,
          timestamp: new Date().toISOString(),
        });
      }

      return reply.send(serialize({ success: true, data: apiKey }));
    } catch (error: any) {
      request.log.error(error, "Failed to update API key");
      return reply.status(500).send({ success: false, error: "Failed to update API key" });
    }
  });

  // ── DELETE /:id ──
  app.delete<{ Params: { id: string } }>("/api/admin/api-keys/:id", {
    preHandler: [authenticate, requireApiKeyManage],
  }, async (request: any, reply) => {
    try {
      const { id } = request.params;
      const apiKey = await prisma.apikey.findUnique({
        where: { id },
        select: { name: true },
      });

      if (!apiKey) {
        return reply.status(404).send({ success: false, error: "API key not found" });
      }

      await deleteApiKeyService(id);

      await prisma.auditLog.create({
        data: {
          userId: request.user.userId,
          action: "api_key.delete",
          resource: "apikey",
          resourceId: id,
          details: { name: apiKey.name },
        },
      });

      // Broadcast api_key_deleted event
      const wsGatewayApiKeyDeleted = (app as any).wsGateway;
      if (wsGatewayApiKeyDeleted?.pushToAdminSubscribers) {
        wsGatewayApiKeyDeleted.pushToAdminSubscribers('api_key_deleted', {
          type: 'api_key_deleted',
          keyId: id,
          keyName: apiKey.name,
          deletedBy: request.user.userId,
          timestamp: new Date().toISOString(),
        });
      }

      return reply.send({ success: true, message: "API key deleted successfully" });
    } catch (error: any) {
      request.log.error(error, "Failed to delete API key");
      return reply.status(500).send({ success: false, error: "Failed to delete API key" });
    }
  });

  // ── GET /:id/usage ──
  app.get<{ Params: { id: string } }>("/api/admin/api-keys/:id/usage", {
    preHandler: [authenticate, requireApiKeyManage],
  }, async (request, reply) => {
    try {
      const { id } = request.params;
      const apiKey = await prisma.apikey.findUnique({
        where: { id },
        select: {
          requestCount: true, remaining: true, lastRequest: true,
          rateLimitMax: true, rateLimitTimeWindow: true, createdAt: true,
        },
      });

      if (!apiKey) {
        return reply.status(404).send({ success: false, error: "API key not found" });
      }

      return reply.send(serialize({
        success: true,
        data: {
          totalRequests: apiKey.requestCount || 0,
          remaining: apiKey.remaining,
          lastUsed: apiKey.lastRequest,
          rateLimit: { max: apiKey.rateLimitMax, windowMs: apiKey.rateLimitTimeWindow },
          createdAt: apiKey.createdAt,
        },
      }));
    } catch (error: any) {
      request.log.error(error, "Failed to get API key usage");
      return reply.status(500).send({ success: false, error: "Failed to get API key usage" });
    }
  });
}
