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

export interface AdminUser {
  id: string;
  email: string;
  username: string;
  createdAt: string;
  updatedAt: string;
  roles: AdminUserRole[];
  banned?: boolean;
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
  isOnline: boolean;
  lastSeenAt?: string | null;
  maxMemoryMb: number;
  maxCpuCores: number;
  _count: {
    servers: number;
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
  createdAt: string;
  updatedAt: string;
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
  fileRateLimitMax: number;
  consoleRateLimitMax: number;
  consoleOutputByteLimitBytes: number;
  lockoutMaxAttempts: number;
  lockoutWindowMinutes: number;
  lockoutDurationMinutes: number;
  auditRetentionDays: number;
  maxBufferMb: number;
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
export interface Role {
  id: string;
  name: string;
  description?: string;
  permissions: string[];
  userCount?: number;
  createdAt: string;
  updatedAt: string;
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

export interface RoleUsersResponse {
  user: {
    id: string;
    email: string;
    username: string;
  };
  roles: Role[];
  permissions: string[];
}
