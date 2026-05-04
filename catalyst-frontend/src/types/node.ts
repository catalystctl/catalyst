export interface NodeInfo {
  id: string;
  name: string;
  locationId: string;
  isOnline: boolean;
  lastSeenAt?: string | null;
  description?: string | null;
  hostname?: string;
  publicAddress?: string;
  serverDataDir?: string;
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
