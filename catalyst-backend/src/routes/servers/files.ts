import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../../db.js";
import { captureSystemError, ensureNotSuspended, fileRateLimitMax, fileRateLimitWindowMs, hasNodeAccess, isArchiveName, normalizeRequestPath, path, validateAndNormalizePath } from './_helpers.js';
import { ChunkedUploadError } from "../../services/chunked-upload";
import type { ChunkedUploadService } from "../../services/chunked-upload";

export async function serverFilesRoutes(app: FastifyInstance) {
  const fileTunnel = (app as any).fileTunnel as import("../../services/file-tunnel").FileTunnelService;
  const chunkedUpload = (app as any).chunkedUpload as ChunkedUploadService;
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

      const server = await prisma.server.findUnique({
        where: { id: serverId },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      if (!ensureNotSuspended(server, reply)) {
        return;
      }

      // Check permissions
      const access = await prisma.serverAccess.findFirst({
        where: {
          serverId,
          userId,
          permissions: { has: "file.read" },
        },
      });

      const hasNodeAccessToServer = await hasNodeAccess(prisma, userId, server.nodeId);

      if (!access && server.ownerId !== userId && !hasNodeAccessToServer) {
        return reply.status(403).send({ error: "Forbidden" });
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
        if (error?.message?.includes("timed out")) {
          return reply.status(504).send({ error: "Agent file operation timed out" });
        }
        reply.status(400).send({ error: "Invalid path" });
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

      const server = await prisma.server.findUnique({
        where: { id: serverId },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      if (!ensureNotSuspended(server, reply)) {
        return;
      }

      const access = await prisma.serverAccess.findFirst({
        where: {
          serverId,
          userId,
          permissions: { has: "file.read" },
        },
      });

      const hasNodeAccessToServer = await hasNodeAccess(prisma, userId, server.nodeId);

      if (!access && server.ownerId !== userId && !hasNodeAccessToServer) {
        return reply.status(403).send({ error: "Forbidden" });
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
        if (error?.message?.includes("timed out")) {
          return reply.status(504).send({ error: "Agent file operation timed out" });
        }
        reply.status(400).send({ error: "Invalid path" });
      }
    }
  );

  // Upload server file
  app.post(
    "/:serverId/files/upload",
    {
      onRequest: [app.authenticate],
      config: { rateLimit: { max: fileRateLimitMax, timeWindow: fileRateLimitWindowMs } },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;

      const server = await prisma.server.findUnique({
        where: { id: serverId },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      if (!ensureNotSuspended(server, reply)) {
        return;
      }

      const access = await prisma.serverAccess.findFirst({
        where: {
          serverId,
          userId,
          permissions: { has: "file.write" },
        },
      });

      const hasNodeAccessToServer = await hasNodeAccess(prisma, userId, server.nodeId);

      if (!access && server.ownerId !== userId && !hasNodeAccessToServer) {
        return reply.status(403).send({ error: "Forbidden" });
      }

      const upload = await request.file();
      if (!upload) {
        return reply.status(400).send({ error: "Missing file upload" });
      }

      const rawPath = (upload.fields as any)?.path?.value;
      const basePath =
        typeof rawPath === "string" ? rawPath : rawPath ? String(rawPath) : "/";
      const normalizedPath = normalizeRequestPath(basePath);
      const safeFilename = path.posix.basename(upload.filename || "upload");
      const filePath = path.posix.join(normalizedPath, safeFilename);

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
        if (error?.message?.includes("timed out")) {
          return reply.status(504).send({ error: "Agent file operation timed out" });
        }
        reply.status(400).send({ error: "Failed to upload file" });
      }
    }
  );

  // ── Resumable / chunked upload protocol (issue #135) ──────────────────────
  //
  //  POST   /:serverId/files/upload/init             — create session, get uploadId
  //  POST   /:serverId/files/upload/:uploadId/chunk  — upload one chunk
  //  GET    /:serverId/files/upload/:uploadId/status — resume info (received chunks)
  //  POST   /:serverId/files/upload/:uploadId/complete — assemble + deliver to agent
  //  DELETE /:serverId/files/upload/:uploadId        — cancel session

  // Helper: validate access for chunked upload routes (same as single-shot upload)
  const validateChunkedServerAccess = async (
    serverId: string,
    userId: string,
    reply: FastifyReply
  ): Promise<{ server: any; normalizedDir: string } | null> => {
    const server = await prisma.server.findUnique({ where: { id: serverId } });
    if (!server) {
      reply.status(404).send({ error: "Server not found" });
      return null;
    }
    if (!ensureNotSuspended(server, reply)) {
      return null;
    }
    const access = await prisma.serverAccess.findFirst({
      where: { serverId, userId, permissions: { has: "file.write" } },
    });
    const hasNodeAccessToServer = await hasNodeAccess(prisma, userId, server.nodeId);
    if (!access && server.ownerId !== userId && !hasNodeAccessToServer) {
      reply.status(403).send({ error: "Forbidden" });
      return null;
    }
    return { server, normalizedDir: "/" };
  };

  // POST /:serverId/files/upload/init
  app.post(
    "/:serverId/files/upload/init",
    {
      onRequest: [app.authenticate],
      config: { rateLimit: { max: fileRateLimitMax, timeWindow: fileRateLimitWindowMs } },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;
      const body = request.body as {
        path?: string;
        filename?: string;
        totalSize?: number;
        chunkSize?: number;
        totalChunks?: number;
        expectedSha256?: string;
      };
      if (!body?.filename || typeof body.totalSize !== "number") {
        return reply.status(400).send({ error: "Missing filename or totalSize" });
      }
      const ctx = await validateChunkedServerAccess(serverId, userId, reply);
      if (!ctx) return;
      const basePath = normalizeRequestPath(body.path ?? "/");
      const safeFilename = path.posix.basename(body.filename);
      try {
        const result = await chunkedUpload.init({
          userId,
          serverId: ctx.server.id,
          serverUuid: ctx.server.uuid,
          nodeId: ctx.server.nodeId,
          targetDir: basePath,
          filename: safeFilename,
          totalSize: Math.floor(body.totalSize),
          chunkSize: body.chunkSize ? Math.floor(body.chunkSize) : undefined,
          totalChunks: body.totalChunks ? Math.floor(body.totalChunks) : undefined,
          expectedSha256: body.expectedSha256,
        });
        reply.send({ success: true, data: result });
      } catch (err: any) {
        const status = err instanceof ChunkedUploadError ? err.statusCode : 400;
        reply.status(status).send({ error: err?.message || "Failed to init upload" });
      }
    }
  );

  // POST /:serverId/files/upload/:uploadId/chunk
  // Body is application/octet-stream raw chunk bytes. The chunk index is in
  // the X-Chunk-Index header (zero-based).
  app.post(
    "/:serverId/files/upload/:uploadId/chunk",
    {
      onRequest: [app.authenticate],
      // Large body limit for max chunk (128 MB) — actual chunks are smaller
      // in practice and validated by the service.
      config: {
        rateLimit: { max: fileRateLimitMax, timeWindow: fileRateLimitWindowMs },
      },
      // Override the application/octet-stream content type parser for this
      // route to stream the chunk body straight to disk (avoids loading the
      // chunk into a Buffer in process memory).
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId, uploadId } = request.params as { serverId: string; uploadId: string };
      const userId = request.user.userId;
      const indexRaw = request.headers["x-chunk-index"];
      const index = Number.parseInt(String(indexRaw ?? ""), 10);
      if (!Number.isInteger(index) || index < 0) {
        return reply.status(400).send({ error: "Missing or invalid X-Chunk-Index header" });
      }
      const ctx = await validateChunkedServerAccess(serverId, userId, reply);
      if (!ctx) return;
      try {
        // request.body is a Buffer because of the global application/octet-stream
        // parser. For very large chunks the Fastify body limit is enforced at
        // the route level (configured below in the parent plugin).
        const body = request.body as Buffer;
        const result = await chunkedUpload.writeChunk(
          uploadId,
          userId,
          ctx.server.id,
          index,
          Buffer.isBuffer(body) ? body : Buffer.from(body ?? []),
        );
        reply.send({ success: true, data: result });
      } catch (err: any) {
        if (err instanceof ChunkedUploadError) {
          return reply.status(err.statusCode).send({ error: err.message });
        }
        request.log.error({ err, uploadId, index }, "Chunked upload chunk failed");
        reply.status(500).send({ error: "Failed to write chunk" });
      }
    }
  );

  // GET /:serverId/files/upload/:uploadId/status
  app.get(
    "/:serverId/files/upload/:uploadId/status",
    {
      onRequest: [app.authenticate],
      config: { rateLimit: { max: fileRateLimitMax, timeWindow: fileRateLimitWindowMs } },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId, uploadId } = request.params as { serverId: string; uploadId: string };
      const userId = request.user.userId;
      const ctx = await validateChunkedServerAccess(serverId, userId, reply);
      if (!ctx) return;
      const status = chunkedUpload.getStatus(uploadId, userId, ctx.server.id);
      if (!status) {
        return reply.status(404).send({ error: "Upload session not found" });
      }
      reply.send({ success: true, data: status });
    }
  );

  // POST /:serverId/files/upload/:uploadId/complete
  app.post(
    "/:serverId/files/upload/:uploadId/complete",
    {
      onRequest: [app.authenticate],
      config: { rateLimit: { max: fileRateLimitMax, timeWindow: fileRateLimitWindowMs } },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId, uploadId } = request.params as { serverId: string; uploadId: string };
      const userId = request.user.userId;
      const ctx = await validateChunkedServerAccess(serverId, userId, reply);
      if (!ctx) return;
      try {
        const result = await chunkedUpload.complete(uploadId, userId, ctx.server.id);
        notifyFileChange(ctx.server.id, ctx.server.status, "upload", result.path);
        reply.send({ success: true, data: result });
      } catch (err: any) {
        if (err instanceof ChunkedUploadError) {
          return reply.status(err.statusCode).send({ error: err.message });
        }
        request.log.error({ err, uploadId }, "Chunked upload complete failed");
        if (err?.message?.includes("timed out")) {
          return reply.status(504).send({ error: "Agent file operation timed out" });
        }
        reply.status(500).send({ error: "Failed to complete upload" });
      }
    }
  );

  // DELETE /:serverId/files/upload/:uploadId
  app.delete(
    "/:serverId/files/upload/:uploadId",
    {
      onRequest: [app.authenticate],
      config: { rateLimit: { max: fileRateLimitMax, timeWindow: fileRateLimitWindowMs } },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId, uploadId } = request.params as { serverId: string; uploadId: string };
      const userId = request.user.userId;
      const ctx = await validateChunkedServerAccess(serverId, userId, reply);
      if (!ctx) return;
      const cancelled = await chunkedUpload.cancel(uploadId, userId, ctx.server.id);
      if (!cancelled) {
        return reply.status(404).send({ error: "Upload session not found" });
      }
      reply.send({ success: true });
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

      const server = await prisma.server.findUnique({
        where: { id: serverId },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      if (!ensureNotSuspended(server, reply)) {
        return;
      }

      const access = await prisma.serverAccess.findFirst({
        where: {
          serverId,
          userId,
          permissions: { has: "file.write" },
        },
      });

      const hasNodeAccessToServer = await hasNodeAccess(prisma, userId, server.nodeId);

      if (!access && server.ownerId !== userId && !hasNodeAccessToServer) {
        return reply.status(403).send({ error: "Forbidden" });
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
        if (error?.message?.includes("timed out")) {
          return reply.status(504).send({ error: "Agent file operation timed out" });
        }
        reply.status(400).send({ error: "Failed to create item" });
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

      const server = await prisma.server.findUnique({
        where: { id: serverId },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      if (!ensureNotSuspended(server, reply)) {
        return;
      }

      const access = await prisma.serverAccess.findFirst({
        where: {
          serverId,
          userId,
          permissions: { has: "file.write" },
        },
      });

      const hasNodeAccessToServer = await hasNodeAccess(prisma, userId, server.nodeId);

      if (!access && server.ownerId !== userId && !hasNodeAccessToServer) {
        return reply.status(403).send({ error: "Forbidden" });
      }

      try {
        const normalizedArchive = normalizeRequestPath(archiveName);
        const normalizedPaths = paths.map((p) => normalizeRequestPath(p));

        const result = await tunnelFileOp(server.nodeId, "compress", server.uuid, normalizedArchive, {
          paths: normalizedPaths,
        });
        if (!result.success) {
          return reply.status(500).send({ error: result.error || "Failed to compress files" });
        }
        notifyFileChange(server.id, server.status, 'compress', normalizedArchive);
        reply.send({ success: true, data: { archivePath: normalizedArchive } });
      } catch (error: any) {
        if (error?.message?.includes("timed out")) {
          return reply.status(504).send({ error: "Agent file operation timed out" });
        }
        reply.status(500).send({ error: "Failed to compress files" });
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

      const server = await prisma.server.findUnique({
        where: { id: serverId },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      if (!ensureNotSuspended(server, reply)) {
        return;
      }

      const access = await prisma.serverAccess.findFirst({
        where: {
          serverId,
          userId,
          permissions: { has: "file.write" },
        },
      });

      const hasNodeAccessToServer = await hasNodeAccess(prisma, userId, server.nodeId);

      if (!access && server.ownerId !== userId && !hasNodeAccessToServer) {
        return reply.status(403).send({ error: "Forbidden" });
      }

      try {
        const normalizedArchive = normalizeRequestPath(archivePath);
        const normalizedTarget = normalizeRequestPath(targetPath);

        const result = await tunnelFileOp(server.nodeId, "decompress", server.uuid, normalizedArchive, {
          targetPath: normalizedTarget,
        });
        if (!result.success) {
          return reply.status(500).send({ error: result.error || "Failed to decompress archive" });
        }
        notifyFileChange(server.id, server.status, 'decompress', normalizedArchive);
        reply.send({ success: true });
      } catch (error: any) {
        if (error?.message?.includes("timed out")) {
          return reply.status(504).send({ error: "Agent file operation timed out" });
        }
        reply.status(500).send({ error: "Failed to decompress archive" });
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

      const server = await prisma.server.findUnique({
        where: { id: serverId },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      if (!ensureNotSuspended(server, reply)) {
        return;
      }

      const access = await prisma.serverAccess.findFirst({
        where: {
          serverId,
          userId,
          permissions: { has: "file.read" },
        },
      });

      const hasNodeAccessToServer = await hasNodeAccess(prisma, userId, server.nodeId);

      if (!access && server.ownerId !== userId && !hasNodeAccessToServer) {
        return reply.status(403).send({ error: "Forbidden" });
      }

      try {
        const normalizedArchive = normalizeRequestPath(archivePath);

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
        if (error?.message?.includes("timed out")) {
          return reply.status(504).send({ error: "Agent file operation timed out" });
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

      const server = await prisma.server.findUnique({
        where: { id: serverId },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      if (!ensureNotSuspended(server, reply)) {
        return;
      }

      // Check permissions - owner, explicit access, or node assignment
      const hasExplicitAccess = await prisma.serverAccess.findFirst({
        where: {
          serverId,
          userId,
          permissions: { has: "console.read" },
        },
      });

      const hasNodeAccessToServer = await hasNodeAccess(prisma, userId, server.nodeId);

      if (!hasExplicitAccess && server.ownerId !== userId && !hasNodeAccessToServer) {
        return reply.status(403).send({ error: "Forbidden" });
      }

      // Get logs from database
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

      const server = await prisma.server.findUnique({
        where: { id: serverId },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      if (!ensureNotSuspended(server, reply)) {
        return;
      }

      // Check permissions
      const access = await prisma.serverAccess.findFirst({
        where: {
          serverId,
          userId,
          permissions: { has: "file.write" },
        },
      });

      const hasNodeAccessToServer = await hasNodeAccess(prisma, userId, server.nodeId);

      if (!access && server.ownerId !== userId && !hasNodeAccessToServer) {
        return reply.status(403).send({ error: "Forbidden" });
      }

      const normalizedPath = normalizeRequestPath(filePath);
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
        if (error?.message?.includes("timed out")) {
          return reply.status(504).send({ error: "Agent file operation timed out" });
        }
        return reply.status(400).send({ error: "Failed to write file" });
      }

      // Log action
      await prisma.auditLog.create({
        data: {
          userId,
          action: "file.write",
          resource: "server",
          resourceId: serverId,
          details: { path: normalizedPath },
        },
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

      const server = await prisma.server.findUnique({
        where: { id: serverId },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      if (!ensureNotSuspended(server, reply)) {
        return;
      }

      const access = await prisma.serverAccess.findFirst({
        where: {
          serverId,
          userId,
          permissions: { has: "file.write" },
        },
      });

      const hasNodeAccessToServer = await hasNodeAccess(prisma, userId, server.nodeId);

      if (!access && server.ownerId !== userId && !hasNodeAccessToServer) {
        return reply.status(403).send({ error: "Forbidden" });
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
        if (error?.message?.includes("timed out")) {
          return reply.status(504).send({ error: "Agent file operation timed out" });
        }
        return reply.status(400).send({ error: "Failed to update permissions" });
      }

      await prisma.auditLog.create({
        data: {
          userId,
          action: "file.chmod",
          resource: "server",
          resourceId: serverId,
          details: { path: normalizedPath, mode: parsedMode },
        },
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

      const server = await prisma.server.findUnique({
        where: { id: serverId },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      if (!ensureNotSuspended(server, reply)) {
        return;
      }

      // Check permissions
      const access = await prisma.serverAccess.findFirst({
        where: {
          serverId,
          userId,
          permissions: { has: "file.write" },
        },
      });

      const hasNodeAccessToServer = await hasNodeAccess(prisma, userId, server.nodeId);

      if (!access && server.ownerId !== userId && !hasNodeAccessToServer) {
        return reply.status(403).send({ error: "Forbidden" });
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
        if (error?.message?.includes("timed out")) {
          return reply.status(504).send({ error: "Agent file operation timed out" });
        }
        return reply.status(400).send({ error: "Failed to delete selection" });
      }

      // Log action
      await prisma.auditLog.create({
        data: {
          userId,
          action: "file.delete",
          resource: "server",
          resourceId: serverId,
          details: { path: normalizedPath },
        },
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

      const server = await prisma.server.findUnique({
        where: { id: serverId },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      if (!ensureNotSuspended(server, reply)) {
        return;
      }

      const access = await prisma.serverAccess.findFirst({
        where: {
          serverId,
          userId,
          permissions: { has: "file.write" },
        },
      });

      const hasNodeAccessToServer = await hasNodeAccess(prisma, userId, server.nodeId);

      if (!access && server.ownerId !== userId && !hasNodeAccessToServer) {
        return reply.status(403).send({ error: "Forbidden" });
      }

      const normalizedFrom = normalizeRequestPath(fromPath);
      const normalizedTo = normalizeRequestPath(toPath);
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
        if (error?.message?.includes("timed out")) {
          return reply.status(504).send({ error: "Agent file operation timed out" });
        }
        return reply.status(400).send({ error: "Failed to rename" });
      }

      await prisma.auditLog.create({
        data: {
          userId,
          action: "file.rename",
          resource: "server",
          resourceId: serverId,
          details: { from: normalizedFrom, to: normalizedTo },
        },
      });

      reply.send({ success: true, message: "Renamed successfully" });
    }
  );

  // Delete server (must be stopped)
}
