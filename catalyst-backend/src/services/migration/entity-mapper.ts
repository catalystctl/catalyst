/**
 * Entity Mapper — Converts Pterodactyl entities to Catalyst Prisma-compatible formats
 */

import type { PrismaClient } from "@prisma/client";
import { nanoid } from "nanoid";
import { sanitizeStartupCommand } from "../../utils/sanitize-startup";
import {
  PTERODACTYL_PERMISSION_MAP,
  type PterodactylLocation,
  type PterodactylNode,
  type PterodactylNest,
  type PterodactylEgg,
  type PterodactylEggVariable,
  type PterodactylUser,
  type PterodactylServer,
  type PterodactylAllocation,
  type PterodactylDatabase,
  type PterodactylDatabaseHost,
  type PterodactylSchedule,
  type PterodactylScheduleTask,
  type PterodactylBackup,
  type PterodactylSubuser,
} from "./types";

/** Maps Pterodactyl location IDs → Catalyst location IDs */
export type IdMap = Map<number, string>;

export class EntityMapper {
  private idMaps: {
    locations: IdMap;
    nodes: IdMap;
    nests: IdMap;
    eggs: IdMap;      // egg ID → template ID
    users: IdMap;
    servers: IdMap;
    dbHosts: IdMap;
  };

  constructor(private prisma: PrismaClient) {
    this.idMaps = {
      locations: new Map(),
      nodes: new Map(),
      nests: new Map(),
      eggs: new Map(),
      users: new Map(),
      servers: new Map(),
      dbHosts: new Map(),
    };
  }

  // ========================================================================
  // ID MAP ACCESSORS
  // ========================================================================

  get locationMap() { return this.idMaps.locations; }
  get nodeMap() { return this.idMaps.nodes; }
  get nestMap() { return this.idMaps.nests; }
  get eggMap() { return this.idMaps.eggs; }
  get userMap() { return this.idMaps.users; }
  get serverMap() { return this.idMaps.servers; }
  get dbHostMap() { return this.idMaps.dbHosts; }

  /** Per-server node mapping for server-scope migrations */
  serverNodeMap: Map<number, string> = new Map();
  /** Pterodactyl server numeric ID → UUID (needed for client API calls) */
  pteroServerUuidMap: Map<number, string> = new Map();
  /** Pterodactyl node ID → Pterodactyl location ID (servers don't have location directly in v1.x) */
  pteroNodeLocationMap: Map<number, number> = new Map();
  /** Pterodactyl allocation ID → { ip, port } (fetched from node allocation endpoints) */
  pteroAllocationMap: Map<number, { ip: string; port: number }> = new Map();

  // ========================================================================
  // LOCATION
  // ========================================================================

  mapLocation(ptero: PterodactylLocation): {
    data: { name: string; description: string };
    sourceId: number;
  } {
    return {
      data: {
        name: ptero.long || ptero.short,
        description: ptero.short !== ptero.long ? `${ptero.short} (${ptero.long})` : undefined as any,
      },
      sourceId: ptero.id,
    };
  }

  // ========================================================================
  // NODE
  // ========================================================================

  mapNode(
    ptero: PterodactylNode,
    catalystLocationId: string
  ): {
    data: {
      name: string;
      description: string | null;
      hostname: string;
      publicAddress: string;
      maxMemoryMb: number;
      maxCpuCores: number;
      locationId: string;
      isOnline: boolean;
      secret: string;
      serverDataDir: string;
    };
    sourceId: number;
  } {
    // Calculate actual max memory (base + overallocate percentage)
    const memoryOverallocate = ptero.memory_overallocate || 0;
    const baseMemory = ptero.memory || 0;
    const maxMemory = memoryOverallocate > 0
      ? baseMemory + Math.round(baseMemory * (memoryOverallocate / 100))
      : baseMemory;

    // Pterodactyl doesn't have CPU core limits per node, estimate from memory
    // (rough heuristic: 1 core per 2GB)
    const estimatedCores = Math.max(1, Math.round(maxMemory / 2048));

    return {
      data: {
        name: ptero.name,
        description: ptero.description || null,
        hostname: ptero.fqdn,
        publicAddress: ptero.fqdn,
        maxMemoryMb: maxMemory,
        maxCpuCores: estimatedCores,
        locationId: catalystLocationId,
        isOnline: false, // Will come online when agent connects
        secret: nanoid(32),
        serverDataDir: ptero.daemon_base || "/var/lib/catalyst/servers",
      },
      sourceId: ptero.id,
    };
  }

  // ========================================================================
  // TEMPLATE (Egg → ServerTemplate)
  // ========================================================================

  /**
   * Convert a Pterodactyl API egg response to the egg export JSON format,
   * then run it through the same import logic as POST /import-pterodactyl.
   * Returns the Prisma create data for ServerTemplate.
   */
  mapTemplate(ptero: PterodactylEgg, catalystNestId: string): {
    data: Record<string, any>;
    sourceId: number;
  } {
    // Extract variables from JSON:API relationships or flat array
    const rawVars: PterodactylEggVariable[] = [];
    if (ptero.relationships?.variables) {
      const rel = ptero.relationships.variables;
      if (Array.isArray(rel)) {
        for (const v of rel) {
          // JSON:API wrapped: { attributes: {...} }
          if (v && typeof v === 'object' && 'attributes' in v) {
            rawVars.push((v as any).attributes);
          } else {
            rawVars.push(v as any);
          }
        }
      } else if (typeof rel === 'object' && 'data' in (rel as any)) {
        const data = (rel as any).data;
        if (Array.isArray(data)) {
          for (const v of data) {
            if (v && typeof v === 'object' && 'attributes' in v) {
              rawVars.push((v as any).attributes);
            } else {
              rawVars.push(v as any);
            }
          }
        }
      }
    }

    // Map variables — same logic as POST /import-pterodactyl
    const mappedVariables = rawVars.map((v) => ({
      name: v.env_variable || v.name,
      description: v.description || "",
      default: v.default_value ?? "",
      required: v.rules ? String(v.rules).includes("required") : false,
      input: (v as any).field_type === "select" ? "select"
        : (v as any).field_type === "number" ? "number"
        : (v as any).field_type === "text" ? "text"
        : undefined,
      rules: v.rules ? String(v.rules).split("|").map((r: string) => r.trim()).filter(Boolean) : [],
    }));

    // Parse features — can be pipe-separated string, array, or undefined
    const rawFeatures = ptero.features;
    const eggFeatures: string[] = Array.isArray(rawFeatures)
      ? rawFeatures
      : (typeof rawFeatures === 'string' ? rawFeatures.split("|").filter(Boolean) : []);

    // Build config from nested config object (API response) or flat fields (egg export)
    const config: Record<string, any> = {};
    const cfg = (ptero as any).config;
    if (cfg?.startup) config.startup = cfg.startup;
    else if (ptero.config_startup) config.startup = ptero.config_startup;
    if (cfg?.logs) config.logs = cfg.logs;
    else if (ptero.config_logs) config.logs = ptero.config_logs;
    if (cfg?.stop) config.stop = cfg.stop;
    else if (ptero.config_stop) config.stop = ptero.config_stop;

    // Build images array — docker_images object (API) or docker_image string (both)
    const dockerImage = ptero.docker_image || "";
    const mappedImages = ptero.docker_images
      ? Object.entries(ptero.docker_images).map(([name, image]) => ({ name, image }))
      : dockerImage
        ? [{ name: "default", image: dockerImage }]
        : [];

    // Build features object — same as POST /import-pterodactyl
    const features: Record<string, any> = {};
    if (eggFeatures.length > 0) features.pterodactylFeatures = eggFeatures;
    if (config.startup) features.startupDetection = config.startup;
    if (config.logs) features.logDetection = config.logs;
    // Parse config_files — can be in config.files (API) or config_files (egg export)
    const rawConfigFiles = cfg?.files || ptero.config_files;
    if (rawConfigFiles) {
      try {
        const parsed = typeof rawConfigFiles === "string"
          ? JSON.parse(rawConfigFiles)
          : rawConfigFiles;
        if (typeof parsed === "object" && parsed !== null) {
          const keys = Object.keys(parsed);
          if (keys.length > 0) {
            features.pterodactylConfigFiles = parsed;
            features.configFile = keys[0];
            features.configFiles = keys;
          }
        }
      } catch { /* ignore */ }
    }

    // Stop command — from config.stop (API) or stop (egg export)
    const rawStopCommand = cfg?.stop || ptero.stop || "stop";
    const stopSignalMap: Record<string, "SIGTERM" | "SIGINT" | "SIGKILL"> = {
      "^C": "SIGINT", "^c": "SIGINT", "^^C": "SIGINT",
      "^SIGKILL": "SIGKILL", "^X": "SIGKILL",
      "SIGINT": "SIGINT", "SIGTERM": "SIGTERM", "SIGKILL": "SIGKILL",
    };
    const resolvedSignal = stopSignalMap[rawStopCommand] || "SIGTERM";
    const stopCommand = stopSignalMap[rawStopCommand] ? "" : rawStopCommand.replace(/^\//, "");
    const sendSignalTo = resolvedSignal;

    return {
      data: {
        name: ptero.name,
        description: ptero.description || null,
        author: ptero.author || "Pterodactyl Import",
        version: "PTDL_v2",
        image: dockerImage,
        images: mappedImages,
        defaultImage: dockerImage || null,
        installImage: ptero.script?.container || null,
        startup: sanitizeStartupCommand(ptero.startup || ""),
        stopCommand,
        sendSignalTo,
        variables: mappedVariables,
        installScript: ptero.script?.install || ptero.install_script || null,
        supportedPorts: [25565],
        allocatedMemoryMb: 1024,
        allocatedCpuCores: 1,
        features,
        nestId: catalystNestId,
      },
      sourceId: ptero.id,
    };
  }

  // ========================================================================
  // USER
  // ========================================================================

  mapUser(ptero: PterodactylUser): {
    data: {
      email: string;
      name: string;
      username: string;
      emailVerified: boolean;
      banned: boolean;
      firstName: string | null;
      lastName: string | null;
    };
    sourceId: number;
    isRootAdmin: boolean;
  } {
    const fullName = [ptero.first_name, ptero.last_name].filter(Boolean).join(" ").trim();
    const username = ptero.username || `user_${ptero.id}`;
    // v1.12.x uses root_admin, older versions use is_root_admin
    const isAdmin = ptero.is_root_admin || (ptero as any).root_admin || false;

    return {
      data: {
        email: ptero.email,
        name: fullName || username,
        username,
        emailVerified: true, // Assume verified since they existed in Pterodactyl
        banned: false,
        firstName: ptero.first_name || null,
        lastName: ptero.last_name || null,
      },
      sourceId: ptero.id,
      isRootAdmin: isAdmin,
    };
  }

  // ========================================================================
  // SERVER
  // ========================================================================

  mapServer(
    ptero: PterodactylServer,
    catalystTemplateId: string,
    catalystNodeId: string,
    catalystOwnerId: string,
    catalystLocationId: string,
    catalystTemplate: Record<string, any>,
    catalystNodeIp?: string | null
  ): {
    data: Record<string, any>;
    sourceId: number;
  } {
    // Build port bindings from ALL allocations (not just primary)
    // In v1.12.x, the list endpoint returns allocation as a numeric ID and
    // allocations as null. We use the pre-built pteroAllocationMap instead.
    const portBindings: Record<number, number> = {};

    // Resolve primary allocation from the allocation map
    let primaryPort = 25565;
    const primaryIp: string | null = catalystNodeIp || null;
    const allocationId = typeof ptero.allocation === 'number'
      ? ptero.allocation
      : (ptero.allocation as any)?.id;

    if (allocationId) {
      const alloc = this.pteroAllocationMap.get(allocationId);
      if (alloc) {
        primaryPort = alloc.port;
        // Note: primaryIp is set by the caller from the Catalyst NodeAllocation
        // for this port on the target node, not from Pterodactyl's allocation.
      }
    }

    // Also try ptero.allocations if present (non-v1.12.x or if populated)
    const allocations = ptero.allocations || [];
    for (const alloc of allocations) {
      if (alloc.port) {
        portBindings[alloc.port] = alloc.port;
      }
    }

    // Handle CPU allocation — Pterodactyl uses percentage (0-100*thread count)
    // Catalyst uses core count
    const cpuPercent = ptero.limits?.cpu || 0;
    const threads = ptero.limits?.threads;
    let cpuCores = 1;
    // Ensure primary port is always in portBindings
    portBindings[primaryPort] = primaryPort;

    if (threads && threads !== "0" && threads !== null) {
      cpuCores = parseInt(threads, 10) || 1;
    } else if (cpuPercent > 0) {
      cpuCores = Math.max(1, Math.round(cpuPercent / 100));
    }

    const memoryMb = ptero.limits?.memory || 1024;
    const diskMb = ptero.limits?.disk || 10240;

    // Build environment from Pterodactyl server's per-server variable values.
    // In v1.12.x, these are in container.environment (not top-level environment).
    // In egg export format, they're at the top level.
    const pteroEnv = ptero.container?.environment || ptero.environment || {};
    const environment: Record<string, string> = {};
    for (const [key, value] of Object.entries(pteroEnv)) {
      if (
        !key.startsWith("PTERODACTYL_") &&
        !key.startsWith("P_SERVER_") &&
        key !== "STARTUP"
      ) {
        environment[key] = value;
      }
    }

    // Set TEMPLATE_IMAGE to the server's docker_image override (or the egg's default)
    // In v1.12.x, the image is in container.image; in egg export it's docker_image
    const serverImage = ptero.container?.image || ptero.docker_image || catalystTemplate.image || "";
    if (serverImage) {
      environment.TEMPLATE_IMAGE = serverImage;
    }

    // Pterodactyl backup limit is a count (number of backups allowed)
    // Catalyst backupAllocationMb is storage in MB. Estimate ~1024MB per backup slot.
    // The Pterodactyl server also has `backups` field showing current count.
    const pteroBackupSlots = ptero.feature_limits?.backups ?? 0;
    const pteroDatabaseSlots = ptero.feature_limits?.databases ?? 0;
    const pteroAllocationSlots = ptero.feature_limits?.allocations ?? 0;

    return {
      data: {
        uuid: ptero.uuid,
        name: ptero.name,
        description: ptero.description || null,
        templateId: catalystTemplateId,
        nodeId: catalystNodeId,
        locationId: catalystLocationId,
        ownerId: catalystOwnerId,
        // Preserve suspended state from Pterodactyl
        status: "stopped",
        suspendedAt: ptero.suspended ? new Date().toISOString() : null,
        suspensionReason: ptero.suspended ? "Migrated from Pterodactyl (was suspended)" : null,

        // Resource limits
        allocatedMemoryMb: memoryMb,
        allocatedCpuCores: cpuCores,
        allocatedDiskMb: diskMb,
        allocatedSwapMb: ptero.limits?.swap || 0,
        ioWeight: ptero.limits?.io || 500,

        // Container info — use Pterodactyl identifier as the container name
        containerId: null,
        containerName: ptero.identifier || null,

        // Networking — all allocations mapped to port bindings
        networkMode: "bridge",
        primaryPort,
        primaryIp,
        portBindings,

        // Per-server environment (all egg variable values + docker image)
        environment,
        startupCommand: ptero.container?.startup_command || ptero.startup || null,

        // Backup settings from Pterodactyl feature_limits
        backupAllocationMb: pteroBackupSlots > 0 ? pteroBackupSlots * 1024 : 0,
        backupStorageMode: "local",
        backupRetentionCount: pteroBackupSlots > 0 ? pteroBackupSlots : 0,
        backupRetentionDays: 0,

        // Database allocation from Pterodactyl feature_limits
        databaseAllocation: pteroDatabaseSlots,
      },
      sourceId: ptero.id,
    };
  }

  // ========================================================================
  // DATABASE
  // ========================================================================

  mapDatabase(
    ptero: PterodactylDatabase,
    catalystServerId: string,
    catalystHostId: string
  ): {
    data: {
      serverId: string;
      hostId: string;
      name: string;
      username: string;
      password: string;
    };
    sourceId: number;
  } {
    // Use original password if available (same DB host), otherwise generate new
    const dbPassword = ptero.password || nanoid(24);

    return {
      data: {
        serverId: catalystServerId,
        hostId: catalystHostId,
        name: ptero.name.startsWith("s")
          ? ptero.name
          : `s${catalystServerId.slice(0, 6)}_${ptero.name}`,
        username: ptero.username,
        password: dbPassword,
      },
      sourceId: ptero.id,
    };
  }

  mapDatabaseHost(
    ptero: PterodactylDatabaseHost
  ): {
    data: {
      name: string;
      host: string;
      port: number;
      username: string;
      password: string;
    };
    sourceId: number;
  } {
    return {
      data: {
        name: ptero.name,
        host: ptero.host,
        port: ptero.port,
        username: ptero.username,
        // Use original password if available (same DB host), otherwise generate new
        password: ptero.password || nanoid(32),
      },
      sourceId: ptero.id,
    };
  }

  // ========================================================================
  // SCHEDULE
  // ========================================================================

  mapSchedule(
    ptero: PterodactylSchedule,
    catalystServerId: string
  ): {
    data: {
      serverId: string;
      name: string;
      description: string | null;
      action: string;
      payload: any;
      schedule: string;
      timeOffset: number;
      sequenceId: number | null;
      enabled: boolean;
    };
    sourceId: number;
  } {
    // Convert Pterodactyl cron to standard cron expression
    // v1.12.x: cron is nested under ptero.cron.{minute, hour, day_of_month, ...}
    // Older versions: flat fields cron_minute, cron_hour, etc.
    const cron = ptero.cron || {};
    const cronExpr = `${cron.minute ?? ptero.cron_minute ?? '*'} ${cron.hour ?? ptero.cron_hour ?? '*'} ${cron.day_of_month ?? ptero.cron_day_of_month ?? '*'} * ${cron.day_of_week ?? ptero.cron_day_of_week ?? '*'}`;

    // Map tasks to Catalyst format
    // v1.12.x client API: relationships.tasks is {object: "list", data: [...]}
    // Each item in data has {object, attributes: {...}}
    // Older versions: relationships.tasks is a bare array of resources
    const tasksRaw = ptero.relationships?.tasks;
    let tasks: PterodactylScheduleTask[] = [];
    if (Array.isArray(tasksRaw)) {
      tasks = tasksRaw.map((t: any) => t.attributes || t);
    } else if (tasksRaw && 'data' in tasksRaw && Array.isArray(tasksRaw.data)) {
      tasks = tasksRaw.data.map((t: any) => t.attributes || t);
    }
    const primaryTask = tasks.find((t) => t.sequence_id === 1) || tasks[0];

    // If no tasks were resolved (include=tasks may not work in some versions),
    // disable the schedule — it can't do anything meaningful without tasks
    if (tasks.length === 0) {
      return {
        data: {
          serverId: catalystServerId,
          name: ptero.name,
          description: `Migrated from Pterodactyl schedule #${ptero.id} (no tasks — disabled)`,
          action: "command",
          payload: {},
          schedule: cronExpr,
          timeOffset: 0,
          sequenceId: null,
          enabled: false,
        },
        sourceId: ptero.id,
      };
    }

    let action = "command";
    let payload: any = {};

    if (primaryTask) {
      switch (primaryTask.action) {
        case "power":
          switch (primaryTask.payload) {
            case "start":
              action = "start";
              break;
            case "stop":
              action = "stop";
              break;
            case "restart":
              action = "restart";
              break;
            case "kill":
              action = "stop";
              break;
            default:
              action = "command";
              payload = { command: primaryTask.payload };
          }
          break;
        case "command":
          action = "command";
          payload = { command: primaryTask.payload };
          break;
        case "backup":
          action = "backup";
          payload = {};
          break;
      }

      // If there are multiple tasks, chain them as commands
      if (tasks.length > 1) {
        const sortedTasks = [...tasks].sort((a, b) => a.time_offset - b.time_offset);
        const commands: string[] = [];
        for (const task of sortedTasks) {
          if (task.action === "command") {
            commands.push(task.payload);
          } else if (task.action === "power") {
            commands.push(`__power_${task.payload}`);
          }
        }
        if (commands.length > 1) {
          action = "command";
          payload = { command: commands.join("; ") };
        }
      }
    }

    return {
      data: {
        serverId: catalystServerId,
        name: ptero.name,
        description: `Migrated from Pterodactyl schedule #${ptero.id}`,
        action,
        payload,
        schedule: cronExpr,
        timeOffset: primaryTask?.time_offset || 0,
        sequenceId: primaryTask?.sequence_id || null,
        enabled: ptero.is_active,
      },
      sourceId: ptero.id,
    };
  }

  // ========================================================================
  // BACKUP
  // ========================================================================

  mapBackup(
    ptero: PterodactylBackup,
    catalystServerId: string
  ): {
    data: {
      serverId: string;
      name: string;
      path: string;
      storageMode: string;
      sizeMb: number;
      compressed: boolean;
      checksum: string | null;
      metadata: any;
    };
    sourceId: number;
    pteroServerId: number;
  } {
    const sizeMb = ptero.bytes ? Math.round(ptero.bytes / (1024 * 1024) * 100) / 100 : 0;

    return {
      data: {
        serverId: catalystServerId,
        name: ptero.name,
        path: `pterodactyl://${ptero.uuid}`,
        storageMode: "local",
        sizeMb,
        compressed: true, // Pterodactyl backups are compressed
        checksum: ptero.checksum || null,
        metadata: {
          pterodactylBackupId: ptero.id,
          pterodactylUuid: ptero.uuid,
          checksumType: ptero.checksum_type,
          ignoredFiles: ptero.ignored_files,
          createdAt: ptero.created_at,
          completedAt: ptero.completed_at,
          migrationSource: "pterodactyl",
        },
      },
      sourceId: ptero.id || 0,
      pteroServerId: ptero.relationships?.server?.attributes?.id || 0,
    };
  }

  // ========================================================================
  // SUBUSER
  // ========================================================================

  mapSubuser(
    ptero: PterodactylSubuser,
    catalystServerId: string,
    catalystUserId: string
  ): {
    data: {
      serverId: string;
      userId: string;
      permissions: string[];
    };
    sourceId: number;
  } {
    // Map Pterodactyl permissions to Catalyst permissions
    const catalystPermissions: string[] = [];
    const seen = new Set<string>();

    for (const perm of ptero.permissions || []) {
      const mapped = PTERODACTYL_PERMISSION_MAP[perm];
      if (mapped && !seen.has(mapped)) {
        catalystPermissions.push(mapped);
        seen.add(mapped);
      }
    }

    // Ensure they have at least read access
    if (!seen.has("server.read")) {
      catalystPermissions.push("server.read");
    }

    return {
      data: {
        serverId: catalystServerId,
        userId: catalystUserId,
        permissions: catalystPermissions,
      },
      sourceId: ptero.id,
    };
  }

  // ========================================================================
  // NODE MAPPING (Hybrid strategy)
  // ========================================================================

  /**
   * Determine how to map Pterodactyl nodes to Catalyst nodes.
   * Returns a map of pterodactylNodeId → { strategy: 'map'|'create', catalystNodeId?: string }
   */
  async resolveNodeMapping(
    pteroNodes: { id: number; fqdn: string; name: string }[],
    strategy: "hybrid" | "create" | "map",
    selectedNodes?: string[]
  ): Promise<Map<number, { strategy: "map" | "create"; catalystNodeId?: string }>> {
    const mapping = new Map<number, { strategy: "map" | "create"; catalystNodeId?: string }>();

    if (strategy === "create") {
      for (const node of pteroNodes) {
        if (selectedNodes && !selectedNodes.includes(String(node.id))) continue;
        mapping.set(node.id, { strategy: "create" });
      }
      return mapping;
    }

    // Get existing Catalyst nodes
    const existingNodes = await this.prisma.node.findMany({
      select: { id: true, hostname: true, name: true, publicAddress: true },
    });

    for (const pteroNode of pteroNodes) {
      if (selectedNodes && !selectedNodes.includes(String(pteroNode.id))) continue;

      if (strategy === "map") {
        // Find by hostname/IP
        const match = existingNodes.find(
          (n) =>
            n.hostname === pteroNode.fqdn ||
            n.publicAddress === pteroNode.fqdn ||
            n.name === pteroNode.name
        );
        if (match) {
          mapping.set(pteroNode.id, { strategy: "map", catalystNodeId: match.id });
        } else {
          mapping.set(pteroNode.id, { strategy: "create" });
        }
      } else {
        // Hybrid: map where possible, create where not
        const match = existingNodes.find(
          (n) =>
            n.hostname === pteroNode.fqdn ||
            n.publicAddress === pteroNode.fqdn ||
            n.name === pteroNode.name
        );
        if (match) {
          mapping.set(pteroNode.id, { strategy: "map", catalystNodeId: match.id });
        } else {
          mapping.set(pteroNode.id, { strategy: "create" });
        }
      }
    }

    return mapping;
  }
}
