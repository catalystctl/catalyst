/**
 * Catalyst - Shared Type Definitions
 * Client <-> Backend <-> Agent communication protocol
 */

// ============================================================================
// ENUMS & CONSTANTS
// ============================================================================

export enum ServerState {
  STOPPED = "stopped",
  INSTALLING = "installing",
  STARTING = "starting",
  RUNNING = "running",
  STOPPING = "stopping",
  CRASHED = "crashed",
  SUSPENDED = "suspended",
  ERROR = "error",
}

export enum NetworkMode {
  HOST = "host",
  BRIDGE = "bridge",
}

export enum Permission {
  // Server permissions
  SERVER_START = "server.start",
  SERVER_STOP = "server.stop",
  SERVER_READ = "server.read",
  SERVER_CREATE = "server.create",
  SERVER_DELETE = "server.delete",
  SERVER_SUSPEND = "server.suspend",
  SERVER_TRANSFER = "server.transfer",
  SERVER_SCHEDULE = "server.schedule",
  // Node permissions
  NODE_READ = "node.read",
  NODE_CREATE = "node.create",
  NODE_UPDATE = "node.update",
  NODE_DELETE = "node.delete",
  NODE_VIEW_STATS = "node.view_stats",
  NODE_MANAGE_ALLOCATION = "node.manage_allocation",
  // Location permissions
  LOCATION_READ = "location.read",
  LOCATION_CREATE = "location.create",
  LOCATION_UPDATE = "location.update",
  LOCATION_DELETE = "location.delete",
  // Template permissions
  TEMPLATE_READ = "template.read",
  TEMPLATE_CREATE = "template.create",
  TEMPLATE_UPDATE = "template.update",
  TEMPLATE_DELETE = "template.delete",
  // User management permissions
  USER_READ = "user.read",
  USER_CREATE = "user.create",
  USER_UPDATE = "user.update",
  USER_DELETE = "user.delete",
  USER_BAN = "user.ban",
  USER_UNBAN = "user.unban",
  USER_SET_ROLES = "user.set_roles",
  // Role management permissions
  ROLE_READ = "role.read",
  ROLE_CREATE = "role.create",
  ROLE_UPDATE = "role.update",
  ROLE_DELETE = "role.delete",
  // Backup permissions
  BACKUP_READ = "backup.read",
  BACKUP_CREATE = "backup.create",
  BACKUP_DELETE = "backup.delete",
  BACKUP_RESTORE = "backup.restore",
  // File and console permissions
  FILE_READ = "file.read",
  FILE_WRITE = "file.write",
  CONSOLE_READ = "console.read",
  CONSOLE_WRITE = "console.write",
  // Database permissions
  DATABASE_CREATE = "database.create",
  DATABASE_READ = "database.read",
  DATABASE_DELETE = "database.delete",
  DATABASE_ROTATE = "database.rotate",
  // Alert permissions
  ALERT_READ = "alert.read",
  ALERT_CREATE = "alert.create",
  ALERT_UPDATE = "alert.update",
  ALERT_DELETE = "alert.delete",
  // Admin permissions
  ADMIN_READ = "admin.read",
  ADMIN_WRITE = "admin.write",
  // API Key management
  APIKEY_MANAGE = "apikey.manage",
}

// ============================================================================
// SERVER TEMPLATE SYSTEM
// ============================================================================

export interface EnvironmentVariable {
  name: string;
  description?: string;
  default: string;
  required: boolean;
  input?: "text" | "number" | "select" | "checkbox";
  rules?: string[];
}

export interface TemplateImageOption {
  name: string;
  label?: string;
  image: string;
}

type ModManagerTarget = "mods" | "datapacks" | "modpacks";
type ModManagerProvider =
  | string
  | {
      id: string;
      label?: string;
      game?: string;
      targets?: ModManagerTarget[];
      curseforge?: {
        gameId?: string | number;
        gameSlug?: string;
        classIds?: Partial<Record<ModManagerTarget, string | number>>;
        classSlugs?: Partial<Record<ModManagerTarget, string>>;
        modLoaderMap?: Record<string, string | number>;
      };
    };

export interface ServerTemplate {
  id: string;
  name: string;
  description: string;
  author: string;
  version: string;
  image: string;
  images?: TemplateImageOption[];
  defaultImage?: string;
  startup: string;
  stopCommand: string;
  sendSignalTo: "SIGTERM" | "SIGKILL";
  variables: EnvironmentVariable[];
  installScript?: string;
  supportedPorts: number[];
  allocatedMemoryMb: number;
  allocatedCpuCores: number;
  features?: {
    restartOnExit?: boolean;
    maxInstances?: number;
    iconUrl?: string;
    configFile?: string;
    configFiles?: string[];
    modManager?: {
      providers: ModManagerProvider[];
      targets?: ModManagerTarget[];
      paths?: {
        mods?: string;
        datapacks?: string;
        modpacks?: string;
      };
    };
    pluginManager?: {
      providers: string[];
      paths?: {
        plugins?: string;
      };
    };
  };
}

export interface ServerInstance {
  id: string;
  uuid: string;
  name: string;
  description?: string;
  templateId: string;
  nodeId: string;
  ownerId: string;
  status: ServerState;
  allocatedMemoryMb: number;
  allocatedCpuCores: number;
  allocatedDiskMb: number;
  databaseAllocation?: number;
  container: {
    id: string;
    name: string;
  };
  networking: {
    mode: NetworkMode;
    primaryPort: number;
    primaryIp?: string;
    portBindings: Record<number, number>; // container port -> host port
  };
  environment: Record<string, string>;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// NODE MANAGEMENT
// ============================================================================

export interface Node {
  id: string;
  name: string;
  description?: string;
  hostname: string;
  publicAddress: string;
  secret: string;
  maxMemoryMb: number;
  maxCpuCores: number;
  isOnline: boolean;
  lastSeenAt?: Date;
  createdAt: Date;
}

export interface NodeHealth {
  cpuPercent: number;
  memoryUsageMb: number;
  memoryTotalMb: number;
  uptime: number;
  containerCount: number;
  diskUsageMb: number;
  diskTotalMb: number;
}

// ============================================================================
// WEBSOCKET EVENTS
// ============================================================================

export namespace WsEvent {
  // CLIENT -> BACKEND -> AGENT
  export interface ServerControl {
    action: "start" | "stop" | "kill" | "restart" | "reboot";
    serverId: string;
  }

  export interface ConsoleInput {
    serverId: string;
    data: string;
  }

  export interface FileOperation {
    type: "read" | "write" | "delete" | "list" | "compress" | "decompress";
    serverId: string;
    path: string;
    data?: string | Buffer;
    options?: Record<string, any>;
  }

  // AGENT -> BACKEND -> CLIENT
  export interface ConsoleOutput {
    serverId: string;
    timestamp: number;
    data: string;
    stream: "stdout" | "stderr";
  }

  export interface ServerStateUpdate {
    serverId: string;
    state: ServerState;
    timestamp: number;
    reason?: string;
    portBindings?: Record<number, number>;
    exitCode?: number;
  }

  export interface HealthReport {
    nodeId: string;
    health: NodeHealth;
    timestamp: number;
  }

  export interface FileOperationResponse {
    requestId: string;
    success: boolean;
    data?: any;
    error?: string;
  }

  // AUTH
  export interface NodeHandshake {
    type: "node_handshake";
    token: string;
    nodeId: string;
    tokenType?: "secret" | "api_key";
  }

  export interface NodeHandshakeResponse {
    type: "node_handshake_response";
    success: boolean;
    cert?: string;
    key?: string;
    backendAddress?: string;
  }
}

// ============================================================================
// API RESPONSES
// ============================================================================

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

// ============================================================================
// AUTHENTICATION
// ============================================================================

export interface JwtPayload {
  userId: string;
  email: string;
  username: string;
  permissions: Permission[];
  exp: number;
}

export interface DeploymentTokenPayload {
  nodeId: string;
  secret: string;
  exp: number;
}

// ============================================================================
// RBAC TYPES
// ============================================================================

export interface ScopedPermission {
  permission: string;
  resourceId?: string;
}

export interface Role {
  id: string;
  name: string;
  description?: string;
  permissions: string[];
  createdAt: string | Date;
  updatedAt: string | Date;
}

export interface RoleCreateInput {
  name: string;
  description?: string;
  permissions: string[];
}

export interface RoleUpdateInput {
  name?: string;
  description?: string;
  permissions?: string[];
}

// ============================================================================
// ERROR TYPES
// ============================================================================

export class CatalystError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode: number = 500
  ) {
    super(message);
    this.name = "CatalystError";
  }
}

export const ErrorCodes = {
  AUTH_INVALID_TOKEN: "AUTH_INVALID_TOKEN",
  AUTH_EXPIRED: "AUTH_EXPIRED",
  NODE_NOT_FOUND: "NODE_NOT_FOUND",
  NODE_OFFLINE: "NODE_OFFLINE",
  SERVER_NOT_FOUND: "SERVER_NOT_FOUND",
  SERVER_ALREADY_RUNNING: "SERVER_ALREADY_RUNNING",
  INSUFFICIENT_RESOURCES: "INSUFFICIENT_RESOURCES",
  CONTAINER_ERROR: "CONTAINER_ERROR",
  NETWORK_ERROR: "NETWORK_ERROR",
  FILE_ACCESS_DENIED: "FILE_ACCESS_DENIED",
  PERMISSION_DENIED: "PERMISSION_DENIED",
} as const;
