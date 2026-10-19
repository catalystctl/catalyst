import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { randomUUID } from "crypto";
import { createWriteStream, promises as fsp } from "fs";
import { Transform } from "stream";
import { pipeline } from "stream/promises";
import path from "path";
import { createAuditLog } from "../../middleware/audit.js";
import { apiError } from "../../lib/http-error";
import { ErrorCodes } from "../../shared-types";
import { validateAndNormalizePath } from "../../lib/path-validation";
import { detectArchiveContainer, ModpackArchiveError } from "../../lib/modpack-archive.js";
import { ModpackInstaller, type ModpackInstallProgress, type TunnelOp } from "../../services/modpack-installer.js";
import { getSecuritySettings, maxUploadBytesFromMb } from "../../services/mailer";
import {
  ensureModManagerEnabled,
  ensureServerAccess,
  modManagerDefaultTargets,
  sanitizeFilename,
} from "./_helpers.js";

/**
 * Modpack installs are long-running: a 200-mod pack is 200 sequential agent
 * downloads, which outlives any single HTTP request. The POST starts a job and
 * returns 202; the client polls the job endpoint.
 *
 * The job registry is process-local by design — a restart loses the handle but
 * never corrupts a server (the installer is idempotent and the staging archive
 * is cleaned up on the next install).
 */
type ModpackJobStatus = "queued" | "running" | "completed" | "failed";

interface ModpackJob {
  id: string;
  serverId: string;
  userId: string;
  filename: string;
  status: ModpackJobStatus;
  progress?: ModpackInstallProgress;
  result?: Record<string, unknown>;
  error?: string;
  code?: string;
  createdAt: number;
  updatedAt: number;
}

const JOB_TTL_MS = 60 * 60 * 1000;
const jobs = new Map<string, ModpackJob>();

function sweepJobs(now = Date.now()) {
  for (const [id, job] of jobs) {
    if (now - job.updatedAt > JOB_TTL_MS) jobs.delete(id);
  }
}

function jobView(job: ModpackJob) {
  return {
    id: job.id,
    status: job.status,
    progress: job.progress ?? null,
    result: job.result ?? null,
    error: job.error ?? null,
    code: job.code ?? null,
    filename: job.filename,
  };
}

/** Sniff the archive magic so a renamed pack still uses the right extractor. */
async function readMagic(filePath: string): Promise<Buffer | undefined> {
  try {
    const handle = await fsp.open(filePath, "r");
    try {
      const buffer = Buffer.alloc(512);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      return bytesRead > 0 ? buffer.subarray(0, bytesRead) : undefined;
    } finally {
      await handle.close();
    }
  } catch {
    return undefined;
  }
}

export async function serverModpackRoutes(app: FastifyInstance) {
  const fileTunnel = (app as any).fileTunnel as import("../../services/file-tunnel").FileTunnelService;

  const tunnelFor = (nodeId: string, serverUuid: string): TunnelOp => async (
    operation,
    filePath,
    data,
  ) => {
    const result = await fileTunnel.queueRequest(nodeId, operation, serverUuid, filePath, data);
    return {
      success: result.success,
      // `download` streams the file body rather than a JSON payload.
      data: operation === "download" ? result.body : result.data,
      error: result.error,
    };
  };

  /**
   * Deliver the archive to the node, then install.
   *
   * Staging happens *inside* the job, not before the response: downloading a
   * multi-hundred-MB pack synchronously made the POST exceed the client's
   * request timeout and surface as a spurious failure.
   */
  const startJob = async (args: {
    jobId: string;
    nodeId: string;
    serverUuid: string;
    archivePath: string;
    targetPath: string;
    filename: string;
    magic?: Buffer;
    serverId: string;
    userId: string;
    /** Local temp file holding an upload, moved to the node by the job. */
    stagedFile?: { filePath: string; size: number };
    /** Remote URL to fetch on the node. */
    sourceUrl?: string;
  }) => {
    const job = jobs.get(args.jobId);
    if (!job) return;

    job.status = "running";
    job.updatedAt = Date.now();

    try {
      if (args.stagedFile) {
        const uploadResult = await fileTunnel.queueRequest(
          args.nodeId,
          "upload",
          args.serverUuid,
          args.archivePath,
          { filename: args.filename },
          undefined,
          { stagedFile: args.stagedFile },
        );
        if (!uploadResult.success) {
          throw new ModpackArchiveError(
            uploadResult.error || "Failed to upload the archive to the node",
            "empty-pack",
          );
        }
      } else if (args.sourceUrl) {
        const downloadResult = await fileTunnel.queueRequest(
          args.nodeId,
          "install-url",
          args.serverUuid,
          args.archivePath,
          { url: args.sourceUrl },
        );
        if (!downloadResult.success) {
          throw new ModpackArchiveError(
            downloadResult.error || "Failed to download the modpack",
            "empty-pack",
          );
        }
      }
    } catch (error: any) {
      job.status = "failed";
      job.error = error?.message || "Failed to stage the modpack archive";
      job.code = ErrorCodes.MODPACK_INSTALL_FAILED;
      job.updatedAt = Date.now();
      if (args.stagedFile) await fsp.unlink(args.stagedFile.filePath).catch(() => {});
      await fileTunnel
        .queueRequest(args.nodeId, "delete", args.serverUuid, path.posix.dirname(args.archivePath))
        .catch(() => {});
      return;
    }

    const installer = new ModpackInstaller({
      tunnel: tunnelFor(args.nodeId, args.serverUuid),
      archivePath: args.archivePath,
      targetPath: args.targetPath,
      filename: args.filename,
      magic: args.magic,
      onProgress: (progress) => {
        job.progress = progress;
        job.updatedAt = Date.now();
      },
    });

    try {
      const result = await installer.install();
      job.status = "completed";
      job.result = result as unknown as Record<string, unknown>;
      job.updatedAt = Date.now();

      await createAuditLog(args.userId, {
        action: "mod_manager.modpack_install",
        resource: "server",
        resourceId: args.serverId,
        request: undefined,
        details: {
          filename: args.filename,
          format: result.format,
          path: args.targetPath,
          installedFiles: result.installedFiles.length,
          installedOverrides: result.installedOverrides,
          skipped: result.skipped.length,
          warnings: result.warnings.length,
        },
      }).catch(() => {});

      const gateway = (app as any).wsGateway;
      const payload = {
        serverId: args.serverId,
        filename: args.filename,
        format: result.format,
        timestamp: Date.now(),
      };
      gateway?.pushToAdminSubscribers?.("modpack_install_complete", payload);
      gateway?.pushToGlobalSubscribers?.("modpack_install_complete", payload);
    } catch (error: any) {
      job.status = "failed";
      job.error =
        error instanceof ModpackArchiveError ? error.message : error?.message || "Modpack install failed";
      job.code =
        error instanceof ModpackArchiveError
          ? error.reason === "unsupported-format"
            ? ErrorCodes.MODPACK_FORMAT_UNSUPPORTED
            : ErrorCodes.MODPACK_INSTALL_FAILED
          : ErrorCodes.MODPACK_INSTALL_FAILED;
      job.updatedAt = Date.now();
    } finally {
      // The staging archive and the local temp upload are only needed while
      // installing.
      const stagingDir = path.posix.dirname(args.archivePath);
      await fileTunnel
        .queueRequest(args.nodeId, "delete", args.serverUuid, stagingDir)
        .catch(() => {});
      if (args.stagedFile) await fsp.unlink(args.stagedFile.filePath).catch(() => {});
    }
  };

  /** Shared preflight: access, mod manager, modpacks target, destination path. */
  const preflight = async (
    request: FastifyRequest,
    reply: FastifyReply,
    rawTargetPath: unknown,
  ): Promise<
    | {
        server: any;
        targetPath: string;
        userId: string;
      }
    | null
  > => {
    const { serverId } = request.params as { serverId: string };
    const userId = request.user.userId;

    const server = await ensureServerAccess(serverId, userId, "mods.manage", reply, request.user);
    if (!server) return null;

    const modManager = ensureModManagerEnabled(server, reply);
    if (!modManager) return null;

    const enabledTargets = modManager.targets?.length
      ? modManager.targets
      : modManagerDefaultTargets;
    if (!enabledTargets.includes("modpacks")) {
      apiError(
        reply,
        400,
        ErrorCodes.MOD_TARGET_NOT_ENABLED,
        "The modpacks target is not enabled for this template",
      );
      return null;
    }

    let targetPath = "/";
    if (typeof rawTargetPath === "string" && rawTargetPath.trim().length > 0) {
      try {
        targetPath = validateAndNormalizePath(rawTargetPath, server.uuid, userId);
      } catch (error: any) {
        apiError(reply, 400, ErrorCodes.VALIDATION_ERROR, error?.message || "Invalid path");
        return null;
      }
    }

    return { server, targetPath, userId };
  };

  app.post(
    "/:serverId/modpack-manager/install",
    {
      schema: {
        summary: "Install a modpack archive",
        description:
          "Install a .zip, .mrpack/.mr, .tar, .tar.gz or .tar.xz modpack from an uploaded file or a URL. Returns a job to poll.",
        tags: ["Mod Plugins"],
        params: { type: "object", required: ["serverId"], properties: { serverId: { type: "string" } } },
        response: { 202: { type: "object", additionalProperties: true } },
      },
      onRequest: [app.authenticate],
      config: { requiredPermission: "mods.manage" },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const isMultipart = typeof (request as any).isMultipart === "function" && (request as any).isMultipart();

      let rawTargetPath: unknown;
      let filename: string | undefined;
      let stagedPath: string | undefined;
      let magic: Buffer | undefined;

      if (isMultipart) {
        const upload = await (request as any).file();
        if (!upload) {
          return apiError(reply, 400, ErrorCodes.VALIDATION_ERROR, "Missing modpack upload");
        }
        const fields = (upload.fields ?? {}) as Record<string, any>;
        rawTargetPath = fields.path?.value;
        filename = sanitizeFilename(path.posix.basename(upload.filename || "modpack.zip"));

        const pre = await preflight(request, reply, rawTargetPath);
        if (!pre) {
          // Drain the upload so the socket is not left mid-stream.
          upload.file.resume();
          return;
        }

        let maxBytes = 0;
        let maxUploadMb: number | undefined;
        try {
          const settings = await getSecuritySettings();
          maxUploadMb = settings.fileTunnelMaxUploadMb;
          maxBytes = maxUploadBytesFromMb(settings.fileTunnelMaxUploadMb);
        } catch {
          maxBytes = 0;
        }

        stagedPath = fileTunnel.createStagingPath();
        let size = 0;
        try {
          await pipeline(
            upload.file,
            new Transform({
              transform(chunk, _enc, cb) {
                size += chunk.length;
                if (maxBytes > 0 && size > maxBytes) {
                  cb(new Error("MODPACK_TOO_LARGE"));
                  return;
                }
                cb(null, chunk);
              },
            }),
            createWriteStream(stagedPath),
          );
        } catch (stageError: any) {
          await fsp.unlink(stagedPath).catch(() => {});
          if (stageError?.message === "MODPACK_TOO_LARGE") {
            return apiError(reply, 413, ErrorCodes.FILE_TOO_LARGE, "Modpack archive exceeds the upload limit", {
              params: maxUploadMb === undefined ? undefined : { maxMb: maxUploadMb },
            });
          }
          return apiError(reply, 400, ErrorCodes.VALIDATION_ERROR, "Failed to read the uploaded archive");
        }

        magic = await readMagic(stagedPath);
        await runInstall(pre, { stagedPath, size, filename, magic });
        return;
      }

      const body = (request.body ?? {}) as { url?: unknown; filename?: unknown; path?: unknown };
      const url = typeof body.url === "string" ? body.url.trim() : undefined;
      rawTargetPath = body.path;
      filename =
        typeof body.filename === "string" && body.filename.trim().length > 0
          ? sanitizeFilename(path.posix.basename(body.filename.trim()))
          : undefined;

      const pre = await preflight(request, reply, rawTargetPath);
      if (!pre) return;

      if (!url) {
        return apiError(reply, 400, ErrorCodes.VALIDATION_ERROR, "A modpack URL or file upload is required");
      }
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return apiError(reply, 400, ErrorCodes.VALIDATION_ERROR, "Invalid modpack URL");
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return apiError(reply, 400, ErrorCodes.VALIDATION_ERROR, "Modpack URL must be http or https");
      }
      if (!filename) {
        filename = sanitizeFilename(path.posix.basename(decodeURIComponent(parsed.pathname)) || "modpack.zip");
      }
      if (detectArchiveContainer(filename) === "unknown") {
        return apiError(
          reply,
          400,
          ErrorCodes.MODPACK_FORMAT_UNSUPPORTED,
          "Unsupported modpack archive type",
        );
      }

      return runInstall(pre, { url, filename, magic: undefined });

      function runInstall(
        pre: { server: any; targetPath: string; userId: string },
        source: { url?: string; stagedPath?: string; size?: number; filename: string; magic?: Buffer },
      ) {
        const jobId = randomUUID();
        const job: ModpackJob = {
          id: jobId,
          serverId,
          userId: pre.userId,
          filename: source.filename,
          status: "queued",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        jobs.set(jobId, job);
        sweepJobs();

        const archivePath = `/.catalyst-modpacks/${jobId}/${source.filename}`;

        // Fire and forget. Staging (upload to the node or the remote download)
        // runs inside the job so this response never waits on the network.
        void startJob({
          jobId,
          nodeId: pre.server.nodeId,
          serverUuid: pre.server.uuid,
          archivePath,
          targetPath: pre.targetPath,
          filename: source.filename,
          magic: source.magic,
          serverId,
          userId: pre.userId,
          stagedFile: source.stagedPath
            ? { filePath: source.stagedPath, size: source.size ?? 0 }
            : undefined,
          sourceUrl: source.url,
        }).catch(() => {});

        return reply.status(202).send({ success: true, data: jobView(job) });
      }
    },
  );

  app.get(
    "/:serverId/modpack-manager/jobs/:jobId",
    {
      schema: {
        summary: "Get a modpack install job",
        description: "Poll the status of a modpack install started by POST /modpack-manager/install.",
        tags: ["Mod Plugins"],
        params: {
          type: "object",
          required: ["serverId", "jobId"],
          properties: { serverId: { type: "string" }, jobId: { type: "string" } },
        },
        response: { 200: { type: "object", additionalProperties: true } },
      },
      onRequest: [app.authenticate],
      config: { requiredPermission: "server.read" },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId, jobId } = request.params as { serverId: string; jobId: string };
      const userId = request.user.userId;

      // Read-class: polling progress must not require a write grant.
      const server = await ensureServerAccess(serverId, userId, "server.read", reply, request.user);
      if (!server) return;

      const job = jobs.get(jobId);
      if (!job || job.serverId !== serverId) {
        return apiError(reply, 404, ErrorCodes.NOT_FOUND, "Modpack install job not found");
      }
      return reply.send({ success: true, data: jobView(job) });
    },
  );
}
