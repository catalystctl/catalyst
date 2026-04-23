/**
 * Centralized TanStack Query key constants.
 * Import from here instead of hardcoding strings — rename in one place.
 */
export const qk = {
  // ── Auth ──────────────────────────────────────────────────────────
  session: () => ['session'] as const,

  // ── Server ──────────────────────────────────────────────────────────
  server: (id: string) => ['server', id] as const,
  servers: (filters?: Record<string, unknown>) => ['servers', filters ?? null] as const,
  serverPermissions: (id: string) => ['server-permissions', id] as const,
  serverInvites: (id: string) => ['server-invites', id] as const,
  serverAllocations: (id: string) => ['server-allocations', id] as const,

  // ── Backups ─────────────────────────────────────────────────────────
  backups: (serverId: string, page = 1, limit = 10) =>
    ['backups', serverId, { page, limit }] as const,

  // ── Tasks ──────────────────────────────────────────────────────────
  tasks: (serverId: string) => ['tasks', serverId] as const,

  // ── Files ──────────────────────────────────────────────────────────
  files: (serverId: string, path: string) => ['files', serverId, path] as const,

  // ── Databases ──────────────────────────────────────────────────────
  serverDatabases: (serverId: string) => ['server-databases', serverId] as const,
  databaseHosts: () => ['database-hosts'] as const,

  // ── Nodes ───────────────────────────────────────────────────────────
  nodes: () => ['nodes'] as const,
  node: (id: string) => ['node', id] as const,
  nodeAssignments: (nodeId: string) => ['nodes', nodeId, 'assignments'] as const,
  nodeApiKey: (nodeId: string) => ['node-api-key', nodeId] as const,
  accessibleNodes: () => ['nodes', 'accessible'] as const,
  nodeStats: (id: string) => ['node-stats', id] as const,
  nodeMetrics: (id: string) => ['node-metrics', id] as const,

  // ── Locations ──────────────────────────────────────────────────────
  locations: () => ['locations'] as const,

  // ── Nests ───────────────────────────────────────────────────────────
  nests: () => ['nests'] as const,

  // ── Templates ───────────────────────────────────────────────────────
  templates: () => ['templates'] as const,
  template: (id: string) => ['template', id] as const,

  // ── Dashboard ───────────────────────────────────────────────────────
  dashboard: () => ['dashboard'] as const,
  dashboardStats: () => ['dashboard-stats'] as const,
  clusterMetrics: () => ['cluster-metrics'] as const,
  dashboardActivity: (params?: Record<string, unknown>) => ['dashboard-activity', params ?? null] as const,
  dashboardResources: () => ['dashboard-resources'] as const,

  // ── Alerts ──────────────────────────────────────────────────────────
  alerts: () => ['alerts'] as const,
  alertRules: (params?: Record<string, unknown>) => ['alert-rules', params ?? null] as const,
  alertStats: () => ['alerts-stats'] as const,

  // ── API Keys ─────────────────────────────────────────────────────────
  apiKeys: () => ['api-keys'] as const,
  apiKeyVariable: (id: string) => ['api-key-variable', id] as const,
  apiKeyDetail: (id: string) => ['api-keys', id] as const,
  apiKeyUsage: (id: string) => ['api-keys', id, 'usage'] as const,

  // ── Permissions ──────────────────────────────────────────────────────
  permissionsCatalog: () => ['permissions-catalog'] as const,
  myPermissions: () => ['my-permissions'] as const,

  // ── Admin ───────────────────────────────────────────────────────────
  adminStats: () => ['admin-stats'] as const,
  adminHealth: () => ['admin-health'] as const,
  adminAuditLogs: (params?: Record<string, unknown>) => ['admin-audit-logs', params ?? null] as const,
  adminUsers: (params?: Record<string, unknown>) => ['admin-users', params ?? null] as const,
  adminNodes: (params?: Record<string, unknown>) => ['admin-nodes', params ?? null] as const,
  adminServers: (params?: Record<string, unknown>) => ['admin-servers', params ?? null] as const,
  adminPlugins: (params?: Record<string, unknown>) => ['admin-plugins', params ?? null] as const,
  adminPlugin: (name: string) => ['admin-plugin', name] as const,
  adminRoles: () => ['admin-roles'] as const,
  adminSmtp: () => ['admin-smtp'] as const,
  adminModManager: () => ['admin-mod-manager'] as const,
  adminSecuritySettings: () => ['admin-security-settings'] as const,
  adminAuthLockouts: (params?: Record<string, unknown>) => ['admin-auth-lockouts', params ?? null] as const,
  adminSystemErrors: (params?: Record<string, unknown>) => ['admin-system-errors', params ?? null] as const,
  adminDatabaseHosts: () => ['admin-database-hosts'] as const,
  adminIpPools: (nodeId: string) => ['ip-pools', nodeId] as const,
  adminNodeAllocations: (nodeId: string) => ['node-allocations', nodeId] as const,
  adminThemeSettings: () => ['admin-theme-settings'] as const,
  adminOidcConfig: () => ['admin-oidc-config'] as const,

  // ── Profile ─────────────────────────────────────────────────────────
  profile: () => ['profile'] as const,
  profileApiKeys: () => ['profile-api-keys'] as const,
  profileSessions: () => ['profile-sessions'] as const,
  profileSsoAccounts: () => ['profile-sso-accounts'] as const,
  profileAuditLog: (limit: number, offset: number) => ['profile-audit-log', limit, offset] as const,

  // ── Server Activity / Variables ─────────────────────────────────────
  serverActivity: (id: string, params?: Record<string, unknown>) => ['server-activity', id, params ?? null] as const,
  serverVariables: (id: string) => ['server-variables', id] as const,

  // ── Migration ────────────────────────────────────────────────────────
  migrationJobs: () => ['migration-jobs'] as const,
  migrationJob: (id: string) => ['migration-job', id] as const,
  migrationSteps: (jobId: string) => ['migration-steps', jobId] as const,

  // ── Roles / Node Assignments ─────────────────────────────────────────
  roleNodes: (roleId: string) => ['roles', roleId, 'nodes'] as const,
  userNodes: (userId: string) => ['users', userId, 'nodes'] as const,

  // ── Files / SFTP ────────────────────────────────────────────────────
  sftpTokens: (serverId: string) => ['sftp-tokens', serverId] as const,
  sftpConnectionInfo: (serverId: string) => ['sftp-connection-info', serverId] as const,
} as const;
