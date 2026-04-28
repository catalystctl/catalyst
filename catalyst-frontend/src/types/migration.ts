export interface MigrationJob {
  id: string;
  status: 'pending' | 'validating' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  sourceUrl: string;
  sourceVersion?: string;
  config: MigrationConfig;
  currentPhase?: string;
  progress: MigrationProgress;
  error?: string;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
  steps?: MigrationStep[];
  _count?: { steps: number };
}

export type MigrationScope = 'full' | 'node' | 'server';

/**
 * nodeMappings: Pterodactyl node ID → Catalyst node ID
 *   Used in 'full' and 'node' scopes. Every Ptero node must map to exactly
 *   one online Catalyst node. All servers on that Ptero node are placed on
 *   the target Catalyst node.
 *
 * serverMappings: Pterodactyl server ID → Catalyst node ID
 *   Used in 'server' scope. Each selected Ptero server is placed on the
 *   chosen Catalyst node.
 */
export interface MigrationConfig {
  scope: MigrationScope;
  nodeMappings: Record<string, string>;   // pteroNodeId → catalystNodeId
  serverMappings: Record<string, string>; // pteroServerId → catalystNodeId
  dryRun?: boolean;
  phases?: string[];
}

export interface MigrationProgress {
  phase?: string;
  total: number;
  completed: number;
  failed: number;
  skipped: number;
}

export interface MigrationStep {
  id: string;
  jobId: string;
  phase: string;
  action: string;
  sourceId?: string;
  targetId?: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  error?: string;
  durationMs?: number;
  metadata?: Record<string, unknown>;
  startedAt?: string;
  completedAt?: string;
}

export interface PterodactylTestResult {
  success: boolean;
  version?: string;
  stats?: {
    locations: number;
    nodes: number;
    nests: number;
    users: number;
    servers: number;
  };
  nodes?: PterodactylNodeInfo[];
  servers?: PterodactylServerInfo[];
  error?: string;
}

export interface PterodactylNodeInfo {
  id: number;
  name: string;
  fqdn: string;
  memory: number;
  serverCount: number;
}

export interface PterodactylServerInfo {
  id: number;
  uuid: string;
  name: string;
  nodeId: number;
  nodeName: string;
  state: string;
  eggName: string;
  nestName: string;
  backupSlots: number;
  currentBackups: number;
  /** Per-server migration summary */
  databases: number;
  schedules: number;
  subusers: number;
  hasAllocation: boolean;
  memory: number;
  disk: number;
  cpu: number;
  suspended: boolean;
}

export interface CatalystNodeOption {
  id: string;
  name: string;
  hostname: string;
  isOnline: boolean;
  lastSeenAt?: string | null;
  maxMemoryMb: number;
  usedMemoryMb: number;
  serverCount: number;
  locationName?: string;
}

export interface MigrationStepsResponse {
  steps: MigrationStep[];
  total: number;
  page: number;
  totalPages: number;
}

export const MIGRATION_PHASES = [
  { id: 'validate', label: 'Validation', icon: 'CheckCircle' },
  { id: 'locations', label: 'Locations', icon: 'MapPin' },
  { id: 'templates', label: 'Templates (Nests & Eggs)', icon: 'Egg' },
  { id: 'users', label: 'Users', icon: 'Users' },
  { id: 'servers', label: 'Servers', icon: 'Box' },
  { id: 'databases', label: 'Databases', icon: 'Database' },
  { id: 'schedules', label: 'Schedules', icon: 'Clock' },
  { id: 'backups', label: 'Backups', icon: 'HardDrive' },
  { id: 'files', label: 'Server Files', icon: 'FileArchive' },
] as const;

export type MigrationPhaseId = (typeof MIGRATION_PHASES)[number]['id'];

export const PHASE_STATUS_COLORS: Record<string, string> = {
  pending: 'text-muted-foreground',
  running: 'text-blue-400',
  completed: 'text-emerald-400',
  failed: 'text-red-400',
  skipped: 'text-muted-foreground',
};
