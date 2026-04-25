import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../../db.js";
import { DatabaseProvisioningError, dropDatabase, ensureDatabasePermission, generateSafeIdentifier, isValidDatabaseIdentifier, provisionDatabase, rotateDatabasePassword, toDatabaseIdentifier } from './_helpers.js';

export async function serverDatabasesRoutes(app: FastifyInstance) {
  app.get(
    "/:serverId/databases",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;

      const canAccess = await ensureDatabasePermission(
        serverId,
        userId,
        reply,
        "database.read",
        "You do not have permission to view databases for this server"
      );
      if (!canAccess) {
        return;
      }

      const databases = await prisma.serverDatabase.findMany({
        where: { serverId },
        include: {
          host: {
            select: {
              id: true,
              name: true,
              host: true,
              port: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      });

      reply.send({
        success: true,
        data: databases.map((db) => ({
          id: db.id,
          name: db.name,
          username: db.username,
          password: db.password,
          host: db.host.host,
          port: db.host.port,
          hostId: db.hostId,
          hostName: db.host.name,
          createdAt: db.createdAt,
        })),
      });
    }
  );

  // Create server database
  app.post(
    "/:serverId/databases",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;
      const { name, hostId } = request.body as { name?: string; hostId: string };

      const canAccess = await ensureDatabasePermission(
        serverId,
        userId,
        reply,
        "database.create",
        "You do not have permission to create databases for this server"
      );
      if (!canAccess) {
        return;
      }

      if (!hostId) {
        return reply.status(400).send({ error: "hostId is required" });
      }

       const server = await prisma.server.findUnique({
         where: { id: serverId },
         select: { databaseAllocation: true },
       });

       if (!server) {
         return reply.status(404).send({ error: "Server not found" });
       }

       const allocationLimit = server.databaseAllocation ?? 0;
       if (!Number.isFinite(allocationLimit) || allocationLimit <= 0) {
         return reply.status(403).send({ error: "Database allocation disabled for this server" });
       }

       const existingCount = await prisma.serverDatabase.count({ where: { serverId } });
       if (existingCount >= allocationLimit) {
         return reply.status(409).send({ error: "Database allocation limit reached" });
       }

       const host = await prisma.databaseHost.findUnique({
         where: { id: hostId },
       });

       if (!host) {
         return reply.status(404).send({ error: "Database host not found" });
       }

      const normalizedName = name ? toDatabaseIdentifier(name.trim()) : "";
      const databaseName =
        normalizedName.length >= 3 ? normalizedName : generateSafeIdentifier("srv_", 12);

      if (!isValidDatabaseIdentifier(databaseName)) {
        return reply.status(400).send({
          error: "Database name must start with a letter and use only lowercase letters, numbers, and underscores (max 32 chars)",
        });
      }

      const databaseUsername = generateSafeIdentifier("u", 12);
      const databasePassword = generateSafeIdentifier("p", 24);

      if (!isValidDatabaseIdentifier(databaseUsername)) {
        return reply.status(500).send({ error: "Generated database username is invalid" });
      }

      if (databasePassword.length < 16) {
        return reply.status(500).send({ error: "Generated database password is too short" });
      }

      try {
        await provisionDatabase(host, databaseName, databaseUsername, databasePassword);
        const database = await prisma.serverDatabase.create({
          data: {
            serverId,
            hostId,
            name: databaseName,
            username: databaseUsername,
            password: databasePassword,
          },
        });

        await prisma.auditLog.create({
          data: {
            userId,
            action: "database.create",
            resource: "server",
            resourceId: serverId,
            details: {
              hostId,
              name: database.name,
            },
          },
        });

        // Broadcast database_created event
        const wsGatewayDbCreated = (app as any).wsGateway;
        if (wsGatewayDbCreated?.pushToAdminSubscribers) {
          wsGatewayDbCreated.pushToAdminSubscribers('database_created', {
            type: 'database_created',
            serverId,
            databaseId: database.id,
            databaseName: database.name,
            createdBy: userId,
            timestamp: new Date().toISOString(),
          });
        }

        reply.status(201).send({
          success: true,
          data: {
            id: database.id,
            name: database.name,
            username: database.username,
            password: database.password,
            host: host.host,
            port: host.port,
            hostId: host.id,
            hostName: host.name,
            createdAt: database.createdAt,
          },
        });
      } catch (error: any) {
        if (error instanceof DatabaseProvisioningError) {
          return reply.status(error.statusCode).send({ error: error.message });
        }
        return reply.status(500).send({ error: "Database provisioning failed" });
      }
    }
  );

  // Rotate server database password
  app.post(
    "/:serverId/databases/:databaseId/rotate",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId, databaseId } = request.params as {
        serverId: string;
        databaseId: string;
      };
      const userId = request.user.userId;

      const canAccess = await ensureDatabasePermission(
        serverId,
        userId,
        reply,
        "database.rotate",
        "You do not have permission to rotate database credentials"
      );
      if (!canAccess) {
        return;
      }

      const database = await prisma.serverDatabase.findFirst({
        where: { id: databaseId, serverId },
        include: {
          host: true,
        },
      });

      if (!database) {
        return reply.status(404).send({ error: "Database not found" });
      }

      const nextPassword = generateSafeIdentifier("p", 24);

      try {
        await rotateDatabasePassword(database.host, database.username, nextPassword);
      } catch (error: any) {
        if (error instanceof DatabaseProvisioningError) {
          return reply.status(error.statusCode).send({ error: error.message });
        }
        return reply.status(500).send({ error: "Database password rotation failed" });
      }

      const updated = await prisma.serverDatabase.update({
        where: { id: database.id },
        data: { password: nextPassword },
      });

      await prisma.auditLog.create({
        data: {
          userId,
          action: "database.rotate",
          resource: "server",
          resourceId: serverId,
          details: {
            databaseId: database.id,
            name: database.name,
          },
        },
      });

      // Broadcast database_password_rotated event
      const wsGatewayDbRotated = (app as any).wsGateway;
      if (wsGatewayDbRotated?.pushToAdminSubscribers) {
        wsGatewayDbRotated.pushToAdminSubscribers('database_password_rotated', {
          type: 'database_password_rotated',
          serverId,
          databaseId: database.id,
          databaseName: database.name,
          rotatedBy: userId,
          timestamp: new Date().toISOString(),
        });
      }

      reply.send({
        success: true,
        data: {
          id: updated.id,
          name: updated.name,
          username: updated.username,
          password: updated.password,
          host: database.host.host,
          port: database.host.port,
          hostId: database.host.id,
          hostName: database.host.name,
          createdAt: updated.createdAt,
        },
      });
    }
  );

  // Delete server database
  app.delete(
    "/:serverId/databases/:databaseId",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId, databaseId } = request.params as {
        serverId: string;
        databaseId: string;
      };
      const userId = request.user.userId;

      const canAccess = await ensureDatabasePermission(
        serverId,
        userId,
        reply,
        "database.delete",
        "You do not have permission to delete databases for this server"
      );
      if (!canAccess) {
        return;
      }

      const database = await prisma.serverDatabase.findFirst({
        where: { id: databaseId, serverId },
      });

      if (!database) {
        return reply.status(404).send({ error: "Database not found" });
      }

      const host = await prisma.databaseHost.findUnique({
        where: { id: database.hostId },
      });

      if (!host) {
        return reply.status(404).send({ error: "Database host not found" });
      }

      try {
        await dropDatabase(host, database.name, database.username);
      } catch (error: any) {
        if (error instanceof DatabaseProvisioningError) {
          return reply.status(error.statusCode).send({ error: error.message });
        }
        return reply.status(500).send({ error: "Database deletion failed" });
      }

      await prisma.serverDatabase.delete({ where: { id: database.id } });

      await prisma.auditLog.create({
        data: {
          userId,
          action: "database.delete",
          resource: "server",
          resourceId: serverId,
          details: { databaseId },
        },
      });

      // Broadcast database_deleted event
      const wsGatewayDbDeleted = (app as any).wsGateway;
      if (wsGatewayDbDeleted?.pushToAdminSubscribers) {
        wsGatewayDbDeleted.pushToAdminSubscribers('database_deleted', {
          type: 'database_deleted',
          serverId,
          databaseId,
          deletedBy: userId,
          timestamp: new Date().toISOString(),
        });
      }

      reply.send({ success: true });
    }
  );

  // Install server (sends install command to agent)
}
