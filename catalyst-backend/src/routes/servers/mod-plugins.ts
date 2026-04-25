import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../../db.js";
import { ModManagerTarget, buildProviderHeaders, ensureModManagerEnabled, ensurePluginManagerEnabled, ensureServerAccess, extractGameVersion, fileRateLimitMax, getModManagerSettings, getProviderTargets, loadPluginProviderConfig, loadProviderConfig, normalizeRequestPath, normalizeTargetValue, path, resolveCurseforgeClassId, resolveCurseforgeGameId, resolveCurseforgeLoaderType, resolveModManagerProvider, resolveModrinthGameVersion, resolvePaperDownload, resolveSpigotDownload, resolveTemplatePath, sanitizeFilename } from './_helpers.js';

export async function serverModpluginsRoutes(app: FastifyInstance) {
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

  app.get(
    "/:serverId/mod-manager/game-versions",
    {
      onRequest: [app.authenticate],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const { provider, game } = request.query as { provider?: string; game?: string };
      const userId = request.user.userId;

      if (!provider) {
        return reply.status(400).send({ error: "provider is required" });
      }

      const server = await ensureServerAccess(serverId, userId, "server.read", reply);
      if (!server) return;
      const modManager = ensureModManagerEnabled(server, reply);
      if (!modManager) return;
      const providerEntry = resolveModManagerProvider(modManager, provider, game);
      if (!providerEntry) {
        return reply.status(400).send({ error: "Provider or game not enabled for this template" });
      }
      const providerId = providerEntry.id;

      if (providerId !== "modrinth") {
        // Non-Modrinth providers don't support game version tag resolution
        return reply.send({ success: true, data: [] });
      }

      const providerConfig = await loadProviderConfig(providerId);
      if (!providerConfig) {
        return reply.status(404).send({ error: "Provider not found" });
      }
      let headers: Record<string, string>;
      try {
        const settings = await getModManagerSettings();
        headers = buildProviderHeaders(providerConfig, settings);
      } catch (error: any) {
        return reply.status(409).send({ error: error?.message || "Missing provider API key" });
      }

      const baseUrl = providerConfig.baseUrl.replace(/\/$/, "");
      const url = `${baseUrl}/v2/tag/game_version`;
      try {
        const response = await fetch(url, { headers });
        if (!response.ok) {
          return reply.send({ success: true, data: [] });
        }
        const data = (await response.json()) as any[];
        // Return release versions only, sorted by date descending
        const releases = data
          .filter((v) => v.version_type === "release")
          .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
          .map((v) => v.version);
        return reply.send({ success: true, data: releases });
      } catch {
        return reply.send({ success: true, data: [] });
      }
    }
  );

  app.get(
    "/:serverId/mod-manager/search",
    {
      onRequest: [app.authenticate],
      config: { rateLimit: { max: fileRateLimitMax, timeWindow: "1 minute" } },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const { provider, game, query, page, gameVersion, loader } = request.query as {
        provider?: string;
        game?: string;
        query?: string;
        target?: ModManagerTarget;
        gameVersion?: string;
        page?: string | number;
        loader?: string;
      };
      const userId = request.user.userId;

      if (!provider) {
        return reply.status(400).send({ error: "provider is required" });
      }

      const server = await ensureServerAccess(serverId, userId, "server.read", reply);
      if (!server) return;
      const modManager = ensureModManagerEnabled(server, reply);
      if (!modManager) return;
      const providerEntry = resolveModManagerProvider(modManager, provider, game);
      if (!providerEntry) {
        return reply.status(400).send({ error: "Provider or game not enabled for this template" });
      }
      const allowedTargets = getProviderTargets(modManager, providerEntry);
      const rawTarget = (request.query as { target?: string }).target;
      const requestedTarget = normalizeTargetValue(rawTarget);
      if (rawTarget && !requestedTarget) {
        return reply.status(400).send({ error: "Invalid target" });
      }
      const targetValue = requestedTarget ?? allowedTargets[0] ?? "mods";
      if (!allowedTargets.includes(targetValue)) {
        return reply.status(400).send({
          error: `Target '${targetValue}' is not enabled for ${providerEntry.id}${
            providerEntry.game ? ` (${providerEntry.game})` : ""
          }`,
          allowedTargets,
        });
      }
      const providerId = providerEntry.id;

      const providerConfig = await loadProviderConfig(providerId);
      if (!providerConfig) {
        return reply.status(404).send({ error: "Provider not found" });
      }
      let headers: Record<string, string>;
      try {
        const settings = await getModManagerSettings();
        headers = buildProviderHeaders(providerConfig, settings);
      } catch (error: any) {
        return reply.status(409).send({ error: error?.message || "Missing provider API key" });
      }

      const pageValue = typeof page === "string" ? Number(page) : page ?? 1;
      const baseUrl = providerConfig.baseUrl.replace(/\/$/, "");
      const searchQuery = typeof query === "string" ? query.trim() : "";
      const rawGameVersion = gameVersion?.trim() || extractGameVersion(server.environment);
      const isTrending = !searchQuery;
      let url = "";
      if (providerId === "modrinth") {
        // Resolve game version (handles "latest", partial versions like "1.21")
        const resolvedGameVersion = rawGameVersion
          ? await resolveModrinthGameVersion(rawGameVersion, baseUrl, headers)
          : "";
        const facets: string[][] = [];
        facets.push([
          `project_type:${
            targetValue === "mods" ? "mod" : targetValue === "datapacks" ? "datapack" : "modpack"
          }`,
        ]);
        if (providerEntry.game) {
          facets.push([`categories:${providerEntry.game}`]);
        }
        if (resolvedGameVersion) {
          facets.push([`versions:${resolvedGameVersion}`]);
        }
        const loaderValue = typeof loader === "string" ? loader.trim().toLowerCase() : "";
        if (loaderValue) {
          facets.push([`categories:${loaderValue}`]);
        }
        const params = new URLSearchParams({
          query: searchQuery,
          limit: "20",
          ...(facets.length ? { facets: JSON.stringify(facets) } : {}),
          offset: String(Math.max(0, (Number(pageValue) - 1) * 20)),
          ...(isTrending ? { index: "downloads" } : {}),
        });
        url = `${baseUrl}${providerConfig.endpoints.search}?${params.toString()}`;
      } else {
        const loaderValue = typeof loader === "string" ? loader.trim().toLowerCase() : "";
        let gameId = "432";
        let classId: string | undefined;
        try {
          gameId = await resolveCurseforgeGameId(providerConfig, providerEntry, baseUrl, headers);
          classId = await resolveCurseforgeClassId(
            providerConfig,
            providerEntry,
            targetValue,
            gameId,
            baseUrl,
            headers
          );
        } catch (error: any) {
          return reply.status(409).send({ error: error?.message || "Failed to resolve game metadata" });
        }
        if (!classId && targetValue !== "mods") {
          return reply.status(409).send({
            error: `No CurseForge class configured for target '${targetValue}' in game '${providerEntry.game || gameId}'`,
          });
        }

        const modLoaderType = loaderValue
          ? resolveCurseforgeLoaderType(providerEntry, gameId, loaderValue)
          : undefined;
        const params = new URLSearchParams({
          gameId,
          pageSize: "20",
          index: String(Math.max(0, (Number(pageValue) - 1) * 20)),
          ...(searchQuery ? { searchFilter: searchQuery } : {}),
          ...(rawGameVersion ? { gameVersion: rawGameVersion } : {}),
          ...(isTrending ? { sortField: "2", sortOrder: "desc" } : {}),
          ...(classId ? { classId } : {}),
          ...(modLoaderType ? { modLoaderType } : {}),
        });
        url = `${baseUrl}${providerConfig.endpoints.search}?${params.toString()}`;
      }

      const response = await fetch(url, { headers });
      if (!response.ok) {
        const body = await response.text();
        return reply
          .status(response.status)
          .send({ error: `Provider error: ${body}` });
      }
      const payload = await response.json() as any;
      if (providerId === "paper" && payload && Array.isArray(payload?.result)) {
        return reply.send({ success: true, data: payload.result });
      }
      return reply.send({ success: true, data: payload });
    }
  );

  app.get(
    "/:serverId/mod-manager/versions",
    {
      onRequest: [app.authenticate],
      config: { rateLimit: { max: fileRateLimitMax, timeWindow: "1 minute" } },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const { provider, game, projectId } = request.query as {
        provider?: string;
        game?: string;
        projectId?: string;
      };
      const userId = request.user.userId;

      if (!provider || !projectId) {
        return reply.status(400).send({ error: "provider and projectId are required" });
      }

      const server = await ensureServerAccess(serverId, userId, "server.read", reply);
      if (!server) return;
      const modManager = ensureModManagerEnabled(server, reply);
      if (!modManager) return;
      const providerEntry = resolveModManagerProvider(modManager, provider, game);
      if (!providerEntry) {
        return reply.status(400).send({ error: "Provider or game not enabled for this template" });
      }
      const providerId = providerEntry.id;

      const providerConfig = await loadProviderConfig(providerId);
      if (!providerConfig) {
        return reply.status(404).send({ error: "Provider not found" });
      }
      let headers: Record<string, string>;
      try {
        const settings = await getModManagerSettings();
        headers = buildProviderHeaders(providerConfig, settings);
      } catch (error: any) {
        return reply.status(409).send({ error: error?.message || "Missing provider API key" });
      }

      const baseUrl = providerConfig.baseUrl.replace(/\/$/, "");
      const endpoint = providerConfig.endpoints.versions || providerConfig.endpoints.files;
      const encodedProjectId =
        providerId === "paper"
          ? String(projectId).split("/").map(encodeURIComponent).join("/")
          : encodeURIComponent(projectId);
      const url = `${baseUrl}${endpoint.replace("{projectId}", encodedProjectId)}`;

      const response = await fetch(url, { headers });
      if (!response.ok) {
        const body = await response.text();
        return reply
          .status(response.status)
          .send({ error: `Provider error: ${body}` });
      }
      const payload = await response.json() as any;
      if (providerId === "paper" && payload && Array.isArray(payload?.result)) {
        return reply.send({ success: true, data: payload.result });
      }
      return reply.send({ success: true, data: payload });
    }
  );

  app.post(
    "/:serverId/mod-manager/install",
    {
      onRequest: [app.authenticate],
      config: { rateLimit: { max: fileRateLimitMax, timeWindow: "1 minute" } },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const { provider, game, projectId, versionId, target, projectName } = request.body as {
        provider?: string;
        game?: string;
        projectId?: string;
        versionId?: string | number;
        target?: ModManagerTarget;
        projectName?: string;
      };
      const userId = request.user.userId;

      if (!provider || !projectId || !versionId || !target) {
        return reply.status(400).send({ error: "provider, projectId, versionId, and target are required" });
      }

      const server = await ensureServerAccess(serverId, userId, "file.write", reply);
      if (!server) return;
      const modManager = ensureModManagerEnabled(server, reply);
      if (!modManager) return;
      const providerEntry = resolveModManagerProvider(modManager, provider, game);
      if (!providerEntry) {
        return reply.status(400).send({ error: "Provider or game not enabled for this template" });
      }
      const allowedTargets = getProviderTargets(modManager, providerEntry);
      if (!allowedTargets.includes(target)) {
        return reply.status(400).send({
          error: `Target '${target}' is not enabled for ${providerEntry.id}${
            providerEntry.game ? ` (${providerEntry.game})` : ""
          }`,
          allowedTargets,
        });
      }
      const providerId = providerEntry.id;

      const providerConfig = await loadProviderConfig(providerId);
      if (!providerConfig) {
        return reply.status(404).send({ error: "Provider not found" });
      }
      let headers: Record<string, string>;
      try {
        const settings = await getModManagerSettings();
        headers = buildProviderHeaders(providerConfig, settings);
      } catch (error: any) {
        return reply.status(409).send({ error: error?.message || "Missing provider API key" });
      }

      const baseUrl = providerConfig.baseUrl.replace(/\/$/, "");
      let metadataUrl = "";
      if (providerId === "modrinth") {
        metadataUrl = `${baseUrl}${providerConfig.endpoints.version.replace("{versionId}", encodeURIComponent(String(versionId)))}`;
      } else {
        metadataUrl = `${baseUrl}${providerConfig.endpoints.file
          .replace("{projectId}", encodeURIComponent(projectId))
          .replace("{fileId}", encodeURIComponent(String(versionId)))}`;
      }

      const metadataResponse = await fetch(metadataUrl, { headers });
      if (!metadataResponse.ok) {
        const body = await metadataResponse.text();
        return reply
          .status(metadataResponse.status)
          .send({ error: `Provider error: ${body}` });
      }
      const metadata = await metadataResponse.json() as any;

      let downloadUrl = "";
      let filename = "";
      if (providerId === "modrinth") {
        const files = metadata?.files ?? [];
        const file = files.find((entry: any) => entry.primary) ?? files[0];
        downloadUrl = file?.url ?? "";
        filename = file?.filename ?? "";
      } else {
        downloadUrl = metadata?.data?.downloadUrl ?? "";
        filename = metadata?.data?.fileName ?? "";
      }

      if (!downloadUrl || !filename) {
        return reply.status(409).send({ error: "Unable to resolve download asset" });
      }

      const normalizedBase = resolveTemplatePath(modManager.paths?.[target], target);
      const normalizedFile = normalizeRequestPath(path.posix.join(normalizedBase, filename));

      try {
        const result = await tunnelFileOp(server.nodeId, "install-url", server.uuid, normalizedFile, { url: downloadUrl });
        if (!result.success) {
          return reply.status(400).send({ error: result.error || "Failed to install asset" });
        }
        await prisma.auditLog.create({
          data: {
            userId,
            action: "mod_manager.install",
            resource: "server",
            resourceId: serverId,
            details: {
              provider: providerId,
              game: providerEntry.game ?? game ?? null,
              projectId,
              versionId,
              target: normalizedFile,
            },
          },
        });
        await prisma.installedMod.upsert({
          where: { serverId_filename: { serverId, filename } },
          update: {
            provider: providerId,
            game: providerEntry.game ?? game ?? null,
            projectId: String(projectId),
            versionId: String(versionId),
            projectName: projectName || undefined,
            type: target === "datapacks" ? "datapack" : target === "modpacks" ? "modpack" : "mod",
            hasUpdate: false,
            latestVersionId: null,
            latestVersionName: null,
          },
          create: {
            serverId,
            filename,
            provider: providerId,
            game: providerEntry.game ?? game ?? null,
            projectId: String(projectId),
            versionId: String(versionId),
            projectName: projectName || null,
            type: target === "datapacks" ? "datapack" : target === "modpacks" ? "modpack" : "mod",
          },
        });
        reply.send({ success: true, data: { path: normalizedFile } });

        // Emit SSE event for mod install completion
        const gateway = (app as any).wsGateway;
        if (gateway?.pushToAdminSubscribers) {
          gateway.pushToAdminSubscribers('mod_install_complete', {
            serverId,
            target: normalizedFile,
            filename,
            projectName: projectName || undefined,
            timestamp: Date.now(),
          });
        }
        if (gateway?.pushToGlobalSubscribers) {
          gateway.pushToGlobalSubscribers('mod_install_complete', {
            serverId,
            target: normalizedFile,
            filename,
            projectName: projectName || undefined,
            timestamp: Date.now(),
          });
        }
      } catch (error: any) {
        reply.status(400).send({ error: error?.message || "Failed to install asset" });
      }
    }
  );

  // Get valid game version tags for a provider (used for autocomplete)
  app.get(
    "/:serverId/plugin-manager/game-versions",
    {
      onRequest: [app.authenticate],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const { provider: rawProvider } = request.query as { provider?: string };
      const provider = rawProvider === "spiget" ? "spigot" : rawProvider;
      const userId = request.user.userId;

      if (!provider) {
        return reply.status(400).send({ error: "provider is required" });
      }

      const server = await ensureServerAccess(serverId, userId, "server.read", reply);
      if (!server) return;
      const pluginManager = ensurePluginManagerEnabled(server, reply);
      if (!pluginManager) return;

      if (provider !== "modrinth") {
        return reply.send({ success: true, data: [] });
      }

      const providerConfig = await loadPluginProviderConfig(provider);
      if (!providerConfig) {
        return reply.status(404).send({ error: "Provider not found" });
      }
      let headers: Record<string, string>;
      try {
        const settings = await getModManagerSettings();
        headers = buildProviderHeaders(providerConfig, settings);
      } catch (error: any) {
        return reply.status(409).send({ error: error?.message || "Missing provider API key" });
      }

      const baseUrl = providerConfig.baseUrl.replace(/\/$/, "");
      const url = `${baseUrl}/v2/tag/game_version`;
      try {
        const response = await fetch(url, { headers });
        if (!response.ok) {
          return reply.send({ success: true, data: [] });
        }
        const data = (await response.json()) as any[];
        const releases = data
          .filter((v) => v.version_type === "release")
          .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
          .map((v) => v.version);
        return reply.send({ success: true, data: releases });
      } catch {
        return reply.send({ success: true, data: [] });
      }
    }
  );

  app.get(
    "/:serverId/plugin-manager/search",
    {
      onRequest: [app.authenticate],
      config: { rateLimit: { max: fileRateLimitMax, timeWindow: "1 minute" } },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const { provider: rawProvider, query, page, gameVersion } = request.query as {
        provider?: string;
        query?: string;
        gameVersion?: string;
        page?: string | number;
      };
      const provider = rawProvider === "spiget" ? "spigot" : rawProvider;
      const userId = request.user.userId;

      if (!provider) {
        return reply.status(400).send({ error: "provider is required" });
      }

      const server = await ensureServerAccess(serverId, userId, "server.read", reply);
      if (!server) return;
      const pluginManager = ensurePluginManagerEnabled(server, reply);
      if (!pluginManager) return;
      const allowedProviders = pluginManager.providers.map((entry) =>
        entry === "spiget" ? "spigot" : entry
      );
      if (!allowedProviders.includes(provider)) {
        return reply.status(400).send({ error: "Provider not enabled for this template" });
      }

      const providerConfig = await loadPluginProviderConfig(provider);
      if (!providerConfig) {
        return reply.status(404).send({ error: "Provider not found" });
      }
      let headers: Record<string, string>;
      try {
        const settings = await getModManagerSettings();
        headers = buildProviderHeaders(providerConfig, settings);
      } catch (error: any) {
        return reply.status(409).send({ error: error?.message || "Missing provider API key" });
      }

      const pageValue = typeof page === "string" ? Number(page) : page ?? 1;
      const baseUrl = providerConfig.baseUrl.replace(/\/$/, "");
      const searchQuery = typeof query === "string" ? query.trim() : "";
      const rawGameVersion = gameVersion?.trim() || extractGameVersion(server.environment);
      const isTrending = !searchQuery;
      let url = "";
      if (provider === "modrinth") {
        // Resolve game version (handles "latest", partial versions like "1.21")
        const resolvedGameVersion = rawGameVersion
          ? await resolveModrinthGameVersion(rawGameVersion, baseUrl, headers)
          : "";
        const facets: string[][] = [["project_type:plugin"]];
        if (resolvedGameVersion) {
          facets.push([`versions:${resolvedGameVersion}`]);
        }
        const params = new URLSearchParams({
          query: searchQuery,
          limit: "20",
          facets: JSON.stringify(facets),
          offset: String(Math.max(0, (Number(pageValue) - 1) * 20)),
          ...(isTrending ? { index: "downloads" } : {}),
        });
        url = `${baseUrl}${providerConfig.endpoints.search}?${params.toString()}`;
      } else if (provider === "spigot") {
        const params = new URLSearchParams({
          size: "20",
          page: String(Math.max(0, Number(pageValue) - 1)),
        });
        if (searchQuery) {
          url = `${baseUrl}${providerConfig.endpoints.search.replace(
            "{query}",
            encodeURIComponent(searchQuery)
          )}?${params.toString()}`;
        } else {
          url = `${baseUrl}${providerConfig.endpoints.resources}?${params.toString()}`;
        }
      } else if (provider === "paper") {
        const params = new URLSearchParams({
          limit: "20",
          offset: String(Math.max(0, (Number(pageValue) - 1) * 20)),
          ...(searchQuery ? { q: searchQuery } : {}),
        });
        url = `${baseUrl}${providerConfig.endpoints.projects}?${params.toString()}`;
      } else {
        return reply.status(400).send({ error: "Unsupported provider" });
      }

      const response = await fetch(url, { headers });
      if (!response.ok) {
        const body = await response.text();
        return reply
          .status(response.status)
          .send({ error: `Provider error: ${body}` });
      }
      const payload = await response.json() as any;
      if (provider === "spigot" && Array.isArray(payload)) {
        const filtered = payload.filter((entry: any) => entry?.premium !== true);
        return reply.send({ success: true, data: filtered });
      }
      if (provider === "spigot" && payload && Array.isArray(payload?.data)) {
        const filtered = payload.data.filter((entry: any) => entry?.premium !== true);
        return reply.send({ success: true, data: { ...payload, data: filtered } });
      }
      if (provider === "paper" && payload && Array.isArray(payload?.result)) {
        return reply.send({ success: true, data: payload.result });
      }
      return reply.send({ success: true, data: payload });
    }
  );

  app.get(
    "/:serverId/plugin-manager/versions",
    {
      onRequest: [app.authenticate],
      config: { rateLimit: { max: fileRateLimitMax, timeWindow: "1 minute" } },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const { provider: rawProvider, projectId } = request.query as {
        provider?: string;
        projectId?: string;
      };
      const provider = rawProvider === "spiget" ? "spigot" : rawProvider;
      const userId = request.user.userId;

      if (!provider || !projectId) {
        return reply.status(400).send({ error: "provider and projectId are required" });
      }

      const server = await ensureServerAccess(serverId, userId, "server.read", reply);
      if (!server) return;
      const pluginManager = ensurePluginManagerEnabled(server, reply);
      if (!pluginManager) return;
      const allowedProviders = pluginManager.providers.map((entry) =>
        entry === "spiget" ? "spigot" : entry
      );
      if (!allowedProviders.includes(provider)) {
        return reply.status(400).send({ error: "Provider not enabled for this template" });
      }

      const providerConfig = await loadPluginProviderConfig(provider);
      if (!providerConfig) {
        return reply.status(404).send({ error: "Provider not found" });
      }
      let headers: Record<string, string>;
      try {
        const settings = await getModManagerSettings();
        headers = buildProviderHeaders(providerConfig, settings);
      } catch (error: any) {
        return reply.status(409).send({ error: error?.message || "Missing provider API key" });
      }

      const baseUrl = providerConfig.baseUrl.replace(/\/$/, "");
      const endpoint = providerConfig.endpoints.versions || providerConfig.endpoints.files;
      const rawProjectId =
        provider === "paper" ? decodeURIComponent(String(projectId)) : String(projectId);
      const encodedProjectId =
        provider === "paper"
          ? rawProjectId.split("/").map(encodeURIComponent).join("/")
          : encodeURIComponent(rawProjectId);
      const url = `${baseUrl}${endpoint.replace("{projectId}", encodedProjectId)}`;

      const response = await fetch(url, { headers });
      if (!response.ok) {
        const body = await response.text();
        return reply
          .status(response.status)
          .send({ error: `Provider error: ${body}` });
      }
      const payload = await response.json() as any;
      return reply.send({ success: true, data: payload });
    }
  );

  app.post(
    "/:serverId/plugin-manager/install",
    {
      onRequest: [app.authenticate],
      config: { rateLimit: { max: fileRateLimitMax, timeWindow: "1 minute" } },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const { provider: rawProvider, projectId, versionId, projectName } = request.body as {
        provider?: string;
        projectId?: string;
        versionId?: string | number;
        projectName?: string;
      };
      const provider = rawProvider === "spiget" ? "spigot" : rawProvider;
      const userId = request.user.userId;

      if (!provider || !projectId || !versionId) {
        return reply.status(400).send({ error: "provider, projectId, and versionId are required" });
      }

      const server = await ensureServerAccess(serverId, userId, "file.write", reply);
      if (!server) return;
      const pluginManager = ensurePluginManagerEnabled(server, reply);
      if (!pluginManager) return;
      const allowedProviders = pluginManager.providers.map((entry) =>
        entry === "spiget" ? "spigot" : entry
      );
      if (!allowedProviders.includes(provider)) {
        return reply.status(400).send({ error: "Provider not enabled for this template" });
      }

      const providerConfig = await loadPluginProviderConfig(provider);
      if (!providerConfig) {
        return reply.status(404).send({ error: "Provider not found" });
      }
      let headers: Record<string, string>;
      try {
        const settings = await getModManagerSettings();
        headers = buildProviderHeaders(providerConfig, settings);
      } catch (error: any) {
        return reply.status(409).send({ error: error?.message || "Missing provider API key" });
      }

      const baseUrl = providerConfig.baseUrl.replace(/\/$/, "");
      let downloadUrl = "";
      let filename = "";
      if (provider === "modrinth") {
        const metadataUrl = `${baseUrl}${providerConfig.endpoints.version.replace(
          "{versionId}",
          encodeURIComponent(String(versionId))
        )}`;
        const metadataResponse = await fetch(metadataUrl, { headers });
        if (!metadataResponse.ok) {
          const body = await metadataResponse.text();
          return reply
            .status(metadataResponse.status)
            .send({ error: `Provider error: ${body}` });
        }
        const metadata = await metadataResponse.json() as any;
        const files = metadata?.files ?? [];
        const file = files.find((entry: any) => entry.primary) ?? files[0];
        downloadUrl = file?.url ?? "";
        filename = file?.filename ?? "";
      } else if (provider === "spigot") {
        const resolved = await resolveSpigotDownload(baseUrl, headers, String(projectId), String(versionId));
        downloadUrl = resolved.downloadUrl;
        filename = resolved.filename;
      } else if (provider === "paper") {
        const rawProjectId = decodeURIComponent(String(projectId));
        const encodedProjectId = rawProjectId
          .split("/")
          .map(encodeURIComponent)
          .join("/");
        const metadataUrl = `${baseUrl}${providerConfig.endpoints.version
          .replace("{projectId}", encodedProjectId)
          .replace("{versionId}", encodeURIComponent(String(versionId)))}`;
        const metadataResponse = await fetch(metadataUrl, { headers });
        if (!metadataResponse.ok) {
          const body = await metadataResponse.text();
          return reply
            .status(metadataResponse.status)
            .send({ error: `Provider error: ${body}` });
        }
        const metadata = await metadataResponse.json() as any;
        const downloads = metadata?.downloads ?? {};
        const downloadEntry =
          downloads?.PAPER ||
          downloads?.paper ||
          Object.values(downloads || {})[0];
        downloadUrl = downloadEntry?.downloadUrl ?? "";
        const externalUrl = downloadEntry?.externalUrl ?? "";

        // If no direct download URL, try to resolve external URL
        if (!downloadUrl && externalUrl) {
          // Convert GitHub release page URLs to API asset download
          const ghMatch = externalUrl.match(
            /github\.com\/([^/]+)\/([^/]+)\/releases\/tags?\/([^/?#]+)/
          );
          if (ghMatch) {
            const [, owner, repo, tag] = ghMatch;
            const ghApiUrl = `https://api.github.com/repos/${owner}/${repo}/releases/tags/${tag}`;
            const ghRes = await fetch(ghApiUrl, {
              headers: { "User-Agent": "CatalystPluginManager/1.0", Accept: "application/vnd.github+json" },
            });
            if (ghRes.ok) {
              const ghData = (await ghRes.json()) as any;
              const assets = ghData?.assets ?? [];
              const jarAsset = assets.find((a: any) => a.name?.endsWith(".jar")) ?? assets[0];
              if (jarAsset?.browser_download_url) {
                downloadUrl = jarAsset.browser_download_url;
                filename = jarAsset.name;
              }
            }
          }
          if (!downloadUrl) {
            downloadUrl = externalUrl;
          }
        }

        if (!filename) {
          filename =
            downloadEntry?.fileInfo?.name ||
            metadata?.name ||
            `paper-${projectId}-${versionId}.jar`;
        }
        if (filename && !filename.endsWith(".jar")) {
          filename = `${filename}-${versionId}.jar`;
        }
      } else {
        return reply.status(400).send({ error: "Unsupported provider" });
      }

      if (!downloadUrl || !filename) {
        return reply.status(409).send({ error: "Unable to resolve download asset" });
      }

      const normalizedBase = resolveTemplatePath(pluginManager.paths?.plugins, "plugins");
      const normalizedFile = normalizeRequestPath(path.posix.join(normalizedBase, filename));

      try {
        const result = await tunnelFileOp(server.nodeId, "install-url", server.uuid, normalizedFile, { url: downloadUrl });
        if (!result.success) {
          return reply.status(400).send({ error: result.error || "Failed to install asset" });
        }
        await prisma.auditLog.create({
          data: {
            userId,
            action: "plugin_manager.install",
            resource: "server",
            resourceId: serverId,
            details: { provider, projectId, versionId, target: normalizedFile },
          },
        });
        await prisma.installedMod.upsert({
          where: { serverId_filename: { serverId, filename } },
          update: {
            provider: provider as string,
            projectId: String(projectId),
            versionId: String(versionId),
            projectName: projectName || undefined,
            type: "plugin",
            hasUpdate: false,
            latestVersionId: null,
            latestVersionName: null,
          },
          create: {
            serverId,
            filename,
            provider: provider as string,
            projectId: String(projectId),
            versionId: String(versionId),
            projectName: projectName || null,
            type: "plugin",
          },
        });
        reply.send({ success: true, data: { path: normalizedFile } });

        // Emit SSE event for plugin install completion
        const gateway = (app as any).wsGateway;
        if (gateway?.pushToAdminSubscribers) {
          gateway.pushToAdminSubscribers('plugin_install_complete', {
            serverId,
            target: normalizedFile,
            filename,
            projectName: projectName || undefined,
            timestamp: Date.now(),
          });
        }
        if (gateway?.pushToGlobalSubscribers) {
          gateway.pushToGlobalSubscribers('plugin_install_complete', {
            serverId,
            target: normalizedFile,
            filename,
            projectName: projectName || undefined,
            timestamp: Date.now(),
          });
        }
      } catch (error: any) {
        reply.status(400).send({ error: error?.message || "Failed to install asset" });
      }
    }
  );

  // List installed mods/plugins in a target directory
  app.get(
    "/:serverId/mod-manager/installed",
    {
      onRequest: [app.authenticate],
      config: { rateLimit: { max: fileRateLimitMax, timeWindow: "1 minute" } },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const { target } = request.query as { target?: string };
      const userId = request.user.userId;

      const server = await ensureServerAccess(serverId, userId, "server.read", reply);
      if (!server) return;
      const modManager = ensureModManagerEnabled(server, reply);
      if (!modManager) return;

      const targetValue = normalizeTargetValue(target) ?? "mods";
      const normalizedBase = resolveTemplatePath(modManager.paths?.[targetValue], targetValue);
      try {
        const listResult = await tunnelFileOp(server.nodeId, "list", server.uuid, normalizedBase);
        const agentEntries: any[] = listResult.success && Array.isArray(listResult.data) ? listResult.data : [];
        const dbRecords = await prisma.installedMod.findMany({
          where: { serverId },
        });
        const dbMap = new Map(dbRecords.map((record) => [record.filename, record]));
        const files = agentEntries
          .filter((entry: any) => !entry.isDirectory)
          .map((entry: any) => {
              const meta = dbMap.get(entry.name);
              return {
                name: entry.name,
                size: entry.size ?? 0,
                modifiedAt: entry.modified ?? null,
                provider: meta?.provider ?? null,
                projectId: meta?.projectId ?? null,
                versionId: meta?.versionId ?? null,
                projectName: meta?.projectName ?? null,
                hasUpdate: meta?.hasUpdate ?? false,
                latestVersionId: meta?.latestVersionId ?? null,
                latestVersionName: meta?.latestVersionName ?? null,
                updateCheckedAt: meta?.updateCheckedAt?.toISOString() ?? null,
              };
          });
        reply.send({ success: true, data: files });
      } catch {
        reply.send({ success: true, data: [] });
      }
    }
  );

  app.get(
    "/:serverId/plugin-manager/installed",
    {
      onRequest: [app.authenticate],
      config: { rateLimit: { max: fileRateLimitMax, timeWindow: "1 minute" } },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;

      const server = await ensureServerAccess(serverId, userId, "server.read", reply);
      if (!server) return;
      const pluginManager = ensurePluginManagerEnabled(server, reply);
      if (!pluginManager) return;

      const normalizedBase = resolveTemplatePath(pluginManager.paths?.plugins, "plugins");
      try {
        const listResult = await tunnelFileOp(server.nodeId, "list", server.uuid, normalizedBase);
        const agentEntries: any[] = listResult.success && Array.isArray(listResult.data) ? listResult.data : [];
        const dbRecords = await prisma.installedMod.findMany({
          where: { serverId, type: "plugin" },
        });
        const dbMap = new Map(dbRecords.map((record) => [record.filename, record]));
        const files = agentEntries
          .filter((entry: any) => !entry.isDirectory)
          .map((entry: any) => {
              const meta = dbMap.get(entry.name);
              return {
                name: entry.name,
                size: entry.size ?? 0,
                modifiedAt: entry.modified ?? null,
                provider: meta?.provider ?? null,
                projectId: meta?.projectId ?? null,
                versionId: meta?.versionId ?? null,
                projectName: meta?.projectName ?? null,
                hasUpdate: meta?.hasUpdate ?? false,
                latestVersionId: meta?.latestVersionId ?? null,
                latestVersionName: meta?.latestVersionName ?? null,
                updateCheckedAt: meta?.updateCheckedAt?.toISOString() ?? null,
              };
          });
        reply.send({ success: true, data: files });
      } catch {
        reply.send({ success: true, data: [] });
      }
    }
  );

  // Uninstall (delete) a mod from the server
  app.post(
    "/:serverId/mod-manager/uninstall",
    {
      onRequest: [app.authenticate],
      config: { rateLimit: { max: fileRateLimitMax, timeWindow: "1 minute" } },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const { filename, target } = request.body as { filename?: string; target?: string };
      const userId = request.user.userId;

      if (!filename) {
        return reply.status(400).send({ error: "filename is required" });
      }

      const server = await ensureServerAccess(serverId, userId, "file.write", reply);
      if (!server) return;
      const modManager = ensureModManagerEnabled(server, reply);
      if (!modManager) return;

      const targetValue = normalizeTargetValue(target) ?? "mods";
      const normalizedBase = resolveTemplatePath(modManager.paths?.[targetValue], targetValue);
      const safeName = sanitizeFilename(filename);
      const normalizedFile = normalizeRequestPath(path.posix.join(normalizedBase, safeName));

      try {
        const result = await tunnelFileOp(server.nodeId, "delete", server.uuid, normalizedFile);
        if (!result.success) {
          return reply.status(400).send({ error: result.error || "Failed to uninstall mod" });
        }
        await prisma.installedMod.deleteMany({ where: { serverId, filename: safeName } });
        await prisma.auditLog.create({
          data: {
            userId,
            action: "mod_manager.uninstall",
            resource: "server",
            resourceId: serverId,
            details: { filename: safeName, target: targetValue },
          },
        });
        reply.send({ success: true });

        // Emit SSE event for mod uninstall completion
        const gateway = (app as any).wsGateway;
        if (gateway?.pushToAdminSubscribers) {
          gateway.pushToAdminSubscribers('mod_uninstall_complete', {
            serverId,
            target: targetValue,
            filename: safeName,
            timestamp: Date.now(),
          });
        }
        if (gateway?.pushToGlobalSubscribers) {
          gateway.pushToGlobalSubscribers('mod_uninstall_complete', {
            serverId,
            target: targetValue,
            filename: safeName,
            timestamp: Date.now(),
          });
        }
      } catch (error: any) {
        reply.status(400).send({ error: error?.message || "Failed to uninstall mod" });
      }
    }
  );

  // Uninstall (delete) a plugin from the server
  app.post(
    "/:serverId/plugin-manager/uninstall",
    {
      onRequest: [app.authenticate],
      config: { rateLimit: { max: fileRateLimitMax, timeWindow: "1 minute" } },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const { filename } = request.body as { filename?: string };
      const userId = request.user.userId;

      if (!filename) {
        return reply.status(400).send({ error: "filename is required" });
      }

      const server = await ensureServerAccess(serverId, userId, "file.write", reply);
      if (!server) return;
      const pluginManager = ensurePluginManagerEnabled(server, reply);
      if (!pluginManager) return;

      const normalizedBase = resolveTemplatePath(pluginManager.paths?.plugins, "plugins");
      const safeName = sanitizeFilename(filename);
      const normalizedFile = normalizeRequestPath(path.posix.join(normalizedBase, safeName));

      try {
        const result = await tunnelFileOp(server.nodeId, "delete", server.uuid, normalizedFile);
        if (!result.success) {
          return reply.status(400).send({ error: result.error || "Failed to uninstall plugin" });
        }
        await prisma.installedMod.deleteMany({ where: { serverId, filename: safeName } });
        await prisma.auditLog.create({
          data: {
            userId,
            action: "plugin_manager.uninstall",
            resource: "server",
            resourceId: serverId,
            details: { filename: safeName },
          },
        });
        reply.send({ success: true });

        // Emit SSE event for plugin uninstall completion
        const gateway = (app as any).wsGateway;
        if (gateway?.pushToAdminSubscribers) {
          gateway.pushToAdminSubscribers('plugin_uninstall_complete', {
            serverId,
            filename: safeName,
            timestamp: Date.now(),
          });
        }
        if (gateway?.pushToGlobalSubscribers) {
          gateway.pushToGlobalSubscribers('plugin_uninstall_complete', {
            serverId,
            filename: safeName,
            timestamp: Date.now(),
          });
        }
      } catch (error: any) {
        reply.status(400).send({ error: error?.message || "Failed to uninstall plugin" });
      }
    }
  );

  // Check for updates on installed mods
  app.post(
    "/:serverId/mod-manager/check-updates",
    {
      onRequest: [app.authenticate],
      config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;

      const server = await ensureServerAccess(serverId, userId, "server.read", reply);
      if (!server) return;
      const modManager = ensureModManagerEnabled(server, reply);
      if (!modManager) return;

      const records = await prisma.installedMod.findMany({
        where: { serverId, type: { in: ["mod", "datapack", "modpack"] } },
      });
      if (!records.length) {
        return reply.send({ success: true, data: { checked: 0, updatesAvailable: 0 } });
      }

      let settings: any;
      try {
        settings = await getModManagerSettings();
      } catch (error: any) {
        return reply.status(409).send({ error: error?.message || "Missing provider API key" });
      }

      let updatesAvailable = 0;
      for (const record of records) {
        try {
          const providerConfig = await loadProviderConfig(record.provider);
          if (!providerConfig) continue;
          const headers = buildProviderHeaders(providerConfig, settings);
          const baseUrl = providerConfig.baseUrl.replace(/\/$/, "");
          const endpoint = providerConfig.endpoints.versions || providerConfig.endpoints.files;
          if (!endpoint) continue;
          const encodedProjectId =
            record.provider === "paper"
              ? String(record.projectId).split("/").map(encodeURIComponent).join("/")
              : encodeURIComponent(record.projectId);
          const url = `${baseUrl}${endpoint.replace("{projectId}", encodedProjectId)}`;
          const response = await fetch(url, { headers });
          if (!response.ok) continue;
          const payload = (await response.json()) as any;

          let latestVersionId: string | null = null;
          let latestVersionName: string | null = null;

          if (record.provider === "modrinth") {
            const versions = Array.isArray(payload) ? payload : [];
            // Resolve server game version for filtering
            const serverGameVer = extractGameVersion(server.environment);
            const resolvedGameVer = serverGameVer
              ? await resolveModrinthGameVersion(serverGameVer, baseUrl, headers)
              : null;
            // Filter versions matching the server's game version
            const matching = resolvedGameVer
              ? versions.filter((v: any) =>
                  Array.isArray(v.game_versions) &&
                  v.game_versions.some((gv: string) => gv === resolvedGameVer || gv.startsWith(`${resolvedGameVer  }.`))
                )
              : versions;
            // Prefer release versions, then most recent by date
            const releases = matching.filter((v: any) => v.version_type === "release");
            const candidates = releases.length ? releases : matching;
            const latest = candidates[0];
            if (latest) {
              latestVersionId = latest.id;
              latestVersionName = latest.version_number ?? latest.name ?? null;
            }
          } else if (record.provider === "curseforge") {
            const files = Array.isArray(payload?.data) ? payload.data : [];
            const latest = files[0];
            if (latest) {
              latestVersionId = String(latest.id);
              latestVersionName = latest.displayName ?? latest.fileName ?? null;
            }
          } else if (record.provider === "paper") {
            const versions = Array.isArray(payload?.result) ? payload.result : (Array.isArray(payload) ? payload : []);
            const latest = versions[0];
            if (latest) {
              latestVersionId = latest.name ?? String(latest.id ?? "");
              latestVersionName = latest.name ?? null;
            }
          } else if (record.provider === "spigot") {
            const versions = Array.isArray(payload) ? payload : [];
            const latest = versions[0];
            if (latest) {
              latestVersionId = String(latest.id);
              latestVersionName = latest.name ?? null;
            }
          }

          const hasUpdate = latestVersionId !== null && latestVersionId !== record.versionId;
          if (hasUpdate) updatesAvailable++;

          await prisma.installedMod.update({
            where: { id: record.id },
            data: {
              latestVersionId,
              latestVersionName,
              hasUpdate,
              updateCheckedAt: new Date(),
            },
          });
        } catch {
          // Skip failed checks for individual mods
        }
      }

      reply.send({ success: true, data: { checked: records.length, updatesAvailable } });
    }
  );

  // Check for updates on installed plugins
  app.post(
    "/:serverId/plugin-manager/check-updates",
    {
      onRequest: [app.authenticate],
      config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;

      const server = await ensureServerAccess(serverId, userId, "server.read", reply);
      if (!server) return;
      const pluginManager = ensurePluginManagerEnabled(server, reply);
      if (!pluginManager) return;

      const records = await prisma.installedMod.findMany({
        where: { serverId, type: "plugin" },
      });
      if (!records.length) {
        return reply.send({ success: true, data: { checked: 0, updatesAvailable: 0 } });
      }

      let settings: any;
      try {
        settings = await getModManagerSettings();
      } catch (error: any) {
        return reply.status(409).send({ error: error?.message || "Missing provider API key" });
      }

      let updatesAvailable = 0;
      for (const record of records) {
        try {
          const providerConfig = await loadPluginProviderConfig(record.provider);
          if (!providerConfig) continue;
          const headers = buildProviderHeaders(providerConfig, settings);
          const baseUrl = providerConfig.baseUrl.replace(/\/$/, "");
          const endpoint = providerConfig.endpoints.versions || providerConfig.endpoints.files;
          if (!endpoint) continue;
          const encodedProjectId = encodeURIComponent(record.projectId);
          const url = `${baseUrl}${endpoint.replace("{projectId}", encodedProjectId)}`;
          const response = await fetch(url, { headers });
          if (!response.ok) continue;
          const payload = (await response.json()) as any;

          let latestVersionId: string | null = null;
          let latestVersionName: string | null = null;

          if (record.provider === "modrinth") {
            const versions = Array.isArray(payload) ? payload : [];
            // Resolve server game version for filtering
            const serverGameVer = extractGameVersion(server.environment);
            const resolvedGameVer = serverGameVer
              ? await resolveModrinthGameVersion(serverGameVer, baseUrl, headers)
              : null;
            // Filter versions matching the server's game version
            const matching = resolvedGameVer
              ? versions.filter((v: any) =>
                  Array.isArray(v.game_versions) &&
                  v.game_versions.some((gv: string) => gv === resolvedGameVer || gv.startsWith(`${resolvedGameVer  }.`))
                )
              : versions;
            // Prefer release versions, then most recent by date
            const releases = matching.filter((v: any) => v.version_type === "release");
            const candidates = releases.length ? releases : matching;
            const latest = candidates[0];
            if (latest) {
              latestVersionId = latest.id;
              latestVersionName = latest.version_number ?? latest.name ?? null;
            }
          } else if (record.provider === "paper") {
            const versions = Array.isArray(payload?.result) ? payload.result : (Array.isArray(payload) ? payload : []);
            const latest = versions[0];
            if (latest) {
              latestVersionId = latest.name ?? String(latest.id ?? "");
              latestVersionName = latest.name ?? null;
            }
          } else if (record.provider === "spigot") {
            const versions = Array.isArray(payload) ? payload : [];
            const latest = versions[0];
            if (latest) {
              latestVersionId = String(latest.id);
              latestVersionName = latest.name ?? null;
            }
          }

          const hasUpdate = latestVersionId !== null && latestVersionId !== record.versionId;
          if (hasUpdate) updatesAvailable++;

          await prisma.installedMod.update({
            where: { id: record.id },
            data: {
              latestVersionId,
              latestVersionName,
              hasUpdate,
              updateCheckedAt: new Date(),
            },
          });
        } catch {
          // Skip failed checks
        }
      }

      reply.send({ success: true, data: { checked: records.length, updatesAvailable } });
    }
  );

  // Update a specific mod to its latest version
  app.post(
    "/:serverId/mod-manager/update",
    {
      onRequest: [app.authenticate],
      config: { rateLimit: { max: fileRateLimitMax, timeWindow: "1 minute" } },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const { filenames } = request.body as { filenames?: string[] };
      const userId = request.user.userId;

      if (!filenames?.length) {
        return reply.status(400).send({ error: "filenames array is required" });
      }

      const server = await ensureServerAccess(serverId, userId, "file.write", reply);
      if (!server) return;
      const modManager = ensureModManagerEnabled(server, reply);
      if (!modManager) return;

      let settings: any;
      try {
        settings = await getModManagerSettings();
      } catch (error: any) {
        return reply.status(409).send({ error: error?.message || "Missing provider API key" });
      }

      const results: { filename: string; success: boolean; error?: string }[] = [];

      for (const filename of filenames) {
        try {
          const record = await prisma.installedMod.findFirst({
            where: { serverId, filename, type: { in: ["mod", "datapack", "modpack"] } },
          });
          if (!record || !record.latestVersionId) {
            results.push({ filename, success: false, error: "No update info available" });
            continue;
          }

          const providerConfig = await loadProviderConfig(record.provider);
          if (!providerConfig) {
            results.push({ filename, success: false, error: "Provider not found" });
            continue;
          }
          const headers = buildProviderHeaders(providerConfig, settings);
          const baseUrl = providerConfig.baseUrl.replace(/\/$/, "");

          let downloadUrl = "";
          let newFilename = "";

          if (record.provider === "modrinth") {
            const versionEndpoint = providerConfig.endpoints.version || "/v2/version/{versionId}";
            const vUrl = `${baseUrl}${versionEndpoint.replace("{versionId}", encodeURIComponent(record.latestVersionId))}`;
            const vRes = await fetch(vUrl, { headers });
            if (!vRes.ok) throw new Error("Failed to fetch version info");
            const vData = (await vRes.json()) as any;
            const file = vData.files?.[0];
            if (file) {
              downloadUrl = file.url;
              newFilename = file.filename;
            }
          } else if (record.provider === "curseforge") {
            const fileEndpoint = providerConfig.endpoints.file || "/v1/mods/{projectId}/files/{fileId}";
            const fUrl = `${baseUrl}${fileEndpoint.replace("{projectId}", encodeURIComponent(record.projectId)).replace("{fileId}", encodeURIComponent(record.latestVersionId))}`;
            const fRes = await fetch(fUrl, { headers });
            if (!fRes.ok) throw new Error("Failed to fetch file info");
            const fData = (await fRes.json()) as any;
            downloadUrl = fData.data?.downloadUrl ?? "";
            newFilename = fData.data?.fileName ?? "";
          } else if (record.provider === "paper") {
            const resolved = await resolvePaperDownload(baseUrl, headers, record.projectId, record.latestVersionId);
            downloadUrl = resolved.downloadUrl;
            newFilename = resolved.filename;
          } else if (record.provider === "spigot") {
            const resolved = await resolveSpigotDownload(baseUrl, headers, record.projectId, record.latestVersionId);
            downloadUrl = resolved.downloadUrl;
            newFilename = resolved.filename;
          }

          if (!downloadUrl || !newFilename) {
            results.push({ filename, success: false, error: "Could not resolve download" });
            continue;
          }

          // Determine target directory from type
          const targetValue = record.type === "datapack" ? "datapacks" : record.type === "modpack" ? "modpacks" : "mods";
          const normalizedBase = resolveTemplatePath(modManager.paths?.[targetValue], targetValue);

          // Delete old file via tunnel
          try {
            const oldFile = normalizeRequestPath(path.posix.join(normalizedBase, record.filename));
            await tunnelFileOp(server.nodeId, "delete", server.uuid, oldFile);
          } catch {
            // Best-effort cleanup before writing the new file.
          }

          // Download new file via tunnel
          const normalizedFile = normalizeRequestPath(path.posix.join(normalizedBase, newFilename));
          const installResult = await tunnelFileOp(server.nodeId, "install-url", server.uuid, normalizedFile, { url: downloadUrl });
          if (!installResult.success) throw new Error(installResult.error || "Download failed");

          // Update DB record
          await prisma.installedMod.update({
            where: { id: record.id },
            data: {
              filename: newFilename,
              versionId: record.latestVersionId,
              hasUpdate: false,
              latestVersionId: null,
              latestVersionName: null,
            },
          });

          results.push({ filename, success: true });
        } catch (error: any) {
          results.push({ filename, success: false, error: error?.message || "Update failed" });
        }
      }

      reply.send({ success: true, data: results });

      // Emit SSE event for mod update completion
      const gateway = (app as any).wsGateway;
      if (gateway?.pushToAdminSubscribers) {
        gateway.pushToAdminSubscribers('mod_update_complete', {
          serverId,
          results: results.map((r: { filename: string; success: boolean }) => ({ filename: r.filename, success: r.success })),
          timestamp: Date.now(),
        });
      }
      if (gateway?.pushToGlobalSubscribers) {
        gateway.pushToGlobalSubscribers('mod_update_complete', {
          serverId,
          results: results.map((r: { filename: string; success: boolean }) => ({ filename: r.filename, success: r.success })),
          timestamp: Date.now(),
        });
      }
    }
  );

  // Update a specific plugin to its latest version
  app.post(
    "/:serverId/plugin-manager/update",
    {
      onRequest: [app.authenticate],
      config: { rateLimit: { max: fileRateLimitMax, timeWindow: "1 minute" } },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const { filenames } = request.body as { filenames?: string[] };
      const userId = request.user.userId;

      if (!filenames?.length) {
        return reply.status(400).send({ error: "filenames array is required" });
      }

      const server = await ensureServerAccess(serverId, userId, "file.write", reply);
      if (!server) return;
      const pluginManager = ensurePluginManagerEnabled(server, reply);
      if (!pluginManager) return;

      let settings: any;
      try {
        settings = await getModManagerSettings();
      } catch (error: any) {
        return reply.status(409).send({ error: error?.message || "Missing provider API key" });
      }

      const normalizedBase = resolveTemplatePath(pluginManager.paths?.plugins, "plugins");
      const results: { filename: string; success: boolean; error?: string }[] = [];

      for (const filename of filenames) {
        try {
          const record = await prisma.installedMod.findFirst({
            where: { serverId, filename, type: "plugin" },
          });
          if (!record || !record.latestVersionId) {
            results.push({ filename, success: false, error: "No update info available" });
            continue;
          }

          const providerConfig = await loadPluginProviderConfig(record.provider);
          if (!providerConfig) {
            results.push({ filename, success: false, error: "Provider not found" });
            continue;
          }
          const headers = buildProviderHeaders(providerConfig, settings);
          const baseUrl = providerConfig.baseUrl.replace(/\/$/, "");

          let downloadUrl = "";
          let newFilename = "";

          if (record.provider === "modrinth") {
            const versionEndpoint = providerConfig.endpoints.version || "/v2/version/{versionId}";
            const vUrl = `${baseUrl}${versionEndpoint.replace("{versionId}", encodeURIComponent(record.latestVersionId))}`;
            const vRes = await fetch(vUrl, { headers });
            if (!vRes.ok) throw new Error("Failed to fetch version info");
            const vData = (await vRes.json()) as any;
            const file = vData.files?.[0];
            if (file) {
              downloadUrl = file.url;
              newFilename = file.filename;
            }
          } else if (record.provider === "paper") {
            const resolved = await resolvePaperDownload(baseUrl, headers, record.projectId, record.latestVersionId);
            downloadUrl = resolved.downloadUrl;
            newFilename = resolved.filename;
          } else if (record.provider === "spigot") {
            const resolved = await resolveSpigotDownload(baseUrl, headers, record.projectId, record.latestVersionId);
            downloadUrl = resolved.downloadUrl;
            newFilename = resolved.filename;
          }

          if (!downloadUrl || !newFilename) {
            results.push({ filename, success: false, error: "Could not resolve download" });
            continue;
          }

          // Delete old file via tunnel
          try {
            const oldFile = normalizeRequestPath(path.posix.join(normalizedBase, record.filename));
            await tunnelFileOp(server.nodeId, "delete", server.uuid, oldFile);
          } catch {
            // Best-effort cleanup before writing the new file.
          }

          // Download new file via tunnel
          const normalizedFile = normalizeRequestPath(path.posix.join(normalizedBase, newFilename));
          const installResult = await tunnelFileOp(server.nodeId, "install-url", server.uuid, normalizedFile, { url: downloadUrl });
          if (!installResult.success) throw new Error(installResult.error || "Download failed");

          // Update DB record
          await prisma.installedMod.update({
            where: { id: record.id },
            data: {
              filename: newFilename,
              versionId: record.latestVersionId,
              hasUpdate: false,
              latestVersionId: null,
              latestVersionName: null,
            },
          });

          results.push({ filename, success: true });
        } catch (error: any) {
          results.push({ filename, success: false, error: error?.message || "Update failed" });
        }
      }

      // Broadcast plugin_update_complete event
      const wsGatewayPluginUpdate = (app as any).wsGateway;
      if (wsGatewayPluginUpdate?.pushToAdminSubscribers) {
        wsGatewayPluginUpdate.pushToAdminSubscribers('plugin_update_complete', {
          type: 'plugin_update_complete',
          serverId,
          updatedBy: userId,
          timestamp: new Date().toISOString(),
        });
      }
      if (wsGatewayPluginUpdate?.pushToGlobalSubscribers) {
        wsGatewayPluginUpdate.pushToGlobalSubscribers('plugin_update_complete', {
          type: 'plugin_update_complete',
          serverId,
          updatedBy: userId,
          timestamp: new Date().toISOString(),
        });
      }

      reply.send({ success: true, data: results });
    }
  );

  // Download server file
}
