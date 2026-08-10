import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../../db.js";
import { createAuditLog } from '../../middleware/audit.js';
import { captureSystemError, ensureServerAccess, fileRateLimitMax, fileRateLimitWindowMs, getSecuritySettings, isArchiveName, path, validateAndNormalizePath } from './_helpers.js';

export async function serverFilesRoutes(app: FastifyInstance) {
  // Compute per-route body limit for upload (mirrors index.ts file-tunnel pattern)
  const uploadSettings = await getSecuritySettings();
  const uploadBodyLimit = Math.max(
    5 * 1024 * 1024, // 5MB minimum
    Math.min(
      uploadSettings.fileTunnelMaxUploadMb * 1024 * 1024,
      500 * 1024 * 1024,
    ),
  );
  const fileTunnel = (app as any).fileTunnel as import("../../services/file-tunnel").FileTunnelService;
  const tunnelFileOp = async (
    nodeId: string,
    operation: string,
    serverUuid: string,
    filePath: string,
    data?: Record<string, unknown>,
    uploadData?: Buffer,
  ) => {
    return fileTunnel.queueRequest(nodeId, operation, serverUuid, filePath, data, uploadData);
  };

  /**
   * Fail fast when the node is offline so the client gets 503 instead of waiting
   * the full file-tunnel timeout (60s) and surfacing a gateway 504.
   * Uses DB isOnline (agent heartbeat) and live poller presence as a secondary signal.
   */
  const ensureNodeOnlineForFiles = async (
    nodeId: string,
    reply: FastifyReply,
  ): Promise<boolean> => {
    const node = await prisma.node.findUnique({
      where: { id: nodeId },
      select: { isOnline: true, name: true },
    });
    if (!node) {
      reply.status(404).send({ error: "Node not found" });
      return false;
    }
    if (!node.isOnline && !fileTunnel.isNodeConnected(nodeId)) {
      reply.status(503).send({
        error: "Node is offline",
        code: "NODE_OFFLINE",
        nodeName: node.name,
      });
      return false;
    }
    return true;
  };


  /** Map tunnel errors to HTTP responses shared by all file routes. */
  const replyTunnelError = (reply: FastifyReply, error: any) => {
    if (error?.message?.includes("timed out")) {
      return reply.status(504).send({
        error: "Agent file operation timed out",
        code: "AGENT_TIMEOUT",
      });
    }
    if (error?.message?.includes("Too many pending") || error?.message?.includes("queue full")) {
      return reply.status(503).send({ error: error.message, code: "FILE_TUNNEL_BUSY" });
    }
    return reply.status(400).send({ error: error?.message || "Invalid path" });
  };

  /**
   * Align file routes with ensureServerAccess:
   * owner, explicit serverAccess perm, admin.write/*, or (node assignment + node.update).
   * Bare hasNodeAccess alone is not enough.
   */
  const requireFileAccess = async (
    serverId: string,
    userId: string,
    permission: string,
    reply: FastifyReply,
  ) => ensureServerAccess(serverId, userId, permission, reply);

  const notifyFileChange = (serverId: string, status: string, action: string, path?: string, from?: string, to?: string) => {
    const wsGateway = app.wsGateway;
    if (!wsGateway?.routeToClients) return;
    wsGateway.routeToClients(serverId, {
      type: 'server_files_changed',
      serverId,
      action,
      ...(path ? { path } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      timestamp: Date.now(),
    }).catch(() => {});
    wsGateway.routeToClients(serverId, {
      type: 'server_state_update',
      serverId,
      state: status,
      timestamp: Date.now(),
    }).catch(() => {});
  };

  app.get(
    "/:serverId/files",
    {
      onRequest: [app.authenticate],
      config: { rateLimit: { max: fileRateLimitMax, timeWindow: fileRateLimitWindowMs } },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;
      const { path: requestedPath } = request.query as { path?: string };

      const server = await requireFileAccess(serverId, userId, "file.read", reply);
      if (!server) {
        return;
      }

      if (!(await ensureNodeOnlineForFiles(server.nodeId, reply))) {
        return;
      }

      const normalizedPath = validateAndNormalizePath(requestedPath, server.uuid, userId);

      try {
        const result = await tunnelFileOp(server.nodeId, "list", server.uuid, normalizedPath);
        if (!result.success) {
          const errMsg = result.error || "Failed to list files";
          const status = errMsg.includes("not found") || errMsg.includes("missing") ? 404 : 400;
          return reply.status(status).send({ error: errMsg });
        }

        reply.send({
          success: true,
          data: {
            path: normalizedPath,
            files: result.data,
          },
        });
      } catch (error: any) {
        return replyTunnelError(reply, error);
      }
    }
  );

  // Get valid game version tags for a provider (used for autocomplete)
  app.get(
    "/:serverId/files/download",
    {
      onRequest: [app.authenticate],
      config: { rateLimit: { max: fileRateLimitMax, timeWindow: fileRateLimitWindowMs } },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;
      const { path: requestedPath } = request.query as { path?: string };

      if (!requestedPath) {
        return reply.status(400).send({ error: "Missing path parameter" });
      }

      const server = await requireFileAccess(serverId, userId, "file.read", reply);
      if (!server) {
        return;
      }

      if (!(await ensureNodeOnlineForFiles(server.nodeId, reply))) {
        return;
      }

      const normalizedPath = validateAndNormalizePath(requestedPath, server.uuid, userId);

      try {
        const result = await tunnelFileOp(server.nodeId, "download", server.uuid, normalizedPath);
        if (!result.success) {
          const errMsg = result.error || "File not found";
          const status = errMsg.includes("not found") || errMsg.includes("missing") ? 404 : 400;
          return reply.status(status).send({ error: errMsg });
        }

        if (result.body) {
          reply.type(result.contentType || "application/octet-stream");
          reply.send(result.body);
        } else {
          reply.status(500).send({ error: "No file data received from agent" });
        }
      } catch (error: any) {
        return replyTunnelError(reply, error);
      }
    }
  );

  // Upload server file
  app.post(
    "/:serverId/files/upload",
    {
      onRequest: [app.authenticate],
      bodyLimit: uploadBodyLimit,
      config: { rateLimit: { max: fileRateLimitMax, timeWindow: fileRateLimitWindowMs } },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;

      const server = await requireFileAccess(serverId, userId, "file.write", reply);
      if (!server) {
        return;
      }

      if (!(await ensureNodeOnlineForFiles(server.nodeId, reply))) {
        return;
      }

      const upload = await request.file();
      if (!upload) {
        return reply.status(400).send({ error: "Missing file upload" });
      }

      const rawPath = (upload.fields as any)?.path?.value;
      const basePath =
        typeof rawPath === "string" ? rawPath : rawPath ? String(rawPath) : "/";
      const safeFilename = path.posix.basename(upload.filename || "upload");
      let filePath: string;
      try {
        const normalizedPath = validateAndNormalizePath(basePath, server.uuid, userId);
        // Re-validate joined path under server jail
        filePath = validateAndNormalizePath(
          path.posix.join(normalizedPath, safeFilename),
          server.uuid,
          userId,
        );
      } catch (pathErr: any) {
        return reply.status(400).send({ error: pathErr?.message || "Invalid path" });
      }

      try {
        // Buffer the upload data and send to agent
        const chunks: Buffer[] = [];
        for await (const chunk of upload.file) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        const uploadData = Buffer.concat(chunks);

        const result = await tunnelFileOp(
          server.nodeId, "upload", server.uuid, filePath,
          { filename: safeFilename },
          uploadData
        );
        if (!result.success) {
          return reply.status(400).send({ error: result.error || "Failed to upload file" });
        }
        notifyFileChange(server.id, server.status, 'upload', filePath);
        reply.send({ success: true });
      } catch (error: any) {
        // Prefer shared tunnel mapping; keep route-specific fallback message.
        if (error?.message?.includes("timed out") || error?.message?.includes("Too many pending") || error?.message?.includes("queue full")) {
          return replyTunnelError(reply, error);
        }
        return reply.status(400).send({ error: error?.message || "Failed to upload file" });
      }
    }
  );

  // Create file or directory
  app.post(
    "/:serverId/files/create",
    {
      onRequest: [app.authenticate],
      config: { rateLimit: { max: fileRateLimitMax, timeWindow: fileRateLimitWindowMs } },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;
      const { path: requestedPath, isDirectory, content } = request.body as {
        path: string;
        isDirectory: boolean;
        content?: string;
      };

      if (!requestedPath) {
        return reply.status(400).send({ error: "Missing path" });
      }

      const server = await requireFileAccess(serverId, userId, "file.write", reply);
      if (!server) {
        return;
      }

      if (!(await ensureNodeOnlineForFiles(server.nodeId, reply))) {
        return;
      }

      const normalizedPath = validateAndNormalizePath(requestedPath, server.uuid, userId);
      if (normalizedPath === "/") {
        return reply.status(400).send({ error: "Invalid path" });
      }

      try {
        const result = await tunnelFileOp(server.nodeId, "create", server.uuid, normalizedPath, {
          isDirectory,
          content: content ?? "",
        });
        if (!result.success) {
          return reply.status(400).send({ error: result.error || "Failed to create item" });
        }
        notifyFileChange(server.id, server.status, 'create', normalizedPath);
        reply.send({ success: true });
      } catch (error: any) {
        // Prefer shared tunnel mapping; keep route-specific fallback message.
        if (error?.message?.includes("timed out") || error?.message?.includes("Too many pending") || error?.message?.includes("queue full")) {
          return replyTunnelError(reply, error);
        }
        return reply.status(400).send({ error: error?.message || "Failed to create item" });
      }
    }
  );

  // Compress files
  app.post(
    "/:serverId/files/compress",
    {
      onRequest: [app.authenticate],
      config: { rateLimit: { max: fileRateLimitMax, timeWindow: fileRateLimitWindowMs } },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;
      const { paths, archiveName } = request.body as { paths: string[]; archiveName: string };

      if (!paths?.length || !archiveName) {
        return reply.status(400).send({ error: "Missing paths or archive name" });
      }

      if (!isArchiveName(archiveName)) {
        return reply.status(400).send({ error: "Unsupported archive type" });
      }

      const server = await requireFileAccess(serverId, userId, "file.write", reply);
      if (!server) {
        return;
      }

      if (!(await ensureNodeOnlineForFiles(server.nodeId, reply))) {
        return;
      }

      try {
        const normalizedArchive = validateAndNormalizePath(archiveName, server.uuid, userId);
        const normalizedPaths = paths.map((p) => validateAndNormalizePath(p, server.uuid, userId));

        const result = await tunnelFileOp(server.nodeId, "compress", server.uuid, normalizedArchive, {
          paths: normalizedPaths,
        });
        if (!result.success) {
          return reply.status(500).send({ error: result.error || "Failed to compress files" });
        }
        notifyFileChange(server.id, server.status, 'compress', normalizedArchive);
        reply.send({ success: true, data: { archivePath: normalizedArchive } });
      } catch (error: any) {
        if (error?.message?.includes("timed out") || error?.message?.includes("Too many pending") || error?.message?.includes("queue full")) {
          return replyTunnelError(reply, error);
        }
        if (error?.message?.includes("Path traversal") || error?.message?.includes("Invalid path")) {
          return reply.status(400).send({ error: error.message });
        }
        reply.status(500).send({ error: error?.message || "Failed to compress files" });
      }
    }
  );

  // Decompress archive
  app.post(
    "/:serverId/files/decompress",
    {
      onRequest: [app.authenticate],
      config: { rateLimit: { max: fileRateLimitMax, timeWindow: fileRateLimitWindowMs } },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;
      const { archivePath, targetPath } = request.body as {
        archivePath: string;
        targetPath: string;
      };

      if (!archivePath || !targetPath) {
        return reply.status(400).send({ error: "Missing archive or target path" });
      }

      const server = await requireFileAccess(serverId, userId, "file.write", reply);
      if (!server) {
        return;
      }

      if (!(await ensureNodeOnlineForFiles(server.nodeId, reply))) {
        return;
      }

      try {
        const normalizedArchive = validateAndNormalizePath(archivePath, server.uuid, userId);
        const normalizedTarget = validateAndNormalizePath(targetPath, server.uuid, userId);

        const result = await tunnelFileOp(server.nodeId, "decompress", server.uuid, normalizedArchive, {
          targetPath: normalizedTarget,
        });
        if (!result.success) {
          return reply.status(500).send({ error: result.error || "Failed to decompress archive" });
        }
        notifyFileChange(server.id, server.status, 'decompress', normalizedArchive);
        reply.send({ success: true });
      } catch (error: any) {
        if (error?.message?.includes("timed out") || error?.message?.includes("Too many pending") || error?.message?.includes("queue full")) {
          return replyTunnelError(reply, error);
        }
        if (error?.message?.includes("Path traversal") || error?.message?.includes("Invalid path")) {
          return reply.status(400).send({ error: error.message });
        }
        reply.status(500).send({ error: error?.message || "Failed to decompress archive" });
      }
    }
  );

  // List archive contents (without extracting)
  app.post(
    "/:serverId/files/archive-contents",
    {
      onRequest: [app.authenticate],
      config: { rateLimit: { max: fileRateLimitMax, timeWindow: fileRateLimitWindowMs } },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;
      const { archivePath } = request.body as { archivePath: string };

      if (!archivePath) {
        return reply.status(400).send({ error: "Missing archive path" });
      }

      const server = await requireFileAccess(serverId, userId, "file.read", reply);
      if (!server) {
        return;
      }

      if (!(await ensureNodeOnlineForFiles(server.nodeId, reply))) {
        return;
      }

      try {
        const normalizedArchive = validateAndNormalizePath(archivePath, server.uuid, userId);

        const result = await tunnelFileOp(server.nodeId, "archive-contents", server.uuid, normalizedArchive);
        if (!result.success) {
          const errMsg = result.error || "Failed to read archive contents";
          const status = errMsg.includes("not found") ? 404 : 500;
          return reply.status(status).send({ error: errMsg });
        }

        reply.send({ success: true, data: result.data });
      } catch (error: any) {
        captureSystemError({
          level: 'warn',
          component: 'ServerRoutes',
          message: `Failed to read archive contents: ${error?.message || String(error)}`,
          stack: error?.stack,
          metadata: { archivePath },
        }).catch(() => {});
        request.log.error({ err: error, archivePath }, "Failed to read archive contents");
        if (error?.message?.includes("timed out") || error?.message?.includes("Too many pending") || error?.message?.includes("queue full")) {
          return replyTunnelError(reply, error);
        }
        reply.status(500).send({ error: error?.message || "Failed to read archive contents" });
      }
    }
  );

  // Get server logs
  app.get(
    "/:serverId/logs",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;
      const { lines, stream } = request.query as { lines?: string; stream?: string };

      const server = await requireFileAccess(serverId, userId, "console.read", reply);
      if (!server) {
        return;
      }

      // Get logs from database (no agent/file-tunnel involved)
      const lineCount = lines ? parseInt(lines) : 100;
      const streamFilter = stream || undefined;

      const logs = await prisma.serverLog.findMany({
        where: {
          serverId,
          ...(streamFilter && { stream: streamFilter }),
        },
        orderBy: { timestamp: "desc" },
        take: lineCount,
      });

      // Reverse to get chronological order
      const reversedLogs = logs.reverse();

      reply.send({
        success: true,
        data: {
          logs: reversedLogs.map(log => ({
            stream: log.stream,
            data: log.data,
            timestamp: log.timestamp,
          })),
          count: reversedLogs.length,
          requestedLines: lineCount,
        },
      });
    }
  );

  // Write/update file content
  app.post(
    "/:serverId/files/write",
    {
      onRequest: [app.authenticate],
      config: { rateLimit: { max: fileRateLimitMax, timeWindow: fileRateLimitWindowMs } },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;
      const { path: filePath, content } = request.body as { path: string; content: string };

      if (!filePath || content === undefined) {
        return reply.status(400).send({ error: "Missing path or content" });
      }

      const server = await requireFileAccess(serverId, userId, "file.write", reply);
      if (!server) {
        return;
      }

      if (!(await ensureNodeOnlineForFiles(server.nodeId, reply))) {
        return;
      }

      let normalizedPath: string;
      try {
        normalizedPath = validateAndNormalizePath(filePath, server.uuid, userId);
      } catch (pathErr: any) {
        return reply.status(400).send({ error: pathErr?.message || "Invalid path" });
      }
      if (normalizedPath === "/") {
        return reply.status(400).send({ error: "Invalid path" });
      }

      try {
        const result = await tunnelFileOp(server.nodeId, "write", server.uuid, normalizedPath, {
          content,
        });
        if (!result.success) {
          return reply.status(400).send({ error: result.error || "Failed to write file" });
        }
        notifyFileChange(server.id, server.status, 'write', normalizedPath);
      } catch (error: any) {
        // Prefer shared tunnel mapping; keep route-specific fallback message.
        if (error?.message?.includes("timed out") || error?.message?.includes("Too many pending") || error?.message?.includes("queue full")) {
          return replyTunnelError(reply, error);
        }
        return reply.status(400).send({ error: error?.message || "Failed to write file" });
      }

      // Log action
      await createAuditLog(userId, {
        action: "file.write",
        resource: "server",
        resourceId: serverId,
        request,
        details: { path: normalizedPath },
      });

      reply.send({ success: true, message: "File saved" });
    }
  );

  // Update file permissions
  app.post(
    "/:serverId/files/permissions",
    {
      onRequest: [app.authenticate],
      config: { rateLimit: { max: fileRateLimitMax, timeWindow: fileRateLimitWindowMs } },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;
      const { path: requestedPath, mode } = request.body as { path: string; mode: string | number };

      if (!requestedPath || mode === undefined || mode === null) {
        return reply.status(400).send({ error: "Missing path or mode" });
      }

      const server = await requireFileAccess(serverId, userId, "file.write", reply);
      if (!server) {
        return;
      }

      if (!(await ensureNodeOnlineForFiles(server.nodeId, reply))) {
        return;
      }

      const normalizedPath = validateAndNormalizePath(requestedPath, server.uuid, userId);
      if (normalizedPath === "/") {
        return reply.status(400).send({ error: "Invalid path" });
      }

      let parsedMode: number;
      if (typeof mode === "number") {
        parsedMode = mode;
      } else {
        const trimmed = String(mode ?? "").trim();
        parsedMode = /^[0-7]{3,4}$/.test(trimmed) ? parseInt(trimmed, 8) : Number(trimmed);
      }

      if (!Number.isFinite(parsedMode) || parsedMode < 0 || parsedMode > 0o777) {
        return reply.status(400).send({ error: "Invalid mode" });
      }

      try {
        const result = await tunnelFileOp(server.nodeId, "permissions", server.uuid, normalizedPath, {
          mode: parsedMode,
        });
        if (!result.success) {
          return reply.status(400).send({ error: result.error || "Failed to update permissions" });
        }
        notifyFileChange(server.id, server.status, 'permissions', normalizedPath);
      } catch (error: any) {
        // Prefer shared tunnel mapping; keep route-specific fallback message.
        if (error?.message?.includes("timed out") || error?.message?.includes("Too many pending") || error?.message?.includes("queue full")) {
          return replyTunnelError(reply, error);
        }
        return reply.status(400).send({ error: error?.message || "Failed to update permissions" });
      }

      await createAuditLog(userId, {
        action: "file.chmod",
        resource: "server",
        resourceId: serverId,
        request,
        details: { path: normalizedPath, mode: parsedMode },
      });

      reply.send({ success: true, message: "Permissions updated" });
    }
  );

  // Delete file or directory
  app.delete(
    "/:serverId/files/delete",
    { onRequest: [app.authenticate], config: { rateLimit: { max: fileRateLimitMax, timeWindow: fileRateLimitWindowMs } } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;
      const { path: requestedPath } = request.query as { path: string };

      if (!requestedPath) {
        return reply.status(400).send({ error: "Missing path parameter" });
      }

      const server = await requireFileAccess(serverId, userId, "file.write", reply);
      if (!server) {
        return;
      }

      if (!(await ensureNodeOnlineForFiles(server.nodeId, reply))) {
        return;
      }

      const normalizedPath = validateAndNormalizePath(requestedPath, server.uuid, userId);
      if (normalizedPath === "/") {
        return reply.status(400).send({ error: "Invalid path" });
      }

      try {
        const result = await tunnelFileOp(server.nodeId, "delete", server.uuid, normalizedPath);
        if (!result.success) {
          return reply.status(400).send({ error: result.error || "Failed to delete selection" });
        }
        notifyFileChange(server.id, server.status, 'delete', normalizedPath);
      } catch (error: any) {
        // Prefer shared tunnel mapping; keep route-specific fallback message.
        if (error?.message?.includes("timed out") || error?.message?.includes("Too many pending") || error?.message?.includes("queue full")) {
          return replyTunnelError(reply, error);
        }
        return reply.status(400).send({ error: error?.message || "Failed to delete selection" });
      }

      // Log action
      await createAuditLog(userId, {
        action: "file.delete",
        resource: "server",
        resourceId: serverId,
        request,
        details: { path: normalizedPath },
      });

      reply.send({ success: true, message: "File deleted" });
    }
  );

  // Rename / move file or directory
  app.post(
    "/:serverId/files/rename",
    {
      onRequest: [app.authenticate],
      config: { rateLimit: { max: fileRateLimitMax, timeWindow: fileRateLimitWindowMs } },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;
      const { from: fromPath, to: toPath } = request.body as { from: string; to: string };

      if (!fromPath || !toPath) {
        return reply.status(400).send({ error: "Missing from or to path" });
      }

      const server = await requireFileAccess(serverId, userId, "file.write", reply);
      if (!server) {
        return;
      }

      if (!(await ensureNodeOnlineForFiles(server.nodeId, reply))) {
        return;
      }

      let normalizedFrom: string;
      let normalizedTo: string;
      try {
        normalizedFrom = validateAndNormalizePath(fromPath, server.uuid, userId);
        normalizedTo = validateAndNormalizePath(toPath, server.uuid, userId);
      } catch (pathErr: any) {
        return reply.status(400).send({ error: pathErr?.message || "Invalid path" });
      }
      if (normalizedFrom === "/" || normalizedTo === "/") {
        return reply.status(400).send({ error: "Invalid path" });
      }

      try {
        const result = await tunnelFileOp(server.nodeId, "rename", server.uuid, normalizedFrom, {
          to: normalizedTo,
        });
        if (!result.success) {
          return reply.status(400).send({ error: result.error || "Failed to rename" });
        }
        notifyFileChange(server.id, server.status, 'rename', undefined, normalizedFrom, normalizedTo);
      } catch (error: any) {
        // Prefer shared tunnel mapping; keep route-specific fallback message.
        if (error?.message?.includes("timed out") || error?.message?.includes("Too many pending") || error?.message?.includes("queue full")) {
          return replyTunnelError(reply, error);
        }
        return reply.status(400).send({ error: error?.message || "Failed to rename" });
      }

      await createAuditLog(userId, {
        action: "file.rename",
        resource: "server",
        resourceId: serverId,
        request,
        details: { from: normalizedFrom, to: normalizedTo },
      });

      reply.send({ success: true, message: "Renamed successfully" });
    }
  );

  // Delete server (must be stopped)
}
