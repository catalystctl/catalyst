import { prisma } from '../../db.js';
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { PrismaClient } from "@prisma/client";
import { serialize } from '../../utils/serialize';
import { v4 as uuidv4 } from "uuid";
import { randomBytes } from "crypto";
import { decryptBackupConfig, encryptBackupConfig, redactBackupConfig } from "../../services/backup-credentials";
import { revokeSftpTokensForUser } from "../../services/sftp-token-manager";
import {
  validateAndNormalizePath,
  validateAndNormalizePaths,
  normalizeRequestPath,
  validateServerId,
} from "../../lib/path-validation.js";
// SECURITY NOTE: decryptBackupConfig MUST always be followed by redactBackupConfig
// when used in API response paths. Never expose decrypted credentials to clients.
import { ServerStateMachine } from "../../services/state-machine";
import { ServerState } from "../../shared-types";
import { createWriteStream } from "fs";
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execFile } from "child_process";
import { promisify } from "util";
import type { Readable } from "stream";
import { pipeline } from "stream/promises";
import { captureSystemError } from "../../services/error-logger";
import { nanoid } from "nanoid";
import { auth } from "../../auth";
import {
  allocateIpForServer,
  releaseIpForServer,
  normalizeHostIp,
  shouldUseIpam,
} from "../../utils/ipam";
import { hasNodeAccess, getUserAccessibleNodes } from "../../lib/permissions";
import { serverCreateSchema, validateRequestBody } from "../../lib/validation";
import {
  DatabaseProvisioningError,
  dropDatabase,
  provisionDatabase,
  rotateDatabasePassword,
} from "../../services/mysql";
import {
  getModManagerSettings,
  getSecuritySettings,
  renderInviteEmail,
  sendEmail,
} from "../../services/mailer";
import { resolveModrinthGameVersion } from "../../services/modrinth-version-resolver";

export const MAX_PORT = 65535;
export const INVITE_EXPIRY_DAYS = 7;
export const DEFAULT_PERMISSION_PRESETS = {
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
    "server.reinstall",
    "server.rebuild",
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
    "server.reinstall",
    "server.rebuild",
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

export const parsePortValue = (value: unknown) => {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(parsed)) return null;
  const port = Number(parsed);
  if (!Number.isInteger(port) || port <= 0 || port > MAX_PORT) {
    return null;
  }
  return port;
};

export const parseStoredPortBindings = (value: unknown): Record<number, number> => {
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

export const normalizePortBindings = (value: unknown, primaryPort: number) => {
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

export const WILDCARD_HOST = "*";

export const collectUsedHostPortsByIp = (
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
  // Track network modes that use shared IP pools so we can catch conflicts
  // even when primaryIp is null but servers share the same network.
  const networkModePorts = new Map<string, Set<number>>();
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
    // Always record by explicit IP or wildcard
    const hostKey = server.primaryIp || WILDCARD_HOST;
    const bucket = used.get(hostKey) ?? new Set<number>();
    ports.forEach((port) => bucket.add(port));
    used.set(hostKey, bucket);
    // Also record by network mode for shared-network conflict detection.
    // When multiple servers use the same custom network without explicit IPs,
    // they share the same CNI IP pool and ports can collide.
    if (!server.primaryIp && server.networkMode) {
      const netKey = `network:${server.networkMode}`;
      const netBucket = networkModePorts.get(netKey) ?? new Set<number>();
      ports.forEach((port) => netBucket.add(port));
      networkModePorts.set(netKey, netBucket);
    }
  }
  // Merge network-mode buckets into the wildcard bucket so that
  // findPortConflict will detect cross-network collisions.
  const wildcard = used.get(WILDCARD_HOST) ?? new Set<number>();
  for (const ports of networkModePorts.values()) {
    for (const port of ports) {
      wildcard.add(port);
    }
  }
  used.set(WILDCARD_HOST, wildcard);
  return used;
};

export const findPortConflict = (
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

export const resolvePrimaryHostPort = (server: any) => {
  const primaryPort = parsePortValue(server?.primaryPort ?? undefined);
  if (!primaryPort) return null;
  const bindings = parseStoredPortBindings(server?.portBindings);
  return bindings[primaryPort] ?? primaryPort;
};

/**
 * Syncs port-related environment variables with the primaryPort.
 * This ensures that the server listens on the same port that is used for port forwarding.
 * Common port variable names: SERVER_PORT, PORT, GAME_PORT, QUERY_PORT (for secondary ports)
 */
export const syncPortEnvironmentVariables = (
  environment: Record<string, string>,
  primaryPort: number,
  portBindings?: Record<number, number>
): Record<string, string> => {
  const syncedEnv = { ...environment };

  // List of common primary port environment variable names
  const primaryPortVarNames = ["SERVER_PORT", "PORT", "GAME_PORT"];

  // Sync primary port variables if they exist in the environment
  for (const varName of primaryPortVarNames) {
    if (syncedEnv[varName] !== undefined) {
      syncedEnv[varName] = String(primaryPort);
    }
  }

  // Handle QUERY_PORT specially - if it's the primary port + 1, update it accordingly
  if (syncedEnv.QUERY_PORT !== undefined && portBindings) {
    // Find if there's a secondary port binding that's primary + 1
    const queryBinding = Object.entries(portBindings).find(
      ([containerPort, hostPort]) => {
        const cp = Number(containerPort);
        const hp = Number(hostPort);
        // Check if this is a query port (typically game port + 1)
        return cp === primaryPort + 1 || hp === primaryPort + 1;
      }
    );
    if (queryBinding) {
      syncedEnv.QUERY_PORT = queryBinding[0]; // Use container port
    }
  }

  return syncedEnv;
};

/**
 * Inject Pterodactyl-compatible environment variables for migrated servers.
 * Many Pterodactyl eggs reference these variables in install scripts
 * and startup commands (e.g. server.properties, MOTD, Java heap sizing).
 *
 * These are injected ONLY if the egg already defines them (i.e. they exist
 * as keys in the template's variable list or server's environment), so
 * non-Pterodactyl servers are unaffected.
 */
export const injectPterodactylCompatibilityVars = (
  environment: Record<string, string>,
  server: { uuid: string; name: string; primaryIp: string | null; primaryPort: number; allocatedMemoryMb: number; allocatedDiskMb: number },
  portBindings?: Record<number, number>
): Record<string, string> => {
  const env = { ...environment };

  // SERVER_IP — primary IP (many eggs use this for server-ip= in properties)
  if ("SERVER_IP" in env && server.primaryIp) {
    env.SERVER_IP = server.primaryIp;
  }

  // SERVER_UUID — server identifier (some eggs use for logging/identification)
  if ("SERVER_UUID" in env) {
    env.SERVER_UUID = server.uuid;
  }

  // SERVER_NAME — used in MOTD, server.properties, etc.
  if ("SERVER_NAME" in env) {
    env.SERVER_NAME = server.name;
  }

  // SERVER_TOTAL_MEMORY — Java heap sizing: ${SERVER_TOTAL_MEMORY}M
  if ("SERVER_TOTAL_MEMORY" in env) {
    env.SERVER_TOTAL_MEMORY = String(server.allocatedMemoryMb);
  }

  // SERVER_TOTAL_DISK — some eggs check available disk space
  if ("SERVER_TOTAL_DISK" in env) {
    env.SERVER_TOTAL_DISK = String(server.allocatedDiskMb);
  }

  // SERVER_PRIMARY_PORT — distinguish primary from additional ports
  if ("SERVER_PRIMARY_PORT" in env) {
    env.SERVER_PRIMARY_PORT = String(server.primaryPort);
  }

  // SERVER_PRIMARY_IP — same as SERVER_IP but explicit
  if ("SERVER_PRIMARY_IP" in env && server.primaryIp) {
    env.SERVER_PRIMARY_IP = server.primaryIp;
  }

  // SERVER_DESCRIPTION — used by some eggs for MOTD
  if ("SERVER_DESCRIPTION" in env && server.name) {
    env.SERVER_DESCRIPTION = server.name;
  }

  // SERVER_PORT_{port} — multi-port games (voice servers, query ports)
  // Only inject for ports that are already referenced in the environment
  if (portBindings) {
    for (const [containerPort] of Object.entries(portBindings)) {
      const key = `SERVER_PORT_${containerPort}`;
      if (key in env) {
        env[key] = containerPort;
      }
    }
  }

  return env;
};

export const resolveHostNetworkIp = (server: any, fallbackNode?: { publicAddress?: string }) => {
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

export const buildConnectionInfo = (
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

export const patchTemplateForRuntime = (template: any) => ({
  ...template,
  stopCommand: template.stopCommand ?? 'stop',
  sendSignalTo: template.sendSignalTo ?? 'SIGTERM',
  installImage: template.installImage ?? 'alpine:3.19',
});

export const withConnectionInfo = (server: any, fallbackNode?: { publicAddress?: string }) => ({
    ...server,
    backupS3Config: redactBackupConfig(decryptBackupConfig(server.backupS3Config)),
    backupSftpConfig: redactBackupConfig(decryptBackupConfig(server.backupSftpConfig)),
    connection: buildConnectionInfo(server, fallbackNode),
  });

export const __filename = fileURLToPath(import.meta.url);
export const __dirname = path.dirname(path.dirname(__filename));
// Using shared prisma instance from db.ts
export const execFileAsync = promisify(execFile);
export const serverDataRoot = process.env.SERVER_DATA_DIR || "/var/lib/catalyst/servers";
export let fileRateLimitMax = 30;
export let maxBufferBytes = 50 * 1024 * 1024;
export const modManagerProviders = new Map<string, string>(
  [
    ["curseforge", path.resolve(__dirname, "../mod-manager/curseforge.json")],
    ["modrinth", path.resolve(__dirname, "../mod-manager/modrinth.json")],
  ] as const
);
export const pluginManagerProviders = new Map<string, string>(
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
} catch (error: any) {
  captureSystemError({
    level: 'warn',
    component: 'ServerRoutes',
    message: `Failed to load security settings for file rate limits: ${error?.message || String(error)}`,
    stack: error?.stack,
  }).catch(() => {});
  console.warn("Failed to load security settings for file rate limits");
}

export const isMaxBufferError = (error: any): boolean =>
  error?.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" ||
  (error?.message && String(error.message).includes("maxBuffer length exceeded"));

export const maxBufferErrorResponse = () => {
  const currentMb = Math.round(maxBufferBytes / (1024 * 1024));
  return {
    error: "Output buffer limit exceeded",
    code: "MAX_BUFFER_EXCEEDED",
    currentMaxBufferMb: currentMb,
    recommendedMaxBufferMb: Math.max(currentMb * 2, 100),
  };
};



export const resolveTemplateImage = (
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

export const ensureServerAccess = async (
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

export const loadProviderConfig = async (provider: string) => {
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
export const loadPluginProviderConfig = async (provider: string) => {
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

export const buildProviderHeaders = (providerConfig: {
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

export type ModManagerTarget = "mods" | "datapacks" | "modpacks";
export type NormalizedModManagerProvider = {
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
export type NormalizedModManager = {
  providers: NormalizedModManagerProvider[];
  paths?: { mods?: string; datapacks?: string; modpacks?: string };
  targets?: ModManagerTarget[];
};

export const modManagerDefaultTargets: ModManagerTarget[] = ["mods", "datapacks", "modpacks"];

class SimpleLRU<K, V> extends Map<K, V> {
  private maxSize: number;
  constructor(maxSize: number) { super(); this.maxSize = maxSize; }
  set(key: K, value: V): this {
    if (this.size >= this.maxSize && !this.has(key)) {
      const firstKey = this.keys().next().value;
      if (firstKey !== undefined) {
        this.delete(firstKey);
      }
    }
    return super.set(key, value);
  }
}

export const curseforgeGameIdCache = new SimpleLRU<string, string>(1000);
export const curseforgeClassIdCache = new SimpleLRU<string, string>(1000);

export const normalizeTargetValue = (value: unknown): ModManagerTarget | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "mods" || normalized === "datapacks" || normalized === "modpacks") {
    return normalized;
  }
  return null;
};

export const normalizeTargetList = (value: unknown): ModManagerTarget[] => {
  if (!Array.isArray(value)) return [];
  const normalized = value
    .map((entry) => normalizeTargetValue(entry))
    .filter((entry): entry is ModManagerTarget => Boolean(entry));
  return Array.from(new Set(normalized));
};

export const normalizeCurseforgeIdMap = (
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

export const normalizeModLoaderMap = (value: unknown): Record<string, string> | undefined => {
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

export const normalizeModManagerProvider = (value: unknown): NormalizedModManagerProvider | null => {
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

export const resolveEnabledModManager = (modManager: unknown): NormalizedModManager | null => {
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

export const resolveModManagerProvider = (
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

export const getProviderTargets = (
  modManager: NormalizedModManager,
  providerEntry: NormalizedModManagerProvider
) =>
  providerEntry.targets?.length
    ? providerEntry.targets
    : modManager.targets?.length
      ? modManager.targets
      : modManagerDefaultTargets;

export const resolveCurseforgeGameId = async (
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
    return curseforgeGameIdCache.get(gameSlug) as string;
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

export const resolveCurseforgeClassId = async (
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

export const resolveCurseforgeLoaderType = (
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

export const ensureModManagerEnabled = (server: any, reply: FastifyReply) => {
  // Keep mod manager checks aligned with the runtime template patching used for Hytale.
  const runtimeTemplate = patchTemplateForRuntime(server.template);
  const modManager = resolveEnabledModManager(runtimeTemplate?.features?.modManager);
  if (!modManager) {
    reply.status(409).send({ error: "Mod manager not enabled for this template" });
    return null;
  }
  return modManager;
};
export const ensurePluginManagerEnabled = (server: any, reply: FastifyReply) => {
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

export const extractGameVersion = (environment: any) => {
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

export const resolveTemplatePath = (pathValue?: string, target?: string) => {
  if (pathValue) {
    return normalizeRequestPath(pathValue);
  }
  const safeTarget = target ? target.replace(/[^a-z0-9_-]/gi, "") : "mods";
  return normalizeRequestPath(`/${safeTarget}`);
};
export const sanitizeFilename = (value: string) => value.replace(/[^a-z0-9._-]/gi, "_");

/**
 * Resolve actual download URL + filename for Spigot resources.
 * Spigot version-specific download endpoints redirect to spigotmc.org which blocks programmatic access.
 * We prefer externalUrl from resource metadata, fallback to generic /download endpoint (cdn.spiget.org).
 */
export const resolveSpigotDownload = async (
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
export const resolvePaperDownload = async (
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
export const fetchDownload = async (
  downloadUrl: string,
  providerBaseUrl: string,
  providerHeaders: Record<string, string>
): Promise<Response> => {
  const dlHeaders = downloadUrl.startsWith(providerBaseUrl)
    ? providerHeaders
    : { "User-Agent": "CatalystPluginManager/1.0" };
  return fetch(downloadUrl, { headers: dlHeaders, redirect: "follow" });
};

export const resolveServerPath = async (serverUuid: string, requestedPath: string, nodeServerDataDir?: string) => {
  const baseDir = path.resolve(nodeServerDataDir || serverDataRoot, serverUuid);
  await fs.mkdir(baseDir, { recursive: true });
  const safePath = path.resolve(baseDir, requestedPath.replace(/\\/g, "/").replace(/^\/+/, ""));
  const basePrefix = baseDir.endsWith(path.sep) ? baseDir : `${baseDir}${path.sep}`;
  if (safePath !== baseDir && !safePath.startsWith(basePrefix)) {
    throw new Error("Path traversal attempt detected");
  }
  return { baseDir, targetPath: safePath };
};
export const validateArchiveEntries = async (archivePath: string, isZip: boolean) => {
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

export const isSuspensionEnforced = () => process.env.SUSPENSION_ENFORCED !== "false";

export const isSuspensionDeleteBlocked = () =>
  process.env.SUSPENSION_DELETE_POLICY === "block";

export const ensureNotSuspended = (server: any, reply: FastifyReply, message?: string) => {
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

// Check permissions from request.user.permissions (populated by auth middleware)
export const checkPerm = (request: any, permission: string): boolean => {
  const perms: string[] = request.user?.permissions ?? [];
  return perms.includes('*') || perms.includes(permission);
};

export const checkAnyPerm = (request: any, permissions: string[]): boolean => {
  const perms: string[] = request.user?.permissions ?? [];
  if (perms.includes('*')) return true;
  return permissions.some((p) => perms.includes(p));
};

export const checkIsAdmin = (request: any, required: "admin.read" | "admin.write" = "admin.read"): boolean => {
  const perms: string[] = request.user?.permissions ?? [];
  return perms.includes('*') || perms.includes('admin.write') || (required === 'admin.read' && perms.includes('admin.read'));
};

export const ensureSuspendPermission = (
  request: any,
  reply: FastifyReply,
  message?: string
) => {
  if (checkAnyPerm(request, ['*', 'admin.write', 'admin.read', 'server.suspend'])) {
    return true;
  }
  reply.status(403).send({ error: message || "Admin access required" });
  return false;
};

// isAdminUser remains DB-based — used by canAccessServer for per-server access checks
// where request may not be available in the same context
export const isAdminUser = async (userId: string, required: "admin.read" | "admin.write" = "admin.read") => {
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
export const canAccessServer = async (userId: string, server: { ownerId: string; nodeId: string }): Promise<boolean> => {
  // Owner can always access
  if (server.ownerId === userId) return true;

  // Admin can access all servers
  if (await isAdminUser(userId, "admin.write")) return true;

  // User with node assignment can access all servers on that node
  if (await hasNodeAccess(prisma, userId, server.nodeId)) return true;

  return false;
};

// Compute the effective permissions a user has on a specific server.
// Returns a string[] of permission identifiers (e.g. ['server.read', 'server.start', ...]).
export const ALL_SERVER_PERMISSIONS = [
  'server.read', 'server.start', 'server.stop', 'server.install',
  'server.transfer', 'server.delete', 'server.schedule',
  'console.read', 'console.write',
  'file.read', 'file.write',
  'backup.read', 'backup.create', 'backup.restore', 'backup.delete',
  'database.read', 'database.create', 'database.rotate', 'database.delete',
  'alert.read', 'alert.create', 'alert.update', 'alert.delete',
];

export const getEffectiveServerPermissions = async (
  userId: string,
  server: { ownerId: string; nodeId: string },
  serverAccess?: Array<{ userId: string; permissions: string[] }>,
  preComputedOwner?: boolean,
  preComputedExplicitAccess?: boolean,
  preComputedNodeAccess?: boolean,
): Promise<string[]> => {
  // Owner gets all server-scoped permissions
  if (preComputedOwner ?? server.ownerId === userId) {
    return ALL_SERVER_PERMISSIONS;
  }

  // Explicit server access entry — return their granted permissions
  if (preComputedExplicitAccess) {
    const access = serverAccess?.find((a) => a.userId === userId);
    return access ? [...access.permissions] : [];
  }

  // Pre-computed node access (already verified by caller)
  if (preComputedNodeAccess) {
    return ALL_SERVER_PERMISSIONS;
  }

  // Fallback: admin / wildcard role check (single DB query)
  const roles = await prisma.role.findMany({
    where: { users: { some: { id: userId } } },
    select: { permissions: true },
  });
  const rolePermissions = roles.flatMap((r) => r.permissions);
  if (rolePermissions.includes('*')) {
    return ALL_SERVER_PERMISSIONS;
  }

  // Last resort: check node access (expensive, up to 6 DB queries)
  if (await hasNodeAccess(prisma, userId, server.nodeId)) {
    return ALL_SERVER_PERMISSIONS;
  }

  return [];
};

export const isArchiveName = (value: string) => {
  const lowered = value.toLowerCase();
  return (
    lowered.endsWith(".tar.gz") ||
    lowered.endsWith(".tgz") ||
    lowered.endsWith(".zip")
  );
};

export const ensureDatabasePermission = async (
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

export const generateSafeIdentifier = (prefix: string, length = 10) => {
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
    if (byte < 252) {
      id += alphabet[byte % 36];
    }
  }
  return `${prefix}${id}`;
};

export const isValidDatabaseIdentifier = (value: string) => {
  return /^[a-z][a-z0-9_]+$/.test(value) && value.length >= 3 && value.length <= 32;
};

export const toDatabaseIdentifier = (value: string) => {
  // Limit input length to prevent ReDoS attacks
  const sanitized = value.slice(0, 100);
  return sanitized
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^_+|_+$/g, "");
};



// Re-exports for sub-route modules
export { prisma } from '../../db.js';
export type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
export { PrismaClient } from "@prisma/client";
export { serialize } from '../../utils/serialize.js';
export { v4 as uuidv4 } from "uuid";
export { randomBytes } from "crypto";
export { decryptBackupConfig, encryptBackupConfig, redactBackupConfig } from "../../services/backup-credentials.js";
export { revokeSftpTokensForUser } from "../../services/sftp-token-manager.js";
export { ServerStateMachine } from "../../services/state-machine.js";
export { ServerState } from "../../shared-types.js";
export { createWriteStream } from "fs";
export { promises as fs } from "fs";
export { default as path } from "path";
export { fileURLToPath } from "url";
export { execFile } from "child_process";
export { promisify } from "util";
export type { Readable } from "stream";
export { pipeline } from "stream/promises";
export { captureSystemError } from "../../services/error-logger.js";
export { nanoid } from "nanoid";
export { auth } from "../../auth.js";
export {
  allocateIpForServer,
  releaseIpForServer,
  normalizeHostIp,
  shouldUseIpam,
} from "../../utils/ipam.js";
export { hasNodeAccess, getUserAccessibleNodes } from "../../lib/permissions.js";
export { serverCreateSchema, validateRequestBody } from "../../lib/validation.js";
export {
  DatabaseProvisioningError,
  dropDatabase,
  provisionDatabase,
  rotateDatabasePassword,
} from "../../services/mysql.js";
export {
  getModManagerSettings,
  getSecuritySettings,
  renderInviteEmail,
  sendEmail,
} from "../../services/mailer.js";
export { resolveModrinthGameVersion } from "../../services/modrinth-version-resolver.js";


export const validateVariableRule = (
    value: string,
    rule: string
  ): string | null => {
    const [name, ...rest] = rule.split(":");
    const param = rest.join(":");
    switch (name) {
      case "between": {
        const [minStr, maxStr] = param.split(",");
        const num = Number(value);
        const min = Number(minStr);
        const max = Number(maxStr);
        if (Number.isNaN(num) || Number.isNaN(min) || Number.isNaN(max)) {
          return `Invalid numeric value`;
        }
        if (num < min || num > max) {
          return `Must be between ${min} and ${max}`;
        }
        return null;
      }
      case "regex": {
        try {
          const re = new RegExp(param);
          if (!re.test(value)) {
            return `Invalid format`;
          }
        } catch {
          return `Invalid rule configuration`;
        }
        return null;
      }
      case "in": {
        const allowed = param.split(",");
        if (!allowed.includes(value)) {
          return `Must be one of: ${allowed.join(", ")}`;
        }
        return null;
      }
      default:
        return null;
    }
  };
export { validateAndNormalizePath, validateAndNormalizePaths, normalizeRequestPath, validateServerId } from "../../lib/path-validation.js";
