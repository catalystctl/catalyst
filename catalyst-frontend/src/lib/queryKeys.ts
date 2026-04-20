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

  // ── Alerts ──────────────────────────────────────────────────────────
  alerts: () => ['alerts'] as const,
  alertRules: () => ['alert-rules'] as const,
  alertStats: () => ['alerts-stats'] as const,

  // ── Tasks / Scheduled ────────────────────────────────────────────────
  scheduledTasks: (serverId: string) => ['scheduled-tasks', serverId] as const,

  // ── API Keys ─────────────────────────────────────────────────────────
  apiKeys: () => ['api-keys'] as const,
  apiKeyVariable: (id: string) => ['api-key-variable', id] as const,

  // ── Admin ───────────────────────────────────────────────────────────
  adminUsers: () => ['admin-users'] as const,
  adminNodes: () => ['admin-nodes'] as const,
  adminServers: () => ['admin-servers'] as const,
  adminPlugins: () => ['admin-plugins'] as const,
  adminPlugin: (name: string) => ['admin-plugin', name] as const,
  adminRoles: () => ['admin-roles'] as const,
  adminSmtp: () => ['admin-smtp'] as const,
  adminModManager: () => ['admin-mod-manager'] as const,
  adminSecuritySettings: () => ['admin-security-settings'] as const,
  adminAuthLockouts: () => ['admin-auth-lockouts'] as const,
  adminDatabaseHosts: () => ['admin-database-hosts'] as const,
  adminIpPools: (nodeId: string) => ['ip-pools', nodeId] as const,
  adminNodeAllocations: (nodeId: string) => ['node-allocations', nodeId] as const,
  adminThemeSettings: () => ['admin-theme-settings'] as const,

  // ── Profile ─────────────────────────────────────────────────────────
  profile: () => ['profile'] as const,
  profileSsoAccounts: () => ['profile-sso-accounts'] as const,

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
