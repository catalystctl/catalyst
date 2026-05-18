/**
 * Centralized TanStack Query key constants.
 * Import from here instead of hardcoding strings — rename in one place.
 *
 * Convention: plural prefix for entity collections, then id, then sub-entity.
 *   e.g. ['servers'] → ['servers', id] → ['servers', id, 'variables']
 * This ensures invalidateQueries(['servers']) catches both list and detail queries.
 */
export const qk = {
  // ── Auth ──────────────────────────────────────────────────────────
  session: () => ['session'] as const,

  // ── Server ──────────────────────────────────────────────────────────
  servers: (filters?: Record<string, unknown>) => ['servers', filters ?? null] as const,
  server: (id: string) => ['servers', id] as const,
  serverPermissions: (id: string) => ['servers', id, 'permissions'] as const,
  serverInvites: (id: string) => ['servers', id, 'invites'] as const,
  serverAllocations: (id: string) => ['servers', id, 'allocations'] as const,
  serverActivity: (id: string, params?: Record<string, unknown>) => ['servers', id, 'activity', params ?? null] as const,
  serverVariables: (id: string) => ['servers', id, 'variables'] as const,

  // ── Server Metrics ─────────────────────────────────────────────────
  serverMetrics: (serverId: string, params?: { hours?: number; limit?: number }) =>
    ['servers', serverId, 'metrics', params ?? null] as const,

  // ── Server Logs ────────────────────────────────────────────────────
  serverLogs: (serverId: string, initialLines?: number) =>
    ['servers', serverId, 'logs', initialLines ?? null] as const,

  // ── Backups ─────────────────────────────────────────────────────────
  backups: (serverId: string, page = 1, limit = 10) =>
    ['servers', serverId, 'backups', { page, limit }] as const,

  // ── Tasks ──────────────────────────────────────────────────────────
  tasks: (serverId: string) => ['servers', serverId, 'tasks'] as const,

  // ── Files ──────────────────────────────────────────────────────────
  files: (serverId: string, path: string) => ['servers', serverId, 'files', path] as const,

  // ── Databases ──────────────────────────────────────────────────────
  serverDatabases: (serverId: string) => ['servers', serverId, 'databases'] as const,
  databaseHosts: () => ['database-hosts'] as const,

  // ── Nodes ───────────────────────────────────────────────────────────
  nodes: (filters?: Record<string, unknown>) => ['nodes', filters ?? null] as const,
  node: (id: string) => ['nodes', id] as const,
  nodeAssignments: (nodeId: string) => ['nodes', nodeId, 'assignments'] as const,
  nodeApiKey: (nodeId: string) => ['nodes', nodeId, 'api-key'] as const,
  accessibleNodes: () => ['nodes', 'accessible'] as const,
  nodeStats: (id: string) => ['nodes', id, 'stats'] as const,
  nodeMetrics: (id: string) => ['nodes', id, 'metrics'] as const,
  unregisteredContainers: (nodeId: string) => ['nodes', nodeId, 'unregistered-containers'] as const,

  // ── Locations ──────────────────────────────────────────────────────
  locations: () => ['locations'] as const,

  // ── Nests ───────────────────────────────────────────────────────────
  nests: () => ['nests'] as const,

  // ── Templates ───────────────────────────────────────────────────────
  templates: () => ['templates'] as const,
  template: (id: string) => ['templates', id] as const,

  // ── Dashboard ───────────────────────────────────────────────────────
  dashboard: () => ['dashboard'] as const,
  dashboardStats: () => ['dashboard-stats'] as const,
  clusterMetrics: (nodeIds?: string[]) => ['cluster-metrics', nodeIds ?? null] as const,
  clusterHistoricalMetrics: (range: { hours: number; limit: number }, nodeIds: string[]) =>
    ['cluster-historical-metrics', range, nodeIds] as const,
  dashboardActivity: (params?: Record<string, unknown>) => ['dashboard-activity', params ?? null] as const,
  dashboardResources: () => ['dashboard-resources'] as const,

  // ── Alerts ──────────────────────────────────────────────────────────
  alerts: (params?: { filterResolved?: boolean; serverId?: string; scope?: string }) =>
    ['alerts', params ?? null] as const,
  alertRules: (params?: Record<string, unknown>) => ['alert-rules', params ?? null] as const,
  alertStats: (params?: { scope?: string; serverId?: string }) =>
    ['alerts-stats', params ?? null] as const,

  // ── API Keys ─────────────────────────────────────────────────────────
  apiKeys: () => ['api-keys'] as const,
  apiKeyVariable: (id: string) => ['api-keys', id, 'variable'] as const,
  apiKeyDetail: (id: string) => ['api-keys', id] as const,
  apiKeyUsage: (id: string) => ['api-keys', id, 'usage'] as const,

  // ── Permissions ──────────────────────────────────────────────────────
  permissionsCatalog: () => ['permissions-catalog'] as const,
  myPermissions: () => ['my-permissions'] as const,

  // ── Invite ──────────────────────────────────────────────────────────
  invitePreview: (token: string) => ['invite-preview', token] as const,

  // ── Role ────────────────────────────────────────────────────────────
  rolePresets: () => ['role-presets'] as const,

  // ── Catalyst Nodes (Migration) ──────────────────────────────────────
  catalystNodes: () => ['catalyst-nodes'] as const,

  // ── Plugin Manager (per-server) ──────────────────────────────────────
  pluginManagerGameVersions: (serverId: string, provider: string) =>
    ['servers', serverId, 'plugin-manager', 'game-versions', provider] as const,
  pluginManagerSearch: (serverId: string, provider: string, query: string, gameVersion: string, page: number) =>
    ['servers', serverId, 'plugin-manager', 'search', provider, query, gameVersion, page] as const,
  pluginManagerVersions: (serverId: string, provider: string, plugin: string) =>
    ['servers', serverId, 'plugin-manager', 'versions', provider, plugin] as const,
  pluginManagerInstalled: (serverId: string) =>
    ['servers', serverId, 'plugin-manager', 'installed'] as const,

  // ── Mod Manager (per-server) ─────────────────────────────────────────
  modManagerGameVersions: (serverId: string, provider: string, game: string) =>
    ['servers', serverId, 'mod-manager', 'game-versions', provider, game] as const,
  modManagerSearch: (serverId: string, provider: string, query: string, game: string, page: number) =>
    ['servers', serverId, 'mod-manager', 'search', provider, query, game, page] as const,
  modManagerVersions: (serverId: string, provider: string, game: string, query: string, page: number) =>
    ['servers', serverId, 'mod-manager', 'versions', provider, game, query, page] as const,
  modManagerInstalled: (serverId: string, target: string) =>
    ['servers', serverId, 'mod-manager', 'installed', target] as const,

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
  adminDnsSettings: () => ['admin-dns-settings'] as const,
  adminSecuritySettings: () => ['admin-security-settings'] as const,
  adminAuthLockouts: (params?: Record<string, unknown>) => ['admin-auth-lockouts', params ?? null] as const,
  adminSystemErrors: (params?: Record<string, unknown>) => ['admin-system-errors', params ?? null] as const,
  adminDatabaseHosts: () => ['admin-database-hosts'] as const,
  adminDatabaseHostPing: (hostId: string) => ['admin-database-host-ping', hostId] as const,
  adminDbStatus: () => ['admin-db-status'] as const,
  adminIpPools: (nodeId: string) => ['ip-pools', nodeId] as const,
  adminNodeAllocations: (nodeId: string) => ['node-allocations', nodeId] as const,
  adminThemeSettings: () => ['admin-theme-settings'] as const,
  adminOidcConfig: () => ['admin-oidc-config'] as const,
  adminUpdateStatus: () => ['admin-update-status'] as const,
  updateCheck: () => ['update-check'] as const,

  // ── Profile ─────────────────────────────────────────────────────────
  profile: () => ['profile'] as const,
  profileApiKeys: () => ['profile-api-keys'] as const,
  profileSessions: () => ['profile-sessions'] as const,
  profileSsoAccounts: () => ['profile-sso-accounts'] as const,
  profileAuditLog: (limit?: number, offset?: number) =>
    ['profile-audit-log', limit ?? null, offset ?? null] as const,

  // ── Migration ────────────────────────────────────────────────────────
  migrationJobs: () => ['migration-jobs'] as const,
  migrationJob: (id: string) => ['migration-job', id] as const,
  migrationSteps: (jobId: string) => ['migration-steps', jobId] as const,

  // ── Roles / Node Assignments ─────────────────────────────────────────
  roleNodes: (roleId: string) => ['roles', roleId, 'nodes'] as const,
  userNodes: (userId: string) => ['users', userId, 'nodes'] as const,

  // ── Files / SFTP ────────────────────────────────────────────────────
  sftpTokens: (serverId: string) => ['servers', serverId, 'sftp-tokens'] as const,
  sftpConnectionInfo: (serverId: string) => ['servers', serverId, 'sftp-connection-info'] as const,

  // ── Mutation Keys ───────────────────────────────────────────────────
  mutation: {
    adminDatabaseHostCreate: () => ['admin-database-host-create'] as const,
    adminDatabaseHostUpdate: () => ['admin-database-host-update'] as const,
    adminDatabaseHostDelete: () => ['admin-database-host-delete'] as const,
    adminUserBan: () => ['admin-user-ban'] as const,
    adminUserUnban: () => ['admin-user-unban'] as const,
  },
} as const;
