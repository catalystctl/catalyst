import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../../db.js";
import { createAuditLog } from '../../middleware/audit.js';
import { DatabaseProvisioningError, dropDatabase, ensureDatabasePermission, generateSafeIdentifier, isValidDatabaseIdentifier, provisionDatabase, rotateDatabasePassword, toDatabaseIdentifier } from './_helpers.js';
import { apiError } from "../../lib/http-error";
import { ErrorCodes } from "../../shared-types";

export async function serverDatabasesRoutes(app: FastifyInstance) {
  // Static path — must not be captured by GET /:serverId
  app.get(
    "/database-hosts",
    { schema: { summary: "List database hosts", description: "List database hosts.", tags: ["Databases"], response: { 200: { type: "object", additionalProperties: true } } },  onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = (request as any).user?.userId;
      const { hasGrant } = await import("../../lib/permissions.js");
      // request.user.permissions is the API-key scope for key requests, so
      // checking it (not DB-resolved roles) also enforces the key ceiling.
      const perms: string[] = (request as any).user?.permissions ?? [];
      // Full panel-wide host inventory is an admin read (TARGET-VOCABULARY
      // §2.3): admin.read via hasGrant keeps admin.write/* passing.
      if (hasGrant(perms, "admin.read")) {
        const hosts = await prisma.databaseHost.findMany({
          orderBy: { name: "asc" },
          select: { id: true, name: true, host: true, port: true },
        });
        return reply.send({ success: true, data: hosts });
      }
      // Non-admins keep a minimal create-database dropdown: only hosts
      // already referenced by databases on servers they own or hold
      // ServerAccess on. No panel-wide infra disclosure to bare subusers.
      const [ownedServers, accessRows] = await Promise.all([
        prisma.server.findMany({ where: { ownerId: userId }, select: { id: true } }),
        prisma.serverAccess.findMany({ where: { userId }, select: { serverId: true } }),
      ]);
      const serverIds = [
        ...new Set([...ownedServers.map((s) => s.id), ...accessRows.map((a) => a.serverId)]),
      ];
      if (serverIds.length === 0) {
        return apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, "Forbidden");
      }
      const dbRows = await prisma.serverDatabase.findMany({
        where: { serverId: { in: serverIds } },
        select: { hostId: true },
      });
      const hostIds = [...new Set(dbRows.map((d) => d.hostId))];
      const hosts =
        hostIds.length > 0
          ? await prisma.databaseHost.findMany({
              where: { id: { in: hostIds } },
              orderBy: { name: "asc" },
              select: { id: true, name: true, host: true, port: true },
            })
          : [];
      reply.send({ success: true, data: hosts });
    }
  );

  app.get(
    "/:serverId/databases",
    { schema: { summary: "Manage databases", description: "Manage databases.", tags: ["Databases"], params: { type: "object", required: ['serverId'], properties: { serverId: { type: "string" } } }, response: { 200: { type: "object", additionalProperties: true } } },  onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;

      const canAccess = await ensureDatabasePermission(
        serverId,
        userId,
        reply,
        "database.read",
        "You do not have permission to view databases for this server",
        request.user,
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

      // List never returns plaintext passwords — only create/rotate do (once).
      reply.send({
        success: true,
        data: databases.map((db) => ({
          id: db.id,
          name: db.name,
          username: db.username,
          host: db.host.host,
          port: db.host.port,
          hostId: db.hostId,
          hostName: db.host.name,
          createdAt: db.createdAt,
          hasPassword: Boolean(db.password),
        })),
      });
    }
  );

  // Create server database
  app.post(
    "/:serverId/databases",
    { schema: { summary: "Manage databases", description: "Manage databases.", tags: ["Databases"], params: { type: "object", required: ['serverId'], properties: { serverId: { type: "string" } } }, response: { 200: { type: "object", additionalProperties: true } } },  onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;
      const { name, hostId } = request.body as { name?: string; hostId: string };

      const canAccess = await ensureDatabasePermission(
        serverId,
        userId,
        reply,
        "database.create",
        "You do not have permission to create databases for this server",
        request.user,
      );
      if (!canAccess) {
        return;
      }

      if (!hostId) {
        return apiError(reply, 400, ErrorCodes.VALIDATION_ERROR, "hostId is required");
      }

      // Authorize the host: admins, node managers, or explicit database.create
      // grantees may use it. The legacy permissive path let any server member
      // provision onto any host.
      const { resolveServerPermissions } = await import("../../lib/permissions-catalog.js");
      const { decideServerAccess } = await import("../../lib/server-access.js");
      const scopeServer = await prisma.server.findUnique({
        where: { id: serverId },
        select: { ownerId: true, nodeId: true },
      });
      if (!scopeServer) {
        return apiError(reply, 404, ErrorCodes.SERVER_NOT_FOUND, "Server not found");
      }
      const scopeAccess = await prisma.serverAccess.findFirst({
        where: { serverId, userId, permissions: { has: "database.create" } },
        select: { userId: true },
      });
      const scopePerms = await resolveServerPermissions(userId, serverId, scopeServer.nodeId);
      const { hasNodeAccess } = await import("../../lib/permissions.js");
      const hostDecision = decideServerAccess({
        isOwner: scopeServer.ownerId === userId,
        hasExplicitServerAccess: Boolean(scopeAccess),
        rolePermissions: scopePerms,
        hasNodeAccess: await hasNodeAccess(prisma, userId, scopeServer.nodeId),
        requiredPermission: "database.create",
      });
      if (!hostDecision.allowed) {
        return apiError(reply, 403, ErrorCodes.DATABASE_HOST_NOT_AUTHORIZED, "Database host not authorized for this server");
      }

       const server = await prisma.server.findUnique({
         where: { id: serverId },
         select: { databaseAllocation: true },
       });

       if (!server) {
         return apiError(reply, 404, ErrorCodes.SERVER_NOT_FOUND, "Server not found");
       }

       const allocationLimit = server.databaseAllocation ?? 0;
       if (!Number.isFinite(allocationLimit) || allocationLimit <= 0) {
         return apiError(reply, 403, ErrorCodes.DATABASE_ALLOCATION_DISABLED, "Database allocation disabled for this server");
       }

       const existingCount = await prisma.serverDatabase.count({ where: { serverId } });
       if (existingCount >= allocationLimit) {
         return apiError(reply, 409, ErrorCodes.DATABASE_LIMIT_REACHED, "Database allocation limit reached");
       }

       const host = await prisma.databaseHost.findUnique({
         where: { id: hostId },
       });

       if (!host) {
         return apiError(reply, 404, ErrorCodes.DATABASE_HOST_NOT_FOUND, "Database host not found");
       }

      const normalizedName = name ? toDatabaseIdentifier(name.trim()) : "";
      const databaseName =
        normalizedName.length >= 3 ? normalizedName : generateSafeIdentifier("srv_", 12);

      if (!isValidDatabaseIdentifier(databaseName)) {
        return apiError(reply, 400, ErrorCodes.DATABASE_NAME_INVALID, "Database name must start with a letter and use only lowercase letters, numbers, and underscores (max 32 chars)");
      }

      // Usernames are prefixed per server (srv_<short>-<rand>) so collisions
      // across tenants are impossible and ownership is auditable.
      const shortServer = serverId.replace(/[^a-z0-9]/gi, "").slice(0, 6).toLowerCase() || "srv";
      const databaseUsername = generateSafeIdentifier(`srv_${shortServer}_`, 8);
      const databasePassword = generateSafeIdentifier("p", 24);
      const { encryptSecretValue, isCredentialEncryptionConfigured } = await import("../../services/backup-credentials.js");

      // Fail fast before provisioning: without the encryption key the
      // password could not be stored afterwards, orphaning the database user.
      if (!isCredentialEncryptionConfigured()) {
        return apiError(reply, 400, ErrorCodes.CREDENTIAL_ENCRYPTION_KEY_MISSING, "Database passwords cannot be stored: BACKUP_CREDENTIALS_ENCRYPTION_KEY is not configured");
      }

      if (!isValidDatabaseIdentifier(databaseUsername)) {
        return apiError(reply, 500, ErrorCodes.DATABASE_CREDENTIALS_INVALID, "Generated database username is invalid");
      }

      if (databasePassword.length < 16) {
        return apiError(reply, 500, ErrorCodes.DATABASE_CREDENTIALS_INVALID, "Generated database password is too short");
      }

      try {
        await provisionDatabase(host, databaseName, databaseUsername, databasePassword);
        const database = await prisma.serverDatabase.create({
          data: {
            serverId,
            hostId,
            name: databaseName,
            username: databaseUsername,
            // Encrypt at rest (backup-credentials AES-GCM pattern); one-time
            // display below decrypts once, list endpoints never expose it.
            password: (encryptSecretValue(databasePassword) ?? databasePassword) as string,
          },
        });

        await createAuditLog(userId, {
          action: "database.create",
          resource: "server",
          resourceId: serverId,
          request,
          details: {
              hostId,
              name: database.name,
            },
        });

        // Broadcast database_created event — admin + global + per-server stream.
        const wsGatewayDbCreated = (app as any).wsGateway;
        const dbCreatedEvent = {
          type: 'database_created',
          serverId,
          databaseId: database.id,
          databaseName: database.name,
          createdBy: userId,
          timestamp: new Date().toISOString(),
        };
        if (wsGatewayDbCreated?.pushToAdminSubscribers) {
          wsGatewayDbCreated.pushToAdminSubscribers('database_created', dbCreatedEvent);
        }
        if (wsGatewayDbCreated?.pushToGlobalSubscribers) {
          wsGatewayDbCreated.pushToGlobalSubscribers('database_created', dbCreatedEvent);
        }
        if (wsGatewayDbCreated?.routeToClients) {
          void wsGatewayDbCreated.routeToClients(serverId, dbCreatedEvent).catch(() => {});
        }

        reply.status(201).send({
          success: true,
          data: {
            id: database.id,
            name: database.name,
            username: database.username,
            // One-time display: decrypt the just-stored value once.
            password: databasePassword,
            host: host.host,
            port: host.port,
            hostId: host.id,
            hostName: host.name,
            createdAt: database.createdAt,
          },
        });
      } catch (error: any) {
        if (error instanceof DatabaseProvisioningError) {
          return apiError(reply, error.statusCode, ErrorCodes.DATABASE_PROVISION_FAILED, error.message);
        }
        return apiError(reply, 500, ErrorCodes.DATABASE_PROVISION_FAILED, "Database provisioning failed");
      }
    }
  );

  // Rotate server database password
  app.post(
    "/:serverId/databases/:databaseId/rotate",
    { schema: { summary: "Rotate database credentials", description: "Rotate database credentials.", tags: ["Databases"], params: { type: "object", required: ['serverId', 'databaseId'], properties: { serverId: { type: "string" }, databaseId: { type: "string" } } }, response: { 200: { type: "object", additionalProperties: true } } },  onRequest: [app.authenticate] },
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
        "You do not have permission to rotate database credentials",
        request.user,
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
        return apiError(reply, 404, ErrorCodes.DATABASE_NOT_FOUND, "Database not found");
      }

      // Verify the joined host matches the stored hostId (cross-host
      // confusion on rotate would set the password on the wrong engine).
      if (!database.host || database.host.id !== database.hostId) {
        return apiError(reply, 409, ErrorCodes.DATABASE_HOST_MISMATCH, "Database host mismatch");
      }

      const nextPassword = generateSafeIdentifier("p", 24);
      const { encryptSecretValue: encryptRotatedSecret, isCredentialEncryptionConfigured } = await import("../../services/backup-credentials.js");

      // Fail fast before rotating: without the encryption key the new
      // password could not be stored, locking everyone out of the database.
      if (!isCredentialEncryptionConfigured()) {
        return apiError(reply, 400, ErrorCodes.CREDENTIAL_ENCRYPTION_KEY_MISSING, "Database passwords cannot be stored: BACKUP_CREDENTIALS_ENCRYPTION_KEY is not configured");
      }

      try {
        await rotateDatabasePassword(database.host, database.username, nextPassword);
      } catch (error: any) {
        if (error instanceof DatabaseProvisioningError) {
          return apiError(reply, error.statusCode, ErrorCodes.DATABASE_ROTATE_FAILED, error.message);
        }
        return apiError(reply, 500, ErrorCodes.DATABASE_ROTATE_FAILED, "Database password rotation failed");
      }

      const updated = await prisma.serverDatabase.update({
        where: { id: database.id },
        data: { password: (encryptRotatedSecret(nextPassword) ?? nextPassword) as string },
      });

      await createAuditLog(userId, {
        action: "database.rotate",
        resource: "server",
        resourceId: serverId,
        request,
        details: {
            databaseId: database.id,
            name: database.name,
          },
      });

      // Broadcast database_password_rotated event — admin + global + per-server stream.
      const wsGatewayDbRotated = (app as any).wsGateway;
      const dbRotatedEvent = {
        type: 'database_password_rotated',
        serverId,
        databaseId: database.id,
        databaseName: database.name,
        rotatedBy: userId,
        timestamp: new Date().toISOString(),
      };
      if (wsGatewayDbRotated?.pushToAdminSubscribers) {
        wsGatewayDbRotated.pushToAdminSubscribers('database_password_rotated', dbRotatedEvent);
      }
      if (wsGatewayDbRotated?.pushToGlobalSubscribers) {
        wsGatewayDbRotated.pushToGlobalSubscribers('database_password_rotated', dbRotatedEvent);
      }
      if (wsGatewayDbRotated?.routeToClients) {
        void wsGatewayDbRotated.routeToClients(serverId, dbRotatedEvent).catch(() => {});
      }

      reply.send({
        success: true,
        data: {
          id: updated.id,
          name: updated.name,
          username: updated.username,
          // One-time display after rotation.
          password: nextPassword,
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
    { schema: { summary: "Manage databases", description: "Manage databases.", tags: ["Databases"], params: { type: "object", required: ['serverId', 'databaseId'], properties: { serverId: { type: "string" }, databaseId: { type: "string" } } }, response: { 200: { type: "object", additionalProperties: true } } },  onRequest: [app.authenticate] },
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
        "You do not have permission to delete databases for this server",
        request.user,
      );
      if (!canAccess) {
        return;
      }

      const database = await prisma.serverDatabase.findFirst({
        where: { id: databaseId, serverId },
      });

      if (!database) {
        return apiError(reply, 404, ErrorCodes.DATABASE_NOT_FOUND, "Database not found");
      }

      const host = await prisma.databaseHost.findUnique({
        where: { id: database.hostId },
      });

      if (!host) {
        return apiError(reply, 404, ErrorCodes.DATABASE_HOST_NOT_FOUND, "Database host not found");
      }
      if (host.id !== database.hostId) {
        return apiError(reply, 409, ErrorCodes.DATABASE_HOST_MISMATCH, "Database host mismatch");
      }

      try {
        await dropDatabase(host, database.name, database.username);
      } catch (error: any) {
        if (error instanceof DatabaseProvisioningError) {
          return apiError(reply, error.statusCode, ErrorCodes.DATABASE_DELETE_FAILED, error.message);
        }
        return apiError(reply, 500, ErrorCodes.DATABASE_DELETE_FAILED, "Database deletion failed");
      }

      await prisma.serverDatabase.delete({ where: { id: database.id } });

      await createAuditLog(userId, {
        action: "database.delete",
        resource: "server",
        resourceId: serverId,
        request,
        details: { databaseId },
      });

      // Broadcast database_deleted event — admin + global + per-server stream.
      const wsGatewayDbDeleted = (app as any).wsGateway;
      const dbDeletedEvent = {
        type: 'database_deleted',
        serverId,
        databaseId,
        deletedBy: userId,
        timestamp: new Date().toISOString(),
      };
      if (wsGatewayDbDeleted?.pushToAdminSubscribers) {
        wsGatewayDbDeleted.pushToAdminSubscribers('database_deleted', dbDeletedEvent);
      }
      if (wsGatewayDbDeleted?.pushToGlobalSubscribers) {
        wsGatewayDbDeleted.pushToGlobalSubscribers('database_deleted', dbDeletedEvent);
      }
      if (wsGatewayDbDeleted?.routeToClients) {
        void wsGatewayDbDeleted.routeToClients(serverId, dbDeletedEvent).catch(() => {});
      }

      reply.send({ success: true });
    }
  );

  // Install server (sends install command to agent)
}
