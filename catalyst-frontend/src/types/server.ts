export type ServerStatus =
  | 'running'
  | 'stopped'
  | 'installing'
  | 'starting'
  | 'stopping'
  | 'crashed'
  // Agent TCP-probe failure while the container is nominally up (P1-26).
  | 'unhealthy'
  | 'transferring'
  | 'cloning'
  | 'suspended'
  | 'restoring'
  | 'creating_backup'
  | 'archived'
  | 'error';

export type RestartPolicy = 'always' | 'on-failure' | 'never';
export type BackupStorageMode = 'local' | 's3' | 'sftp' | 'stream';
type ModManagerTarget = 'mods' | 'datapacks' | 'modpacks';
export interface ModManagerProviderObject {
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
}
type ModManagerProvider = string | ModManagerProviderObject;

export interface ServerOwnerInfo {
  id: string;
  username?: string | null;
  email?: string | null;
  name?: string | null;
}

export interface Server {
  id: string;
  ownerId?: string;
  /** Resolved owner profile from GET /api/servers/:id (not always present on list). */
  owner?: ServerOwnerInfo | null;
  name: string;
  status: ServerStatus;
  /** Soft realtime progress for install/transfer/clone (from SSE). */
  operationStage?: string | null;
  /** 0–100 when known. */
  operationProgress?: number | null;
  nodeId: string;
  templateId: string;
  nodeName?: string;
  primaryPort?: number;
  primaryIp?: string | null;
  portBindings?: Record<number, number>;
  networkMode?: string;
  environment?: Record<string, string>;
  startupCommand?: string | null;
  node?: {
    name?: string;
    hostname?: string;
    publicAddress?: string;
    sftpPort?: number;
    sftpEnabled?: boolean;
  };
  template?: {
    name?: string;
    image?: string;
    startup?: string;
    images?: Array<{
      name: string;
      label?: string;
      image: string;
    }>;
    defaultImage?: string;
    features?: {
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
  };
  cpuPercent?: number;
  memoryPercent?: number;
  memoryUsageMb?: number | null;
  diskUsageMb?: number | null;
  diskTotalMb?: number | null;
  allocatedMemoryMb?: number;
  allocatedCpuCores?: number;
  allocatedDiskMb?: number;
  allocatedSwapMb?: number;
  ioWeight?: number;
  backupStorageMode?: BackupStorageMode;
  backupRetentionCount?: number;
  backupRetentionDays?: number;
  backupAllocationMb?: number;
  databaseAllocation?: number;
  backupS3Config?: {
    bucket?: string | null;
    region?: string | null;
    endpoint?: string | null;
    accessKeyId?: string | null;
    secretAccessKey?: string | null;
    pathStyle?: boolean | null;
  } | null;
  backupSftpConfig?: {
    host?: string | null;
    port?: number | null;
    username?: string | null;
    password?: string | null;
    privateKey?: string | null;
    privateKeyPassphrase?: string | null;
    basePath?: string | null;
  } | null;
  restartPolicy?: RestartPolicy;
  crashCount?: number;
  maxCrashCount?: number;
  lastCrashAt?: string | null;
  lastExitCode?: number | null;
  suspendedAt?: string | null;
  suspendedByUserId?: string | null;
  suspensionReason?: string | null;
  connection?: {
    assignedIp?: string | null;
    nodeIp?: string | null;
    hostNetworkIp?: string | null;
    host?: string | null;
    port?: number | null;
  };
  /** Effective permissions for the current user on this server */
  effectivePermissions?: string[];
}

export interface ServerListParams {
  status?: ServerStatus;
  search?: string;
  nodeId?: string;
  [key: string]: string | number | boolean | null | undefined;
}

export interface CreateServerPayload {
  name: string;
  description?: string;
  templateId: string;
  nodeId: string;
  locationId: string;
  allocatedMemoryMb: number;
  allocatedCpuCores: number;
  allocatedDiskMb: number;
  allocatedSwapMb?: number;
  backupAllocationMb?: number;
  databaseAllocation?: number;
  primaryPort: number;
  primaryIp?: string | null;
  allocationId?: string;
  portBindings?: Record<number, number>;
  networkMode?: string;
  environment: Record<string, string>;
  ownerId?: string;
}

export interface UpdateServerPayload {
  name?: string;
  description?: string;
  startupCommand?: string | null;
  environment?: Record<string, string>;
  allocatedMemoryMb?: number;
  allocatedCpuCores?: number;
  allocatedDiskMb?: number;
  primaryPort?: number;
  primaryIp?: string | null;
  allocationId?: string;
  portBindings?: Record<number, number>;
  backupAllocationMb?: number;
  databaseAllocation?: number;
}

export type CloneMode = 'full' | 'configuration';

export interface CloneIncludeOptions {
  includeAccess?: boolean;
  includeRoleGrants?: boolean;
  includeScheduledTasks?: boolean;
  includeDatabases?: boolean;
  includeInstalledMods?: boolean;
}

/** Shared options for the preflight and submit calls. */
export interface CloneServerPayload extends CloneIncludeOptions {
  mode?: CloneMode;
  name?: string;
  description?: string;
  nodeId?: string;
  allocatedMemoryMb?: number;
  allocatedCpuCores?: number;
  allocatedDiskMb?: number;
  allocatedSwapMb?: number;
  ioWeight?: number;
  backupAllocationMb?: number;
  databaseAllocation?: number;
  environment?: Record<string, string>;
  ownerId?: string;
  allocationId?: string;
  networkMode?: string;
  backupStorageMode?: string;
  copyBackupCredentials?: boolean;
  /** Deprecated alias for `mode`. */
  copyFiles?: boolean;
  /** Submit-only: preflight confirmation binding. */
  preflightId?: string;
  fingerprint?: string;
  acknowledgedWarnings?: string[];
}

export interface ClonePreflightPayload extends CloneServerPayload {
  mode: CloneMode;
  targetNodeId: string;
}

export interface CloneBlocker {
  code: string;
  message: string;
  field?: string;
}

export interface CloneWarning {
  code: string;
  message: string;
  field?: string;
}

export interface CloneChange {
  field: string;
  label: string;
  from: string | number | null;
  to: string | number | null;
  nodeSpecific: boolean;
}

export interface ClonePlan {
  preflightId: string;
  fingerprint: string;
  mode: CloneMode;
  crossNode: boolean;
  source: {
    id: string;
    uuid: string;
    name: string;
    status: string;
    nodeId: string;
    nodeName: string;
    locationId: string;
    locationName: string;
    templateId: string;
    templateName: string;
    networkMode: string;
    primaryIp: string | null;
    primaryPort: number;
    dataDir: string;
    dataSizeBytes: number | null;
    installedMods: number;
    scheduledTasks: number;
    subUsers: number;
    databases: number;
  };
  target: {
    nodeId: string;
    nodeName: string;
    locationId: string;
    locationName: string;
    isOnline: boolean;
    agentVersion: string | null;
    serverDataDir: string;
    sftpPort: number;
    publicAddress: string;
    supportedNetworkModes: string[];
    capacity: {
      memoryFreeMb: number | 'unlimited';
      cpuFreeCores: number | 'unlimited';
      diskFreeBytes: number | null;
    };
  };
  resolved: {
    name: string;
    ownerId: string;
    nodeId: string;
    locationId: string;
    templateId: string;
    networkMode: string;
    primaryIp: string | null;
    primaryPort: number;
    portBindings: Record<number, number>;
    allocatedMemoryMb: number;
    allocatedCpuCores: number;
    allocatedDiskMb: number;
    backupStorageMode: string;
  };
  allocations: {
    required: boolean;
    mode: 'ipam' | 'allocation' | 'host-public' | 'none';
    available: Array<{ id: string; ip: string; port: number; alias: string | null }>;
    selected: { id: string; ip: string; port: number } | null;
  };
  includeSurfaces: {
    access: boolean;
    roleGrants: boolean;
    scheduledTasks: boolean;
    databases: boolean;
  };
  requirements: {
    sourceStopped: boolean;
    installWillRun: boolean;
    estimatedDurationSec: number | null;
  };
  changes: CloneChange[];
  blockers: CloneBlocker[];
  warnings: CloneWarning[];
}

export interface TransferServerPayload {
  targetNodeId: string;
  transferMode?: BackupStorageMode;
}

export type ServerAllocation = {
  containerPort: number;
  hostPort: number;
  isPrimary: boolean;
  allocationId?: string | null;
  ip?: string | null;
  alias?: string | null;
};

export interface ServerMetrics {
  cpuPercent: number;
  memoryPercent: number;
  memoryUsageMb?: number;
  networkRxBytes?: number;
  networkTxBytes?: number;
  diskIoMb?: number;
  diskUsageMb?: number;
  diskTotalMb?: number;
  timestamp: string;
}

export interface ServerMetricsPoint {
  cpuPercent: number;
  memoryUsageMb: number;
  diskIoMb?: number;
  diskUsageMb: number;
  networkRxBytes: string | number | null;
  networkTxBytes: string | number | null;
  timestamp: string;
}

export interface ServerMetricsResponse {
  latest: ServerMetricsPoint | null;
  averages: {
    cpuPercent: number;
    memoryUsageMb: number;
    diskIoMb?: number;
    diskUsageMb: number;
  } | null;
  history: ServerMetricsPoint[];
  count: number;
}

export interface ServerLogEntry {
  id?: string;
  logId?: string;
  stream: string;
  data: string;
  timestamp: string;
}

export interface ServerLogs {
  logs: ServerLogEntry[];
  count: number;
  requestedLines: number;
}

export type ServerPermissionPreset = 'readOnly' | 'power' | 'full' | 'custom';

export interface ServerAccessEntry {
  id: string;
  userId: string;
  serverId: string;
  permissions: string[];
  createdAt: string;
  updatedAt: string;
  user: {
    id: string;
    email: string;
    username: string;
  };
}

export interface ServerInvite {
  id: string;
  serverId: string;
  email: string;
  token: string;
  permissions: string[];
  invitedByUserId: string;
  createdAt: string;
  expiresAt: string;
  acceptedAt?: string | null;
  cancelledAt?: string | null;
}

/** Result of creating/regenerating an invite, with delivery info. */
export interface InviteDeliveryResult {
  invite: ServerInvite;
  inviteUrl: string;
  mailSent: boolean;
  mailConfigured: boolean;
}

export interface ServerInvitePreview {
  email: string;
  serverName: string;
  permissions: string[];
  expiresAt: string;
}

export interface ServerPermissionsResponse {
  success: boolean;
  data: ServerAccessEntry[];
  presets: {
    readOnly: string[];
    power: string[];
    full: string[];
  };
}

export interface ServerActivityLogEntry {
  id: string;
  userId: string | null;
  action: string;
  resource: string;
  resourceId: string | null;
  details: Record<string, unknown> | null;
  timestamp: string;
  user?: {
    id: string;
    username: string | null;
    email: string;
    name: string | null;
  } | null;
}

export interface ServerActivityLogResponse {
  success: boolean;
  data: ServerActivityLogEntry[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface ServerStartupVariable {
  name: string;
  description: string;
  default: string;
  required: boolean;
  input: 'text' | 'number' | 'select' | 'checkbox';
  rules: string[];
  value: string;
}
