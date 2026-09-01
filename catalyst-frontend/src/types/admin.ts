export interface AdminStats {
  users: number;
  servers: number;
  nodes: number;
  activeServers: number;
}

export interface AdminUserRole {
  id: string;
  name: string;
  description?: string | null;
  permissions?: string[];
}

export interface AdminRole {
  id: string;
  name: string;
  description?: string | null;
  permissions: string[];
  userCount?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface AdminRolesResponse {
  roles: AdminRole[];
}

export interface AdminUserPasskey {
  id: string;
  name: string | null;
  createdAt: string;
}

export interface AdminUserAccount {
  id: string;
  providerId: string;
  accountId: string;
}

export interface AdminUser {
  id: string;
  email: string;
  username: string;
  createdAt: string;
  updatedAt: string;
  roles: AdminUserRole[];
  banned?: boolean;
  banReason?: string | null;
  banExpires?: string | null;
  emailVerified?: boolean;
  twoFactorEnabled?: boolean;
  lastSuccessfulLogin?: string | null;
  lastSignInIp?: string | null;
  accounts?: AdminUserAccount[];
  passkeys?: AdminUserPasskey[];
  twoFactor?: { id: string }[];
  _count?: {
    passkeys: number;
    sessions: number;
  };
}

export interface UserWithRoles extends AdminUser {
  roles: AdminUserRole[];
  permissions?: string[];
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface AdminUsersResponse {
  users: AdminUser[];
  pagination: PaginationMeta;
}

export interface AdminServerNode {
  id: string;
  name: string;
  hostname: string;
}

export interface AdminNode {
  id: string;
  name: string;
  locationId: string;
  hostname: string;
  publicAddress: string;
  sftpPort?: number;
  sftpEnabled?: boolean;
  isOnline: boolean;
  lastSeenAt?: string | null;
  maxMemoryMb: number;
  maxCpuCores: number;
  _count: {
    servers: number;
  };
  location?: {
    id: string;
    name: string;
  };
}

export interface AdminNodesResponse {
  nodes: AdminNode[];
}

export interface AdminServerTemplate {
  id: string;
  name: string;
}

export interface AdminServer {
  id: string;
  name: string;
  status: string;
  suspendedAt?: string | null;
  suspensionReason?: string | null;
  databaseAllocation?: number;
  allocatedMemoryMb?: number;
  allocatedCpuCores?: number;
  allocatedDiskMb?: number;
  ownerId?: string;
  owner?: {
    id: string;
    username: string;
    email: string;
  } | null;
  primaryIp?: string | null;
  primaryPort?: number | null;
  networkMode?: string | null;
  node: AdminServerNode;
  template: AdminServerTemplate;
}

export type AdminServerAction =
  | 'start'
  | 'stop'
  | 'restart'
  | 'suspend'
  | 'unsuspend'
  | 'delete';

export interface AdminServerActionResult {
  serverId: string;
  status: 'success' | 'failed' | 'skipped';
  error?: string;
}

export interface AdminServerActionResponse {
  success: boolean;
  results: AdminServerActionResult[];
  summary: Record<string, number>;
}

export interface AdminServersResponse {
  servers: AdminServer[];
  pagination: PaginationMeta;
}

export interface AuditLogUser {
  id: string;
  username: string;
  email: string;
}

export interface AuditLogEntry {
  id: string;
  action: string;
  resource: string;
  resourceId?: string | null;
  /** Backend stores this as `details` (Json). Kept as both for compat. */
  details?: Record<string, any> | null;
  /** @deprecated Use `details` — some older clients expected metadata. */
  metadata?: Record<string, any> | null;
  timestamp: string;
  ipAddress?: string | null;
  userId?: string | null;
  user?: AuditLogUser | null;
}

export interface AuditLogsResponse {
  logs: AuditLogEntry[];
  pagination: PaginationMeta;
}

export interface AdminHealthResponse {
  status: 'healthy' | 'degraded';
  database: 'connected' | 'disconnected';
  nodes: {
    total: number;
    online: number;
    offline: number;
    stale: number;
  };
  timestamp: string;
}

export interface DatabaseHost {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  password: string;
  engine: string;
  database: string;
  createdAt: string;
  updatedAt: string;
  _count?: {
    databases: number;
  };
}

export interface DatabaseHostPingResult {
  connected: boolean;
  latency: number;
  version?: string | null;
  databaseCount?: number;
  tableCount?: number;
  engine?: string;
  error?: string | null;
}

export interface DbStatusResult {
  connected: boolean;
  latency: number;
  engine: string;
  tableCount: number;
  sizeBytes: number;
  activeConnections: number;
  rowCounts: {
    users: number;
    servers: number;
    nodes: number;
    sessions: number;
  };
  error?: string | null;
}

export interface SmtpSettings {
  host: string | null;
  port: number | null;
  username: string | null;
  password: string | null;
  from: string | null;
  replyTo: string | null;
  secure: boolean;
  requireTls: boolean;
  pool: boolean;
  maxConnections: number | null;
  maxMessages: number | null;
}

export interface SecuritySettings {
  authRateLimitMax: number;
  authRateLimitWindowMs: number;
  fileRateLimitMax: number;
  fileRateLimitWindowMs: number;
  consoleRateLimitMax: number;
  consoleRateLimitWindowMs: number;
  consoleOutputLinesMax: number;
  consoleOutputByteLimitBytes: number;
  agentMessageMax: number;
  agentMetricsMax: number;
  serverMetricsMax: number;
  lockoutMaxAttempts: number;
  lockoutWindowMinutes: number;
  lockoutDurationMinutes: number;
  auditRetentionDays: number;
  maxBufferMb: number;
  // Email verification
  requireEmailVerification: boolean;
  // File tunnel settings
  fileTunnelRateLimitMax: number;
  fileTunnelRateLimitWindowMs: number;
  fileTunnelMaxUploadMb: number;
  fileTunnelMaxPendingPerNode: number;
  fileTunnelConcurrentMax: number;
}

export interface ModManagerSettings {
  curseforgeApiKey: string | null;
  modrinthApiKey: string | null;
}

export interface AuthLockout {
  id: string;
  email: string;
  ipAddress: string;
  userAgent?: string | null;
  failureCount: number;
  firstFailedAt: string;
  lastFailedAt: string;
  lockedUntil?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuthLockoutsResponse {
  lockouts: AuthLockout[];
  pagination: PaginationMeta;
}

// Role management types

/** Role wizard scoped-access step: server/node grants for this role. */
export type RoleScopeMode = 'none' | 'nodes' | 'servers';
export interface RoleScope {
  mode: RoleScopeMode;
  /** Node ids for mode 'nodes'; "*" = all nodes. */
  nodeIds?: string[];
  serverIds?: string[];
  /** Subset of ALL_SERVER_PERMISSIONS (GET /api/permissions/server). */
  permissions?: string[];
}

export interface Role {
  id: string;
  name: string;
  description?: string;
  permissions: string[];
  userCount?: number;
  serverGrantCount?: number;
  nodeGrantCount?: number;
  scope?: RoleScope;
  serverGrants?: Array<{ serverId: string; permissions: string[]; server?: { name: string; node?: { name: string } } }>;
  nodeGrants?: Array<{ nodeId: string | null; permissions: string[]; node?: { name: string } | null }>;
  createdAt: string;
  updatedAt: string;
}

export interface RoleCreateInput {
  name: string;
  description?: string;
  permissions: string[];
  scope?: RoleScope;
}

export interface RoleUpdateInput {
  name?: string;
  description?: string;
  permissions?: string[];
  scope?: RoleScope;
}

export interface RolePreset {
  key: string;
  label: string;
  description: string;
  permissions: string[];
}

export interface PermissionCategory {
  label: string;
  permissions: string[];
}

export interface SystemError {
  id: string;
  level: 'error' | 'warn' | 'critical';
  component: string;
  message: string;
  stack?: string | null;
  metadata?: Record<string, any> | null;
  requestId?: string | null;
  userId?: string | null;
  nodeId?: string | null;
  resolved: boolean;
  createdAt: string;
}

export interface SystemErrorsResponse {
  errors: SystemError[];
  pagination: PaginationMeta;
}

export interface RoleUsersResponse {
  user: {
    id: string;
    email: string;
    username: string;
  };
  roles: Role[];
  permissions: string[];
}

export interface DnsSettings {
  enabled: boolean;
  provider: string | null;
  baseDomain: string | null;
  cloudflareApiToken: string | null;
  cloudflareZoneId: string | null;
}

export interface UpdateStatusResponse {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  lastCheckedAt: string | null;
  releaseUrl: string | null;
  isDocker: boolean;
  autoUpdateEnabled: boolean;
}

export interface UpdateStateResponse {
  state: 'idle' | 'pulling' | 'restarting' | 'failed';
  message: string | null;
  startedAt: string | null;
  updatedAt: string | null;
}
