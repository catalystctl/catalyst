import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../../db.js";
import { checkIsAdmin, collectUsedHostPortsByIp, ensureNotSuspended, findPortConflict, parsePortValue, parseStoredPortBindings, shouldUseIpam } from './_helpers.js';

export async function serverNetworkRoutes(app: FastifyInstance) {
  app.get(
    "/:serverId/allocations",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;

      const server = await prisma.server.findUnique({
        where: { id: serverId },
        include: {
          node: true,
          access: true,
        },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      if (!ensureNotSuspended(server, reply)) {
        return;
      }

      // Admin bypass - admins can access any server
      if (checkIsAdmin(request, 'admin.read')) {
        // Admin bypass - proceed to return allocations
      } else {
        // Check if user is owner OR has server.read permission via access entry
        const hasAccess = server.ownerId === userId || server.access.some(
          (access) => access.userId === userId && access.permissions.includes("server.read")
        );
        if (!hasAccess) {
          return reply.status(403).send({ error: "Forbidden" });
        }
      }

      const bindings = parseStoredPortBindings(server.portBindings);

      const allocations = Object.entries(bindings)
        .map(([containerPort, hostPort]) => ({
          containerPort: Number(containerPort),
          hostPort,
          isPrimary: Number(containerPort) === server.primaryPort,
        }))
        .sort((a, b) => a.containerPort - b.containerPort);

      if (!allocations.length && server.primaryPort) {
        allocations.push({
          containerPort: server.primaryPort,
          hostPort: server.primaryPort,
          isPrimary: true,
        });
      }

      reply.send({ success: true, data: allocations, subdomain: server.subdomain ?? null });
    }
  );

  // Add allocation
  app.post(
    "/:serverId/allocations",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const { containerPort, hostPort } = request.body as {
        containerPort: number;
        hostPort: number;
      };
      const userId = request.user.userId;

      const server = await prisma.server.findUnique({
        where: { id: serverId },
        include: { access: true },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      if (!ensureNotSuspended(server, reply)) {
        return;
      }

      const hasAccess =
        server.ownerId === userId ||
        server.access.some((access) => access.userId === userId);
      if (!hasAccess) {
        return reply.status(403).send({ error: "Forbidden" });
      }

      if (server.status !== "stopped") {
        return reply.status(409).send({
          error: "Server must be stopped to update allocations",
        });
      }

      const parsedContainerPort = parsePortValue(containerPort);
      const parsedHostPort = parsePortValue(hostPort);
      if (!parsedContainerPort || !parsedHostPort) {
        return reply.status(400).send({ error: "Invalid port value" });
      }

      const bindings = parseStoredPortBindings(server.portBindings);
      if (bindings[parsedContainerPort]) {
        return reply.status(409).send({ error: "Allocation already exists for container port" });
      }

      const usedHostPorts = new Set(Object.values(bindings));
      if (!bindings[server.primaryPort]) {
        const primaryHostPort = parsePortValue(server.primaryPort ?? undefined);
        if (primaryHostPort) {
          usedHostPorts.add(primaryHostPort);
        }
      }
      const isPrimaryBinding =
        parsedContainerPort === server.primaryPort && parsedHostPort === server.primaryPort;
      if (!isPrimaryBinding && usedHostPorts.has(parsedHostPort)) {
        return reply.status(409).send({ error: "Host port already assigned to allocation" });
      }

      if (!shouldUseIpam(server.networkMode ?? undefined) && server.networkMode !== "host") {
        const siblingServers = await prisma.server.findMany({
          where: {
            nodeId: server.nodeId,
            id: { not: serverId },
          },
          select: {
            id: true,
            primaryPort: true,
            primaryIp: true,
            portBindings: true,
            networkMode: true,
          },
        });
        const usedPorts = collectUsedHostPortsByIp(siblingServers, serverId);
        const hostIp = server.primaryIp ?? null;
        const conflictPort = findPortConflict(usedPorts, hostIp, [parsedHostPort]);
        if (conflictPort) {
          return reply.status(400).send({
            error: `Port ${parsedHostPort} is already in use on this node`,
          });
        }
      }

      bindings[parsedContainerPort] = parsedHostPort;
      const updated = await prisma.server.update({
        where: { id: serverId },
        data: {
          portBindings: bindings,
        },
      });

      const wsGateway = app.wsGateway;
      if (wsGateway?.pushToAdminSubscribers) {
        wsGateway.pushToAdminSubscribers('server_updated', {
          type: 'server_updated',
          serverId,
          updatedBy: userId,
          change: 'allocation_added',
          timestamp: new Date().toISOString(),
        });
      }
      if (wsGateway?.pushToGlobalSubscribers) {
        wsGateway.pushToGlobalSubscribers('server_updated', {
          type: 'server_updated',
          serverId,
          updatedBy: userId,
          change: 'allocation_added',
          timestamp: new Date().toISOString(),
        });
      }

      reply.send({
        success: true,
        data: {
          containerPort: parsedContainerPort,
          hostPort: parsedHostPort,
          isPrimary: parsedContainerPort === updated.primaryPort,
        },
      });
    }
  );

  // Remove allocation
  app.delete(
    "/:serverId/allocations/:containerPort",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId, containerPort } = request.params as {
        serverId: string;
        containerPort: string;
      };
      const userId = request.user.userId;

      const server = await prisma.server.findUnique({
        where: { id: serverId },
        include: { access: true },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      if (!ensureNotSuspended(server, reply)) {
        return;
      }

      const hasAccess =
        server.ownerId === userId ||
        server.access.some((access) => access.userId === userId);
      if (!hasAccess) {
        return reply.status(403).send({ error: "Forbidden" });
      }

      if (server.status !== "stopped") {
        return reply.status(409).send({
          error: "Server must be stopped to update allocations",
        });
      }

      const parsedContainerPort = parsePortValue(containerPort);
      if (!parsedContainerPort) {
        return reply.status(400).send({ error: "Invalid port value" });
      }

      if (parsedContainerPort === server.primaryPort) {
        return reply.status(400).send({ error: "Cannot remove primary allocation" });
      }

      const bindings = parseStoredPortBindings(server.portBindings);
      if (!bindings[parsedContainerPort]) {
        return reply.status(404).send({ error: "Allocation not found" });
      }

      delete bindings[parsedContainerPort];

      await prisma.server.update({
        where: { id: serverId },
        data: { portBindings: bindings },
      });

      const wsGateway = app.wsGateway;
      if (wsGateway?.pushToAdminSubscribers) {
        wsGateway.pushToAdminSubscribers('server_updated', {
          type: 'server_updated',
          serverId,
          updatedBy: userId,
          change: 'allocation_removed',
          timestamp: new Date().toISOString(),
        });
      }
      if (wsGateway?.pushToGlobalSubscribers) {
        wsGateway.pushToGlobalSubscribers('server_updated', {
          type: 'server_updated',
          serverId,
          updatedBy: userId,
          change: 'allocation_removed',
          timestamp: new Date().toISOString(),
        });
      }

      reply.send({ success: true });
    }
  );

  // Set primary allocation
  app.post(
    "/:serverId/allocations/primary",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const { containerPort } = request.body as { containerPort: number };
      const userId = request.user.userId;

      const server = await prisma.server.findUnique({
        where: { id: serverId },
        include: { access: true },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      if (!ensureNotSuspended(server, reply)) {
        return;
      }

      const hasAccess =
        server.ownerId === userId ||
        server.access.some((access) => access.userId === userId);
      if (!hasAccess) {
        return reply.status(403).send({ error: "Forbidden" });
      }

      if (server.status !== "stopped") {
        return reply.status(409).send({
          error: "Server must be stopped to update allocations",
        });
      }

      const parsedContainerPort = parsePortValue(containerPort);
      if (!parsedContainerPort) {
        return reply.status(400).send({ error: "Invalid port value" });
      }

      const bindings = parseStoredPortBindings(server.portBindings);
      if (!bindings[parsedContainerPort]) {
        return reply.status(404).send({ error: "Allocation not found" });
      }

      const updated = await prisma.server.update({
        where: { id: serverId },
        data: { primaryPort: parsedContainerPort },
      });

      const wsGateway = app.wsGateway;
      if (wsGateway?.pushToAdminSubscribers) {
        wsGateway.pushToAdminSubscribers('server_updated', {
          type: 'server_updated',
          serverId,
          updatedBy: userId,
          change: 'primary_allocation_changed',
          timestamp: new Date().toISOString(),
        });
      }
      if (wsGateway?.pushToGlobalSubscribers) {
        wsGateway.pushToGlobalSubscribers('server_updated', {
          type: 'server_updated',
          serverId,
          updatedBy: userId,
          change: 'primary_allocation_changed',
          timestamp: new Date().toISOString(),
        });
      }

      reply.send({
        success: true,
        data: {
          primaryPort: updated.primaryPort,
        },
      });
    }
  );

  // Update restart policy
}
