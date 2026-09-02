import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../../db.js";
import { createAuditLog } from "../../middleware/audit.js";
import {
  buildProviderHeaders,
  ensureCs2FrameworkEnabled,
  fetchGitHubReleases,
  fileRateLimitMax,
  fileRateLimitWindowMs,
  validateAndNormalizePath,
  resolveGitHubAsset,
} from "./_helpers.js";
import path from "path";
import { describeError } from "../../utils/describe-error.js";
import { promises as fs } from "fs";
import { fileURLToPath } from "url";

const __filenameCs2 = fileURLToPath(import.meta.url);
const __dirnameCs2 = path.dirname(path.dirname(__filenameCs2));

type Cs2FrameworkId = "metamod" | "counterstrikesharp" | "sourcemod";

const CS2_FRAMEWORKS: Record<
  Cs2FrameworkId,
  {
    id: Cs2FrameworkId;
    name: string;
    description: string;
    repo: string;
    assetPattern: string;
    assetExclude?: string;
    docsUrl: string;
    dependencies: Cs2FrameworkId[];
  }
> = {
  metamod: {
    id: "metamod",
    name: "Metamod:Source",
    description: "Core plugin layer for Source2. Required by CounterStrikeSharp and SourceMod.",
    repo: "alliedmodders/metamod-source",
    assetPattern: "linux\\.tar\\.gz$",
    assetExclude: "windows",
    docsUrl: "https://wiki.alliedmods.net/Category:Metamod:Source_Documentation",
    dependencies: [],
  },
  counterstrikesharp: {
    id: "counterstrikesharp",
    name: "CounterStrikeSharp",
    description: "Modern .NET framework for CS2 plugins. Requires Metamod:Source.",
    repo: "roflmuffin/CounterStrikeSharp",
    assetPattern: "with-runtime-linux.*\\.zip$",
    assetExclude: "windows",
    docsUrl: "https://docs.cssharp.dev",
    dependencies: ["metamod"],
  },
  sourcemod: {
    id: "sourcemod",
    name: "SourceMod",
    description: "SourceMod for CS2 (experimental, extends Metamod:Source).",
    repo: "alliedmodders/sourcemod",
    assetPattern: "linux\\.tar\\.gz$",
    assetExclude: "windows",
    docsUrl: "https://wiki.alliedmods.net/SourceMod_Installation",
    dependencies: ["metamod"],
  },
};

function isCs2Template(template: unknown): boolean {
  const name = String((template as Record<string, unknown> | null)?.name || "").toLowerCase();
  return (
    name.includes("counter-strike 2") ||
    name.includes("counter strike 2") ||
    name.includes("counter--strike2") ||
    name === "cs2" ||
    name.includes(" cs2")
  );
}

async function getInstalledFrameworks(
  serverUuid: string,
  nodeId: string,
  fileTunnel: { queueRequest: (nodeId: string, op: string, uuid: string, p: string, data?: Record<string, unknown>) => Promise<{ success: boolean; data?: unknown; error?: string }> }
): Promise<Set<Cs2FrameworkId>> {
  const installed = new Set<Cs2FrameworkId>();
  const checks: Array<[Cs2FrameworkId, string]> = [
    ["metamod", "game/csgo/addons/metamod/bin/linuxsteamrt64/metamod.2.cs2.so"],
    ["metamod", "game/csgo/addons/metamod.vdf"],
    ["counterstrikesharp", "game/csgo/addons/counterstrikesharp/bin/linuxsteamrt64/counterstrikesharp.so"],
    ["sourcemod", "game/csgo/addons/sourcemod/bin/sourcemod_mm"],
  ];
  // For metamod we check either vdf or so; for others single check is enough.
  // Run existence checks via file_tunnel "list" parent dir + search, fallback to trying read via validate path existence.
  // Simpler: try to list addons; if list succeeds we can infer.
  // We will probe via "list" on key directories — cheapest is to use InstalledMod records + file check.
  const probes: Record<Cs2FrameworkId, string> = {
    metamod: "game/csgo/addons/metamod.vdf",
    counterstrikesharp: "game/csgo/addons/counterstrikesharp/bin/linuxsteamrt64/counterstrikesharp.so",
    sourcemod: "game/csgo/addons/sourcemod",
  };
  for (const id of Object.keys(probes) as Cs2FrameworkId[]) {
    const probePath = probes[id];
    try {
      // Use validateAndNormalizePath to build safe path; then queueRequest via file_exists-like check:
      // we use a lightweight trick: try to list parent dir and look for entry.
      // For .so/.vdf probes, check via download-path-like existence by listing parent.
      const parent = path.posix.dirname(probePath);
      const base = path.posix.basename(probePath);
      const listRes = await fileTunnel.queueRequest(nodeId, "list", serverUuid, `/${parent}`);
      if (listRes.success && Array.isArray(listRes.data)) {
        const entries = listRes.data as Array<{ name?: string; isDirectory?: boolean; type?: string }>;
        const names = entries.map((e) => String(e.name || ""));
        if (id === "metamod") {
          // metamod present if either .vdf exists or directory exists with cs2 so
          if (names.includes(base) || names.includes("metamod")) installed.add(id);
        } else if (id === "sourcemod") {
          if (names.includes("sourcemod") || names.includes(base)) installed.add(id);
        } else {
          if (names.includes(base)) installed.add(id);
          else {
            // For CSS, parent is .../linuxsteamrt64 — check that dir listing
            const leaf = path.posix.basename(parent);
            if (leaf === "linuxsteamrt64") {
              // listing already is leaf dir
            }
          }
        }
      }
    } catch {
      // ignore probe failure
    }
  }
  // Second pass for CSS: listing linuxsteamrt64 directly
  if (!installed.has("counterstrikesharp")) {
    try {
      const r = await fileTunnel.queueRequest(nodeId, "list", serverUuid, "/game/csgo/addons/counterstrikesharp/bin/linuxsteamrt64");
      if (r.success && Array.isArray(r.data)) {
        const arr = r.data as Array<{ name?: string }>;
        if (arr.some((e) => String(e.name).toLowerCase().includes("counterstrikesharp"))) installed.add("counterstrikesharp");
      }
    } catch {
      // ignore
    }
  }
  // Sourcemod directory check
  if (!installed.has("sourcemod")) {
    try {
      const r = await fileTunnel.queueRequest(nodeId, "list", serverUuid, "/game/csgo/addons");
      if (r.success && Array.isArray(r.data)) {
        const arr = r.data as Array<{ name?: string }>;
        if (arr.some((e) => String(e.name).toLowerCase() === "sourcemod")) installed.add("sourcemod");
      }
    } catch {
      // ignore
    }
  }
  // Metamod addons dir presence as fallback
  if (!installed.has("metamod")) {
    try {
      const r = await fileTunnel.queueRequest(nodeId, "list", serverUuid, "/game/csgo/addons/metamod");
      if (r.success && Array.isArray(r.data) && (r.data as unknown[]).length >= 0) {
        // if dir exists (even empty) it listed; but empty still counts only if vdf present
      }
    } catch {
      // ignore
    }
  }
  // checks var is unused but keeps probe paths visible for future
  void checks;
  return installed;
}

function checkDependencies(frameworkId: Cs2FrameworkId, installed: Set<Cs2FrameworkId>): { ok: boolean; missing: Cs2FrameworkId[] } {
  const fw = CS2_FRAMEWORKS[frameworkId];
  const missing = fw.dependencies.filter((d) => !installed.has(d));
  return { ok: missing.length === 0, missing };
}

export async function serverCs2Routes(app: FastifyInstance) {
  const fileTunnel = (app as unknown as { fileTunnel: { queueRequest: (nodeId: string, op: string, uuid: string, p: string, data?: Record<string, unknown>) => Promise<{ success: boolean; data?: unknown; error?: string }> } }).fileTunnel;

  const ensureAccess = async (serverId: string, userId: string, perm: string, reply: FastifyReply) => {
    const { ensureServerAccess } = await import("./_helpers.js");
    return ensureServerAccess(serverId, userId, perm, reply);
  };

  // List available CS2 frameworks and their install state
  app.get(
    "/:serverId/cs2/frameworks",
    { onRequest: [(app as unknown as { authenticate: (req: unknown, reply: unknown) => Promise<void> }).authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = (request as unknown as { user: { userId: string } }).user.userId;
      const server = await ensureAccess(serverId, userId, "server.read", reply);
      if (!server) return;
      const gate = ensureCs2FrameworkEnabled(server, reply);
      if (!gate) return;
      if (!isCs2Template(server.template)) {
        // Non-CS2 servers that explicitly enable cs2 frameworks via modManager are allowed; already gated.
      }
      let installed: Set<Cs2FrameworkId>;
      try {
        installed = await getInstalledFrameworks(server.uuid, server.nodeId, fileTunnel);
      } catch {
        installed = new Set();
      }
      const frameworks = (Object.values(CS2_FRAMEWORKS) as Array<(typeof CS2_FRAMEWORKS)[Cs2FrameworkId]>).map((fw) => ({
        id: fw.id,
        name: fw.name,
        description: fw.description,
        repo: fw.repo,
        docsUrl: fw.docsUrl,
        dependencies: fw.dependencies,
        installed: installed.has(fw.id),
        dependencyStatus: checkDependencies(fw.id, installed),
      }));
      return reply.send({ success: true, data: frameworks });
    }
  );

  // List releases for a framework (paginated)
  app.get(
    "/:serverId/cs2/frameworks/:frameworkId/releases",
    { onRequest: [(app as unknown as { authenticate: (req: unknown, reply: unknown) => Promise<void> }).authenticate], config: { rateLimit: { max: fileRateLimitMax, timeWindow: fileRateLimitWindowMs } } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId, frameworkId } = request.params as { serverId: string; frameworkId: string };
      const { page, perPage, query } = request.query as { page?: string; perPage?: string; query?: string };
      const userId = (request as unknown as { user: { userId: string } }).user.userId;
      const fid = frameworkId.toLowerCase() as Cs2FrameworkId;
      const fw = CS2_FRAMEWORKS[fid];
      if (!fw) return reply.status(404).send({ error: "Unknown framework" });
      const server = await ensureAccess(serverId, userId, "server.read", reply);
      if (!server) return;
      const gate = ensureCs2FrameworkEnabled(server, reply);
      if (!gate) return;
      const p = Math.max(1, Number(page || 1));
      const pp = Math.min(20, Math.max(1, Number(perPage || 10)));
      try {
        const { releases } = await fetchGitHubReleases(fw.repo, p, pp, query?.trim());
        const mapped = releases.map((r: { tag_name?: string; name?: string; body?: string; published_at?: string; prerelease?: boolean; draft?: boolean; html_url?: string; assets?: Array<{ name?: string }> }) => ({
          tag: r.tag_name || "",
          name: r.name || r.tag_name || "",
          body: r.body || "",
          publishedAt: r.published_at || null,
          prerelease: Boolean(r.prerelease),
          draft: Boolean(r.draft),
          htmlUrl: r.html_url || `https://github.com/${fw.repo}/releases/tag/${r.tag_name}`,
          assets: (r.assets || []).map((a) => a.name || "").filter(Boolean),
        }));
        return reply.send({ success: true, data: mapped });
      } catch (error: unknown) {
        const msg = describeError(error);
        return reply.status(502).send({ error: `Failed to fetch releases: ${msg}` });
      }
    }
  );

  // Install a framework release
  app.post(
    "/:serverId/cs2/frameworks/:frameworkId/install",
    { onRequest: [(app as unknown as { authenticate: (req: unknown, reply: unknown) => Promise<void> }).authenticate], config: { rateLimit: { max: fileRateLimitMax, timeWindow: fileRateLimitWindowMs } } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId, frameworkId } = request.params as { serverId: string; frameworkId: string };
      const { tag, allowDependencyInstall } = request.body as { tag?: string; allowDependencyInstall?: boolean };
      const userId = (request as unknown as { user: { userId: string } }).user.userId;
      const fid = frameworkId.toLowerCase() as Cs2FrameworkId;
      const fw = CS2_FRAMEWORKS[fid];
      if (!fw) return reply.status(404).send({ error: "Unknown framework" });
      if (!tag || !String(tag).trim()) return reply.status(400).send({ error: "tag is required" });
      const server = await ensureAccess(serverId, userId, "file.write", reply);
      if (!server) return;
      const gate = ensureCs2FrameworkEnabled(server, reply);
      if (!gate) return;

      let installed: Set<Cs2FrameworkId>;
      try {
        installed = await getInstalledFrameworks(server.uuid, server.nodeId, fileTunnel);
      } catch {
        installed = new Set();
      }
      const depCheck = checkDependencies(fid, installed);
      if (!depCheck.ok && !allowDependencyInstall) {
        return reply.status(409).send({
          error: `Missing dependencies: ${depCheck.missing.join(", ")}`,
          missingDependencies: depCheck.missing,
          hint: "Install dependencies first or set allowDependencyInstall:true",
        });
      }
      // Optionally auto-install missing dependencies (only metamod currently)
      if (!depCheck.ok && allowDependencyInstall) {
        for (const dep of depCheck.missing) {
          const depFw = CS2_FRAMEWORKS[dep];
          try {
            // Fetch latest release for dep
            const { releases } = await fetchGitHubReleases(depFw.repo, 1, 1);
            const depTag = releases[0]?.tag_name as string | undefined;
            if (!depTag) continue;
            const depAsset = await resolveGitHubAsset(depFw.repo, depTag, depFw.assetPattern, depFw.assetExclude);
            // Download + decompress dep inline
            await installFrameworkArchive(server, depAsset.downloadUrl, depAsset.filename, fileTunnel, reply);
            if (reply.sent) return;
          } catch {
            // continue even if dep install fails — main install will still attempt
          }
        }
        try {
          installed = await getInstalledFrameworks(server.uuid, server.nodeId, fileTunnel);
        } catch {
          // ignore
        }
      }

      let asset: { downloadUrl: string; filename: string };
      try {
        asset = await resolveGitHubAsset(fw.repo, String(tag).trim(), fw.assetPattern, fw.assetExclude);
      } catch (error: unknown) {
        const msg = describeError(error);
        return reply.status(502).send({ error: msg });
      }

      const installedOk = await installFrameworkArchive(server, asset.downloadUrl, asset.filename, fileTunnel, reply);
      if (!installedOk) return; // reply already sent inside helper on failure
      try {
        await createAuditLog(userId, {
          action: "cs2.framework.install",
          resource: "server",
          resourceId: serverId,
          request: request as unknown as Parameters<typeof createAuditLog>[1] extends { request: infer R } ? R : never,
          details: { framework: fid, tag: String(tag).trim(), asset: asset.filename },
        });
      } catch {
        // audit is best-effort
      }
      await prisma.installedMod.upsert({
        where: { serverId_filename: { serverId, filename: asset.filename } },
        update: {
          provider: fid,
          game: "cs2",
          projectId: fw.repo,
          versionId: String(tag).trim(),
          projectName: fw.name,
          type: "plugin",
          hasUpdate: false,
          latestVersionId: null,
          latestVersionName: null,
        },
        create: {
          serverId,
          filename: asset.filename,
          provider: fid,
          game: "cs2",
          projectId: fw.repo,
          versionId: String(tag).trim(),
          projectName: fw.name,
          type: "plugin",
        },
      });
      return reply.send({ success: true, data: { filename: asset.filename, tag: String(tag).trim() } });
    }
  );

  // Uninstall framework (removes known paths)
  app.post(
    "/:serverId/cs2/frameworks/:frameworkId/uninstall",
    { onRequest: [(app as unknown as { authenticate: (req: unknown, reply: unknown) => Promise<void> }).authenticate], config: { rateLimit: { max: fileRateLimitMax, timeWindow: fileRateLimitWindowMs } } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId, frameworkId } = request.params as { serverId: string; frameworkId: string };
      const userId = (request as unknown as { user: { userId: string } }).user.userId;
      const fid = frameworkId.toLowerCase() as Cs2FrameworkId;
      const fw = CS2_FRAMEWORKS[fid];
      if (!fw) return reply.status(404).send({ error: "Unknown framework" });
      const server = await ensureAccess(serverId, userId, "file.write", reply);
      if (!server) return;
      const gate = ensureCs2FrameworkEnabled(server, reply);
      if (!gate) return;

      const paths: string[] = [];
      if (fid === "metamod") paths.push("/game/csgo/addons/metamod", "/game/csgo/addons/metamod.vdf", "/game/csgo/addons/metamod_x64.vdf");
      else if (fid === "counterstrikesharp") paths.push("/game/csgo/addons/counterstrikesharp");
      else if (fid === "sourcemod") paths.push("/game/csgo/addons/sourcemod", "/game/csgo/addons/sourcemod.vdf");

      // Attempt to revert gameinfo.gi patch for metamod uninstall (best effort)
      if (fid === "metamod") {
        try {
          await revertGameInfoPatch(server.uuid, server.nodeId, fileTunnel);
        } catch {
          // best effort
        }
      }
      // Also clean metaplugins.ini entry for CSS undeploy
      if (fid === "counterstrikesharp") {
        try {
          await removeMetapluginsEntry(server.uuid, server.nodeId, fileTunnel);
        } catch {
          // best effort
        }
      }

      const errors: string[] = [];
      for (const p of paths) {
        try {
          const normalized = validateAndNormalizePath(p, server.uuid);
          const res = await fileTunnel.queueRequest(server.nodeId, "delete", server.uuid, normalized);
          if (!res.success && res.error && !String(res.error).toLowerCase().includes("not found") && !String(res.error).toLowerCase().includes("no such")) {
            errors.push(`${p}: ${res.error}`);
          }
        } catch (error: unknown) {
          const msg = describeError(error);
          if (!msg.toLowerCase().includes("not found") && !msg.toLowerCase().includes("no such")) errors.push(`${p}: ${msg}`);
        }
      }
      // Remove installedMod DB rows for this framework
      try {
        await prisma.installedMod.deleteMany({ where: { serverId, provider: fid, game: "cs2" } });
      } catch {
        // ignore
      }
      try {
        await createAuditLog(userId, {
          action: "cs2.framework.uninstall",
          resource: "server",
          resourceId: serverId,
          request: request as unknown as Parameters<typeof createAuditLog>[1] extends { request: infer R } ? R : never,
          details: { framework: fid },
        });
      } catch {
        // ignore
      }
      if (errors.length) {
        return reply.status(207).send({ success: true, warnings: errors });
      }
      return reply.send({ success: true });
    }
  );

  // CS2 plugins: list installed plugins from addons/counterstrikesharp/plugins
  app.get(
    "/:serverId/cs2/plugins",
    { onRequest: [(app as unknown as { authenticate: (req: unknown, reply: unknown) => Promise<void> }).authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = (request as unknown as { user: { userId: string } }).user.userId;
      const server = await ensureAccess(serverId, userId, "server.read", reply);
      if (!server) return;
      const gate = ensureCs2FrameworkEnabled(server, reply);
      if (!gate) return;
      try {
        const base = validateAndNormalizePath("/game/csgo/addons/counterstrikesharp/plugins", server.uuid);
        const res = await fileTunnel.queueRequest(server.nodeId, "list", server.uuid, base);
        const entries = res.success && Array.isArray(res.data) ? (res.data as Array<{ name?: string; type?: string; isDirectory?: boolean; size?: number; modified?: string }>) : [];
        const dbRecords = await prisma.installedMod.findMany({ where: { serverId, type: "plugin", game: "cs2" } });
        const dbMap = new Map(dbRecords.map((r) => [r.filename, r]));
        const mapped = entries.map((e) => ({
          name: String(e.name || ""),
          isDirectory: Boolean(e.isDirectory ?? e.type === "directory"),
          size: Number(e.size || 0),
          modified: (e.modified as string) || null,
          meta: dbMap.get(String(e.name || "")) || null,
        }));
        return reply.send({ success: true, data: mapped });
      } catch {
        return reply.send({ success: true, data: [] });
      }
    }
  );

  // CS2 plugins: uninstall a plugin folder/file under addons/counterstrikesharp/plugins
  app.post(
    "/:serverId/cs2/plugins/uninstall",
    { onRequest: [(app as unknown as { authenticate: (req: unknown, reply: unknown) => Promise<void> }).authenticate], config: { rateLimit: { max: fileRateLimitMax, timeWindow: fileRateLimitWindowMs } } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const { filename } = request.body as { filename?: string };
      const userId = (request as unknown as { user: { userId: string } }).user.userId;
      if (!filename || !String(filename).trim()) return reply.status(400).send({ error: "filename is required" });
      const server = await ensureAccess(serverId, userId, "file.write", reply);
      if (!server) return;
      const gate = ensureCs2FrameworkEnabled(server, reply);
      if (!gate) return;
      const safe = String(filename).trim().replace(/[^a-zA-Z0-9._-]/g, "_");
      // Allow plugin directory names that were sanitized on install; also support raw folder names
      const targetName = safe || String(filename).trim();
      const safePath = path.posix.join("/game/csgo/addons/counterstrikesharp/plugins", targetName);
      try {
        const normalized = validateAndNormalizePath(safePath, server.uuid);
        const res = await fileTunnel.queueRequest(server.nodeId, "delete", server.uuid, normalized);
        if (!res.success) return reply.status(400).send({ error: res.error || "Failed to uninstall plugin" });
        await prisma.installedMod.deleteMany({ where: { serverId, filename: targetName } });
        await createAuditLog(userId, {
          action: "cs2.plugin.uninstall",
          resource: "server",
          resourceId: serverId,
          request: request as unknown as Parameters<typeof createAuditLog>[1] extends { request: infer R } ? R : never,
          details: { filename: targetName },
        });
        return reply.send({ success: true });
      } catch (error: unknown) {
        const msg = describeError(error);
        return reply.status(400).send({ error: msg || "Failed to uninstall plugin" });
      }
    }
  );
}

async function installFrameworkArchive(
  server: { uuid: string; nodeId: string },
  downloadUrl: string,
  filename: string,
  fileTunnel: { queueRequest: (nodeId: string, op: string, uuid: string, p: string, data?: Record<string, unknown>) => Promise<{ success: boolean; data?: unknown; error?: string; body?: unknown; contentType?: string }> },
  reply: FastifyReply
): Promise<boolean> {
  // Stage archive under /_cs2_tmp, download via install-url, decompress to game/csgo, then cleanup.
  // Archives contain addons/ at root — target must be game/csgo, not /.
  const tmpArchive = `/_cs2_tmp/${filename}`;
  const extractTarget = "/game/csgo";
  try {
    const normTmp = validateAndNormalizePath(tmpArchive, server.uuid);
    const dl = await fileTunnel.queueRequest(server.nodeId, "install-url", server.uuid, normTmp, { url: downloadUrl });
    if (!dl.success) {
      reply.status(502).send({ error: dl.error || "Failed to download framework archive" });
      return false;
    }
    const normArchive = validateAndNormalizePath(tmpArchive, server.uuid);
    const target = validateAndNormalizePath(extractTarget, server.uuid);
    const dec = await fileTunnel.queueRequest(server.nodeId, "decompress", server.uuid, normArchive, { targetPath: target });
    if (!dec.success) {
      reply.status(500).send({ error: dec.error || "Failed to extract framework archive" });
      try {
        await fileTunnel.queueRequest(server.nodeId, "delete", server.uuid, normTmp);
      } catch {
        // ignore
      }
      return false;
    }
    try {
      await fileTunnel.queueRequest(server.nodeId, "delete", server.uuid, normTmp);
    } catch {
      // ignore
    }
    try {
      if (filename.toLowerCase().includes("mmsource") || filename.toLowerCase().includes("metamod")) {
        await ensureGameInfoPatch(server.uuid, server.nodeId, fileTunnel);
      }
    } catch {
      // best effort; don't fail install
    }
    try {
      if (filename.toLowerCase().includes("counterstrikesharp")) {
        await ensureMetapluginsEntry(server.uuid, server.nodeId, fileTunnel);
      }
    } catch {
      // best effort
    }
    return true;
  } catch (error: unknown) {
    const msg = describeError(error);
    if (!reply.sent) reply.status(500).send({ error: msg || "Failed to install framework" });
    return false;
  }
}

// Ensure game/csgo/gameinfo.gi contains `Game	csgo/addons/metamod` before `Game	csgo`.
// Do NOT use Game_LowViolence — that is the China csgo_lv line.
async function ensureGameInfoPatch(
  serverUuid: string,
  nodeId: string,
  fileTunnel: { queueRequest: (nodeId: string, op: string, uuid: string, p: string, data?: Record<string, unknown>) => Promise<{ success: boolean; data?: unknown; error?: string; body?: unknown; contentType?: string }> }
): Promise<void> {
  const giPath = validateAndNormalizePath("/game/csgo/gameinfo.gi", serverUuid);
  let content = "";
  try {
    const res = await fileTunnel.queueRequest(nodeId, "download", serverUuid, giPath);
    // download returns body as Buffer/stream, surfaced as `body` on the FileTunnelResponse
    const body = (res as unknown as { body?: unknown }).body;
    if (body !== null && body !== undefined) {
      if (Buffer.isBuffer(body)) content = body.toString("utf-8");
      else if (body instanceof Uint8Array) content = Buffer.from(body).toString("utf-8");
      else if (typeof body === "string") content = body;
    }
    if (!content && typeof res.data === "string") content = res.data as string;
    else if (!content && res.data && typeof (res.data as Record<string, unknown>).content === "string") content = String((res.data as Record<string, unknown>).content);
  } catch {
    // ignore
  }
  if (!content) {
    try {
      const list = await fileTunnel.queueRequest(nodeId, "list", serverUuid, validateAndNormalizePath("/game/csgo", serverUuid));
      const entries = Array.isArray(list.data) ? (list.data as Array<{ name?: string }>) : [];
      const hasGi = entries.some((e) => String(e.name).toLowerCase() === "gameinfo.gi");
      if (!hasGi) return;
    } catch {
      return;
    }
    return;
  }
  if (content.includes("csgo/addons/metamod")) return;
  let patched: string;
  // Insert Game	csgo/addons/metamod immediately before the first Game	csgo line (case-sensitive, word-boundary aware)
  if (/^[ \t]*Game[ \t]+csgo\b/m.test(content)) {
    patched = content.replace(/^([ \t]*Game[ \t]+csgo\b.*)$/m, "\tGame\tcsgo/addons/metamod\n$1");
  } else if (content.includes("SearchPaths")) {
    // Fallback: inject at top of SearchPaths block — use plain Game, not Game_LowViolence
    patched = content.replace(/SearchPaths\s*\{/, (m) => `${m}\n\t\tGame\tcsgo/addons/metamod`);
  } else {
    patched = `${content.trimEnd()}\nGame\tcsgo/addons/metamod\n`;
  }
  await fileTunnel.queueRequest(nodeId, "write", serverUuid, giPath, { content: patched });
}

async function revertGameInfoPatch(
  serverUuid: string,
  nodeId: string,
  fileTunnel: { queueRequest: (nodeId: string, op: string, uuid: string, p: string, data?: Record<string, unknown>) => Promise<{ success: boolean; data?: unknown; error?: string; body?: unknown; contentType?: string }> }
): Promise<void> {
  const giPath = validateAndNormalizePath("/game/csgo/gameinfo.gi", serverUuid);
  let content = "";
  try {
    const res = await fileTunnel.queueRequest(nodeId, "download", serverUuid, giPath);
    const body = (res as unknown as { body?: unknown }).body;
    if (body !== null && body !== undefined) {
      if (Buffer.isBuffer(body)) content = body.toString("utf-8");
      else if (body instanceof Uint8Array) content = Buffer.from(body).toString("utf-8");
      else if (typeof body === "string") content = body;
    }
    if (!content && typeof res.data === "string") content = res.data as string;
  } catch {
    return;
  }
  if (!content || !content.includes("addons/metamod")) return;
  // Only remove the line we inserted: Game	csgo/addons/metamod ; never touch Game_LowViolence
  const cleaned = content
    .split("\n")
    .filter((line) => !line.includes("csgo/addons/metamod"))
    .join("\n");
  await fileTunnel.queueRequest(nodeId, "write", serverUuid, giPath, { content: cleaned });
}

async function ensureMetapluginsEntry(
  serverUuid: string,
  nodeId: string,
  fileTunnel: { queueRequest: (nodeId: string, op: string, uuid: string, p: string, data?: Record<string, unknown>) => Promise<{ success: boolean; data?: unknown; error?: string; body?: unknown; contentType?: string }> }
): Promise<void> {
  const mpPath = validateAndNormalizePath("/game/csgo/addons/metamod/metaplugins.ini", serverUuid);
  let content = "";
  try {
    const res = await fileTunnel.queueRequest(nodeId, "download", serverUuid, mpPath);
    const body = (res as unknown as { body?: unknown }).body;
    if (body !== null && body !== undefined) {
      if (Buffer.isBuffer(body)) content = body.toString("utf-8");
      else if (body instanceof Uint8Array) content = Buffer.from(body).toString("utf-8");
      else if (typeof body === "string") content = body;
    }
    if (!content && typeof res.data === "string") content = res.data as string;
  } catch {
    // file may not exist yet; create it
  }
  if (content.includes("counterstrikesharp")) return;
  const line = "addons/counterstrikesharp/bin/linuxsteamrt64/counterstrikesharp";
  const next = content ? `${content.trimEnd()}\n${line}\n` : `${line}\n`;
  await fileTunnel.queueRequest(nodeId, "write", serverUuid, mpPath, { content: next });
}


async function removeMetapluginsEntry(
  serverUuid: string,
  nodeId: string,
  fileTunnel: { queueRequest: (nodeId: string, op: string, uuid: string, p: string, data?: Record<string, unknown>) => Promise<{ success: boolean; data?: unknown; error?: string; body?: unknown; contentType?: string }> }
): Promise<void> {
  const mpPath = validateAndNormalizePath("/game/csgo/addons/metamod/metaplugins.ini", serverUuid);
  let content = "";
  try {
    const res = await fileTunnel.queueRequest(nodeId, "download", serverUuid, mpPath);
    const body = (res as unknown as { body?: unknown }).body;
    if (body !== null && body !== undefined) {
      if (Buffer.isBuffer(body)) content = body.toString("utf-8");
      else if (body instanceof Uint8Array) content = Buffer.from(body).toString("utf-8");
      else if (typeof body === "string") content = body;
    }
    if (!content && typeof res.data === "string") content = res.data as string;
  } catch {
    return;
  }
  if (!content.includes("counterstrikesharp")) return;
  const cleaned = content
    .split("\n")
    .filter((line) => !line.toLowerCase().includes("counterstrikesharp"))
    .join("\n");
  await fileTunnel.queueRequest(nodeId, "write", serverUuid, mpPath, { content: cleaned.trimEnd() ? `${cleaned.trimEnd()}\n` : "" });
}
