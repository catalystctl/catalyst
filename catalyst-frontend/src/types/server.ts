export type ServerStatus =
  | 'running'
  | 'stopped'
  | 'installing'
  | 'starting'
  | 'stopping'
  | 'crashed'
  | 'transferring'
  | 'suspended';

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

export interface Server {
  id: string;
  ownerId?: string;
  name: string;
  status: ServerStatus;
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
  backupAllocationMb?: number;
  databaseAllocation?: number;
  primaryPort: number;
  primaryIp?: string | null;
  allocationId?: string;
  portBindings?: Record<number, number>;
  networkMode?: string;
  environment: Record<string, string>;
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

export interface TransferServerPayload {
  targetNodeId: string;
  transferMode?: BackupStorageMode;
}

export type ServerAllocation = {
  containerPort: number;
  hostPort: number;
  isPrimary: boolean;
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
  networkRxBytes: string;
  networkTxBytes: string;
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
