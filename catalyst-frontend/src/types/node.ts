export interface NodeInfo {
  id: string;
  name: string;
  locationId: string;
  isOnline: boolean;
  agentVersion?: string | null;
  lastSeenAt?: string | null;
  description?: string | null;
  hostname?: string;
  publicAddress?: string;
  serverDataDir?: string;
  consoleLogDir?: string | null;
  cniDir?: string | null;
  cniBinDir?: string | null;
  cniDataDir?: string | null;
  cniResultsDir?: string | null;
  cniBridgeName?: string | null;
  cniBridgeSubnet?: string | null;
  systemdOverrideDir?: string | null;
  agentConfigPath?: string | null;
  agentReleaseRepo?: string | null;
  sftpPort?: number;
  sftpEnabled?: boolean;
  maxMemoryMb?: number;
  maxCpuCores?: number;
  memoryOverallocatePercent?: number;
  cpuOverallocatePercent?: number;
  createdAt?: string;
  updatedAt?: string;
  servers?: Array<{
    id: string;
    uuid?: string;
    name: string;
    status: string;
  }>;
  _count?: {
    servers: number;
  };
  location?: {
    id: string;
    name: string;
  };
}

export interface NodeAllocation {
  id: string;
  nodeId: string;
  serverId?: string | null;
  ip: string;
  port: number;
  alias?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NodeStats {
  nodeId: string;
  isOnline: boolean;
  lastSeenAt?: string | null;
  resources: {
    maxMemoryMb: number;
    maxCpuCores: number;
    allocatedMemoryMb: number;
    allocatedCpuCores: number;
    availableMemoryMb: number;
    availableCpuCores: number;
    memoryUsagePercent: number;
    cpuUsagePercent: number;
    actualMemoryUsageMb: number;
    actualMemoryTotalMb: number;
    actualCpuPercent: number;
    actualDiskUsageMb: number;
    actualDiskTotalMb: number;
    memoryOverallocatePercent?: number;
    cpuOverallocatePercent?: number;
    effectiveMaxMemoryMb?: number;
    effectiveMaxCpuCores?: number;
  };
  servers: {
    total: number;
    running: number;
    stopped: number;
  };
  lastMetricsUpdate?: string | null;
  agentVersion?: string | null;
  agentUpdateAvailable?: boolean | null;
  latestAgentVersion?: string | null;
}

export interface NodeMetricsPoint {
  cpuPercent: number;
  memoryUsageMb: number;
  memoryTotalMb: number;
  diskUsageMb: number;
  diskTotalMb: number;
  networkRxBytes: string;
  networkTxBytes: string;
  containerCount: number;
  timestamp: string;
}

export interface NodeMetricsResponse {
  latest: NodeMetricsPoint | null;
  averages: {
    cpuPercent: number;
    memoryUsageMb: number;
    diskUsageMb: number;
    containerCount: number;
  } | null;
  history: NodeMetricsPoint[];
  count: number;
  node: {
    id: string;
    name: string;
    maxMemoryMb: number;
    maxCpuCores: number;
    isOnline: boolean;
  };
}
