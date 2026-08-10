import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { prisma } from "../../db.js";
import { createRbacMiddleware } from "../../middleware/rbac.js";
import { canAccessServer, collectUsedHostPortsByIp, ensureNotSuspended, findPortConflict, parsePortValue, parseStoredPortBindings, shouldUseIpam, validateRequestBody } from './_helpers.js';

/** Statuses that allow allocation changes. Stopped servers can always change allocations;
 *  running servers support hot-add / hot-remove (the agent will sync firewall rules). */
const ALLOCATION_ALLOWED_STATUSES = new Set(["stopped", "running", "crashed", "error"]);

const allocationSchema = z.object({
  containerPort: z.number().int().min(1).max(65535),
  hostPort: z.number().int().min(1).max(65535),
});

export async function serverNetworkRoutes(app: FastifyInstance) {
  const rbac = createRbacMiddleware(prisma);
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

      // decideServerAccess contract (owner | ServerAccess | node+node.update | admin.write/*)
      if (!(await canAccessServer(userId, {
        id: serverId,
        ownerId: server.ownerId,
        nodeId: server.nodeId,
      }))) {
        return reply.status(403).send({ error: "Forbidden" });
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

  // Add allocation (hot-add supported for running servers)
  app.post(
    "/:serverId/allocations",
    { onRequest: [app.authenticate, rbac.requirePermission('server.update', 'serverId')], preHandler: [validateRequestBody(allocationSchema)] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const { containerPort, hostPort } = request.body as z.infer<typeof allocationSchema>;
      const userId = request.user.userId;

      const server = await prisma.server.findUnique({
        where: { id: serverId },
        include: { access: true, node: true },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      if (!ensureNotSuspended(server, reply)) {
        return;
      }

      // Write path: owner | ServerAccess(update/delete) | node+node.update | admin.write/*
      // Bare node assignment / admin.read alone is NOT enough.
      const hasWriteAccess = server.access.some(
        (access) => access.userId === userId &&
          (access.permissions.includes('server.update') || access.permissions.includes('server.delete'))
      );
      if (server.ownerId !== userId && !hasWriteAccess) {
        if (!(await canAccessServer(userId, {
          id: serverId,
          ownerId: server.ownerId,
          nodeId: server.nodeId,
        }))) {
          return reply.status(403).send({ error: "Forbidden" });
        }
      }

      // Allow allocation changes on stopped, running, crashed, and error servers (hot-add)
      if (!ALLOCATION_ALLOWED_STATUSES.has(server.status)) {
        return reply.status(409).send({
          error: `Server must be in one of these statuses to update allocations: ${[...ALLOCATION_ALLOWED_STATUSES].join(', ')}`,
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

      // Wrap port-binding read-modify-write in a transaction to prevent lost updates
      let updated;
      try {
        updated = await prisma.$transaction(async (tx) => {
          const fresh = await tx.server.findUnique({
            where: { id: serverId },
            select: { portBindings: true, primaryPort: true },
          });
          if (!fresh) throw new Error("Server not found");
          const txBindings = parseStoredPortBindings(fresh.portBindings);
          // Re-check inside transaction — concurrent request may have added this port
          if (txBindings[parsedContainerPort]) {
            throw new Error("Allocation already exists for container port");
          }
          txBindings[parsedContainerPort] = parsedHostPort;
          return tx.server.update({
            where: { id: serverId },
            data: { portBindings: txBindings },
          });
        });
      } catch (err) {
        const msg = (err as Error)?.message || "";
        if (msg === "Allocation already exists for container port") {
          return reply.status(409).send({ error: msg });
        }
        throw err;
      }

      const wsGateway = app.wsGateway;

      // If server is running, notify the agent to open the firewall port
      if (server.status === "running" && wsGateway?.sendToAgent) {
        const containerIp = server.primaryIp ?? "";
        wsGateway.sendToAgent(server.nodeId, {
          type: "allocation_added",
          serverId,
          serverUuid: server.uuid,
          containerPort: parsedContainerPort,
          hostPort: parsedHostPort,
          containerIp,
          networkMode: server.networkMode ?? "bridge",
          protocol: "tcp",
        }).catch(() => {
          // Best-effort — agent may be temporarily disconnected; reconciliation will catch up.
        });
      }

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

  // Remove allocation (hot-remove supported for running servers)
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
        include: { access: true, node: true },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      if (!ensureNotSuspended(server, reply)) {
        return;
      }

      const hasWriteAccess = server.access.some(
        (access) => access.userId === userId &&
          (access.permissions.includes('server.update') || access.permissions.includes('server.delete'))
      );
      if (server.ownerId !== userId && !hasWriteAccess) {
        if (!(await canAccessServer(userId, {
          id: serverId,
          ownerId: server.ownerId,
          nodeId: server.nodeId,
        }))) {
          return reply.status(403).send({ error: "Forbidden" });
        }
      }

      // Allow allocation removal on stopped, running, crashed, and error servers (hot-remove)
      if (!ALLOCATION_ALLOWED_STATUSES.has(server.status)) {
        return reply.status(409).send({
          error: `Server must be in one of these statuses to update allocations: ${[...ALLOCATION_ALLOWED_STATUSES].join(', ')}`,
        });
      }

      const parsedContainerPort = parsePortValue(containerPort);
      if (!parsedContainerPort) {
        return reply.status(400).send({ error: "Invalid port value" });
      }

      // Primary allocation cannot be removed regardless of server status (AC-4)
      if (parsedContainerPort === server.primaryPort) {
        return reply.status(400).send({ error: "Cannot remove primary allocation" });
      }

      const bindings = parseStoredPortBindings(server.portBindings);
      if (!bindings[parsedContainerPort]) {
        return reply.status(404).send({ error: "Allocation not found" });
      }

      const removedHostPort = bindings[parsedContainerPort];

      delete bindings[parsedContainerPort];

      await prisma.server.update({
        where: { id: serverId },
        data: { portBindings: bindings },
      });

      const wsGateway = app.wsGateway;

      // If server is running, notify the agent to close the firewall port
      if (server.status === "running" && wsGateway?.sendToAgent) {
        const containerIp = server.primaryIp ?? "";
        // Send the remaining port bindings so the agent can re-add surviving rules
        // after removing all rules for this server (remove_server_ports is server-scoped)
        wsGateway.sendToAgent(server.nodeId, {
          type: "allocation_removed",
          serverId,
          serverUuid: server.uuid,
          containerPort: parsedContainerPort,
          hostPort: removedHostPort,
          containerIp,
          networkMode: server.networkMode ?? "bridge",
          protocol: "tcp",
          remainingPortBindings: bindings, // the updated bindings after deletion
        }).catch(() => {
          // Best-effort — agent may be temporarily disconnected; reconciliation will catch up.
        });
      }

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

  // Set primary allocation (allowed when running — no firewall change needed, just metadata swap)
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

      const hasWriteAccess = server.access.some(
        (access) => access.userId === userId &&
          (access.permissions.includes('server.update') || access.permissions.includes('server.delete'))
      );
      if (server.ownerId !== userId && !hasWriteAccess) {
        if (!(await canAccessServer(userId, {
          id: serverId,
          ownerId: server.ownerId,
          nodeId: server.nodeId,
        }))) {
          return reply.status(403).send({ error: "Forbidden" });
        }
      }

      // Primary allocation change is allowed on stopped, running, crashed, and error servers
      if (!ALLOCATION_ALLOWED_STATUSES.has(server.status)) {
        return reply.status(409).send({
          error: `Server must be in one of these statuses to update allocations: ${[...ALLOCATION_ALLOWED_STATUSES].join(', ')}`,
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

}
