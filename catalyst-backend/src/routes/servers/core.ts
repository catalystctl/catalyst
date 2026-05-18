import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../../db.js";
import { allocateIpForServer, canAccessServer, captureSystemError, checkIsAdmin, checkPerm, collectUsedHostPortsByIp, ensureNotSuspended, findPortConflict, getEffectiveServerPermissions, getUserAccessibleNodes, hasNodeAccess, isSuspensionDeleteBlocked, isSuspensionEnforced, normalizeHostIp, normalizePortBindings, parsePortValue, parseStoredPortBindings, releaseIpForServer, resolveTemplateImage, serialize, serverCloneSchema, serverCreateSchema, shouldUseIpam, uuidv4, validateRequestBody, withConnectionInfo, WILDCARD_HOST } from './_helpers.js';

/**
 * Find the next available host port starting from `startPort`.
 * Uses the port usage map from collectUsedHostPortsByIp and findPortConflict
 * to avoid collisions with existing servers on the same node.
 */
function findAvailableHostPort(
  usedPorts: Map<string, Set<number>>,
  hostIp: string | null,
  startPort: number,
  maxPort = 65535,
): number {
  for (let port = startPort; port <= maxPort; port++) {
    const conflict = findPortConflict(usedPorts, hostIp, [port]);
    if (!conflict) {
      return port;
    }
  }
  // Fallback: scan from 1024 up to startPort
  for (let port = 1024; port < startPort; port++) {
    const conflict = findPortConflict(usedPorts, hostIp, [port]);
    if (!conflict) {
      return port;
    }
  }
  throw new Error('No available host port found on this node');
}

export async function serverCoreRoutes(app: FastifyInstance) {
  app.post(
    "/",
    { onRequest: [app.authenticate], preHandler: [validateRequestBody(serverCreateSchema)] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const {
        name,
        description,
        templateId,
        nodeId,
        locationId,
        allocatedMemoryMb,
        allocatedCpuCores,
        allocatedDiskMb,
        backupAllocationMb,
        databaseAllocation,
        primaryPort,
        primaryIp,
        allocationId,
        portBindings,
        networkMode,
        environment,
        subdomain,
        ownerId: bodyOwnerId,
      } = request.body as {
        name: string;
        description?: string;
        templateId: string;
        nodeId: string;
        locationId: string;
        allocatedMemoryMb: number;
        allocatedCpuCores: number;
        allocatedDiskMb: number;
        backupAllocationMb?: number;
        databaseAllocation?: number;
        primaryPort: number;
        primaryIp?: string | null;
        allocationId?: string;
        portBindings?: Record<number, number>;
        networkMode?: string;
        environment: Record<string, string>;
        subdomain?: string | null;
        ownerId?: string;
      };

      const userId = request.user.userId;
      // For admin/API-key callers, allow specifying a different owner.
      // Regular users can only create servers for themselves.
      const canCreate = checkIsAdmin(request, "admin.write");
      const hasNodeAccessResult = await hasNodeAccess(prisma, userId, nodeId);

      if (!canCreate && !hasNodeAccessResult) {
        return reply.status(403).send({ error: 'Admin access or node assignment required' });
      }

      const effectiveOwnerId = (canCreate || hasNodeAccessResult) && bodyOwnerId ? bodyOwnerId : userId;

      // If ownerId is specified, verify the target user exists and requester has permission
      if (effectiveOwnerId !== userId) {
        // Check if user has permission to create resources for other users
        if (!checkPerm(request, 'user.create')) {
          return reply.status(403).send({ error: 'Insufficient permissions to create server for other user' });
        }

        const targetUser = await prisma.user.findUnique({ where: { id: effectiveOwnerId } });
        if (!targetUser) {
          return reply.status(400).send({ error: 'Specified owner does not exist' });
        }
      }

      // Validate required fields
      const validatedPrimaryPort = parsePortValue(primaryPort);
      if (!validatedPrimaryPort) {
        return reply.status(400).send({ error: "Invalid primary port" });
      }

      // Validate template exists and get variables
      const template = await prisma.serverTemplate.findUnique({
        where: { id: templateId },
      });

      if (!template) {
        return reply.status(404).send({ error: "Template not found" });
      }

      const templateVariables = (template.variables as any[]) || [];
      const templateDefaults = templateVariables.reduce((acc, variable) => {
        if (variable?.name && variable?.default !== undefined) {
          acc[variable.name] = String(variable.default);
        }
        return acc;
      }, {} as Record<string, string>);
      const resolvedEnvironment = {
        ...templateDefaults,
        ...(environment || {}),
      };

      const resolvedImage = resolveTemplateImage(template, resolvedEnvironment);
      if (!resolvedImage) {
        return reply.status(400).send({ error: "Template image is required" });
      }
      if (template.images && Array.isArray(template.images)) {
        const hasVariant = template.images.some((option: any) => option?.name === resolvedEnvironment.IMAGE_VARIANT);
        if (resolvedEnvironment.IMAGE_VARIANT && !hasVariant) {
          return reply.status(400).send({ error: "Invalid image variant selected" });
        }
      }

      // Validate required template variables are provided
      const requiredVars = templateVariables.filter((v) => v.required);
      const missingVars = requiredVars.filter((v) => !resolvedEnvironment?.[v.name]);
      
      if (missingVars.length > 0) {
        return reply.status(400).send({
          error: `Missing required template variables: ${missingVars.map((v) => v.name).join(", ")}`,
        });
      }

      const templateFeatures = (template.features as any) || {};
      const templateBackupAllocation = Number(templateFeatures.backupAllocationMb);
      const templateDatabaseAllocation = Number(templateFeatures.databaseAllocation);
      const resolvedBackupAllocationMb =
        backupAllocationMb ?? (Number.isFinite(templateBackupAllocation) ? templateBackupAllocation : undefined);
      const resolvedDatabaseAllocation =
        databaseAllocation ?? (Number.isFinite(templateDatabaseAllocation) ? templateDatabaseAllocation : undefined);

      // Validate variable values against rules
      for (const variable of templateVariables) {
        const value = resolvedEnvironment?.[variable.name];
        if (value && variable.rules) {
          for (const rule of variable.rules) {
            if (rule.startsWith("between:")) {
              const [min, max] = rule.substring(8).split(",").map(Number);
              const numValue = Number(value);
              if (numValue < min || numValue > max) {
                return reply.status(400).send({
                  error: `Variable ${variable.name} must be between ${min} and ${max}`,
                });
              }
            } else if (rule.startsWith("in:")) {
              const allowedValues = rule.substring(3).split(",");
              if (!allowedValues.includes(value)) {
                return reply.status(400).send({
                  error: `Variable ${variable.name} must be one of: ${allowedValues.join(", ")}`,
                });
              }
            } else if (rule.startsWith("regex:")) {
              let pattern = rule.substring(6);
              // Strip leading/trailing / delimiters if present
              if (pattern.startsWith("/") && pattern.endsWith("/")) {
                pattern = pattern.slice(1, -1);
              }
              // Validate regex pattern for ReDoS protection
              // Block dangerous patterns that could cause catastrophic backtracking
              const dangerousPatterns = [
                /\(.*\)\{/,     // Nested quantifiers like (a+)+ or (a*)+
                /\(\?[=:!]/,    // Lookahead/behind assertions
                /\*.*\+|\+.*\*|\{.*,.*\}/, // Complex quantifiers
              ];
              const isUnsafeRegex = dangerousPatterns.some(p => p.test(pattern));
              if (isUnsafeRegex) {
                return reply.status(400).send({
                  error: `Invalid regex pattern for variable ${variable.name}: pattern contains potentially unsafe constructs`,
                });
              }
              try {
                const regex = new RegExp(pattern);
                // Test with timeout protection
                const startTime = Date.now();
                const result = regex.test(value);
                if (Date.now() - startTime > 1000) {
                  return reply.status(400).send({
                    error: `Variable ${variable.name} regex validation timeout`,
                  });
                }
                if (!result) {
                  return reply.status(400).send({
                    error: `Variable ${variable.name} does not match required pattern`,
                  });
                }
              } catch {
                return reply.status(400).send({
                  error: `Invalid regex pattern for variable ${variable.name}: ${pattern}`,
                });
              }
            }
          }
        }
      }

      // Validate node exists and has resources
      const node = await prisma.node.findUnique({
        where: { id: nodeId },
        include: {
          servers: {
            select: {
              id: true,
              allocatedMemoryMb: true,
              allocatedCpuCores: true,
              primaryPort: true,
              primaryIp: true,
              portBindings: true,
              networkMode: true,
            },
          },
        },
      });

      if (!node) {
        return reply.status(404).send({ error: "Node not found" });
      }

      if (
        resolvedDatabaseAllocation !== undefined &&
        (!Number.isFinite(resolvedDatabaseAllocation) || resolvedDatabaseAllocation < 0)
      ) {
        return reply.status(400).send({ error: "databaseAllocation must be 0 or more" });
      }

      if (
        resolvedBackupAllocationMb !== undefined &&
        (!Number.isFinite(resolvedBackupAllocationMb) || resolvedBackupAllocationMb < 0)
      ) {
        return reply.status(400).send({ error: "backupAllocationMb must be 0 or more" });
      }

      // Check resource availability
      const totalAllocatedMemory = node.servers.reduce(
        (sum, s) => sum + (s.allocatedMemoryMb || 0),
        0
      );
      const totalAllocatedCpu = node.servers.reduce(
        (sum, s) => sum + (s.allocatedCpuCores || 0),
        0
      );

      request.log.debug(
        {
          nodeId: node.id,
          maxMemory: node.maxMemoryMb,
          maxCpu: node.maxCpuCores,
          totalAllocatedMemory,
          totalAllocatedCpu,
          requestedMemory: allocatedMemoryMb,
          requestedCpu: allocatedCpuCores,
        },
        "Node resource check"
      );

      const effectiveMaxMemory = node.memoryOverallocatePercent === -1 ? Infinity : Math.floor(node.maxMemoryMb * (1 + node.memoryOverallocatePercent / 100));
      const effectiveMaxCpu = node.cpuOverallocatePercent === -1 ? Infinity : node.maxCpuCores * (1 + node.cpuOverallocatePercent / 100);

      if (totalAllocatedMemory + allocatedMemoryMb > effectiveMaxMemory) {
        const available = effectiveMaxMemory === Infinity ? "unlimited" : `${effectiveMaxMemory - totalAllocatedMemory}MB`;
        return reply.status(400).send({
          error: `Insufficient memory. Available: ${available}, Required: ${allocatedMemoryMb}MB`,
        });
      }

      if (totalAllocatedCpu + allocatedCpuCores > effectiveMaxCpu) {
        const available = effectiveMaxCpu === Infinity ? "unlimited" : `${effectiveMaxCpu - totalAllocatedCpu} cores`;
        return reply.status(400).send({
          error: `Insufficient CPU. Available: ${available}, Required: ${allocatedCpuCores} cores`,
        });
      }

      if (
        databaseAllocation !== undefined &&
        (!Number.isFinite(databaseAllocation) || databaseAllocation < 0)
      ) {
        return reply.status(400).send({ error: "databaseAllocation must be 0 or more" });
      }

      const desiredNetworkMode =
        typeof networkMode === "string" && networkMode.trim().length > 0
          ? networkMode.trim()
          : "mc-lan-static";
      const hasPrimaryIp = primaryIp !== undefined;
      const normalizedPrimaryIp = typeof primaryIp === "string" ? primaryIp.trim() : null;
      const isHostNetwork = desiredNetworkMode === "host";
      if (allocationId && shouldUseIpam(desiredNetworkMode)) {
        return reply.status(400).send({
          error: "Allocation IDs are only valid for bridge networking",
        });
      }
      if (allocationId && normalizedPrimaryIp) {
        return reply.status(400).send({
          error: "Choose either allocationId or primaryIp",
        });
      }
      if (hasPrimaryIp && !shouldUseIpam(desiredNetworkMode) && !allocationId) {
        return reply.status(400).send({
          error: "Primary IP can only be set for IPAM networks",
        });
      }
      if (isHostNetwork && normalizedPrimaryIp) {
        return reply.status(400).send({
          error: "Primary IP is not used for host networking",
        });
      }
      const resolvedPortBindings = normalizePortBindings(portBindings, validatedPrimaryPort);

      // Validate subdomain uniqueness
      const normalizedSubdomain = typeof subdomain === 'string' ? subdomain.trim().toLowerCase() : null;
      if (normalizedSubdomain) {
        const existing = await prisma.server.findUnique({ where: { subdomain: normalizedSubdomain } });
        if (existing) {
          return reply.status(409).send({ error: 'Subdomain is already in use' });
        }
      }

      let resolvedHostIp: string | null = null;
      try {
        resolvedHostIp =
          typeof resolvedEnvironment?.CATALYST_NETWORK_IP === "string"
            ? normalizeHostIp(resolvedEnvironment.CATALYST_NETWORK_IP)
            : null;
      } catch (error: any) {
        return reply.status(400).send({ error: error.message });
      }
      let hostNetworkIp: string | null = null;
      if (isHostNetwork) {
        try {
          hostNetworkIp = resolvedHostIp ?? normalizeHostIp(node.publicAddress);
        } catch (error: any) {
          return reply.status(400).send({ error: error.message });
        }
      }
      const nextEnvironment = isHostNetwork && hostNetworkIp
        ? {
            ...(resolvedEnvironment || {}),
            CATALYST_NETWORK_IP: hostNetworkIp,
          }
        : resolvedEnvironment;

      if (!shouldUseIpam(desiredNetworkMode) && desiredNetworkMode !== "host") {
        const usedPorts = collectUsedHostPortsByIp(node.servers);
        const conflictPort = findPortConflict(
          usedPorts,
          resolvedHostIp,
          Object.values(resolvedPortBindings)
        );
        if (conflictPort) {
          return reply.status(400).send({
            error: `Port ${conflictPort} is already in use on this node`,
          });
        }
      }
      const requestedIp = hasPrimaryIp
        ? normalizedPrimaryIp && normalizedPrimaryIp.length > 0
          ? normalizedPrimaryIp
          : null
        : resolvedHostIp ?? null;

      let allocationIp: string | null = null;
      let allocationPort: number | null = null;
      if (allocationId) {
        const allocation = await prisma.nodeAllocation.findUnique({
          where: { id: allocationId },
        });
        if (!allocation || allocation.nodeId !== nodeId) {
          return reply.status(404).send({ error: "Allocation not found" });
        }
        if (allocation.serverId) {
          return reply.status(409).send({ error: "Allocation is already assigned" });
        }
        allocationIp = allocation.ip;
        allocationPort = allocation.port;
        const conflictPort = findPortConflict(
          collectUsedHostPortsByIp(node.servers),
          allocationIp,
          Object.values(resolvedPortBindings)
        );
        if (conflictPort) {
          return reply.status(400).send({
            error: `Port ${conflictPort} is already in use on this node`,
          });
        }
      }

      // Create server (allocate IP after we have serverId)
      let server;
      try {
        server = await prisma.$transaction(async (tx) => {
          const created = await tx.server.create({
            data: {
              uuid: uuidv4(),
              name,
              description,
              templateId,
              nodeId,
              locationId,
              ownerId: effectiveOwnerId,
              allocatedMemoryMb,
              allocatedCpuCores,
              allocatedDiskMb,
              backupAllocationMb: resolvedBackupAllocationMb ?? 0,
              databaseAllocation: resolvedDatabaseAllocation ?? 0,
              primaryPort: allocationPort ?? validatedPrimaryPort,
              portBindings: resolvedPortBindings,
              networkMode: desiredNetworkMode,
              subdomain: normalizedSubdomain,
              environment: {
                ...nextEnvironment,
                TEMPLATE_IMAGE: resolvedImage,
              },
            },
          });

          if (allocationId) {
            const updated = await tx.server.update({
              where: { id: created.id },
              data: {
                primaryIp: allocationIp,
                primaryPort: allocationPort ?? validatedPrimaryPort,
                environment: {
                  ...(nextEnvironment || {}),
                  TEMPLATE_IMAGE: resolvedImage,
                  CATALYST_NETWORK_IP: allocationIp,
                },
              },
            });
            await tx.nodeAllocation.update({
              where: { id: allocationId },
              data: { serverId: created.id },
            });
            return updated as typeof created;
          }

          if (shouldUseIpam(desiredNetworkMode)) {
            const allocatedIp = await allocateIpForServer(tx, {
              nodeId,
              networkName: desiredNetworkMode,
              serverId: created.id,
              requestedIp,
            });

            if (!allocatedIp) {
              throw new Error("No IP pool configured for this network");
            }

            const ipamEnvironment = {
              ...(nextEnvironment || {}),
              TEMPLATE_IMAGE: resolvedImage,
              CATALYST_NETWORK_IP: allocatedIp,
            };

            const updated = await tx.server.update({
              where: { id: created.id },
              data: {
                primaryIp: allocatedIp,
                environment: ipamEnvironment,
              },
            });

            return {
              ...updated,
              environment: ipamEnvironment,
            } as typeof updated;
          }

          return created;
        });
      } catch (error: any) {
        return reply.status(400).send({ error: error.message });
      }

      // Grant owner full permissions
      await prisma.serverAccess.create({
        data: {
          userId: effectiveOwnerId,
          serverId: server.id,
          permissions: [
            "server.start",
            "server.stop",
            "server.read",
            "server.install",
            "alert.read",
            "alert.create",
            "alert.update",
            "alert.delete",
            "file.read",
            "file.write",
            "console.read",
            "console.write",
            "server.delete",
          ],
        },
      });

      reply.status(201).send({
        success: true,
        data: withConnectionInfo(server, node),
      });

      // Fire webhook for server creation
      const webhookService: any = (app as any).webhookService;
      if (webhookService) {
        webhookService.serverCreated({ id: server.id, name: server.name, ownerId: effectiveOwnerId }, userId).catch(() => {});
      }

      // Trigger DNS sync for subdomain
      if (server.subdomain) {
        const { syncServerSubdomain } = await import('../../services/dns-sync.js');
        syncServerSubdomain({
          id: server.id,
          subdomain: server.subdomain,
          primaryIp: server.primaryIp,
          primaryPort: server.primaryPort,
        }).catch((err: any) => {
          captureSystemError({
            level: 'warn',
            component: 'DnsSync',
            message: `Failed to sync DNS for new server ${server.id}: ${err?.message}`,
          }).catch(() => {});
        });
      }

      // Broadcast server_created event
      const wsGatewayServerCreated = (app as any).wsGateway;
      if (wsGatewayServerCreated?.pushToAdminSubscribers) {
        wsGatewayServerCreated.pushToAdminSubscribers('server_created', {
          type: 'server_created',
          serverId: server.id,
          serverName: server.name,
          ownerId: effectiveOwnerId,
          createdBy: userId,
          timestamp: new Date().toISOString(),
        });
      }
      if (wsGatewayServerCreated?.pushToGlobalSubscribers) {
        wsGatewayServerCreated.pushToGlobalSubscribers('server_created', {
          type: 'server_created',
          serverId: server.id,
          serverName: server.name,
          ownerId: effectiveOwnerId,
          createdBy: userId,
          timestamp: new Date().toISOString(),
        });
      }
    }
  );

  // Clone a server
  app.post(
    "/:serverId/clone",
    { onRequest: [app.authenticate], preHandler: [validateRequestBody(serverCloneSchema)] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;

      // Permission check — cloning creates a new server, so server.create is required
      if (!checkPerm(request, 'server.create')) {
        return reply.status(403).send({ error: 'Insufficient permissions to create a server' });
      }

      // Fetch the source server with template, node, and location
      const sourceServer = await prisma.server.findUnique({
        where: { id: serverId },
        include: { template: true, node: true, location: true },
      });

      if (!sourceServer) {
        return reply.status(404).send({ error: 'Source server not found' });
      }

      // Check access to the source server
      if (!(await canAccessServer(userId, sourceServer))) {
        return reply.status(403).send({ error: 'Cannot access source server' });
      }

      const body = request.body as {
        name?: string;
        nodeId?: string;
        locationId?: string;
        allocatedMemoryMb?: number;
        allocatedCpuCores?: number;
        allocatedDiskMb?: number;
        backupAllocationMb?: number;
        databaseAllocation?: number;
        environment?: Record<string, string>;
        subdomain?: string | null;
        ownerId?: string;
        allocationId?: string;
        networkMode?: string;
        copyFiles?: boolean;
      };

      // Resolve overrides with defaults from source server
      const resolvedName = body.name ?? `${sourceServer.name} Copy`;
      const targetNodeId = body.nodeId ?? sourceServer.nodeId;
      const resolvedLocationId = body.locationId ?? sourceServer.locationId;
      const resolvedMemoryMb = body.allocatedMemoryMb ?? sourceServer.allocatedMemoryMb;
      const resolvedCpuCores = body.allocatedCpuCores ?? sourceServer.allocatedCpuCores;
      const resolvedDiskMb = body.allocatedDiskMb ?? sourceServer.allocatedDiskMb;
      const resolvedBackupAllocationMb = body.backupAllocationMb ?? sourceServer.backupAllocationMb;
      const resolvedDatabaseAllocation = body.databaseAllocation ?? sourceServer.databaseAllocation;

      // Owner resolution — same logic as POST / (admin/API-key callers can specify a different owner)
      const canCreate = checkIsAdmin(request, 'admin.write');
      const hasNodeAccessResult = await hasNodeAccess(prisma, userId, targetNodeId);
      if (!canCreate && !hasNodeAccessResult) {
        return reply.status(403).send({ error: 'Admin access or node assignment required' });
      }
      const effectiveOwnerId = (canCreate || hasNodeAccessResult) && body.ownerId ? body.ownerId : userId;
      if (effectiveOwnerId !== userId) {
        if (!checkPerm(request, 'user.create')) {
          return reply.status(403).send({ error: 'Insufficient permissions to create server for other user' });
        }
        const targetUser = await prisma.user.findUnique({ where: { id: effectiveOwnerId } });
        if (!targetUser) {
          return reply.status(400).send({ error: 'Specified owner does not exist' });
        }
      }

      // Subdomain — default to null (do NOT copy source subdomain)
      const normalizedSubdomain = typeof body.subdomain === 'string' ? body.subdomain.trim().toLowerCase() : null;
      if (normalizedSubdomain) {
        const existing = await prisma.server.findUnique({ where: { subdomain: normalizedSubdomain } });
        if (existing) {
          return reply.status(409).send({ error: 'Subdomain is already in use' });
        }
      }

      // Validate source server's template still exists
      if (!sourceServer.template) {
        return reply.status(400).send({ error: 'Source server template not found' });
      }

      // Resolve environment — merge template defaults with source environment, then apply overrides
      const templateVariables = (sourceServer.template.variables as any[]) || [];
      const templateDefaults = templateVariables.reduce((acc: Record<string, string>, variable: any) => {
        if (variable?.name && variable?.default !== undefined) {
          acc[variable.name] = String(variable.default);
        }
        return acc;
      }, {} as Record<string, string>);
      const sourceEnvironment = (sourceServer.environment as Record<string, string>) || {};
      const resolvedEnvironment = {
        ...templateDefaults,
        ...sourceEnvironment,
        ...(body.environment || {}),
      };

      // Remove runtime-injected keys that should be re-resolved
      delete resolvedEnvironment.CATALYST_NETWORK_IP;
      delete resolvedEnvironment.TEMPLATE_IMAGE;

      const resolvedImage = resolveTemplateImage(sourceServer.template, resolvedEnvironment);
      if (!resolvedImage) {
        return reply.status(400).send({ error: 'Template image is required' });
      }

      // Validate required template variables are provided
      const requiredVars = templateVariables.filter((v: any) => v.required);
      const missingVars = requiredVars.filter((v: any) => !resolvedEnvironment?.[v.name]);
      if (missingVars.length > 0) {
        return reply.status(400).send({
          error: `Missing required template variables: ${missingVars.map((v: any) => v.name).join(', ')}`,
        });
      }

      // Validate variable values against rules (same as POST /)
      for (const variable of templateVariables) {
        const value = resolvedEnvironment?.[variable.name];
        if (value && variable.rules) {
          for (const rule of variable.rules) {
            if (rule.startsWith('between:')) {
              const [min, max] = rule.substring(8).split(',').map(Number);
              const numValue = Number(value);
              if (numValue < min || numValue > max) {
                return reply.status(400).send({ error: `Variable ${variable.name} must be between ${min} and ${max}` });
              }
            } else if (rule.startsWith('in:')) {
              const allowedValues = rule.substring(3).split(',');
              if (!allowedValues.includes(value)) {
                return reply.status(400).send({ error: `Variable ${variable.name} must be one of: ${allowedValues.join(', ')}` });
              }
            } else if (rule.startsWith('regex:')) {
              let pattern = rule.substring(6);
              if (pattern.startsWith('/') && pattern.endsWith('/')) {
                pattern = pattern.slice(1, -1);
              }
              // Validate regex pattern for ReDoS protection
              const dangerousPatterns = [
                /\(.*\)\{/,     // Nested quantifiers like (a+)+ or (a*)+
                /\(\?[=:!]/,    // Lookahead/behind assertions
                /\*.*\+|\+.*\*|\{.*,.*\}/, // Complex quantifiers
              ];
              const isUnsafeRegex = dangerousPatterns.some(p => p.test(pattern));
              if (isUnsafeRegex) {
                return reply.status(400).send({ error: `Invalid regex pattern for variable ${variable.name}: pattern contains potentially unsafe constructs` });
              }
              try {
                const regex = new RegExp(pattern);
                const startTime = Date.now();
                const result = regex.test(value);
                if (Date.now() - startTime > 1000) {
                  return reply.status(400).send({ error: `Variable ${variable.name} regex validation timeout` });
                }
                if (!result) {
                  return reply.status(400).send({ error: `Variable ${variable.name} does not match required pattern` });
                }
              } catch {
                return reply.status(400).send({ error: `Invalid regex pattern for variable ${variable.name}: ${pattern}` });
              }
            }
          }
        }
      }

      // Validate node exists and has resources (same as POST /)
      const node = await prisma.node.findUnique({
        where: { id: targetNodeId },
        include: {
          servers: {
            select: {
              id: true,
              allocatedMemoryMb: true,
              allocatedCpuCores: true,
              primaryPort: true,
              primaryIp: true,
              portBindings: true,
              networkMode: true,
            },
          },
        },
      });

      if (!node) {
        return reply.status(404).send({ error: 'Node not found' });
      }

      // Check resource availability
      const totalAllocatedMemory = node.servers.reduce(
        (sum: number, s: any) => sum + (s.allocatedMemoryMb || 0), 0
      );
      const totalAllocatedCpu = node.servers.reduce(
        (sum: number, s: any) => sum + (s.allocatedCpuCores || 0), 0
      );

      const effectiveMaxMemory = node.memoryOverallocatePercent === -1 ? Infinity : Math.floor(node.maxMemoryMb * (1 + node.memoryOverallocatePercent / 100));
      const effectiveMaxCpu = node.cpuOverallocatePercent === -1 ? Infinity : node.maxCpuCores * (1 + node.cpuOverallocatePercent / 100);

      if (totalAllocatedMemory + resolvedMemoryMb > effectiveMaxMemory) {
        const available = effectiveMaxMemory === Infinity ? 'unlimited' : `${effectiveMaxMemory - totalAllocatedMemory}MB`;
        return reply.status(400).send({
          error: `Insufficient memory. Available: ${available}, Required: ${resolvedMemoryMb}MB`,
        });
      }

      if (totalAllocatedCpu + resolvedCpuCores > effectiveMaxCpu) {
        const available = effectiveMaxCpu === Infinity ? 'unlimited' : `${effectiveMaxCpu - totalAllocatedCpu} cores`;
        return reply.status(400).send({
          error: `Insufficient CPU. Available: ${available}, Required: ${resolvedCpuCores} cores`,
        });
      }

      // Network configuration — allow override, default to source server's mode
      const desiredNetworkMode = body.networkMode || sourceServer.networkMode || 'mc-lan-static';
      const isHostNetwork = desiredNetworkMode === 'host';

      // Auto-assign fresh host ports for the clone.
      // Never reuse the source server's primaryPort, primaryIp, or portBindings.
      const usedPorts = collectUsedHostPortsByIp(node.servers);

      let resolvedHostIp: string | null = null;
      try {
        resolvedHostIp =
          typeof resolvedEnvironment?.CATALYST_NETWORK_IP === 'string'
            ? normalizeHostIp(resolvedEnvironment.CATALYST_NETWORK_IP)
            : null;
      } catch (error: any) {
        return reply.status(400).send({ error: error.message });
      }

      let hostNetworkIp: string | null = null;
      if (isHostNetwork) {
        try {
          hostNetworkIp = resolvedHostIp ?? normalizeHostIp(node.publicAddress);
        } catch (error: any) {
          return reply.status(400).send({ error: error.message });
        }
      }

      // For host network mode, no port mapping is needed
      // For other modes, we need to auto-assign fresh host ports
      let clonePortBindings: Record<number, number> = {};
      let clonePrimaryPort: number;

      if (isHostNetwork) {
        // Host network — primaryPort is the container port, no host mapping needed
        clonePrimaryPort = parsePortValue(sourceServer.primaryPort) ?? 25565;
        // Port bindings in host mode are identity-mapped (container port = host port)
        const sourceBindings = parseStoredPortBindings(sourceServer.portBindings);
        for (const [containerPort] of Object.entries(sourceBindings)) {
          const cp = parsePortValue(containerPort);
          if (cp) clonePortBindings[cp] = cp;
        }
        clonePortBindings[clonePrimaryPort] = clonePrimaryPort;
      } else if (shouldUseIpam(desiredNetworkMode)) {
        // IPAM mode — no host port mapping needed, each container gets its own IP
        clonePrimaryPort = parsePortValue(sourceServer.primaryPort) ?? 25565;
        const sourceBindings = parseStoredPortBindings(sourceServer.portBindings);
        for (const [containerPort] of Object.entries(sourceBindings)) {
          const cp = parsePortValue(containerPort);
          if (cp) clonePortBindings[cp] = cp; // identity map for IPAM
        }
        clonePortBindings[clonePrimaryPort] = clonePrimaryPort;
      } else {
        // Non-IPAM, non-host (bridge/mc-lan-static/mc-lan-dynamic)
        // Auto-assign fresh host ports for each container port from the source server
        clonePrimaryPort = parsePortValue(sourceServer.primaryPort) ?? 25565;
        const sourceBindings = parseStoredPortBindings(sourceServer.portBindings);

        // Collect all container ports from source
        const containerPorts = Object.keys(sourceBindings).map(k => parsePortValue(k)).filter((p): p is number => p !== null);
        if (!containerPorts.includes(clonePrimaryPort)) {
          containerPorts.push(clonePrimaryPort);
        }

        // For each container port, find a free host port and register it
        // to prevent collisions between the clone's own ports
        const ipKey = resolvedHostIp || WILDCARD_HOST;
        for (const containerPort of containerPorts) {
          const hostPort = findAvailableHostPort(usedPorts, resolvedHostIp, containerPort);
          clonePortBindings[containerPort] = hostPort;
          // Register the assigned port so subsequent bindings don't conflict
          if (!usedPorts.has(ipKey)) usedPorts.set(ipKey, new Set());
          usedPorts.get(ipKey)!.add(hostPort);
        }
      }

      const nextEnvironment = isHostNetwork && hostNetworkIp
        ? { ...resolvedEnvironment, CATALYST_NETWORK_IP: hostNetworkIp }
        : resolvedEnvironment;

      // Validate allocationId if provided
      const cloneAllocationId = body.allocationId;
      let allocationIp: string | null = null;
      let allocationPort: number | null = null;
      if (cloneAllocationId) {
        if (shouldUseIpam(desiredNetworkMode)) {
          return reply.status(400).send({ error: 'Allocation IDs are only valid for bridge/host networking' });
        }
        const allocation = await prisma.nodeAllocation.findUnique({
          where: { id: cloneAllocationId },
        });
        if (!allocation || allocation.nodeId !== targetNodeId) {
          return reply.status(404).send({ error: 'Allocation not found' });
        }
        if (allocation.serverId) {
          return reply.status(409).send({ error: 'Allocation is already assigned to a server' });
        }
        allocationIp = allocation.ip;
        allocationPort = allocation.port;
        // Override primary port and IP from the allocation
        clonePrimaryPort = allocationPort;
        hostNetworkIp = allocationIp;
      }

      const finalEnvironment = allocationIp
        ? { ...nextEnvironment, CATALYST_NETWORK_IP: allocationIp }
        : nextEnvironment;

      // Create the cloned server in a transaction (same pattern as POST /)
      let server;
      try {
        server = await prisma.$transaction(async (tx) => {
          const created = await tx.server.create({
            data: {
              uuid: uuidv4(),
              name: resolvedName,
              templateId: sourceServer.templateId,
              nodeId: targetNodeId,
              locationId: resolvedLocationId,
              ownerId: effectiveOwnerId,
              allocatedMemoryMb: resolvedMemoryMb,
              allocatedCpuCores: resolvedCpuCores,
              allocatedDiskMb: resolvedDiskMb,
              backupAllocationMb: resolvedBackupAllocationMb ?? 0,
              databaseAllocation: resolvedDatabaseAllocation ?? 0,
              primaryPort: clonePrimaryPort,
              portBindings: clonePortBindings,
              networkMode: desiredNetworkMode,
              subdomain: normalizedSubdomain,
              environment: {
                ...finalEnvironment,
                TEMPLATE_IMAGE: resolvedImage,
              },
              // Status is always "stopped" for a clone — never copy runtime state
            },
          });

          // Assign allocation to the server if provided
          if (cloneAllocationId) {
            const updated = await tx.server.update({
              where: { id: created.id },
              data: {
                primaryIp: allocationIp,
                primaryPort: allocationPort ?? clonePrimaryPort,
                environment: {
                  ...finalEnvironment,
                  TEMPLATE_IMAGE: resolvedImage,
                  CATALYST_NETWORK_IP: allocationIp,
                },
              },
            });
            await tx.nodeAllocation.update({
              where: { id: cloneAllocationId },
              data: { serverId: created.id },
            });
            return updated as typeof created;
          }

          // Allocate fresh IP via IPAM if needed (same as POST /)
          if (shouldUseIpam(desiredNetworkMode)) {
            const allocatedIp = await allocateIpForServer(tx, {
              nodeId: targetNodeId,
              networkName: desiredNetworkMode,
              serverId: created.id,
              requestedIp: null, // auto-assign
            });

            if (!allocatedIp) {
              throw new Error('No IP pool configured for this network');
            }

            const ipamEnvironment = {
              ...(nextEnvironment || {}),
              TEMPLATE_IMAGE: resolvedImage,
              CATALYST_NETWORK_IP: allocatedIp,
            };

            const updated = await tx.server.update({
              where: { id: created.id },
              data: {
                primaryIp: allocatedIp,
                environment: ipamEnvironment,
              },
            });

            return { ...updated, environment: ipamEnvironment } as typeof updated;
          }

          return created;
        });
      } catch (error: any) {
        return reply.status(400).send({ error: error.message });
      }

      // Grant owner full permissions (same as POST /)
      await prisma.serverAccess.create({
        data: {
          userId: effectiveOwnerId,
          serverId: server.id,
          permissions: [
            'server.start',
            'server.stop',
            'server.read',
            'server.install',
            'alert.read',
            'alert.create',
            'alert.update',
            'alert.delete',
            'file.read',
            'file.write',
            'console.read',
            'console.write',
            'server.delete',
          ],
        },
      });

      // Audit log
      await prisma.auditLog.create({
        data: {
          userId,
          action: 'server.clone',
          resource: 'server',
          resourceId: server.id,
          details: {
            sourceServerId: sourceServer.id,
            sourceServerName: sourceServer.name,
            clonedByName: resolvedName,
          },
        },
      });

      // If copyFiles is requested, set status to "cloning" and kick off async file copy
      const shouldCopyFiles = body.copyFiles === true;
      if (shouldCopyFiles) {
        await prisma.server.update({
          where: { id: server.id },
          data: { status: 'cloning' },
        });

        // Broadcast the cloning status update immediately
        const wsGatewayCloning = (app as any).wsGateway;
        if (wsGatewayCloning?.pushToGlobalSubscribers) {
          wsGatewayCloning.pushToGlobalSubscribers('server_state_update', {
            type: 'server_state_update',
            serverId: server.id,
            state: 'cloning',
          });
        }

        reply.status(201).send({
          success: true,
          data: withConnectionInfo({ ...server, status: 'cloning' }, node),
        });
      } else {
        reply.status(201).send({
          success: true,
          data: withConnectionInfo(server, node),
        });
      }

      // Async file copy (fire-and-forget from the request's perspective)
      if (shouldCopyFiles) {
        const cloneServerId = server.id;
        const cloneServerUuid = (server as any).uuid;
        const sourceUuid = sourceServer.uuid;
        const sourceNodeId = sourceServer.nodeId;
        const targetNodeIdFinal = targetNodeId;
        const isSameNode = sourceNodeId === targetNodeIdFinal;

        // Log start of file copy
        await prisma.serverLog.create({
          data: {
            serverId: cloneServerId,
            stream: 'system',
            data: 'File copy from source server started...',
          },
        });

        const wsGatewayFileCopy = (app as any).wsGateway;

        // Perform file copy in background
        (async () => {
          try {
            if (!wsGatewayFileCopy) {
              throw new Error('WebSocket gateway not available');
            }

            if (isSameNode) {
              // Same-node: tell agent to cp -a the data directory
              const result = await wsGatewayFileCopy.requestFromAgent(targetNodeIdFinal, {
                type: 'clone_server_files',
                serverId: cloneServerId,
                sourceServerUuid: sourceUuid,
                targetServerUuid: cloneServerUuid,
              }, 300000); // 5 min timeout for large servers

              if (!result?.success) {
                throw new Error(result?.error || 'Agent file copy failed');
              }
            } else {
              // Cross-node: use backup stream relay (same as transfer)
              const requestId = crypto.randomUUID();

              // Prepare restore on target agent
              const targetNode = await prisma.node.findUnique({ where: { id: targetNodeIdFinal } });
              if (!targetNode) {
                throw new Error('Target node not found');
              }
              const targetServerDir = `${targetNode.serverDataDir || '/var/lib/catalyst/servers'}/${cloneServerUuid}`;

              const prepareResult = await wsGatewayFileCopy.requestFromAgent(targetNodeIdFinal, {
                type: 'prepare_restore_stream',
                requestId,
                serverId: cloneServerId,
                serverUuid: cloneServerUuid,
                serverDir: targetServerDir,
              }, 15000);

              if (!prepareResult?.success) {
                throw new Error(prepareResult?.error || 'Target agent failed to prepare for file copy');
              }

              // Set up binary relay
              const relayPromise = wsGatewayFileCopy.relayBackupStream(sourceNodeId, targetNodeIdFinal);

              // Tell source agent to start streaming
              wsGatewayFileCopy.sendToAgent(sourceNodeId, {
                type: 'start_backup_stream',
                requestId,
                serverId: sourceServer.id,
                serverUuid: sourceUuid,
              });

              // Wait for relay to complete
              await relayPromise;

              // Finish restore on target
              const finishResult = await wsGatewayFileCopy.requestFromAgent(targetNodeIdFinal, {
                type: 'finish_restore_stream',
                requestId,
                serverId: cloneServerId,
                serverUuid: cloneServerUuid,
              }, 30000);

              if (!finishResult?.success) {
                throw new Error(finishResult?.error || 'Target agent failed to finish file copy');
              }
            }

            // Success — update status to stopped
            await prisma.server.update({
              where: { id: cloneServerId },
              data: { status: 'stopped' },
            });

            await prisma.serverLog.create({
              data: {
                serverId: cloneServerId,
                stream: 'system',
                data: 'File copy complete. Server is ready to start.',
              },
            });

            // Broadcast status update
            const wsGatewayDone = (app as any).wsGateway;
            if (wsGatewayDone?.pushToGlobalSubscribers) {
              wsGatewayDone.pushToGlobalSubscribers('server_state_update', {
                type: 'server_state_update',
                serverId: cloneServerId,
                state: 'stopped',
              });
            }
          } catch (err: any) {
            // Failure — still set to stopped but log the error
            await prisma.server.update({
              where: { id: cloneServerId },
              data: { status: 'stopped' },
            });

            await prisma.serverLog.create({
              data: {
                serverId: cloneServerId,
                stream: 'system',
                data: `File copy failed: ${err.message}. Server was created but files were not copied.`,
              },
            });

            const wsGatewayFail = (app as any).wsGateway;
            if (wsGatewayFail?.pushToGlobalSubscribers) {
              wsGatewayFail.pushToGlobalSubscribers('server_state_update', {
                type: 'server_state_update',
                serverId: cloneServerId,
                state: 'stopped',
              });
            }

            captureSystemError({
              level: 'error',
              component: 'CloneFiles',
              message: `File copy failed for clone ${cloneServerId}: ${err.message}`,
            }).catch(() => {});
          }
        })();
      }

      // Fire webhook for server creation
      const webhookService: any = (app as any).webhookService;
      if (webhookService) {
        webhookService.serverCreated({ id: server.id, name: server.name, ownerId: effectiveOwnerId }, userId).catch(() => {});
      }

      // Trigger DNS sync if subdomain was provided
      if (server.subdomain) {
        const { syncServerSubdomain } = await import('../../services/dns-sync.js');
        syncServerSubdomain({
          id: server.id,
          subdomain: server.subdomain,
          primaryIp: server.primaryIp,
          primaryPort: server.primaryPort,
        }).catch((err: any) => {
          captureSystemError({
            level: 'warn',
            component: 'DnsSync',
            message: `Failed to sync DNS for cloned server ${server.id}: ${err?.message}`,
          }).catch(() => {});
        });
      }

      // Broadcast server_created event (same as POST /)
      const wsGatewayClone = (app as any).wsGateway;
      if (wsGatewayClone?.pushToAdminSubscribers) {
        wsGatewayClone.pushToAdminSubscribers('server_created', {
          type: 'server_created',
          serverId: server.id,
          serverName: server.name,
          ownerId: effectiveOwnerId,
          createdBy: userId,
          timestamp: new Date().toISOString(),
        });
      }
      if (wsGatewayClone?.pushToGlobalSubscribers) {
        wsGatewayClone.pushToGlobalSubscribers('server_created', {
          type: 'server_created',
          serverId: server.id,
          serverName: server.name,
          ownerId: effectiveOwnerId,
          createdBy: userId,
          timestamp: new Date().toISOString(),
        });
      }
    }
  );

  // List user's servers
  app.get(
    "/",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.user.userId;

      // Get nodes accessible to user (via direct assignment or role)
      const accessibleResult = await getUserAccessibleNodes(prisma, userId);
      const accessibleNodeIds = accessibleResult.nodeIds;

      const servers = await prisma.server.findMany({
        where: {
          OR: [
            { ownerId: userId },
            {
              access: {
                some: { userId, permissions: { has: "server.read" } },
              },
            },
            // Include all servers on nodes user has access to
            ...(accessibleNodeIds.length > 0
              ? [{ nodeId: { in: accessibleNodeIds } }]
              : []
            ),
          ],
        },
        include: {
          template: true,
          node: true,
          location: true,
          access: { select: { userId: true, permissions: true } },
        },
      });
      const latestMetrics = await prisma.serverMetrics.findMany({
        where: { serverId: { in: servers.map((server) => server.id) } },
        orderBy: { timestamp: "desc" },
        distinct: ["serverId"],
      });
      const latestMetricsByServer = new Map(
        latestMetrics.map((metric) => [metric.serverId, metric])
      );

      // Pre-compute user's effective permissions for each server.
      // Owners get all permissions, node-assigned users get all,
      // explicit access users get their stored permissions.
      // For the list, we compute this from the already-loaded data.
      const isUserAdmin = checkIsAdmin(request, "admin.write");
      const allServerPermissions = [
        'server.read', 'server.start', 'server.stop', 'server.install',
        'server.transfer', 'server.delete', 'server.schedule',
        'console.read', 'console.write',
        'file.read', 'file.write',
        'backup.read', 'backup.create', 'backup.restore', 'backup.delete',
        'database.read', 'database.create', 'database.rotate', 'database.delete',
        'alert.read', 'alert.create', 'alert.update', 'alert.delete',
      ];

      reply.send(serialize({
        success: true,
        data: servers.map((server) => {
          const metrics = latestMetricsByServer.get(server.id) as any;
          const diskTotalMb =
            server.allocatedDiskMb && server.allocatedDiskMb > 0 ? server.allocatedDiskMb : null;
          const { access, ...serverData } = server;

          // Compute effective permissions
          let effectivePermissions: string[];
          if (isUserAdmin || server.ownerId === userId || accessibleResult.hasWildcard) {
            effectivePermissions = allServerPermissions;
          } else if (accessibleResult.nodeIds.includes(server.nodeId)) {
            effectivePermissions = allServerPermissions;
          } else {
            const userAccess = (access as any[])?.find((a: any) => a.userId === userId);
            effectivePermissions = userAccess?.permissions ?? ['server.read'];
          }

          return {
            ...withConnectionInfo(serverData as any),
            cpuPercent: metrics?.cpuPercent ?? null,
            memoryUsageMb: metrics?.memoryUsageMb ?? null,
            diskUsageMb: metrics?.diskUsageMb ?? null,
            diskTotalMb,
            effectivePermissions,
          };
        }),
      }));
    }
  );

  // Get server details
  app.get(
    "/:serverId",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;

      const server = await prisma.server.findUnique({
        where: { id: serverId },
        include: {
          template: true,
          node: true,
          location: true,
          access: true,
        },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      // Determine access level with minimal DB queries:
      //   1. Owner → skip hasNodeAccess entirely
      //   2. Explicit access → skip hasNodeAccess entirely
      //   3. Otherwise → call hasNodeAccess once and reuse result for permissions
      let nodeAccessGranted = false;
      const isOwner = server.ownerId === userId;
      const hasExplicitAccess = server.access.some((a) => a.userId === userId);

      if (!isOwner && !hasExplicitAccess) {
        nodeAccessGranted = await hasNodeAccess(prisma, userId, server.nodeId);
        if (!nodeAccessGranted) {
          return reply.status(403).send({ error: "Forbidden" });
        }
      }

      // Compute effective permissions — reuse the nodeAccessGranted result
      // instead of calling hasNodeAccess a second time inside getEffectiveServerPermissions
      const effectivePermissions = await getEffectiveServerPermissions(
        userId,
        { ownerId: server.ownerId, nodeId: server.nodeId },
        server.access.map((a) => ({ userId: a.userId, permissions: a.permissions as string[] })),
        isOwner,
        hasExplicitAccess,
        nodeAccessGranted,
      );

      const { access, ...serverData } = server;
      reply.send({ success: true, data: { ...withConnectionInfo(serverData as any), effectivePermissions } });
    }
  );

  // Get historical stats for a server
  app.put(
    "/:serverId",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;

      const server = await prisma.server.findUnique({
        where: { id: serverId },
        include: { node: true },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      if (!ensureNotSuspended(server, reply)) {
        return;
      }

      // Check permission - owner, admin, or node-assigned user can access
      if (!(await canAccessServer(userId, server))) {
        // Also check for explicit server access as fallback
        const access = await prisma.serverAccess.findUnique({
          where: { userId_serverId: { userId, serverId } },
        });
        if (!access) {
          return reply.status(403).send({ error: "Forbidden" });
        }
      }

      const {
        name,
        description,
        environment,
        startupCommand,
        allocatedMemoryMb,
        allocatedCpuCores,
        allocatedDiskMb,
        backupAllocationMb,
        databaseAllocation,
        primaryPort,
        primaryIp,
        portBindings,
        allocationId,
        subdomain,
      } = request.body as {
        name?: string;
        description?: string;
        environment?: Record<string, string>;
        startupCommand?: string | null;
        allocatedMemoryMb?: number;
        allocatedCpuCores?: number;
        allocatedDiskMb?: number;
        backupAllocationMb?: number;
        databaseAllocation?: number;
        primaryPort?: number;
        primaryIp?: string | null;
        portBindings?: Record<number, number>;
        allocationId?: string;
        subdomain?: string | null;
      };

      const hasPrimaryIpUpdate = primaryIp !== undefined;
      const hasAllocationUpdate = allocationId !== undefined;
      const normalizedPrimaryIp = typeof primaryIp === "string" ? primaryIp.trim() : null;

      // Validate subdomain uniqueness on update
      const normalizedSubdomain = typeof subdomain === 'string' ? subdomain.trim().toLowerCase() : null;
      if (subdomain !== undefined && normalizedSubdomain !== server.subdomain) {
        if (normalizedSubdomain) {
          const existing = await prisma.server.findUnique({ where: { subdomain: normalizedSubdomain } });
          if (existing && existing.id !== serverId) {
            return reply.status(409).send({ error: 'Subdomain is already in use' });
          }
        }
      }

      // Can only update resources if server is stopped
      if (
        (allocatedMemoryMb !== undefined ||
          allocatedCpuCores !== undefined ||
          allocatedDiskMb !== undefined ||
          primaryPort !== undefined ||
          portBindings !== undefined ||
          hasPrimaryIpUpdate ||
          hasAllocationUpdate) &&
        server.status !== "stopped"
      ) {
        return reply.status(409).send({
          error: "Server must be stopped to update resource allocation",
        });
      }

      // Validate resource changes if provided
      if (
        allocatedMemoryMb !== undefined ||
        allocatedCpuCores !== undefined ||
        allocatedDiskMb !== undefined
      ) {
        if (
          (allocatedMemoryMb !== undefined && allocatedMemoryMb <= 0) ||
          (allocatedCpuCores !== undefined && allocatedCpuCores <= 0) ||
          (allocatedDiskMb !== undefined && allocatedDiskMb <= 0)
        ) {
          return reply.status(400).send({
            error: "Resource values must be positive numbers",
          });
        }

        const node = server.node;
        const otherServers = await prisma.server.findMany({
          where: {
            nodeId: server.nodeId,
            id: { not: serverId },
          },
          select: {
            id: true,
            allocatedMemoryMb: true,
            allocatedCpuCores: true,
            allocatedDiskMb: true,
            primaryPort: true,
            portBindings: true,
            networkMode: true,
          },
        });

        const totalOtherMemory = otherServers.reduce(
          (sum, s) => sum + (s.allocatedMemoryMb || 0),
          0
        );
        const totalOtherCpu = otherServers.reduce(
          (sum, s) => sum + (s.allocatedCpuCores || 0),
          0
        );
        const totalOtherDisk = otherServers.reduce(
          (sum, s) => sum + (s.allocatedDiskMb || 0),
          0
        );

        const newMemory = allocatedMemoryMb ?? server.allocatedMemoryMb;
        const newCpu = allocatedCpuCores ?? server.allocatedCpuCores;
        const newDisk = allocatedDiskMb ?? server.allocatedDiskMb;

        const effectiveMaxMemory = node.memoryOverallocatePercent === -1 ? Infinity : Math.floor(node.maxMemoryMb * (1 + node.memoryOverallocatePercent / 100));
        const effectiveMaxCpu = node.cpuOverallocatePercent === -1 ? Infinity : node.maxCpuCores * (1 + node.cpuOverallocatePercent / 100);

        if (totalOtherMemory + newMemory > effectiveMaxMemory) {
          const available = effectiveMaxMemory === Infinity ? "unlimited" : `${effectiveMaxMemory - totalOtherMemory}MB`;
          return reply.status(400).send({
            error: `Insufficient memory. Available: ${available}`,
          });
        }

        if (totalOtherCpu + newCpu > effectiveMaxCpu) {
          const available = effectiveMaxCpu === Infinity ? "unlimited" : `${effectiveMaxCpu - totalOtherCpu} cores`;
          return reply.status(400).send({
            error: `Insufficient CPU. Available: ${available}`,
          });
        }

        if (process.env.MAX_DISK_MB) {
          const maxDisk = Number(process.env.MAX_DISK_MB);
          if (Number.isFinite(maxDisk) && maxDisk > 0 && totalOtherDisk + newDisk > maxDisk) {
            return reply.status(400).send({
              error: `Insufficient disk. Available: ${maxDisk - totalOtherDisk}MB`,
            });
          }
        }
      }

      if (
        backupAllocationMb !== undefined &&
        (!Number.isFinite(backupAllocationMb) || backupAllocationMb < 0)
      ) {
        return reply.status(400).send({ error: "backupAllocationMb must be 0 or more" });
      }
      if (
        databaseAllocation !== undefined &&
        (!Number.isFinite(databaseAllocation) || databaseAllocation < 0)
      ) {
        return reply.status(400).send({ error: "databaseAllocation must be 0 or more" });
      }

      let nextPrimaryPort = primaryPort ?? server.primaryPort;
      if (!parsePortValue(nextPrimaryPort)) {
        return reply.status(400).send({ error: "Invalid primary port" });
      }
      const hasExplicitPortBindings =
        portBindings !== undefined && portBindings !== null;
      const resolvedPortBindings =
        hasExplicitPortBindings
          ? normalizePortBindings(portBindings, nextPrimaryPort)
          : parseStoredPortBindings(server.portBindings);
      const effectiveBindings =
        Object.keys(resolvedPortBindings).length > 0
          ? resolvedPortBindings
          : normalizePortBindings({}, nextPrimaryPort);
      let resolvedHostIp: string | null = null;
      if (typeof environment?.CATALYST_NETWORK_IP === "string") {
        try {
          resolvedHostIp = normalizeHostIp(environment.CATALYST_NETWORK_IP);
        } catch (error: any) {
          return reply.status(400).send({ error: error.message });
        }
      }
      const isHostNetwork = server.networkMode === "host";
      let hostNetworkIp: string | null = null;
      if (isHostNetwork) {
        try {
          hostNetworkIp = resolvedHostIp ?? normalizeHostIp(server.node.publicAddress);
        } catch (error: any) {
          return reply.status(400).send({ error: error.message });
        }
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
        const hostIp = resolvedHostIp ?? server.primaryIp ?? null;
        const conflictPort = findPortConflict(
          usedPorts,
          hostIp,
          Object.values(effectiveBindings)
        );
        if (conflictPort) {
          return reply.status(400).send({
            error: `Port ${conflictPort} is already in use on this node`,
          });
        }
      }

      if (hasPrimaryIpUpdate && !shouldUseIpam(server.networkMode ?? undefined)) {
        return reply.status(400).send({
          error: "Primary IP can only be updated for IPAM networks",
        });
      }
      if (hasPrimaryIpUpdate && isHostNetwork && normalizedPrimaryIp) {
        return reply.status(400).send({
          error: "Primary IP is not used for host networking",
        });
      }

      // Validate allocationId if provided
      let newAllocation: { id: string; ip: string; port: number } | null = null;
      if (hasAllocationUpdate && allocationId) {
        // Allocations only work for bridge or host networking
        if (shouldUseIpam(server.networkMode ?? undefined)) {
          return reply.status(400).send({
            error: "Allocation IDs are only valid for bridge/host networking",
          });
        }
        const allocation = await prisma.nodeAllocation.findUnique({
          where: { id: allocationId },
        });
        if (!allocation || allocation.nodeId !== server.nodeId) {
          return reply.status(404).send({ error: "Allocation not found" });
        }
        if (allocation.serverId && allocation.serverId !== serverId) {
          return reply.status(409).send({ error: "Allocation is already assigned to another server" });
        }
        newAllocation = { id: allocation.id, ip: allocation.ip, port: allocation.port };
      }

      const updated = await prisma.$transaction(async (tx) => {
        let nextPrimaryIp = server.primaryIp ?? null;
        let nextEnvironment = (environment || server.environment) as Record<string, string>;

        if (hasPrimaryIpUpdate) {
          if (normalizedPrimaryIp && normalizedPrimaryIp.length > 0) {
            if (normalizedPrimaryIp !== server.primaryIp) {
              await releaseIpForServer(tx, serverId);
              const allocatedIp = await allocateIpForServer(tx, {
                nodeId: server.nodeId,
                networkName: server.networkMode,
                serverId,
                requestedIp: normalizedPrimaryIp,
              });
              if (!allocatedIp) {
                throw new Error("No IP pool configured for this network");
              }
              nextPrimaryIp = allocatedIp;
            }
          } else if (server.primaryIp) {
            await releaseIpForServer(tx, serverId);
            const allocatedIp = await allocateIpForServer(tx, {
              nodeId: server.nodeId,
              networkName: server.networkMode,
              serverId,
            });
            if (!allocatedIp) {
              throw new Error("No IP pool configured for this network");
            }
            nextPrimaryIp = allocatedIp;
          }

          nextEnvironment = {
            ...((environment || server.environment || {}) as Record<string, any>),
          };
          if (nextPrimaryIp) {
            nextEnvironment.CATALYST_NETWORK_IP = nextPrimaryIp;
          } else {
            delete nextEnvironment.CATALYST_NETWORK_IP;
          }
        } else if (isHostNetwork && hostNetworkIp) {
          nextEnvironment = {
            ...((environment || server.environment || {}) as Record<string, any>),
            CATALYST_NETWORK_IP: hostNetworkIp,
          };
        }

        // Handle allocation update for bridge/host networking
        if (newAllocation) {
          // Release old allocation if it exists
          const oldAllocation = await tx.nodeAllocation.findFirst({
            where: { serverId },
          });
          if (oldAllocation && oldAllocation.id !== newAllocation.id) {
            await tx.nodeAllocation.update({
              where: { id: oldAllocation.id },
              data: { serverId: null },
            });
          }
          // Assign new allocation
          await tx.nodeAllocation.update({
            where: { id: newAllocation.id },
            data: { serverId },
          });
          nextPrimaryIp = newAllocation.ip;
          nextPrimaryPort = newAllocation.port;
          nextEnvironment = {
            ...((environment || server.environment || {}) as Record<string, any>),
            CATALYST_NETWORK_IP: newAllocation.ip,
          };
        }

        const updatedServer = await tx.server.update({
          where: { id: serverId },
          data: {
            name: name || server.name,
            description: description !== undefined ? description : server.description,
            environment: nextEnvironment,
            ...(startupCommand !== undefined ? { startupCommand: startupCommand || null } : {}),
            allocatedMemoryMb: allocatedMemoryMb ?? server.allocatedMemoryMb,
            allocatedCpuCores: allocatedCpuCores ?? server.allocatedCpuCores,
            allocatedDiskMb: allocatedDiskMb ?? server.allocatedDiskMb,
            backupAllocationMb: backupAllocationMb ?? server.backupAllocationMb ?? 0,
            databaseAllocation: databaseAllocation ?? server.databaseAllocation ?? 0,
            primaryPort: nextPrimaryPort,
            portBindings: effectiveBindings,
            primaryIp: nextPrimaryIp,
            subdomain: subdomain !== undefined ? normalizedSubdomain : server.subdomain,
          },
        });

        return updatedServer;
      });

      reply.send({ success: true, data: updated });

      // Trigger DNS sync if subdomain or primary IP changed
      if (updated.subdomain) {
        const { syncServerSubdomain } = await import('../../services/dns-sync.js');
        syncServerSubdomain({
          id: updated.id,
          subdomain: updated.subdomain,
          primaryIp: updated.primaryIp,
          primaryPort: updated.primaryPort,
        }).catch((err: any) => {
          captureSystemError({
            level: 'warn',
            component: 'DnsSync',
            message: `Failed to sync DNS for updated server ${server.id}: ${err?.message}`,
          }).catch(() => {});
        });
      }

      // Broadcast server_updated event
      const wsGatewayServerUpdated = (app as any).wsGateway;
      if (wsGatewayServerUpdated?.pushToAdminSubscribers) {
        wsGatewayServerUpdated.pushToAdminSubscribers('server_updated', {
          type: 'server_updated',
          serverId: server.id,
          updatedBy: userId,
          timestamp: new Date().toISOString(),
        });
      }
      if (wsGatewayServerUpdated?.pushToGlobalSubscribers) {
        wsGatewayServerUpdated.pushToGlobalSubscribers('server_updated', {
          type: 'server_updated',
          serverId: server.id,
          updatedBy: userId,
          timestamp: new Date().toISOString(),
        });
      }
    }
  );

  // Resize server storage (grow online, shrink requires stop)
  app.post(
    "/:serverId/storage/resize",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const { allocatedDiskMb } = request.body as { allocatedDiskMb?: number };
      const userId = request.user.userId;

      if (!allocatedDiskMb || allocatedDiskMb <= 0) {
        return reply.status(400).send({ error: "Invalid disk size" });
      }

      const server = await prisma.server.findUnique({
        where: { id: serverId },
        include: { node: true },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      if (!ensureNotSuspended(server, reply)) {
        return;
      }

      if (server.ownerId !== userId) {
        const access = await prisma.serverAccess.findUnique({
          where: { userId_serverId: { userId, serverId } },
        });
        if (!access) {
          return reply.status(403).send({ error: "Forbidden" });
        }
        // Check that the access entry includes write permissions for storage resize
        const accessPermissions = access.permissions as string[];
        if (!accessPermissions.includes('file.write') && !accessPermissions.includes('server.update')) {
          return reply.status(403).send({ error: "Insufficient permissions for storage resize" });
        }
      }

      const isShrink = allocatedDiskMb < server.allocatedDiskMb;
      if (isShrink && server.status !== "stopped") {
        return reply.status(409).send({ error: "Server must be stopped to shrink disk" });
      }

      const gateway = (app as any).wsGateway;
      if (!gateway) {
        return reply.status(500).send({ error: "WebSocket gateway not available" });
      }

      const success = await gateway.sendToAgent(server.nodeId, {
        type: "resize_storage",
        serverId: server.id,
        serverUuid: server.uuid,
        allocatedDiskMb,
      });

      if (!success) {
        return reply.status(503).send({ error: "Failed to send resize command to agent" });
      }

      await prisma.server.update({
        where: { id: serverId },
        data: { allocatedDiskMb },
      });

      await prisma.auditLog.create({
        data: {
          userId,
          action: "server.storage.resize",
          resource: "server",
          resourceId: serverId,
          details: { allocatedDiskMb, previousDiskMb: server.allocatedDiskMb },
        },
      });

      const wsGateway = app.wsGateway;
      if (wsGateway?.pushToAdminSubscribers) {
        wsGateway.pushToAdminSubscribers('server_updated', {
          type: 'server_updated',
          serverId,
          updatedBy: userId,
          change: 'storage_resize',
          timestamp: new Date().toISOString(),
        });
      }
      if (wsGateway?.pushToGlobalSubscribers) {
        wsGateway.pushToGlobalSubscribers('server_updated', {
          type: 'server_updated',
          serverId,
          updatedBy: userId,
          change: 'storage_resize',
          timestamp: new Date().toISOString(),
        });
      }

      reply.send({ success: true, message: "Resize initiated" });
    }
  );

  // Get server files
  app.delete(
    "/:serverId",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;

      const server = await prisma.server.findUnique({
        where: { id: serverId },
        include: { template: true },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      if (isSuspensionEnforced() && server.suspendedAt && isSuspensionDeleteBlocked()) {
        return reply.status(423).send({
          error: "Server is suspended",
          suspendedAt: server.suspendedAt,
          suspensionReason: server.suspensionReason ?? null,
        });
      }

      // Check permission - owner, admin, node-assigned, or server.delete permission
      if (server.ownerId !== userId && !checkIsAdmin(request, "admin.read")) {
        const access = await prisma.serverAccess.findFirst({
          where: { serverId, userId, permissions: { has: "server.delete" } },
        });
        const hasNodeAccessToServer = await hasNodeAccess(prisma, userId, server.nodeId);
        if (!access && !hasNodeAccessToServer) {
          return reply.status(403).send({ error: "Forbidden" });
        }
      }

      const deletableStates = ["stopped", "error", "crashed", "installing"];
      if (!deletableStates.includes(server.status)) {
        return reply.status(409).send({
          error: `Server must be stopped before deletion (current state: ${server.status})`,
        });
      }

      // Clean up DNS record before deleting server
      if (server.subdomain) {
        const { deleteServerSubdomain } = await import('../../services/dns-sync.js');
        deleteServerSubdomain({
          subdomain: server.subdomain,
          primaryPort: server.primaryPort,
          template: server.template ? { srvService: server.template.srvService, srvProtocol: server.template.srvProtocol } : null,
        }).catch(() => {});
      }

      await prisma.$transaction(async (tx) => {
        await releaseIpForServer(tx, serverId);
        await tx.server.delete({ where: { id: serverId } });
      });

      // Tell the agent to clean up the container and firewall rules.
      // If the agent is offline, log a warning — the DB record is already gone,
      // and the agent-side cleanup will be skipped. When the agent reconnects,
      // the state sync will not find this server, so no stale state remains.
      // For a full safety net, a future enhancement could use a "pending_deletion"
      // pattern that defers the DB delete until agent acknowledgment.
      if (server.nodeId) {
        const gateway = (app as any).wsGateway;
        if (gateway) {
          const sent = await gateway.sendToAgent(server.nodeId, {
            type: "delete_server",
            serverId: server.id,
            serverUuid: server.uuid,
          });
          if (!sent) {
            captureSystemError({
              level: 'warn',
              component: 'ServerRoutes',
              message: 'Agent offline during delete — container/data cleanup will be skipped',
              metadata: { serverId: server.id, nodeId: server.nodeId },
            }).catch(() => {});
            app.log.warn(
              { serverId: server.id, nodeId: server.nodeId },
              "Agent offline during delete — container/data cleanup will be skipped. " +
              "Manual cleanup may be required on the node."
            );
          }
        }
      }

      reply.send({ success: true });

      // Fire webhook for server deletion
      const webhookService: any = (app as any).webhookService;
      if (webhookService) {
        webhookService.serverDeleted(serverId, server.name, userId).catch(() => {});
      }

      // Broadcast server_deleted event
      const wsGateway2 = (app as any).wsGateway;
      if (wsGateway2?.pushToAdminSubscribers) {
        wsGateway2.pushToAdminSubscribers('server_deleted', {
          type: 'server_deleted',
          serverId: serverId,
          serverName: server.name,
          deletedBy: userId,
          timestamp: new Date().toISOString(),
        });
      }
      if (wsGateway2?.pushToGlobalSubscribers) {
        wsGateway2.pushToGlobalSubscribers('server_deleted', {
          type: 'server_deleted',
          serverId: serverId,
          serverName: server.name,
          deletedBy: userId,
          timestamp: new Date().toISOString(),
        });
      }
    }
  );

  // Get server permissions
}
