import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db";
import { Permission } from "../shared-types";
import { auth } from "../auth";
import { createApiKey } from "../services/api-key-service";
import { serialize } from '../utils/serialize';

const createApiKeySchema = z.object({
  name: z.string().min(1).max(100),
  expiresIn: z.number().min(3600).max(31536000).optional(), // Optional - if not provided, never expires
  permissions: z.record(z.string(), z.array(z.string())).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
  rateLimitMax: z.number().min(1).max(10000).default(100),
  rateLimitTimeWindow: z.number().min(1000).max(3600000).default(60000), // 1 minute default
});

const updateApiKeySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  enabled: z.boolean().optional(),
});

export async function apiKeyRoutes(app: FastifyInstance) {
  // Middleware to check API key management permission
  const checkPermission = async (request: any, reply: any) => {
    const session = await auth.api.getSession({ headers: request.headers });
    
    if (!session?.user) {
      return reply.status(401).send({ success: false, error: "Unauthorized" });
    }

    // Check if user has admin role or apikey.manage permission
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      include: { roles: true },
    });

    const isAdmin = user?.role === "administrator" || user?.roles.some(r => r.name === "administrator");
    const hasPermission = user?.roles.some(role => 
      role.permissions.includes(Permission.APIKEY_MANAGE)
    );

    if (!isAdmin && !hasPermission) {
      return reply.status(403).send({ 
        success: false, 
        error: "Insufficient permissions. Requires apikey.manage permission." 
      });
    }

    request.user = session.user;
  };

  // Create API key
  app.post("/api/admin/api-keys", {
    preHandler: checkPermission,
  }, async (request, reply) => {
    try {
      // Validate body with Zod
      const body = createApiKeySchema.parse(request.body);
      const userId = (request as any).user.id;

      // Create API key using standalone service
      const response = await createApiKey({
        name: body.name,
        userId,
        expiresIn: body.expiresIn,
        prefix: "catalyst",
        permissions: body.permissions as Record<string, string[]> | undefined,
        metadata: body.metadata as Record<string, unknown> | undefined,
        rateLimitEnabled: true,
        rateLimitMax: body.rateLimitMax,
        rateLimitTimeWindow: body.rateLimitTimeWindow,
      });

      // Extract data from response
      const apiKeyData = response;

      // Audit log
      await prisma.auditLog.create({
        data: {
          userId,
          action: "api_key.create",
          resource: "apikey",
          resourceId: apiKeyData.id || "unknown",
          details: {
            name: body.name,
            expiresAt: apiKeyData.expiresAt,
          },
        },
      });

      return reply.send(serialize({
        success: true,
        data: apiKeyData,
      }));
    } catch (error: any) {
      request.log.error(error, "Failed to create API key");
      return reply.status(500).send({
        success: false,
        error: error.message || "Failed to create API key",
      });
    }
  });

  // List all API keys
  app.get("/api/admin/api-keys", {
    preHandler: checkPermission,
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
          permissions: true,
          metadata: true,
          createdAt: true,
          updatedAt: true,
          userId: true,
          user: {
            select: {
              id: true,
              username: true,
              email: true,
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
      });

      return reply.send(serialize({
        success: true,
        data: apiKeys,
      }));
    } catch (error: any) {
      request.log.error(error, "Failed to list API keys");
      return reply.status(500).send({
        success: false,
        error: "Failed to list API keys",
      });
    }
  });

  // Get specific API key
  app.get<{ Params: { id: string } }>("/api/admin/api-keys/:id", {
    preHandler: checkPermission,
  }, async (request, reply) => {
    try {
      const { id } = request.params;

      const apiKey = await prisma.apikey.findUnique({
        where: { id },
        select: {
          id: true,
          name: true,
          prefix: true,
          start: true,
          enabled: true,
          expiresAt: true,
          lastRequest: true,
          requestCount: true,
          remaining: true,
          rateLimitMax: true,
          rateLimitTimeWindow: true,
          permissions: true,
          metadata: true,
          createdAt: true,
          updatedAt: true,
          userId: true,
        },
      });

      if (!apiKey) {
        return reply.status(404).send({
          success: false,
          error: "API key not found",
        });
      }

      return reply.send(serialize({
        success: true,
        data: apiKey,
      }));
    } catch (error: any) {
      request.log.error(error, "Failed to get API key");
      return reply.status(500).send({
        success: false,
        error: "Failed to get API key",
      });
    }
  });

  // Update API key (name, enabled status)
  app.patch<{ Params: { id: string } }>("/api/admin/api-keys/:id", {
    preHandler: checkPermission,
  }, async (request, reply) => {
    try {
      const { id } = request.params;
      const body = updateApiKeySchema.parse(request.body);
      const userId = (request as any).user.id;

      const apiKey = await prisma.apikey.update({
        where: { id },
        data: {
          name: body.name,
          enabled: body.enabled,
          updatedAt: new Date(),
        },
        select: {
          id: true,
          name: true,
          enabled: true,
          expiresAt: true,
          lastRequest: true,
          updatedAt: true,
        },
      });

      // Audit log
      await prisma.auditLog.create({
        data: {
          userId,
          action: "api_key.update",
          resource: "apikey",
          resourceId: id,
          details: body,
        },
      });

      return reply.send(serialize({
        success: true,
        data: apiKey,
      }));
    } catch (error: any) {
      request.log.error(error, "Failed to update API key");
      return reply.status(500).send({
        success: false,
        error: "Failed to update API key",
      });
    }
  });

  // Delete API key (revoke)
  app.delete<{ Params: { id: string } }>("/api/admin/api-keys/:id", {
    preHandler: checkPermission,
  }, async (request, reply) => {
    try {
      const { id } = request.params;
      const userId = (request as any).user.id;

      const apiKey = await prisma.apikey.findUnique({
        where: { id },
        select: { name: true },
      });

      if (!apiKey) {
        return reply.status(404).send({
          success: false,
          error: "API key not found",
        });
      }

      await prisma.apikey.delete({
        where: { id },
      });

      // Audit log
      await prisma.auditLog.create({
        data: {
          userId,
          action: "api_key.delete",
          resource: "apikey",
          resourceId: id,
          details: { name: apiKey.name },
        },
      });

      return reply.send({
        success: true,
        message: "API key deleted successfully",
      });
    } catch (error: any) {
      request.log.error(error, "Failed to delete API key");
      return reply.status(500).send({
        success: false,
        error: "Failed to delete API key",
      });
    }
  });

  // Get API key usage statistics
  app.get<{ Params: { id: string } }>("/api/admin/api-keys/:id/usage", {
    preHandler: checkPermission,
  }, async (request, reply) => {
    try {
      const { id } = request.params;

      const apiKey = await prisma.apikey.findUnique({
        where: { id },
        select: {
          requestCount: true,
          remaining: true,
          lastRequest: true,
          rateLimitMax: true,
          rateLimitTimeWindow: true,
          createdAt: true,
        },
      });

      if (!apiKey) {
        return reply.status(404).send({
          success: false,
          error: "API key not found",
        });
      }

      return reply.send(serialize({
        success: true,
        data: {
          totalRequests: apiKey.requestCount || 0,
          remaining: apiKey.remaining,
          lastUsed: apiKey.lastRequest,
          rateLimit: {
            max: apiKey.rateLimitMax,
            windowMs: apiKey.rateLimitTimeWindow,
          },
          createdAt: apiKey.createdAt,
        },
      }));
    } catch (error: any) {
      request.log.error(error, "Failed to get API key usage");
      return reply.status(500).send({
        success: false,
        error: "Failed to get API key usage",
      });
    }
  });
}
