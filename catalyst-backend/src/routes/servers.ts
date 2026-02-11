import { prisma } from '../db.js';
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { PrismaClient } from "@prisma/client";
import { serialize } from '../utils/serialize';
import { v4 as uuidv4 } from "uuid";
import { randomBytes } from "crypto";
import { decryptBackupConfig, encryptBackupConfig, redactBackupConfig } from "../services/backup-credentials";
import { ServerStateMachine } from "../services/state-machine";
import { ServerState } from "../shared-types";
import { createWriteStream } from "fs";
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execFile } from "child_process";
import { promisify } from "util";
import type { Readable } from "stream";
import { pipeline } from "stream/promises";
import { nanoid } from "nanoid";
import { auth } from "../auth";
import {
  allocateIpForServer,
  releaseIpForServer,
  normalizeHostIp,
  shouldUseIpam,
} from "../utils/ipam";
import {
  hasNodeAccess,
  getUserAccessibleNodes,
} from "../lib/permissions";
import {
  DatabaseProvisioningError,
  dropDatabase,
  provisionDatabase,
  rotateDatabasePassword,
} from "../services/mysql";
import {
  getModManagerSettings,
  getSecuritySettings,
  renderInviteEmail,
  sendEmail,
} from "../services/mailer";

const MAX_PORT = 65535;
const INVITE_EXPIRY_DAYS = 7;
const DEFAULT_PERMISSION_PRESETS = {
  readOnly: [
    "server.read",
    "alert.read",
    "console.read",
    "file.read",
    "database.read",
  ],
  power: [
    "server.read",
    "server.start",
    "server.stop",
    "server.install",
    "alert.read",
    "alert.create",
    "alert.update",
    "console.read",
    "console.write",
    "file.read",
    "file.write",
    "database.read",
    "database.create",
    "database.rotate",
    "database.delete",
  ],
  full: [
    "server.read",
    "server.start",
    "server.stop",
    "server.install",
    "server.transfer",
    "alert.read",
    "alert.create",
    "alert.update",
    "alert.delete",
    "console.read",
    "console.write",
    "file.read",
    "file.write",
    "database.read",
    "database.create",
    "database.rotate",
    "database.delete",
    "server.delete",
  ],
};

const parsePortValue = (value: unknown) => {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(parsed)) return null;
  const port = Number(parsed);
  if (!Number.isInteger(port) || port <= 0 || port > MAX_PORT) {
    return null;
  }
  return port;
};

const parseStoredPortBindings = (value: unknown): Record<number, number> => {
  if (!value || typeof value !== "object") {
    return {};
  }
  const bindings: Record<number, number> = {};
  for (const [containerKey, hostValue] of Object.entries(value as Record<string, unknown>)) {
    const containerPort = parsePortValue(containerKey);
    const hostPort = parsePortValue(hostValue);
    if (!containerPort || !hostPort) {
      continue;
    }
    bindings[containerPort] = hostPort;
  }
  return bindings;
};

const normalizePortBindings = (value: unknown, primaryPort: number) => {
  const bindings: Record<number, number> = {};
  const usedHostPorts = new Set<number>();

  if (value && typeof value === "object") {
    for (const [containerKey, hostValue] of Object.entries(value as Record<string, unknown>)) {
      const containerPort = parsePortValue(containerKey);
      const hostPort = parsePortValue(hostValue);
      if (!containerPort || !hostPort) {
        throw new Error("Invalid port binding value");
      }
      if (usedHostPorts.has(hostPort)) {
        throw new Error(`Host port ${hostPort} appears multiple times in port bindings`);
      }
      usedHostPorts.add(hostPort);
      bindings[containerPort] = hostPort;
    }
  }

  const primaryHostPort = bindings[primaryPort];
  if (!primaryHostPort) {
    bindings[primaryPort] = primaryPort;
  }

  return bindings;
};

const WILDCARD_HOST = "*";

const collectUsedHostPortsByIp = (
  servers: Array<{
    id: string;
    primaryPort?: number | null;
    primaryIp?: string | null;
    portBindings?: unknown;
    networkMode?: string | null;
  }>,
  excludeId?: string
) => {
  const used = new Map<string, Set<number>>();
  for (const server of servers) {
    if (excludeId && server.id === excludeId) {
      continue;
    }
    if (shouldUseIpam(server.networkMode ?? undefined)) {
      continue;
    }
    if (server.networkMode === "host") {
      continue;
    }
    const hostKey = server.primaryIp || WILDCARD_HOST;
    const bindings = parseStoredPortBindings(server.portBindings);
    const hostPorts = Object.values(bindings);
    const ports =
      hostPorts.length > 0
        ? hostPorts
        : parsePortValue(server.primaryPort ?? undefined)
          ? [parsePortValue(server.primaryPort ?? undefined) as number]
          : [];
    if (ports.length === 0) {
      continue;
    }
    const bucket = used.get(hostKey) ?? new Set<number>();
    ports.forEach((port) => bucket.add(port));
    used.set(hostKey, bucket);
  }
  return used;
};

const findPortConflict = (
  usage: Map<string, Set<number>>,
  hostIp: string | null,
  ports: number[]
) => {
  if (!ports.length) return null;
  const key = hostIp || WILDCARD_HOST;
  if (key === WILDCARD_HOST) {
    for (const port of ports) {
      for (const bucket of usage.values()) {
        if (bucket.has(port)) {
          return port;
        }
      }
    }
    return null;
  }
  const hostBucket = usage.get(key);
  const wildcardBucket = usage.get(WILDCARD_HOST);
  return (
    ports.find((port) => hostBucket?.has(port) || wildcardBucket?.has(port)) ?? null
  );
};

const resolvePrimaryHostPort = (server: any) => {
  const primaryPort = parsePortValue(server?.primaryPort ?? undefined);
  if (!primaryPort) return null;
  const bindings = parseStoredPortBindings(server?.portBindings);
  return bindings[primaryPort] ?? primaryPort;
};

const resolveHostNetworkIp = (server: any, fallbackNode?: { publicAddress?: string }) => {
  if (server?.networkMode !== "host") {
    return null;
  }
  if (typeof server?.environment?.CATALYST_NETWORK_IP === "string") {
    try {
      return normalizeHostIp(server.environment.CATALYST_NETWORK_IP);
    } catch {
      return null;
    }
  }
  const candidate = fallbackNode?.publicAddress ?? server?.node?.publicAddress ?? null;
  if (!candidate) return null;
  try {
    return normalizeHostIp(candidate);
  } catch {
    return null;
  }
};

const buildConnectionInfo = (
  server: any,
  fallbackNode?: { publicAddress?: string }
) => {
  const assignedIp = server.primaryIp ?? null;
  const nodeIp = fallbackNode?.publicAddress ?? server.node?.publicAddress ?? null;
  const hostNetworkIp = resolveHostNetworkIp(server, fallbackNode);
  const host = assignedIp || hostNetworkIp || nodeIp || null;

  return {
    assignedIp,
    nodeIp,
    hostNetworkIp,
    host,
    port: resolvePrimaryHostPort(server),
  };
};

const isHytaleTemplate = (template: any) => {
  const name = typeof template?.name === "string" ? template.name : "";
  const image = typeof template?.image === "string" ? template.image : "";
  const startup = typeof template?.startup === "string" ? template.startup : "";
  const installScript =
    typeof template?.installScript === "string" ? template.installScript : "";

  return (
    /hytale/i.test(name) ||
    /hytale/i.test(image) ||
    startup.includes("HytaleServer.jar") ||
    installScript.includes("hytale-downloader")
  );
};

const patchTemplateForRuntime = (template: any) => {
  if (!template || !isHytaleTemplate(template)) {
    return template;
  }

  const patched = { ...template } as any;
  const defaultHytaleModManager = {
    targets: ["mods"],
    providers: [
      {
        id: "curseforge",
        label: "CurseForge (Hytale)",
        game: "hytale",
        targets: ["mods"],
        curseforge: {
          gameSlug: "hytale",
          classSlugs: {
            mods: "mods",
          },
        },
      },
    ],
    paths: {
      mods: "/mods",
    },
  };

  if (typeof patched.installScript === "string") {
    patched.installScript = patched.installScript
      .replace(
        /unzip -o -DD "\$DOWNLOAD_ZIP" -d \{\{SERVER_DIR\}\}/g,
        'unzip -o "$DOWNLOAD_ZIP" -d {{SERVER_DIR}}'
      )
      .replace(
        /unzip -o -DD \$DOWNLOAD_ZIP -d \{\{SERVER_DIR\}\}/g,
        'unzip -o "$DOWNLOAD_ZIP" -d {{SERVER_DIR}}'
      );

    if (!patched.installScript.includes("chown -R 1001:1001 {{SERVER_DIR}}")) {
      patched.installScript = patched.installScript.replace(
        /\necho '\[Catalyst\] Hytale installation complete!'\n?$/,
        "\n\necho '[Catalyst] Fixing file ownership for runtime user...'\nchown -R 1001:1001 {{SERVER_DIR}}\nchmod -R u+rwX {{SERVER_DIR}}\n\necho '[Catalyst] Hytale installation complete!'\n"
      );
    }
  }

  if (
    typeof patched.startup === "string" &&
    /-XX:AOTCache(?:=|\b)/.test(patched.startup)
  ) {
    patched.startup = patched.startup
      .replace(/\s+-Xshare:(?:on|auto|off|dump)\b/g, "")
      .replace(/\s+-XX:DumpLoadedClassList(?:=\S+)?/g, "")
      .replace(/\s+-XX:SharedClassListFile(?:=\S+)?/g, "")
      .replace(/\s+-XX:SharedArchiveFile(?:=\S+)?/g, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  const existingFeatures =
    patched.features && typeof patched.features === "object" ? patched.features : {};
  const existingModManager = existingFeatures.modManager;
  const hasModManagerProviders =
    existingModManager &&
    typeof existingModManager === "object" &&
    Array.isArray(existingModManager.providers) &&
    existingModManager.providers.length > 0;
  if (!hasModManagerProviders) {
    patched.features = {
      ...existingFeatures,
      modManager: defaultHytaleModManager,
    };
  }

  return patched;
};

  const withConnectionInfo = (server: any, fallbackNode?: { publicAddress?: string }) => ({
    ...server,
    backupS3Config: redactBackupConfig(decryptBackupConfig(server.backupS3Config)),
    backupSftpConfig: redactBackupConfig(decryptBackupConfig(server.backupSftpConfig)),
    connection: buildConnectionInfo(server, fallbackNode),
  });

export async function serverRoutes(app: FastifyInstance) {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  // Using shared prisma instance from db.ts
  const execFileAsync = promisify(execFile);
  const serverDataRoot = process.env.SERVER_DATA_PATH || "/var/lib/catalyst/servers";
  let fileRateLimitMax = 30;
  let maxBufferBytes = 50 * 1024 * 1024;
  const modManagerProviders = new Map<string, string>(
    [
      ["curseforge", path.resolve(__dirname, "../mod-manager/curseforge.json")],
      ["modrinth", path.resolve(__dirname, "../mod-manager/modrinth.json")],
    ] as const
  );
  const pluginManagerProviders = new Map<string, string>(
    [
      ["modrinth", path.resolve(__dirname, "../mod-manager/modrinth.json")],
      ["spigot", path.resolve(__dirname, "../mod-manager/spigot.json")],
      ["spiget", path.resolve(__dirname, "../mod-manager/spigot.json")],
      ["paper", path.resolve(__dirname, "../mod-manager/paper.json")],
    ] as const
  );

  try {
    const settings = await getSecuritySettings();
    fileRateLimitMax = settings.fileRateLimitMax;
    maxBufferBytes = (settings.maxBufferMb ?? 50) * 1024 * 1024;
  } catch (error) {
    console.warn("Failed to load security settings for file rate limits");
  }

  const isMaxBufferError = (error: any): boolean =>
    error?.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" ||
    (error?.message && String(error.message).includes("maxBuffer length exceeded"));

  const maxBufferErrorResponse = () => {
    const currentMb = Math.round(maxBufferBytes / (1024 * 1024));
    return {
      error: "Output buffer limit exceeded",
      code: "MAX_BUFFER_EXCEEDED",
      currentMaxBufferMb: currentMb,
      recommendedMaxBufferMb: Math.max(currentMb * 2, 100),
    };
  };

  const normalizeRequestPath = (value?: string) => {
    if (!value) return "/";
    const cleaned = value.replace(/\\/g, "/").trim();
    if (!cleaned || cleaned === ".") return "/";
    const parts = cleaned.split("/").filter(Boolean);
    return `/${parts.join("/")}`;
  };

  // File tunnel service for proxying file operations to agents
  const fileTunnel = (app as any).fileTunnel as import("../services/file-tunnel").FileTunnelService;

  /** Send a file operation to the agent via the HTTP file tunnel and return the response. */
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

  const resolveTemplateImage = (
    template: { image: string; images?: any; defaultImage?: string | null },
    environment: Record<string, string>
  ) => {
    const options = Array.isArray(template.images) ? template.images : [];
    if (!options.length) return template.image;
    const requested = environment.IMAGE_VARIANT;
    if (requested) {
      const match = options.find((option) => option?.name === requested);
      if (match?.image) {
        return match.image;
      }
    }
    if (template.defaultImage) {
      const defaultMatch = options.find((option) => option?.image === template.defaultImage);
      if (defaultMatch?.image) {
        return defaultMatch.image;
      }
      return template.defaultImage;
    }
    return template.image;
  };

  const ensureServerAccess = async (
    serverId: string,
    userId: string,
    permission: string,
    reply: FastifyReply
  ) => {
    const server = await prisma.server.findUnique({
      where: { id: serverId },
      include: { template: true },
    });
    if (!server) {
      reply.status(404).send({ error: "Server not found" });
      return null;
    }
    if (!ensureNotSuspended(server, reply)) {
      return null;
    }
    if (server.ownerId !== userId) {
      const access = await prisma.serverAccess.findFirst({
        where: {
          serverId,
          userId,
          permissions: { has: permission },
        },
      });
      const hasNodeAccessToServer = await hasNodeAccess(prisma, userId, server.nodeId);
      if (!access && !hasNodeAccessToServer) {
        reply.status(403).send({ error: "Forbidden" });
        return null;
      }
    }
    return server;
  };

  const loadProviderConfig = async (provider: string) => {
    const configPath = modManagerProviders.get(provider);
    if (!configPath) {
      return null;
    }
    const raw = await fs.readFile(configPath, "utf8");
    return JSON.parse(raw) as {
      id: string;
      name: string;
      baseUrl: string;
      headers: Record<string, string>;
      endpoints: Record<string, string>;
    };
  };
  const loadPluginProviderConfig = async (provider: string) => {
    const configPath = pluginManagerProviders.get(provider);
    if (!configPath) {
      return null;
    }
    const raw = await fs.readFile(configPath, "utf8");
    return JSON.parse(raw) as {
      id: string;
      name: string;
      baseUrl: string;
      headers: Record<string, string>;
      endpoints: Record<string, string>;
    };
  };

  const buildProviderHeaders = (providerConfig: {
    headers: Record<string, string>;
  }, settings: { curseforgeApiKey: string | null; modrinthApiKey: string | null }) => {
    const headers: Record<string, string> = {};
    Object.entries(providerConfig.headers || {}).forEach(([key, value]) => {
      if (value.includes("{{CURSEFORGE_API_KEY}}")) {
        if (!settings.curseforgeApiKey) {
          throw new Error("CurseForge API key not configured");
        }
        headers[key] = value.replace("{{CURSEFORGE_API_KEY}}", settings.curseforgeApiKey);
      } else if (value.includes("{{MODRINTH_API_KEY}}")) {
        if (!settings.modrinthApiKey) {
          throw new Error("Modrinth API key not configured");
        }
        headers[key] = value.replace("{{MODRINTH_API_KEY}}", settings.modrinthApiKey);
      } else {
        headers[key] = value;
      }
    });
    return headers;
  };

  type ModManagerTarget = "mods" | "datapacks" | "modpacks";
  type NormalizedModManagerProvider = {
    id: string;
    label?: string;
    game?: string;
    targets?: ModManagerTarget[];
    curseforge?: {
      gameId?: string;
      gameSlug?: string;
      classIds?: Partial<Record<ModManagerTarget, string>>;
      classSlugs?: Partial<Record<ModManagerTarget, string>>;
      modLoaderMap?: Record<string, string>;
    };
  };
  type NormalizedModManager = {
    providers: NormalizedModManagerProvider[];
    paths?: { mods?: string; datapacks?: string; modpacks?: string };
    targets?: ModManagerTarget[];
  };

  const modManagerDefaultTargets: ModManagerTarget[] = ["mods", "datapacks", "modpacks"];
  const curseforgeGameIdCache = new Map<string, string>();
  const curseforgeClassIdCache = new Map<string, string>();

  const normalizeTargetValue = (value: unknown): ModManagerTarget | null => {
    if (typeof value !== "string") return null;
    const normalized = value.trim().toLowerCase();
    if (normalized === "mods" || normalized === "datapacks" || normalized === "modpacks") {
      return normalized;
    }
    return null;
  };

  const normalizeTargetList = (value: unknown): ModManagerTarget[] => {
    if (!Array.isArray(value)) return [];
    const normalized = value
      .map((entry) => normalizeTargetValue(entry))
      .filter((entry): entry is ModManagerTarget => Boolean(entry));
    return Array.from(new Set(normalized));
  };

  const normalizeCurseforgeIdMap = (
    value: unknown
  ): Partial<Record<ModManagerTarget, string>> | undefined => {
    if (!value || typeof value !== "object") return undefined;
    const next: Partial<Record<ModManagerTarget, string>> = {};
    for (const [rawKey, rawValue] of Object.entries(value as Record<string, unknown>)) {
      const key = normalizeTargetValue(rawKey);
      if (!key) continue;
      const normalizedValue =
        typeof rawValue === "number"
          ? String(rawValue)
          : typeof rawValue === "string"
            ? rawValue.trim()
            : "";
      if (!normalizedValue) continue;
      next[key] = normalizedValue;
    }
    return Object.keys(next).length ? next : undefined;
  };

  const normalizeModLoaderMap = (value: unknown): Record<string, string> | undefined => {
    if (!value || typeof value !== "object") return undefined;
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([loader, mapped]) => {
        const normalizedLoader = loader.trim().toLowerCase();
        const normalizedMapped =
          typeof mapped === "number"
            ? String(mapped)
            : typeof mapped === "string"
              ? mapped.trim()
              : "";
        if (!normalizedLoader || !normalizedMapped) return null;
        return [normalizedLoader, normalizedMapped] as const;
      })
      .filter((entry): entry is readonly [string, string] => Boolean(entry));
    if (!entries.length) return undefined;
    return Object.fromEntries(entries);
  };

  const normalizeModManagerProvider = (value: unknown): NormalizedModManagerProvider | null => {
    if (typeof value === "string") {
      const id = value.trim().toLowerCase();
      return id ? { id } : null;
    }
    if (!value || typeof value !== "object") return null;
    const source = value as Record<string, unknown>;
    const idRaw = source.id ?? source.provider;
    if (typeof idRaw !== "string" || !idRaw.trim()) return null;
    const id = idRaw.trim().toLowerCase();
    const game =
      typeof source.game === "string" && source.game.trim()
        ? source.game.trim().toLowerCase()
        : undefined;
    const label =
      typeof source.label === "string" && source.label.trim()
        ? source.label.trim()
        : undefined;

    const curseforge =
      source.curseforge && typeof source.curseforge === "object"
        ? (source.curseforge as Record<string, unknown>)
        : null;
    const gameIdRaw = curseforge?.gameId;
    const gameId =
      typeof gameIdRaw === "number"
        ? String(gameIdRaw)
        : typeof gameIdRaw === "string" && gameIdRaw.trim()
          ? gameIdRaw.trim()
          : undefined;
    const gameSlugRaw = curseforge?.gameSlug ?? game;
    const gameSlug =
      typeof gameSlugRaw === "string" && gameSlugRaw.trim()
        ? gameSlugRaw.trim().toLowerCase()
        : undefined;
    const classIds = normalizeCurseforgeIdMap(curseforge?.classIds);
    const classSlugs = normalizeCurseforgeIdMap(curseforge?.classSlugs);
    const modLoaderMap = normalizeModLoaderMap(curseforge?.modLoaderMap);

    return {
      id,
      label,
      game,
      targets: normalizeTargetList(source.targets),
      ...(gameId || gameSlug || classIds || classSlugs || modLoaderMap
        ? {
            curseforge: {
              ...(gameId ? { gameId } : {}),
              ...(gameSlug ? { gameSlug } : {}),
              ...(classIds ? { classIds } : {}),
              ...(classSlugs ? { classSlugs } : {}),
              ...(modLoaderMap ? { modLoaderMap } : {}),
            },
          }
        : {}),
    };
  };

  const resolveEnabledModManager = (modManager: unknown): NormalizedModManager | null => {
    if (!modManager || typeof modManager !== "object") {
      return null;
    }
    const source = modManager as Record<string, unknown>;
    const providers = Array.isArray(source.providers)
      ? source.providers
          .map((entry) => normalizeModManagerProvider(entry))
          .filter((entry): entry is NormalizedModManagerProvider => Boolean(entry))
      : [];
    if (!providers.length) {
      return null;
    }
    const paths =
      source.paths && typeof source.paths === "object"
        ? (source.paths as { mods?: string; datapacks?: string; modpacks?: string })
        : undefined;
    const targets = normalizeTargetList(source.targets);
    return {
      providers,
      ...(paths ? { paths } : {}),
      ...(targets.length ? { targets } : {}),
    };
  };

  const resolveModManagerProvider = (
    modManager: NormalizedModManager,
    provider: string,
    game?: string
  ) => {
    const providerId = provider.trim().toLowerCase();
    const requestedGame = game?.trim().toLowerCase() || undefined;
    const matches = modManager.providers.filter((entry) => entry.id === providerId);
    if (!matches.length) return null;
    if (requestedGame) {
      return matches.find((entry) => entry.game === requestedGame) ?? null;
    }
    return matches.find((entry) => !entry.game) ?? matches[0];
  };

  const getProviderTargets = (
    modManager: NormalizedModManager,
    providerEntry: NormalizedModManagerProvider
  ) =>
    providerEntry.targets?.length
      ? providerEntry.targets
      : modManager.targets?.length
        ? modManager.targets
        : modManagerDefaultTargets;

  const resolveCurseforgeGameId = async (
    providerConfig: { endpoints: Record<string, string> },
    providerEntry: NormalizedModManagerProvider,
    baseUrl: string,
    headers: Record<string, string>
  ) => {
    const explicitGameId = providerEntry.curseforge?.gameId;
    if (explicitGameId) {
      return explicitGameId;
    }

    const gameSlug = providerEntry.curseforge?.gameSlug || providerEntry.game;
    if (!gameSlug || gameSlug === "minecraft") {
      return "432";
    }
    if (curseforgeGameIdCache.has(gameSlug)) {
      return curseforgeGameIdCache.get(gameSlug)!;
    }

    const endpoint = providerConfig.endpoints.games || "/v1/games";
    const pageSize = 50;
    for (let index = 0; index <= 5000; index += pageSize) {
      const params = new URLSearchParams({
        index: String(index),
        pageSize: String(pageSize),
      });
      const response = await fetch(`${baseUrl}${endpoint}?${params.toString()}`, { headers });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`CurseForge game lookup failed: ${body}`);
      }
      const payload = (await response.json()) as any;
      const games = Array.isArray(payload?.data) ? payload.data : [];
      if (!games.length) {
        break;
      }
      const match = games.find((entry: any) => {
        const slug = typeof entry?.slug === "string" ? entry.slug.toLowerCase() : "";
        const name = typeof entry?.name === "string" ? entry.name.toLowerCase() : "";
        return slug === gameSlug || name === gameSlug;
      });
      const matchId =
        match?.id !== undefined && match?.id !== null
          ? String(match.id).trim()
          : match?.gameId !== undefined && match?.gameId !== null
            ? String(match.gameId).trim()
            : "";
      if (matchId) {
        curseforgeGameIdCache.set(gameSlug, matchId);
        return matchId;
      }
      if (games.length < pageSize) {
        break;
      }
    }

    throw new Error(
      `Unable to resolve CurseForge game '${gameSlug}'. Configure providers[].curseforge.gameId explicitly.`
    );
  };

  const resolveCurseforgeClassId = async (
    providerConfig: { endpoints: Record<string, string> },
    providerEntry: NormalizedModManagerProvider,
    target: ModManagerTarget,
    gameId: string,
    baseUrl: string,
    headers: Record<string, string>
  ) => {
    const explicitClassId = providerEntry.curseforge?.classIds?.[target];
    if (explicitClassId) {
      return explicitClassId;
    }

    if (gameId === "432") {
      const minecraftDefaults: Record<ModManagerTarget, string> = {
        mods: "6",
        datapacks: "512",
        modpacks: "4471",
      };
      return minecraftDefaults[target];
    }

    const classSlug = providerEntry.curseforge?.classSlugs?.[target];
    if (!classSlug) {
      return undefined;
    }

    const cacheKey = `${gameId}:${classSlug}`;
    if (curseforgeClassIdCache.has(cacheKey)) {
      return curseforgeClassIdCache.get(cacheKey);
    }

    const endpoint = providerConfig.endpoints.categories || "/v1/categories";
    const params = new URLSearchParams({
      gameId,
      classesOnly: "true",
    });
    const response = await fetch(`${baseUrl}${endpoint}?${params.toString()}`, { headers });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`CurseForge category lookup failed: ${body}`);
    }
    const payload = (await response.json()) as any;
    const categories = Array.isArray(payload?.data) ? payload.data : [];
    const match = categories.find((entry: any) => {
      const slug = typeof entry?.slug === "string" ? entry.slug.toLowerCase() : "";
      const name = typeof entry?.name === "string" ? entry.name.toLowerCase() : "";
      return slug === classSlug || name === classSlug;
    });
    const matchId =
      match?.id !== undefined && match?.id !== null
        ? String(match.id).trim()
        : match?.classId !== undefined && match?.classId !== null
          ? String(match.classId).trim()
          : "";
    if (!matchId) {
      throw new Error(`CurseForge class '${classSlug}' not found for game '${gameId}'`);
    }
    curseforgeClassIdCache.set(cacheKey, matchId);
    return matchId;
  };

  const resolveCurseforgeLoaderType = (
    providerEntry: NormalizedModManagerProvider,
    gameId: string,
    loader: string
  ) => {
    const loaderKey = loader.trim().toLowerCase();
    if (!loaderKey) return undefined;
    const defaultLoaderMap =
      gameId === "432"
        ? {
            forge: "1",
            neoforge: "20",
            fabric: "4",
            quilt: "5",
          }
        : {};
    const providerMap = providerEntry.curseforge?.modLoaderMap ?? {};
    return providerMap[loaderKey] ?? defaultLoaderMap[loaderKey as keyof typeof defaultLoaderMap];
  };

  const ensureModManagerEnabled = (server: any, reply: FastifyReply) => {
    // Keep mod manager checks aligned with the runtime template patching used for Hytale.
    const runtimeTemplate = patchTemplateForRuntime(server.template);
    const modManager = resolveEnabledModManager(runtimeTemplate?.features?.modManager);
    if (!modManager) {
      reply.status(409).send({ error: "Mod manager not enabled for this template" });
      return null;
    }
    return modManager;
  };
  const ensurePluginManagerEnabled = (server: any, reply: FastifyReply) => {
    const pluginManager = server.template?.features?.pluginManager;
    if (
      !pluginManager ||
      !Array.isArray(pluginManager.providers) ||
      pluginManager.providers.length === 0
    ) {
      reply.status(409).send({ error: "Plugin manager not enabled for this template" });
      return null;
    }
    return pluginManager as {
      providers: string[];
      paths?: { plugins?: string };
    };
  };

  const extractGameVersion = (environment: any) => {
    if (!environment || typeof environment !== "object") return null;
    const candidates = [
      "MC_VERSION",
      "MINECRAFT_VERSION",
      "GAME_VERSION",
      "SERVER_VERSION",
      "VERSION",
    ];
    for (const key of candidates) {
      const value = (environment as Record<string, unknown>)[key];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
    return null;
  };

  const resolveTemplatePath = (pathValue?: string, target?: string) => {
    if (pathValue) {
      return normalizeRequestPath(pathValue);
    }
    const safeTarget = target ? target.replace(/[^a-z0-9_-]/gi, "") : "mods";
    return normalizeRequestPath(`/${safeTarget}`);
  };
  const sanitizeFilename = (value: string) => value.replace(/[^a-z0-9._-]/gi, "_");

  /**
   * Resolve actual download URL + filename for Spigot resources.
   * Spigot version-specific download endpoints redirect to spigotmc.org which blocks programmatic access.
   * We prefer externalUrl from resource metadata, fallback to generic /download endpoint (cdn.spiget.org).
   */
  const resolveSpigotDownload = async (
    baseUrl: string,
    headers: Record<string, string>,
    projectId: string,
    versionId: string
  ): Promise<{ downloadUrl: string; filename: string }> => {
    const resourceUrl = `${baseUrl}/v2/resources/${encodeURIComponent(projectId)}`;
    const resourceRes = await fetch(resourceUrl, { headers });
    let externalUrl = "";
    if (resourceRes.ok) {
      const data = (await resourceRes.json()) as any;
      externalUrl = data?.file?.externalUrl || "";
    }
    const downloadUrl = externalUrl || `${baseUrl}/v2/resources/${encodeURIComponent(projectId)}/download`;
    const safeName = sanitizeFilename(String(versionId));
    return { downloadUrl, filename: `spigot-${projectId}-${safeName}.jar` };
  };

  /**
   * Resolve actual download URL + filename for Paper (Hangar) resources.
   * Many Hangar plugins have downloadUrl: null with only externalUrl pointing to GitHub release pages.
   * We resolve GitHub release URLs to actual .jar asset download URLs via GitHub API.
   */
  const resolvePaperDownload = async (
    baseUrl: string,
    headers: Record<string, string>,
    projectId: string,
    versionId: string
  ): Promise<{ downloadUrl: string; filename: string }> => {
    const rawProjectId = decodeURIComponent(String(projectId));
    const parts = rawProjectId.split("/");
    if (parts.length < 2) return { downloadUrl: "", filename: "" };
    const slug = parts[0];
    const encodedProjectId = parts.map(encodeURIComponent).join("/");

    // Try the standard Hangar download endpoint first
    const hangarUrl = `${baseUrl}/api/v1/projects/${encodedProjectId}/versions/${encodeURIComponent(versionId)}/PAPER/download`;
    let downloadUrl = "";
    let filename = `${slug}-${versionId}.jar`;

    try {
      const headRes = await fetch(hangarUrl, { headers, redirect: "manual" });
      if (headRes.status >= 200 && headRes.status < 400) {
        return { downloadUrl: hangarUrl, filename };
      }
    } catch {
      // Ignore and fall back to metadata/external URL resolution.
    }

    // Fetch version metadata to check for externalUrl
    const vUrl = `${baseUrl}/api/v1/projects/${encodeURIComponent(slug)}/versions/${encodeURIComponent(versionId)}`;
    const vRes = await fetch(vUrl, { headers });
    if (!vRes.ok) return { downloadUrl: "", filename };
    const vData = (await vRes.json()) as any;
    const platformDl = vData?.downloads?.PAPER;

    if (platformDl?.downloadUrl) {
      downloadUrl = platformDl.downloadUrl.startsWith("http")
        ? platformDl.downloadUrl
        : `${baseUrl}${platformDl.downloadUrl}`;
    } else if (platformDl?.externalUrl) {
      // Resolve GitHub release URLs to actual asset download
      const ghMatch = platformDl.externalUrl.match(
        /github\.com\/([^/]+)\/([^/]+)\/releases\/tag\/([^/?#]+)/
      );
      if (ghMatch) {
        const ghApiUrl = `https://api.github.com/repos/${ghMatch[1]}/${ghMatch[2]}/releases/tags/${ghMatch[3]}`;
        try {
          const ghRes = await fetch(ghApiUrl, { headers: { "User-Agent": "CatalystPluginManager/1.0" } });
          if (ghRes.ok) {
            const ghData = (await ghRes.json()) as any;
            const jarAsset = (ghData.assets || []).find((a: any) => a.name?.endsWith(".jar"));
            if (jarAsset) {
              downloadUrl = jarAsset.browser_download_url;
              filename = jarAsset.name;
            }
          }
        } catch {
          // Ignore GitHub resolution errors and use the external URL directly.
        }
      }
      if (!downloadUrl) downloadUrl = platformDl.externalUrl;
    }

    return { downloadUrl, filename };
  };

  /**
   * Download a file with appropriate headers — only sends provider-specific API headers
   * when the URL belongs to the provider's base domain. Uses generic headers for external URLs.
   */
  const fetchDownload = async (
    downloadUrl: string,
    providerBaseUrl: string,
    providerHeaders: Record<string, string>
  ): Promise<Response> => {
    const dlHeaders = downloadUrl.startsWith(providerBaseUrl)
      ? providerHeaders
      : { "User-Agent": "CatalystPluginManager/1.0" };
    return fetch(downloadUrl, { headers: dlHeaders, redirect: "follow" });
  };

  const resolveServerPath = async (serverUuid: string, requestedPath: string, nodeServerDataDir?: string) => {
    const baseDir = path.resolve(nodeServerDataDir || serverDataRoot, serverUuid);
    await fs.mkdir(baseDir, { recursive: true });
    const safePath = path.resolve(baseDir, requestedPath.replace(/\\/g, "/").replace(/^\/+/, ""));
    const basePrefix = baseDir.endsWith(path.sep) ? baseDir : `${baseDir}${path.sep}`;
    if (safePath !== baseDir && !safePath.startsWith(basePrefix)) {
      throw new Error("Path traversal attempt detected");
    }
    return { baseDir, targetPath: safePath };
  };
  const validateArchiveEntries = async (archivePath: string, isZip: boolean) => {
    const { stdout } = isZip
      ? await execFileAsync("unzip", ["-Z", "-1", archivePath], { maxBuffer: maxBufferBytes })
      : await execFileAsync("tar", ["-tzf", archivePath], { maxBuffer: maxBufferBytes });
    const entries = stdout
      .split("\n")
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (entries.length > 5000) {
      throw new Error("Archive contains too many entries");
    }
    for (const entry of entries) {
      const normalized = path.posix.normalize(entry);
      if (normalized.startsWith("..") || path.posix.isAbsolute(normalized)) {
        throw new Error("Archive contains invalid paths");
      }
      const depth = normalized.split("/").filter(Boolean).length;
      if (depth > 20) {
        throw new Error("Archive contains deeply nested paths");
      }
    }
  };

  const isSuspensionEnforced = () => process.env.SUSPENSION_ENFORCED !== "false";

  const isSuspensionDeleteBlocked = () =>
    process.env.SUSPENSION_DELETE_POLICY === "block";

  const ensureNotSuspended = (server: any, reply: FastifyReply, message?: string) => {
    if (!isSuspensionEnforced()) {
      return true;
    }
    if (!server?.suspendedAt) {
      return true;
    }
    reply.status(423).send({
      error: message || "Server is suspended",
      suspendedAt: server.suspendedAt,
      suspensionReason: server.suspensionReason ?? null,
    });
    return false;
  };

  const ensureSuspendPermission = async (
    userId: string,
    reply: FastifyReply,
    message?: string
  ) => {
    const roles = await prisma.role.findMany({
      where: { users: { some: { id: userId } } },
      select: { permissions: true },
    });
    const permissions = roles.flatMap((role) => role.permissions);
    if (
      permissions.includes("*") ||
      permissions.includes("admin.write") ||
      permissions.includes("admin.read") ||
      permissions.includes("server.suspend")
    ) {
      return true;
    }
    reply.status(403).send({ error: message || "Admin access required" });
    return false;
  };

  const isAdminUser = async (userId: string, required: "admin.read" | "admin.write" = "admin.read") => {
    const roles = await prisma.role.findMany({
      where: { users: { some: { id: userId } } },
      select: { name: true, permissions: true },
    });
    const permissions = roles.flatMap((role) => role.permissions);
    if (
      permissions.includes("*") ||
      permissions.includes("admin.write") ||
      (required === "admin.read" && permissions.includes("admin.read"))
    ) {
      return true;
    }
    return roles.some((role) => role.name.toLowerCase() === "administrator");
  };

  // Check if user can access a server - either as owner, admin, or via node assignment
  const canAccessServer = async (userId: string, server: { ownerId: string; nodeId: string }): Promise<boolean> => {
    // Owner can always access
    if (server.ownerId === userId) return true;

    // Admin can access all servers
    if (await isAdminUser(userId, "admin.write")) return true;

    // User with node assignment can access all servers on that node
    if (await hasNodeAccess(prisma, userId, server.nodeId)) return true;

    return false;
  };

  const isArchiveName = (value: string) => {
    const lowered = value.toLowerCase();
    return (
      lowered.endsWith(".tar.gz") ||
      lowered.endsWith(".tgz") ||
      lowered.endsWith(".zip")
    );
  };

  const ensureDatabasePermission = async (
    serverId: string,
    userId: string,
    reply: FastifyReply,
    permission: string,
    message: string
  ) => {
    const server = await prisma.server.findUnique({
      where: { id: serverId },
      select: { ownerId: true, suspendedAt: true, suspensionReason: true },
    });

    if (!server) {
      reply.status(404).send({ error: "Server not found" });
      return false;
    }

    if (process.env.SUSPENSION_ENFORCED !== "false" && server.suspendedAt) {
      reply.status(423).send({
        error: "Server is suspended",
        suspendedAt: server.suspendedAt,
        suspensionReason: server.suspensionReason ?? null,
      });
      return false;
    }

    if (server.ownerId === userId) {
      return true;
    }

    const access = await prisma.serverAccess.findFirst({
      where: {
        serverId,
        userId,
        permissions: { has: permission },
      },
    });

    if (access) {
      return true;
    }

    const roles = await prisma.role.findMany({
      where: { users: { some: { id: userId } } },
      select: { permissions: true },
    });
    const rolePermissions = roles.flatMap((role) => role.permissions);
    if (rolePermissions.includes("*") || rolePermissions.includes("admin.read")) {
      return true;
    }

    reply.status(403).send({ error: message });
    return false;
  };

  const generateSafeIdentifier = (prefix: string, length = 10) => {
    const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
    // Generate unbiased random values by using rejection sampling
    // Get enough bytes to fill the length with proper rejection sampling
    const randomBytesNeeded = Math.ceil(length * 256 / 252); // 252 = largest multiple of 36 <= 255
    const bytes = randomBytes(randomBytesNeeded);
    let id = "";
    let byteIndex = 0;
    while (id.length < length && byteIndex < bytes.length) {
      const value = bytes[byteIndex++];
      // Use rejection sampling: only use values 0-251 (evenly divisible by 36)
      // This removes the bias from using modulo on 0-255
      if (value < 252) {
        id += alphabet[value % 36];
      }
    }
    // Fallback: if we somehow didn't get enough valid bytes, pad with random chars
    while (id.length < length) {
      const byte = randomBytes(1)[0];
      id += alphabet[byte % 36];
    }
    return `${prefix}${id}`;
  };

  const isValidDatabaseIdentifier = (value: string) => {
    return /^[a-z][a-z0-9_]+$/.test(value) && value.length >= 3 && value.length <= 32;
  };

  const toDatabaseIdentifier = (value: string) => {
    // Limit input length to prevent ReDoS attacks
    const sanitized = value.slice(0, 100);
    return sanitized
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "_")
      .replace(/_{2,}/g, "_")
      .replace(/^_+|_+$/g, "");
  };

  // Create server
  app.post(
    "/",
    { onRequest: [app.authenticate] },
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
      };

      const userId = request.user.userId;

      // Check if user can create servers - either admin or has node assignment
      const canCreate = await isAdminUser(userId, "admin.write");
      const hasNodeAccessResult = await hasNodeAccess(prisma, userId, nodeId);

      if (!canCreate && !hasNodeAccessResult) {
        return reply.status(403).send({ error: "Admin access or node assignment required" });
      }

      // Validate required fields
      if (
        !name ||
        !templateId ||
        !nodeId ||
        !locationId ||
        allocatedMemoryMb === undefined ||
        allocatedCpuCores === undefined ||
        allocatedDiskMb === undefined ||
        primaryPort === undefined
      ) {
        return reply.status(400).send({ error: "Missing required fields" });
      }
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

      if (totalAllocatedMemory + allocatedMemoryMb > node.maxMemoryMb) {
        return reply.status(400).send({
          error: `Insufficient memory. Available: ${node.maxMemoryMb - totalAllocatedMemory}MB, Required: ${allocatedMemoryMb}MB`,
        });
      }

      if (totalAllocatedCpu + allocatedCpuCores > node.maxCpuCores) {
        return reply.status(400).send({
          error: `Insufficient CPU. Available: ${node.maxCpuCores - totalAllocatedCpu} cores, Required: ${allocatedCpuCores} cores`,
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
              ownerId: userId,
              allocatedMemoryMb,
              allocatedCpuCores,
              allocatedDiskMb,
              backupAllocationMb: resolvedBackupAllocationMb ?? 0,
              databaseAllocation: resolvedDatabaseAllocation ?? 0,
              primaryPort: allocationPort ?? validatedPrimaryPort,
              portBindings: resolvedPortBindings,
              networkMode: desiredNetworkMode,
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
          userId,
          serverId: server.id,
          permissions: [
            "server.start",
            "server.stop",
            "server.read",
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

      reply.send(serialize({
        success: true,
        data: servers.map((server) => {
          const metrics = latestMetricsByServer.get(server.id) as any;
          const diskTotalMb =
            server.allocatedDiskMb && server.allocatedDiskMb > 0 ? server.allocatedDiskMb : null;
          return {
            ...withConnectionInfo(server),
            cpuPercent: metrics?.cpuPercent ?? null,
            memoryUsageMb: metrics?.memoryUsageMb ?? null,
            diskUsageMb: metrics?.diskUsageMb ?? null,
            diskTotalMb,
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

      // Check if user has access - owner, explicit access, or node assignment
      const hasAccess =
        server.ownerId === userId ||
        server.access.some((a) => a.userId === userId) ||
        (await hasNodeAccess(prisma, userId, server.nodeId));

      if (!hasAccess) {
        return reply.status(403).send({ error: "Forbidden" });
      }

      reply.send({ success: true, data: withConnectionInfo(server) });
    }
  );

  // Update server
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
      };

      const hasPrimaryIpUpdate = primaryIp !== undefined;
      const normalizedPrimaryIp = typeof primaryIp === "string" ? primaryIp.trim() : null;

      // Can only update resources if server is stopped
      if (
        (allocatedMemoryMb !== undefined ||
          allocatedCpuCores !== undefined ||
          allocatedDiskMb !== undefined ||
          primaryPort !== undefined ||
          portBindings !== undefined ||
          hasPrimaryIpUpdate) &&
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

        if (totalOtherMemory + newMemory > node.maxMemoryMb) {
          return reply.status(400).send({
            error: `Insufficient memory. Available: ${node.maxMemoryMb - totalOtherMemory}MB`,
          });
        }

        if (totalOtherCpu + newCpu > node.maxCpuCores) {
          return reply.status(400).send({
            error: `Insufficient CPU. Available: ${node.maxCpuCores - totalOtherCpu} cores`,
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

      const nextPrimaryPort = primaryPort ?? server.primaryPort;
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
          },
        });

        return updatedServer;
      });

      reply.send({ success: true, data: updated });
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

      reply.send({ success: true, message: "Resize initiated" });
    }
  );

  // Get server files
  app.get(
    "/:serverId/files",
    {
      onRequest: [app.authenticate],
      config: { rateLimit: { max: fileRateLimitMax, timeWindow: '1 minute' } },
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

      const normalizedPath = normalizeRequestPath(requestedPath);

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
      const resolvedGameVersion = gameVersion?.trim() || extractGameVersion(server.environment);
      const isTrending = !searchQuery;
      let url = "";
      if (providerId === "modrinth") {
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
          ...(resolvedGameVersion ? { gameVersion: resolvedGameVersion } : {}),
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
      } catch (error: any) {
        reply.status(400).send({ error: error?.message || "Failed to install asset" });
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
      const resolvedGameVersion = gameVersion?.trim() || extractGameVersion(server.environment);
      const isTrending = !searchQuery;
      let url = "";
      if (provider === "modrinth") {
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
            provider: provider!,
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
            provider: provider!,
            projectId: String(projectId),
            versionId: String(versionId),
            projectName: projectName || null,
            type: "plugin",
          },
        });
        reply.send({ success: true, data: { path: normalizedFile } });
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
            const latest = versions[0];
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
            const latest = versions[0];
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

      reply.send({ success: true, data: results });
    }
  );

  // Download server file
  app.get(
    "/:serverId/files/download",
    {
      onRequest: [app.authenticate],
      config: { rateLimit: { max: fileRateLimitMax, timeWindow: '1 minute' } },
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

      const normalizedPath = normalizeRequestPath(requestedPath);

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
      config: { rateLimit: { max: fileRateLimitMax, timeWindow: '1 minute' } },
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
        reply.send({ success: true });
      } catch (error: any) {
        if (error?.message?.includes("timed out")) {
          return reply.status(504).send({ error: "Agent file operation timed out" });
        }
        reply.status(400).send({ error: "Failed to upload file" });
      }
    }
  );

  // Create file or directory
  app.post(
    "/:serverId/files/create",
    {
      onRequest: [app.authenticate],
      config: { rateLimit: { max: fileRateLimitMax, timeWindow: '1 minute' } },
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

      const normalizedPath = normalizeRequestPath(requestedPath);
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
      config: { rateLimit: { max: fileRateLimitMax, timeWindow: '1 minute' } },
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
      config: { rateLimit: { max: fileRateLimitMax, timeWindow: '1 minute' } },
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
      config: { rateLimit: { max: fileRateLimitMax, timeWindow: '1 minute' } },
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
      config: { rateLimit: { max: fileRateLimitMax, timeWindow: '1 minute' } },
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
      config: { rateLimit: { max: fileRateLimitMax, timeWindow: '1 minute' } },
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

      const normalizedPath = normalizeRequestPath(requestedPath);
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
    { onRequest: [app.authenticate], config: { rateLimit: { max: fileRateLimitMax, timeWindow: '1 minute' } } },
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

      const normalizedPath = normalizeRequestPath(requestedPath);
      if (normalizedPath === "/") {
        return reply.status(400).send({ error: "Invalid path" });
      }

      try {
        const result = await tunnelFileOp(server.nodeId, "delete", server.uuid, normalizedPath);
        if (!result.success) {
          return reply.status(400).send({ error: result.error || "Failed to delete selection" });
        }
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
      config: { rateLimit: { max: fileRateLimitMax, timeWindow: '1 minute' } },
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
  app.delete(
    "/:serverId",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;

      const server = await prisma.server.findUnique({
        where: { id: serverId },
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

      // Check permission - owner, admin, or node-assigned user can delete
      if (!(await canAccessServer(userId, server))) {
        return reply.status(403).send({ error: "Forbidden" });
      }

      const deletableStates = ["stopped", "error", "crashed", "installing"];
      if (!deletableStates.includes(server.status)) {
        return reply.status(409).send({
          error: `Server must be stopped before deletion (current state: ${server.status})`,
        });
      }

      await prisma.$transaction(async (tx) => {
        await releaseIpForServer(tx, serverId);
        await tx.server.delete({ where: { id: serverId } });
      });

      reply.send({ success: true });
    }
  );

  // Get server permissions
  app.get(
    "/:serverId/permissions",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;

      const server = await prisma.server.findUnique({
        where: { id: serverId },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      // Check if user has access - owner, admin, or node-assigned user
      if (!(await canAccessServer(userId, server))) {
        const access = await prisma.serverAccess.findUnique({
          where: { userId_serverId: { userId, serverId } },
        });
        if (!access) {
          return reply.status(403).send({ error: "Forbidden" });
        }
      }

      // Get all access entries for this server
      const permissions = await prisma.serverAccess.findMany({
        where: { serverId },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              username: true,
            },
          },
        },
      });

      reply.send({ success: true, data: permissions, presets: DEFAULT_PERMISSION_PRESETS });
    }
  );

  // List pending server invites
  app.get(
    "/:serverId/invites",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;

      const server = await prisma.server.findUnique({
        where: { id: serverId },
        select: { id: true, ownerId: true, nodeId: true },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      if (server.ownerId !== userId) {
        const access = await prisma.serverAccess.findFirst({
          where: { serverId, userId, permissions: { has: "server.read" } },
        });
        const hasNodeAccessToServer = await hasNodeAccess(prisma, userId, server.nodeId);
        if (!access && !hasNodeAccessToServer) {
          return reply.status(403).send({ error: "Forbidden" });
        }
      }

      const invites = await prisma.serverAccessInvite.findMany({
        where: { serverId, cancelledAt: null, acceptedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: "desc" },
      });

      reply.send({ success: true, data: invites });
    }
  );

  // Create invite
  app.post(
    "/:serverId/invites",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;
      const { email, permissions } = request.body as {
        email?: string;
        permissions?: string[];
      };

      if (!email || !permissions || permissions.length === 0) {
        return reply.status(400).send({ error: "Email and permissions are required" });
      }

      const server = await prisma.server.findUnique({
        where: { id: serverId },
        select: { id: true, name: true, ownerId: true },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      if (server.ownerId !== userId) {
        return reply.status(403).send({ error: "Forbidden" });
      }

      const normalizedEmail = email.toLowerCase();
      const existingUser = await prisma.user.findUnique({ where: { email: normalizedEmail } });
      if (existingUser) {
        const existingAccess = await prisma.serverAccess.findUnique({
          where: { userId_serverId: { userId: existingUser.id, serverId } },
        });
        if (existingAccess) {
          return reply.status(409).send({ error: "User already has access" });
        }
      }

      const token = nanoid(32);
      const expiresAt = new Date(Date.now() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
      const sanitizedPermissions = permissions.map((entry) => entry.trim()).filter(Boolean);
      if (sanitizedPermissions.length === 0) {
        return reply.status(400).send({ error: "Permissions cannot be empty" });
      }
      const invite = await prisma.serverAccessInvite.create({
        data: {
          serverId,
          email: normalizedEmail,
          token,
          permissions: sanitizedPermissions,
          invitedByUserId: userId,
          expiresAt,
        },
      });

      const inviteUrl = `${process.env.FRONTEND_URL || "http://localhost:5173"}/invites/${token}`;
      const emailContent = renderInviteEmail({
        serverName: server.name,
        inviteUrl,
        expiresAt,
      });
      await sendEmail({
        to: normalizedEmail,
        subject: emailContent.subject,
        html: emailContent.html,
        text: emailContent.text,
      });

      await prisma.auditLog.create({
        data: {
          userId,
          action: "server.invite",
          resource: "server",
          resourceId: serverId,
          details: { email: normalizedEmail, permissions: sanitizedPermissions },
        },
      });

      reply.status(201).send({ success: true, data: invite });
    }
  );

  // Cancel invite
  app.delete(
    "/:serverId/invites/:inviteId",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId, inviteId } = request.params as { serverId: string; inviteId: string };
      const userId = request.user.userId;

      const server = await prisma.server.findUnique({
        where: { id: serverId },
        select: { ownerId: true },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      if (server.ownerId !== userId) {
        return reply.status(403).send({ error: "Forbidden" });
      }

      const invite = await prisma.serverAccessInvite.findFirst({
        where: { id: inviteId, serverId },
      });

      if (!invite) {
        return reply.status(404).send({ error: "Invite not found" });
      }

      await prisma.serverAccessInvite.update({
        where: { id: inviteId },
        data: { cancelledAt: new Date() },
      });

      await prisma.auditLog.create({
        data: {
          userId,
          action: "server.invite.cancel",
          resource: "server",
          resourceId: serverId,
          details: { email: invite.email },
        },
      });

      reply.send({ success: true });
    }
  );

  const acceptInviteForUser = async (args: {
    userId: string;
    token: string;
    reply: FastifyReply;
    invite?: { id: string; serverId: string; email: string; permissions: string[]; cancelledAt?: Date | null; acceptedAt?: Date | null; expiresAt: Date };
  }) => {
    const invite =
      args.invite ??
      (await prisma.serverAccessInvite.findUnique({ where: { token: args.token } }));
    if (!invite) {
      args.reply.status(404).send({ error: "Invite not found" });
      return null;
    }

    if (invite.cancelledAt || invite.acceptedAt) {
      args.reply.status(409).send({ error: "Invite no longer active" });
      return null;
    }

    if (invite.expiresAt <= new Date()) {
      args.reply.status(410).send({ error: "Invite expired" });
      return null;
    }

    const user = await prisma.user.findUnique({ where: { id: args.userId } });
    if (!user || user.email.toLowerCase() !== invite.email.toLowerCase()) {
      args.reply.status(403).send({ error: "Invite not valid for this account" });
      return null;
    }

    await prisma.$transaction(async (tx) => {
      await tx.serverAccess.upsert({
        where: { userId_serverId: { userId: args.userId, serverId: invite.serverId } },
        create: {
          userId: args.userId,
          serverId: invite.serverId,
          permissions: invite.permissions,
        },
        update: {
          permissions: invite.permissions,
        },
      });
      await tx.serverAccessInvite.update({
        where: { id: invite.id },
        data: { acceptedAt: new Date() },
      });
    });

    await prisma.auditLog.create({
      data: {
        userId: args.userId,
        action: "server.invite.accept",
        resource: "server",
        resourceId: invite.serverId,
        details: { email: invite.email },
      },
    });

    return invite;
  };

  // Accept invite (authenticated)
  app.post(
    "/invites/accept",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.user.userId;
      const { token } = request.body as { token?: string };

      if (!token) {
        return reply.status(400).send({ error: "Missing token" });
      }

      const invite = await acceptInviteForUser({ userId, token, reply });
      if (!invite) {
        return;
      }

      reply.send({ success: true });
    }
  );

  // Accept invite + register
  app.post(
    "/invites/register",
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { token, username, password } = request.body as {
        token?: string;
        username?: string;
        password?: string;
      };

      if (!token || !username || !password) {
        return reply.status(400).send({ error: "Missing token, username, or password" });
      }

      if (password.length < 8) {
        return reply.status(400).send({ error: "Password must be at least 8 characters" });
      }

      const invite = await prisma.serverAccessInvite.findUnique({ where: { token } });
      if (!invite) {
        return reply.status(404).send({ error: "Invite not found" });
      }

      if (invite.cancelledAt || invite.acceptedAt) {
        return reply.status(409).send({ error: "Invite no longer active" });
      }

      if (invite.expiresAt <= new Date()) {
        return reply.status(410).send({ error: "Invite expired" });
      }

      const existing = await prisma.user.findFirst({
        where: { OR: [{ email: invite.email }, { username }] },
      });
      if (existing) {
        return reply.status(409).send({ error: "Email or username already in use" });
      }

      const signUpResponse = await auth.api.signUpEmail({
        headers: new Headers({
          origin: request.headers.origin || request.headers.host || "http://localhost:3000",
        }),
        body: {
          email: invite.email,
          password,
          name: username,
          username,
        } as any,
        returnHeaders: true,
      });

      const signUpUser =
        "headers" in signUpResponse && signUpResponse.response
          ? signUpResponse.response.user
          : (signUpResponse as any)?.user;
      if (!signUpUser) {
        return reply.status(400).send({ error: "Registration failed" });
      }

      const accepted = await acceptInviteForUser({ userId: signUpUser.id, token, reply, invite });
      if (!accepted) {
        return;
      }

      const roles = await prisma.role.findMany({
        where: { users: { some: { id: signUpUser.id } } },
        select: { permissions: true },
      });
      const permissions = roles.flatMap((role) => role.permissions);

      const tokenValue =
        "headers" in signUpResponse ? signUpResponse.headers.get("set-auth-token") : null;
      if (tokenValue) {
        reply.header("set-auth-token", tokenValue);
        reply.header("Access-Control-Expose-Headers", "set-auth-token");
      }

      reply.send({
        success: true,
        data: {
          userId: signUpUser.id,
          email: signUpUser.email,
          username: signUpUser.username ?? username,
          permissions,
          token: tokenValue ?? null,
        },
      });
    }
  );

  // Invite preview (for invite signup flow)
  app.get(
    "/invites/:token",
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { token } = request.params as { token: string };
      if (!token) {
        return reply.status(400).send({ error: "Missing token" });
      }

      const invite = await prisma.serverAccessInvite.findUnique({
        where: { token },
        include: {
          server: { select: { name: true } },
        },
      });

      if (!invite) {
        return reply.status(404).send({ error: "Invite not found" });
      }

      if (invite.cancelledAt || invite.acceptedAt) {
        return reply.status(409).send({ error: "Invite no longer active" });
      }

      if (invite.expiresAt <= new Date()) {
        return reply.status(410).send({ error: "Invite expired" });
      }

      reply.send({
        success: true,
        data: {
          email: invite.email,
          serverName: invite.server.name,
          permissions: invite.permissions,
          expiresAt: invite.expiresAt,
        },
      });
    }
  );

  // Add or update server access
  app.post(
    "/:serverId/access",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;
      const { targetUserId, permissions } = request.body as {
        targetUserId?: string;
        permissions?: string[];
      };

      if (!targetUserId || !permissions || permissions.length === 0) {
        return reply.status(400).send({ error: "targetUserId and permissions are required" });
      }

      const server = await prisma.server.findUnique({
        where: { id: serverId },
        select: { ownerId: true },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      if (server.ownerId !== userId) {
        return reply.status(403).send({ error: "Forbidden" });
      }

      if (targetUserId === server.ownerId) {
        return reply.status(409).send({ error: "Owner permissions cannot be edited" });
      }

      const targetUser = await prisma.user.findUnique({ where: { id: targetUserId } });
      if (!targetUser) {
        return reply.status(404).send({ error: "User not found" });
      }

      const sanitizedPermissions = permissions.map((entry) => entry.trim()).filter(Boolean);
      if (sanitizedPermissions.length === 0) {
        return reply.status(400).send({ error: "Permissions cannot be empty" });
      }

      const access = await prisma.serverAccess.upsert({
        where: { userId_serverId: { userId: targetUserId, serverId } },
        create: { userId: targetUserId, serverId, permissions: sanitizedPermissions },
        update: { permissions: sanitizedPermissions },
      });

      await prisma.auditLog.create({
        data: {
          userId,
          action: "server.access.update",
          resource: "server",
          resourceId: serverId,
          details: { targetUserId, permissions: sanitizedPermissions },
        },
      });

      reply.send({ success: true, data: access });
    }
  );

  // Remove server access
  app.delete(
    "/:serverId/access/:targetUserId",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId, targetUserId } = request.params as {
        serverId: string;
        targetUserId: string;
      };
      const userId = request.user.userId;

      const server = await prisma.server.findUnique({
        where: { id: serverId },
        select: { ownerId: true },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      if (server.ownerId !== userId) {
        return reply.status(403).send({ error: "Forbidden" });
      }

      if (targetUserId === server.ownerId) {
        return reply.status(409).send({ error: "Owner access cannot be removed" });
      }

      await prisma.serverAccess.delete({
        where: { userId_serverId: { userId: targetUserId, serverId } },
      });

      await prisma.auditLog.create({
        data: {
          userId,
          action: "server.access.remove",
          resource: "server",
          resourceId: serverId,
          details: { targetUserId },
        },
      });

      reply.send({ success: true });
    }
  );

  // List server databases
  app.get(
    "/:serverId/databases",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;

      const canAccess = await ensureDatabasePermission(
        serverId,
        userId,
        reply,
        "database.read",
        "You do not have permission to view databases for this server"
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

      reply.send({
        success: true,
        data: databases.map((db) => ({
          id: db.id,
          name: db.name,
          username: db.username,
          password: db.password,
          host: db.host.host,
          port: db.host.port,
          hostId: db.hostId,
          hostName: db.host.name,
          createdAt: db.createdAt,
        })),
      });
    }
  );

  // Create server database
  app.post(
    "/:serverId/databases",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;
      const { name, hostId } = request.body as { name?: string; hostId: string };

      const canAccess = await ensureDatabasePermission(
        serverId,
        userId,
        reply,
        "database.create",
        "You do not have permission to create databases for this server"
      );
      if (!canAccess) {
        return;
      }

      if (!hostId) {
        return reply.status(400).send({ error: "hostId is required" });
      }

       const server = await prisma.server.findUnique({
         where: { id: serverId },
         select: { databaseAllocation: true },
       });

       if (!server) {
         return reply.status(404).send({ error: "Server not found" });
       }

       const allocationLimit = server.databaseAllocation ?? 0;
       if (!Number.isFinite(allocationLimit) || allocationLimit <= 0) {
         return reply.status(403).send({ error: "Database allocation disabled for this server" });
       }

       const existingCount = await prisma.serverDatabase.count({ where: { serverId } });
       if (existingCount >= allocationLimit) {
         return reply.status(409).send({ error: "Database allocation limit reached" });
       }

       const host = await prisma.databaseHost.findUnique({
         where: { id: hostId },
       });

       if (!host) {
         return reply.status(404).send({ error: "Database host not found" });
       }

      const normalizedName = name ? toDatabaseIdentifier(name.trim()) : "";
      const databaseName =
        normalizedName.length >= 3 ? normalizedName : generateSafeIdentifier("srv_", 12);

      if (!isValidDatabaseIdentifier(databaseName)) {
        return reply.status(400).send({
          error: "Database name must start with a letter and use only lowercase letters, numbers, and underscores (max 32 chars)",
        });
      }

      const databaseUsername = generateSafeIdentifier("u", 12);
      const databasePassword = generateSafeIdentifier("p", 24);

      if (!isValidDatabaseIdentifier(databaseUsername)) {
        return reply.status(500).send({ error: "Generated database username is invalid" });
      }

      if (databasePassword.length < 16) {
        return reply.status(500).send({ error: "Generated database password is too short" });
      }

      try {
        await provisionDatabase(host, databaseName, databaseUsername, databasePassword);
        const database = await prisma.serverDatabase.create({
          data: {
            serverId,
            hostId,
            name: databaseName,
            username: databaseUsername,
            password: databasePassword,
          },
        });

        await prisma.auditLog.create({
          data: {
            userId,
            action: "database.create",
            resource: "server",
            resourceId: serverId,
            details: {
              hostId,
              name: database.name,
            },
          },
        });

        reply.status(201).send({
          success: true,
          data: {
            id: database.id,
            name: database.name,
            username: database.username,
            password: database.password,
            host: host.host,
            port: host.port,
            hostId: host.id,
            hostName: host.name,
            createdAt: database.createdAt,
          },
        });
      } catch (error: any) {
        if (error instanceof DatabaseProvisioningError) {
          return reply.status(error.statusCode).send({ error: error.message });
        }
        return reply.status(500).send({ error: "Database provisioning failed" });
      }
    }
  );

  // Rotate server database password
  app.post(
    "/:serverId/databases/:databaseId/rotate",
    { onRequest: [app.authenticate] },
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
        "You do not have permission to rotate database credentials"
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
        return reply.status(404).send({ error: "Database not found" });
      }

      const nextPassword = generateSafeIdentifier("p", 24);

      try {
        await rotateDatabasePassword(database.host, database.username, nextPassword);
      } catch (error: any) {
        if (error instanceof DatabaseProvisioningError) {
          return reply.status(error.statusCode).send({ error: error.message });
        }
        return reply.status(500).send({ error: "Database password rotation failed" });
      }

      const updated = await prisma.serverDatabase.update({
        where: { id: database.id },
        data: { password: nextPassword },
      });

      await prisma.auditLog.create({
        data: {
          userId,
          action: "database.rotate",
          resource: "server",
          resourceId: serverId,
          details: {
            databaseId: database.id,
            name: database.name,
          },
        },
      });

      reply.send({
        success: true,
        data: {
          id: updated.id,
          name: updated.name,
          username: updated.username,
          password: updated.password,
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
    { onRequest: [app.authenticate] },
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
        "You do not have permission to delete databases for this server"
      );
      if (!canAccess) {
        return;
      }

      const database = await prisma.serverDatabase.findFirst({
        where: { id: databaseId, serverId },
      });

      if (!database) {
        return reply.status(404).send({ error: "Database not found" });
      }

      const host = await prisma.databaseHost.findUnique({
        where: { id: database.hostId },
      });

      if (!host) {
        return reply.status(404).send({ error: "Database host not found" });
      }

      try {
        await dropDatabase(host, database.name, database.username);
      } catch (error: any) {
        if (error instanceof DatabaseProvisioningError) {
          return reply.status(error.statusCode).send({ error: error.message });
        }
        return reply.status(500).send({ error: "Database deletion failed" });
      }

      await prisma.serverDatabase.delete({ where: { id: database.id } });

      await prisma.auditLog.create({
        data: {
          userId,
          action: "database.delete",
          resource: "server",
          resourceId: serverId,
          details: { databaseId },
        },
      });

      reply.send({ success: true });
    }
  );

  // Install server (sends install command to agent)
  app.post(
    "/:serverId/install",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;

      const server = await prisma.server.findUnique({
        where: { id: serverId },
        include: {
          template: true,
          node: true,
        },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      if (!ensureNotSuspended(server, reply)) {
        return;
      }

      // Check permissions
      if (server.ownerId !== userId && !(await isAdminUser(userId, "admin.read"))) {
        const access = await prisma.serverAccess.findFirst({
          where: {
            userId,
            serverId,
            permissions: { has: "server.install" },
          },
        });
        const hasNodeAccessToServer = await hasNodeAccess(prisma, userId, server.nodeId);
        if (!access && !hasNodeAccessToServer) {
          return reply.status(403).send({ error: "Forbidden" });
        }
      }

      // Validate state transition
      const currentState = server.status as ServerState;
      if (!ServerStateMachine.canTransition(currentState, ServerState.INSTALLING)) {
        return reply.status(409).send({
          error: `Cannot install server in ${server.status} state`,
        });
      }

      // Check if node is online
      if (!server.node.isOnline) {
        return reply.status(503).send({ error: "Node is offline" });
      }

      // Send install command to agent via WebSocket
      const gateway = (app as any).wsGateway;
      if (!gateway) {
        return reply.status(500).send({ error: "WebSocket gateway not available" });
      }

      // Automatically add SERVER_DIR to environment (uses node's configured server data directory)
      const serverDir = server.node.serverDataDir || "/var/lib/catalyst/servers";
      const fullServerDir = `${serverDir}/${server.uuid}`;
      
      const templateVariables = (server.template.variables as any[]) || [];
      const templateDefaults = templateVariables.reduce((acc, variable) => {
        if (variable?.name && variable?.default !== undefined) {
          acc[variable.name] = String(variable.default);
        }
        return acc;
      }, {} as Record<string, string>);

      const environment = {
        ...templateDefaults,
        ...(server.environment as Record<string, string>),
        SERVER_DIR: fullServerDir,
      };
      if (server.template?.image) {
        const resolvedImage = resolveTemplateImage(server.template, environment);
        environment.TEMPLATE_IMAGE = resolvedImage;
      }
      if (server.primaryIp && !environment.CATALYST_NETWORK_IP) {
        environment.CATALYST_NETWORK_IP = server.primaryIp;
      }
      if (server.networkMode === "host" && !environment.CATALYST_NETWORK_IP) {
        try {
          environment.CATALYST_NETWORK_IP = normalizeHostIp(server.node.publicAddress) || "";
        } catch (error: any) {
          return reply.status(400).send({ error: error.message });
        }
      }
      const runtimeTemplate = patchTemplateForRuntime(server.template);

      const success = await gateway.sendToAgent(server.nodeId, {
        type: "install_server",
        serverId: server.id,
        serverUuid: server.uuid,
        template: runtimeTemplate,
        environment: environment,
        allocatedMemoryMb: server.allocatedMemoryMb,
        allocatedCpuCores: server.allocatedCpuCores,
        allocatedDiskMb: server.allocatedDiskMb,
        primaryPort: server.primaryPort,
        portBindings: parseStoredPortBindings(server.portBindings),
      });

      if (!success) {
        return reply.status(503).send({ error: "Failed to send command to agent" });
      }

      // Update server status
      await prisma.server.update({
        where: { id: serverId },
        data: { status: "installing" },
      });

      await prisma.serverLog.create({
        data: {
          serverId: serverId,
          stream: "system",
          data: "Installation started.",
        },
      });

      reply.send({ success: true, message: "Install command sent to agent" });
    }
  );

  // Start server (sends start command to agent)
  app.post(
    "/:serverId/start",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;

      const server = await prisma.server.findUnique({
        where: { id: serverId },
        include: {
          template: true,
          node: true,
        },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      if (!ensureNotSuspended(server, reply)) {
        return;
      }

      // Check permissions
      if (server.ownerId !== userId && !(await isAdminUser(userId, "admin.read"))) {
        const access = await prisma.serverAccess.findFirst({
          where: {
            userId,
            serverId,
            permissions: { has: "server.start" },
          },
        });
        const hasNodeAccessToServer = await hasNodeAccess(prisma, userId, server.nodeId);
        if (!access && !hasNodeAccessToServer) {
          return reply.status(403).send({ error: "Forbidden" });
        }
      }

      // Validate state transition
      const currentState = server.status as ServerState;
      if (!ServerStateMachine.canStart(currentState)) {
        return reply.status(409).send({
          error: `Cannot start server in ${server.status} state. Server must be stopped or crashed.`,
        });
      }

      // Check if node is online
      if (!server.node.isOnline) {
        return reply.status(503).send({ error: "Node is offline" });
      }

      // Send start command to agent via WebSocket
      const gateway = (app as any).wsGateway;
      if (!gateway) {
        return reply.status(500).send({ error: "WebSocket gateway not available" });
      }

      // Automatically add SERVER_DIR to environment
      const serverDir = server.node.serverDataDir || "/var/lib/catalyst/servers";
      const fullServerDir = `${serverDir}/${server.uuid}`;
      
      const templateVariables = (server.template.variables as any[]) || [];
      const templateDefaults = templateVariables.reduce((acc, variable) => {
        if (variable?.name && variable?.default !== undefined) {
          acc[variable.name] = String(variable.default);
        }
        return acc;
      }, {} as Record<string, string>);

      const environment = {
        ...templateDefaults,
        ...(server.environment as Record<string, string>),
        SERVER_DIR: fullServerDir,
      };
      if (server.template?.image) {
        const resolvedImage = resolveTemplateImage(server.template, environment);
        environment.TEMPLATE_IMAGE = resolvedImage;
      }
      if (server.primaryIp && !environment.CATALYST_NETWORK_IP) {
        environment.CATALYST_NETWORK_IP = server.primaryIp;
      }
      if (server.networkMode === "host" && !environment.CATALYST_NETWORK_IP) {
        try {
          environment.CATALYST_NETWORK_IP = normalizeHostIp(server.node.publicAddress) || "";
        } catch (error: any) {
          return reply.status(400).send({ error: error.message });
        }
      }
      const runtimeTemplate = patchTemplateForRuntime(server.template);
      if (server.startupCommand) {
        runtimeTemplate.startup = server.startupCommand;
      }

      const success = await gateway.sendToAgent(server.nodeId, {
        type: "start_server",
        serverId: server.id,
        serverUuid: server.uuid,
        template: runtimeTemplate,
        environment: environment,
        allocatedMemoryMb: server.allocatedMemoryMb,
        allocatedCpuCores: server.allocatedCpuCores,
        allocatedDiskMb: server.allocatedDiskMb,
        primaryPort: server.primaryPort,
        portBindings: parseStoredPortBindings(server.portBindings),
        networkMode: server.networkMode,
      });

      if (!success) {
        return reply.status(503).send({ error: "Failed to send command to agent" });
      }

      // Update server status
      await prisma.server.update({
        where: { id: serverId },
        data: { status: "starting" },
      });

      reply.send({ success: true, message: "Start command sent to agent" });
    }
  );

  // Stop server (sends stop command to agent)
  app.post(
    "/:serverId/stop",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;

      const server = await prisma.server.findUnique({
        where: { id: serverId },
        include: {
          node: true,
          template: true,
        },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      if (!ensureNotSuspended(server, reply)) {
        return;
      }

      // Check permissions
      if (server.ownerId !== userId && !(await isAdminUser(userId, "admin.read"))) {
        const access = await prisma.serverAccess.findFirst({
          where: {
            userId,
            serverId,
            permissions: { has: "server.stop" },
          },
        });
        const hasNodeAccessToServer = await hasNodeAccess(prisma, userId, server.nodeId);
        if (!access && !hasNodeAccessToServer) {
          return reply.status(403).send({ error: "Forbidden" });
        }
      }

      // Validate state transition
      const currentState = server.status as ServerState;
      if (!ServerStateMachine.canStop(currentState)) {
        return reply.status(409).send({
          error: `Cannot stop server in ${server.status} state. Server must be running or starting.`,
        });
      }

      // Check if node is online
      if (!server.node.isOnline) {
        return reply.status(503).send({ error: "Node is offline" });
      }

      // Send stop command to agent via WebSocket
      const gateway = (app as any).wsGateway;
      if (!gateway) {
        return reply.status(500).send({ error: "WebSocket gateway not available" });
      }

      const success = await gateway.sendToAgent(server.nodeId, {
        type: "stop_server",
        serverId: server.id,
        serverUuid: server.uuid,
        template: patchTemplateForRuntime(server.template),
      });

      if (!success) {
        return reply.status(503).send({ error: "Failed to send command to agent" });
      }

      // Update server status
      await prisma.server.update({
        where: { id: serverId },
        data: { status: "stopping" },
      });

      reply.send({ success: true, message: "Stop command sent to agent" });
    }
  );

  // Restart server (stop then start)
  app.post(
    "/:serverId/restart",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;

      const server = await prisma.server.findUnique({
        where: { id: serverId },
        include: {
          template: true,
          node: true,
        },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      if (!ensureNotSuspended(server, reply)) {
        return;
      }

      // Check permissions
      if (server.ownerId !== userId && !(await isAdminUser(userId, "admin.read"))) {
        const access = await prisma.serverAccess.findFirst({
          where: {
            userId,
            serverId,
            permissions: { has: "server.stop" }, // Needs both start and stop
          },
        });
        const hasNodeAccessToServer = await hasNodeAccess(prisma, userId, server.nodeId);
        if (!access && !hasNodeAccessToServer) {
          return reply.status(403).send({ error: "Forbidden" });
        }
        // Also need to check for server.start permission
        const hasStartAccess = access?.permissions.includes("server.start");
        if (!hasStartAccess && !hasNodeAccessToServer) {
          return reply.status(403).send({ error: "Forbidden" });
        }
      }

      // Validate state
      const currentState = server.status as ServerState;
      if (!ServerStateMachine.canRestart(currentState)) {
        return reply.status(409).send({
          error: `Cannot restart server in ${server.status} state`,
        });
      }

      // Check if node is online
      if (!server.node.isOnline) {
        return reply.status(503).send({ error: "Node is offline" });
      }

      const gateway = (app as any).wsGateway;
      if (!gateway) {
        return reply.status(500).send({ error: "WebSocket gateway not available" });
      }
      const runtimeTemplate = patchTemplateForRuntime(server.template);

      // If running, stop first
      if (currentState === ServerState.RUNNING) {
        await gateway.sendToAgent(server.nodeId, {
          type: "stop_server",
          serverId: server.id,
          serverUuid: server.uuid,
          template: runtimeTemplate,
        });
        await prisma.server.update({
          where: { id: serverId },
          data: { status: "stopping" },
        });
      }

      // Start after a delay (agent will handle the actual timing)
      const serverDir = server.node.serverDataDir || "/var/lib/catalyst/servers";
      const fullServerDir = `${serverDir}/${server.uuid}`;
      
      const environment: Record<string, string> = {
        ...(server.environment as Record<string, string>),
        SERVER_DIR: fullServerDir,
      };
      if (server.template?.image) {
        const resolvedImage = resolveTemplateImage(server.template, environment);
        environment.TEMPLATE_IMAGE = resolvedImage;
      }
      if (server.primaryIp && !environment.CATALYST_NETWORK_IP) {
        environment.CATALYST_NETWORK_IP = server.primaryIp;
      }
      if (server.networkMode === "host" && !environment.CATALYST_NETWORK_IP) {
        try {
          environment.CATALYST_NETWORK_IP = normalizeHostIp(server.node.publicAddress) || "";
        } catch (error: any) {
          return reply.status(400).send({ error: error.message });
        }
      }

      const success = await gateway.sendToAgent(server.nodeId, {
        type: "restart_server",
        serverId: server.id,
        serverUuid: server.uuid,
        template: runtimeTemplate,
        environment: environment,
        allocatedMemoryMb: server.allocatedMemoryMb,
        allocatedCpuCores: server.allocatedCpuCores,
        allocatedDiskMb: server.allocatedDiskMb,
        primaryPort: server.primaryPort,
        portBindings: parseStoredPortBindings(server.portBindings),
        networkMode: server.networkMode,
      });

      if (!success) {
        return reply.status(503).send({ error: "Failed to send command to agent" });
      }

      reply.send({ success: true, message: "Restart command sent to agent" });
    }
  );

  // List port allocations
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

      const hasAccess =
        server.ownerId === userId || server.access.some((access) => access.userId === userId);
      if (!hasAccess) {
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

      reply.send({ success: true, data: allocations });
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

      reply.send({
        success: true,
        data: {
          primaryPort: updated.primaryPort,
        },
      });
    }
  );

  // Update restart policy
  app.patch(
    "/:id/restart-policy",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const { restartPolicy, maxCrashCount } = request.body as {
        restartPolicy?: string;
        maxCrashCount?: number;
      };

      // Validate restart policy
      const validPolicies = ["always", "on-failure", "never"];
      if (restartPolicy && !validPolicies.includes(restartPolicy)) {
        return reply.status(400).send({
          error: `Invalid restart policy. Must be one of: ${validPolicies.join(", ")}`,
        });
      }

      // Validate max crash count
      if (maxCrashCount !== undefined && (maxCrashCount < 0 || maxCrashCount > 100)) {
        return reply.status(400).send({
          error: "maxCrashCount must be between 0 and 100",
        });
      }

      const server = await prisma.server.findUnique({
        where: { id },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      if (!ensureNotSuspended(server, reply)) {
        return;
      }

      const canUpdate = await ensureServerAccess(
        id,
        request.user.userId,
        "server.start",
        reply
      );
      if (!canUpdate) return;

      // Update server
      const updated = await prisma.server.update({
        where: { id },
        data: {
          restartPolicy: restartPolicy || server.restartPolicy,
          maxCrashCount: maxCrashCount ?? server.maxCrashCount,
        },
      });

      reply.send({
        success: true,
        restartPolicy: updated.restartPolicy,
        maxCrashCount: updated.maxCrashCount,
      });
    }
  );

  // Reset crash count
  app.post(
    "/:id/reset-crash-count",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      const server = await prisma.server.findUnique({
        where: { id },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      if (!ensureNotSuspended(server, reply)) {
        return;
      }

      const canUpdate = await ensureServerAccess(
        id,
        request.user.userId,
        "server.start",
        reply
      );
      if (!canUpdate) return;

      await prisma.server.update({
        where: { id },
        data: {
          crashCount: 0,
          lastCrashAt: null,
        },
      });

      reply.send({ success: true, message: "Crash count reset" });
    }
  );

  // Update backup settings
  app.patch(
    "/:id/backup-settings",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const {
        storageMode,
        retentionCount,
        retentionDays,
        s3Config,
        sftpConfig,
      } = request.body as {
        storageMode?: string;
        retentionCount?: number;
        retentionDays?: number;
        s3Config?: {
          bucket?: string | null;
          region?: string | null;
          endpoint?: string | null;
          accessKeyId?: string | null;
          secretAccessKey?: string | null;
          pathStyle?: boolean | null;
        } | null;
        sftpConfig?: {
          host?: string | null;
          port?: number | null;
          username?: string | null;
          password?: string | null;
          privateKey?: string | null;
          privateKeyPassphrase?: string | null;
          basePath?: string | null;
        } | null;
      };

      const validModes = ["local", "s3", "sftp", "stream"];
      if (storageMode && !validModes.includes(storageMode)) {
        return reply.status(400).send({
          error: `Invalid storage mode. Must be one of: ${validModes.join(", ")}`,
        });
      }

      if (
        retentionCount !== undefined &&
        (!Number.isFinite(retentionCount) || retentionCount < 0 || retentionCount > 1000)
      ) {
        return reply.status(400).send({ error: "retentionCount must be between 0 and 1000" });
      }

      if (
        retentionDays !== undefined &&
        (!Number.isFinite(retentionDays) || retentionDays < 0 || retentionDays > 3650)
      ) {
        return reply.status(400).send({ error: "retentionDays must be between 0 and 3650" });
      }

      const server = await prisma.server.findUnique({
        where: { id },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      if (!ensureNotSuspended(server, reply)) {
        return;
      }

      const canUpdate = await ensureServerAccess(
        id,
        request.user.userId,
        "server.start",
        reply
      );
      if (!canUpdate) return;

      const encryptedS3Config = s3Config ? encryptBackupConfig(s3Config) : undefined;
      const encryptedSftpConfig = sftpConfig ? encryptBackupConfig(sftpConfig) : undefined;
      const updated = await prisma.server.update({
        where: { id },
        data: {
          backupStorageMode: storageMode || server.backupStorageMode,
          backupRetentionCount:
            retentionCount !== undefined ? retentionCount : server.backupRetentionCount,
          backupRetentionDays:
            retentionDays !== undefined ? retentionDays : server.backupRetentionDays,
          backupS3Config: (encryptedS3Config ?? server.backupS3Config) as any,
          backupSftpConfig: (encryptedSftpConfig ?? server.backupSftpConfig) as any,
        },
      });

      reply.send({
        success: true,
        backupStorageMode: updated.backupStorageMode,
        backupRetentionCount: updated.backupRetentionCount,
        backupRetentionDays: updated.backupRetentionDays,
        backupS3Config: redactBackupConfig(decryptBackupConfig(updated.backupS3Config as any)),
        backupSftpConfig: redactBackupConfig(decryptBackupConfig(updated.backupSftpConfig as any)),
      });
    }
  );

  // Transfer server to another node
  app.post(
    "/:id/transfer",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const { targetNodeId, transferMode } = request.body as {
        targetNodeId: string;
        transferMode?: string;
      };

      if (!targetNodeId) {
        return reply.status(400).send({ error: "targetNodeId is required" });
      }

      const transferModes = ["local", "s3", "stream"];
      if (transferMode && !transferModes.includes(transferMode)) {
        return reply.status(400).send({
          error: `Invalid transferMode. Must be one of: ${transferModes.join(", ")}`,
        });
      }

      // Get server with current node
      const server = await prisma.server.findUnique({
        where: { id },
        include: { node: true },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      if (!ensureNotSuspended(server, reply)) {
        return;
      }


      // Check if user has permission
      const hasExplicitAccess = await prisma.serverAccess.findFirst({
        where: {
          serverId: id,
          userId: request.user.userId,
        },
      });

      const hasNodeAccessToServer = await hasNodeAccess(prisma, request.user.userId, server.nodeId);

      if (server.ownerId !== request.user.userId) {
        if (!hasExplicitAccess || !hasExplicitAccess.permissions.includes("server.transfer")) {
          if (!hasNodeAccessToServer) {
            return reply.status(403).send({
              error: "You do not have permission to transfer this server",
            });
          }
        }
      }

      // Check if already on target node
      if (server.nodeId === targetNodeId) {
        return reply.status(400).send({
          error: "Server is already on the target node",
        });
      }

      // Get target node
      const targetNode = await prisma.node.findUnique({
        where: { id: targetNodeId },
      });

      if (!targetNode) {
        return reply.status(404).send({ error: "Target node not found" });
      }

      // Check if target node is online
      if (!targetNode.isOnline) {
        return reply.status(400).send({
          error: "Target node is offline",
        });
      }

      // Check if target node has enough resources
      const serversOnTarget = await prisma.server.findMany({
        where: { nodeId: targetNodeId },
      });

      const usedMemory = serversOnTarget.reduce(
        (sum, s) => sum + s.allocatedMemoryMb,
        0
      );
      const usedCpu = serversOnTarget.reduce(
        (sum, s) => sum + s.allocatedCpuCores,
        0
      );

      if (
        usedMemory + server.allocatedMemoryMb > targetNode.maxMemoryMb ||
        usedCpu + server.allocatedCpuCores > targetNode.maxCpuCores
      ) {
        return reply.status(400).send({
          error: "Target node does not have enough resources",
          available: {
            memory: targetNode.maxMemoryMb - usedMemory,
            cpu: targetNode.maxCpuCores - usedCpu,
          },
          required: {
            memory: server.allocatedMemoryMb,
            cpu: server.allocatedCpuCores,
          },
        });
      }

      // Server must be stopped to transfer
      if (server.status !== "stopped") {
        return reply.status(400).send({
          error: "Server must be stopped before transfer",
          currentStatus: server.status,
        });
      }

      // Create a log entry
      await prisma.serverLog.create({
        data: {
          serverId: id,
          stream: "system",
          data: `Transfer initiated from node ${server.node.name} to ${targetNode.name}`,
        },
      });

      // Update server status to transferring
      await prisma.server.update({
        where: { id },
        data: { status: "transferring" },
      });

      // Get WebSocket gateway
      const wsGateway = (app as any).wsGateway;

      try {
        // Step 1: Create backup on source node
        await prisma.serverLog.create({
          data: {
            serverId: id,
            stream: "system",
            data: `Creating backup on source node...`,
          },
        });

        const backupName = `transfer-${Date.now()}`;
        const mode = (transferMode || server.backupStorageMode || "local") as import("../services/backup-storage").BackupStorageMode;
        const { buildBackupPaths, buildTransferBackupPath } = await import("../services/backup-storage");
        const { agentPath, storagePath, storageKey } = buildBackupPaths(server.uuid, backupName, mode, server);
        if (mode === "s3" && !storageKey) {
          throw new Error("Missing S3 storage key");
        }
        if (mode === "sftp" && !storageKey) {
          throw new Error("Missing SFTP storage key");
        }
        const transferPath = buildTransferBackupPath(server.uuid, backupName);

        const backupRecord = await prisma.backup.create({
          data: {
            serverId: server.id,
            name: backupName,
            path: mode === "stream" || mode === "s3" ? transferPath : storagePath,
            storageMode: mode,
            sizeMb: 0,
            metadata: { agentPath, storageKey, transferPath },
          },
        });

        await wsGateway.sendToAgent(server.nodeId, {
          type: "create_backup",
          serverId: id,
          backupName,
          backupPath: agentPath,
          backupId: backupRecord.id,
        });

        // Wait a moment for backup to be created (in production, use proper async handling)
        await new Promise((resolve) => setTimeout(resolve, 2000));

        await prisma.serverLog.create({
          data: {
            serverId: id,
            stream: "system",
            data: `Backup created: ${backupName}`,
          },
        });

        const backupPath = mode === "stream" || mode === "s3" || mode === "sftp" ? transferPath : storagePath;

        if (mode === "s3") {
          const { openStorageStream, uploadStreamToAgent } = await import("../services/backup-storage");
          const { stream } = await openStorageStream(
            {
              path: storagePath,
              storageMode: "s3",
              metadata: { storageKey },
            },
            server,
          );
          await uploadStreamToAgent(wsGateway, targetNodeId, id, server.uuid, transferPath, stream);
        }

        if (mode === "sftp") {
          const { openStorageStream, uploadStreamToAgent } = await import("../services/backup-storage");
          const { stream } = await openStorageStream(
            {
              path: storagePath,
              storageMode: "sftp",
              metadata: { storageKey },
            },
            server,
          );
          await uploadStreamToAgent(wsGateway, targetNodeId, id, server.uuid, transferPath, stream);
        }

        if (mode === "stream") {
          const { openStorageStream, uploadStreamToAgent } = await import("../services/backup-storage");
          const { stream } = await openStorageStream({
            path: backupPath,
            storageMode: "local",
            metadata: { storageKey },
          });
          await uploadStreamToAgent(wsGateway, targetNodeId, id, server.uuid, transferPath, stream);
        }

        await prisma.serverLog.create({
          data: {
            serverId: id,
            stream: "system",
            data: `Transferring backup to target node...`,
          },
        });

        // Step 4: Restore on target node
        await prisma.serverLog.create({
          data: {
            serverId: id,
            stream: "system",
            data: `Restoring on target node ${targetNode.name}...`,
          },
        });

        await wsGateway.sendToAgent(targetNodeId, {
          type: "restore_backup",
          serverId: id,
          serverUuid: server.uuid,
          backupPath: backupPath,
          backupId: backupRecord.id,
          serverDir: `${targetNode.serverDataDir || "/var/lib/catalyst/servers"}/${server.uuid}`,
        });

        // Step 5: Update server's nodeId and reassign IP if using IPAM
        await prisma.$transaction(async (tx) => {
          let nextEnvironment = server.environment as Record<string, string>;
          let nextPrimaryIp: string | null = server.primaryIp;

          if (shouldUseIpam(server.networkMode)) {
            await releaseIpForServer(tx, id);
            const allocatedIp = await allocateIpForServer(tx, {
              nodeId: targetNodeId,
              networkName: server.networkMode,
              serverId: id,
            });

            if (!allocatedIp) {
              throw new Error("No IP pool configured for target node network");
            }

            nextPrimaryIp = allocatedIp;
            nextEnvironment = {
              ...(server.environment as Record<string, string>),
              CATALYST_NETWORK_IP: allocatedIp,
            };
          }

          await tx.server.update({
            where: { id },
            data: {
              nodeId: targetNodeId,
              primaryIp: nextPrimaryIp,
              environment: nextEnvironment,
              status: "stopped",
              containerId: null, // Will be regenerated on new node
              containerName: null,
            },
          });
        });

        await prisma.serverLog.create({
          data: {
            serverId: id,
            stream: "system",
            data: `Transfer complete! Server is now on ${targetNode.name}`,
          },
        });

        reply.send({
          success: true,
          message: "Server transferred successfully",
          server: {
            id: server.id,
            name: server.name,
            previousNode: server.node.name,
            currentNode: targetNode.name,
          },
        });
      } catch (error: any) {
        // Rollback on error
        await prisma.server.update({
          where: { id },
          data: { status: "stopped" },
        });

        await prisma.serverLog.create({
          data: {
            serverId: id,
            stream: "system",
            data: `Transfer failed: ${error.message}`,
          },
        });

        return reply.status(500).send({
          error: "Transfer failed",
          message: error.message,
        });
      }
    }
  );

  // Suspend server
  app.post(
    "/:serverId/suspend",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;
      const { reason } = request.body as { reason?: string };

      if (!(await ensureSuspendPermission(userId, reply))) {
        return;
      }

      const server = await prisma.server.findUnique({
        where: { id: serverId },
        include: { node: true },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      if (server.suspendedAt) {
        return reply.status(409).send({ error: "Server is already suspended" });
      }

      if (server.status === "running" || server.status === "starting") {
        const gateway = (app as any).wsGateway;
        if (!gateway) {
          return reply.status(500).send({ error: "WebSocket gateway not available" });
        }
        if (!server.node?.isOnline) {
          return reply.status(503).send({ error: "Node is offline" });
        }
        await gateway.sendToAgent(server.nodeId, {
          type: "stop_server",
          serverId: server.id,
          serverUuid: server.uuid,
        });
      }

      const updated = await prisma.server.update({
        where: { id: serverId },
        data: {
          status: "suspended",
          suspendedAt: new Date(),
          suspendedByUserId: userId,
          suspensionReason: reason?.trim() || null,
        },
      });

      await prisma.auditLog.create({
        data: {
          userId,
          action: "server.suspend",
          resource: "server",
          resourceId: serverId,
          details: { reason: updated.suspensionReason ?? undefined },
        },
      });

      await prisma.serverLog.create({
        data: {
          serverId,
          stream: "system",
          data: `Server suspended${updated.suspensionReason ? `: ${updated.suspensionReason}` : ""}`,
        },
      });

      return reply.send({ success: true, data: updated });
    }
  );

  // Unsuspend server
  app.post(
    "/:serverId/unsuspend",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;

      if (!(await ensureSuspendPermission(userId, reply))) {
        return;
      }

      const server = await prisma.server.findUnique({
        where: { id: serverId },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      if (!server.suspendedAt) {
        return reply.status(409).send({ error: "Server is not suspended" });
      }

      const updated = await prisma.server.update({
        where: { id: serverId },
        data: {
          status: "stopped",
          suspendedAt: null,
          suspendedByUserId: null,
          suspensionReason: null,
        },
      });

      await prisma.auditLog.create({
        data: {
          userId,
          action: "server.unsuspend",
          resource: "server",
          resourceId: serverId,
          details: {},
        },
      });

      await prisma.serverLog.create({
        data: {
          serverId,
          stream: "system",
          data: "Server unsuspended",
        },
      });

      return reply.send({ success: true, data: updated });
    }
  );
}
