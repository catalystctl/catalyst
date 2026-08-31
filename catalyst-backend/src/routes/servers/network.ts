import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { prisma } from "../../db.js";
import { canAccessServer, collectUsedHostPortsByIp, ensureNotSuspended, findPortConflict, parsePortValue, parseStoredPortBindings, shouldUseIpam, validateRequestBody } from './_helpers.js';

/** Statuses that allow allocation changes. Stopped servers can always change allocations;
 *  running servers support hot-add / hot-remove (the agent will sync firewall rules). */
const ALLOCATION_ALLOWED_STATUSES = new Set(["stopped", "running", "crashed", "error"]);

const allocationSchema = z
  .object({
    /** Preferred: claim a free NodeAllocation on the server's node. */
    allocationId: z.string().min(1).optional(),
    containerPort: z.number().int().min(1).max(65535).optional(),
    /** Legacy free-form host port (bridge/IPAM or when no NodeAllocation pool is used). */
    hostPort: z.number().int().min(1).max(65535).optional(),
  })
  .superRefine((value, ctx) => {
    if (
      !value.allocationId &&
      (value.containerPort === undefined || value.hostPort === undefined)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide allocationId, or both containerPort and hostPort",
      });
    }
  });

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

      // decideServerAccess contract (owner | ServerAccess | node+node.update | admin.write/*)
      if (!(await canAccessServer(userId, {
        id: serverId,
        ownerId: server.ownerId,
        nodeId: server.nodeId,
      }))) {
        return reply.status(403).send({ error: "Forbidden" });
      }

      const bindings = parseStoredPortBindings(server.portBindings);

      const nodeAllocations = await prisma.nodeAllocation.findMany({
        where: { serverId },
        select: { id: true, ip: true, port: true, alias: true },
      });
      const nodeAllocByHostPort = new Map(
        nodeAllocations.map((alloc) => [alloc.port, alloc] as const),
      );

      const allocations = Object.entries(bindings)
        .map(([containerPort, hostPort]) => {
          const nodeAlloc = nodeAllocByHostPort.get(hostPort);
          return {
            containerPort: Number(containerPort),
            hostPort,
            isPrimary: Number(containerPort) === server.primaryPort,
            allocationId: nodeAlloc?.id ?? null,
            ip: nodeAlloc?.ip ?? server.primaryIp ?? null,
            alias: nodeAlloc?.alias ?? null,
          };
        })
        .sort((a, b) => a.containerPort - b.containerPort);

      if (!allocations.length && server.primaryPort) {
        const nodeAlloc = nodeAllocByHostPort.get(server.primaryPort);
        allocations.push({
          containerPort: server.primaryPort,
          hostPort: server.primaryPort,
          isPrimary: true,
          allocationId: nodeAlloc?.id ?? null,
          ip: nodeAlloc?.ip ?? server.primaryIp ?? null,
          alias: nodeAlloc?.alias ?? null,
        });
      }

      reply.send({ success: true, data: allocations, subdomain: server.subdomain ?? null });
    }
  );

  // Add allocation (hot-add supported for running servers)
  app.post(
    "/:serverId/allocations",
    // No onRequest RBAC gate here: the write-path contract (owner | ServerAccess
    // update/delete | node access + node.update | admin.write/*) is enforced
    // in-handler via canAccessServer below, same as DELETE and /primary.
    // A requirePermission('server.update') middleware previously ran here and
    // always 403'd non-super-admins — 'server.update' is not a grantable
    // catalog permission, and the middleware ran before canAccessServer could
    // apply the node-manage path.
    { onRequest: [app.authenticate], preHandler: [validateRequestBody(allocationSchema)] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const body = request.body as z.infer<typeof allocationSchema>;
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

      let claimedAllocationId: string | null = null;
      let claimedAllocationIp: string | null = null;
      let claimedAllocationAlias: string | null = null;
      let parsedContainerPort: number | null = null;
      let parsedHostPort: number | null = null;

      if (body.allocationId) {
        const allocation = await prisma.nodeAllocation.findUnique({
          where: { id: body.allocationId },
        });
        if (!allocation || allocation.nodeId !== server.nodeId) {
          return reply.status(404).send({ error: "Allocation not found" });
        }
        if (allocation.serverId && allocation.serverId !== serverId) {
          return reply.status(409).send({ error: "Allocation is already assigned to another server" });
        }
        claimedAllocationId = allocation.id;
        claimedAllocationIp = allocation.ip;
        claimedAllocationAlias = allocation.alias ?? null;
        parsedHostPort = allocation.port;
        // Default container port to the host allocation port unless explicitly overridden.
        parsedContainerPort = parsePortValue(body.containerPort) ?? allocation.port;
      } else {
        parsedContainerPort = parsePortValue(body.containerPort);
        parsedHostPort = parsePortValue(body.hostPort);
      }

      if (!parsedContainerPort || !parsedHostPort) {
        return reply.status(400).send({ error: "Invalid port value" });
      }
      const containerPort = parsedContainerPort;
      const hostPort = parsedHostPort;

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

      // When claiming a NodeAllocation, host-port ownership is already tracked there.
      // Keep free-form conflict checks for legacy hostPort posts on bridge (non-IPAM).
      if (
        !claimedAllocationId &&
        !shouldUseIpam(server.networkMode ?? undefined) &&
        server.networkMode !== "host"
      ) {
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
          if (txBindings[containerPort]) {
            throw new Error("Allocation already exists for container port");
          }
          if (Object.values(txBindings).includes(hostPort)) {
            const isSamePrimary =
              parsedContainerPort === fresh.primaryPort &&
              parsedHostPort === fresh.primaryPort;
            if (!isSamePrimary) {
              throw new Error("Host port already assigned to allocation");
            }
          }

          if (claimedAllocationId) {
            const claim = await tx.nodeAllocation.updateMany({
              where: {
                id: claimedAllocationId,
                nodeId: server.nodeId,
                OR: [{ serverId: null }, { serverId }],
              },
              data: { serverId },
            });
            if (claim.count === 0) {
              throw new Error("Allocation is already assigned to another server");
            }
          }

          txBindings[containerPort] = hostPort;
          return tx.server.update({
            where: { id: serverId },
            data: { portBindings: txBindings },
          });
        });
      } catch (err) {
        const msg = (err as Error)?.message || "";
        if (
          msg === "Allocation already exists for container port" ||
          msg === "Host port already assigned to allocation" ||
          msg === "Allocation is already assigned to another server"
        ) {
          return reply.status(409).send({ error: msg });
        }
        throw err;
      }

      const wsGateway = app.wsGateway;

      // If server is running, notify the agent to open the firewall port
      if (server.status === "running" && wsGateway?.sendToAgent) {
        const containerIp = claimedAllocationIp ?? server.primaryIp ?? "";
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
          allocationId: claimedAllocationId,
          ip: claimedAllocationIp ?? server.primaryIp ?? null,
          alias: claimedAllocationAlias,
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

      await prisma.$transaction(async (tx) => {
        await tx.server.update({
          where: { id: serverId },
          data: { portBindings: bindings },
        });

        // Release matching NodeAllocation(s) so the port returns to the free pool.
        // Prefer exact host-port match; fall back to any still-linked row for this host port.
        await tx.nodeAllocation.updateMany({
          where: {
            serverId,
            port: removedHostPort,
          },
          data: { serverId: null },
        });
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
