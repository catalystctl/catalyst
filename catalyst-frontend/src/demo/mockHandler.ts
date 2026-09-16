// Routes demo API traffic to canned fixtures. Returns undefined when the
// path is not part of the demo surface so the caller can fall back.
import {
  demoAdminStats,
  demoAdminUsers,
  demoAlerts,
  demoAuditLogs,
  demoBackups,
  demoConsoleLines,
  demoDashboardActivity,
  demoDashboardStats,
  demoDatabaseHosts,
  demoDatabases,
  demoLocations,
  demoMetricsHistory,
  demoMigrationJob,
  demoMigrationSteps,
  demoMigrationTest,
  demoNodes,
  demoNodeStats,
  demoProfile,
  demoPublicTheme,
  demoResourceStats,
  demoRoles,
  demoServers,
  demoTemplates,
  demoUser,
} from './fixtures';

const now = () => new Date().toISOString();
const ok = <T>(data: T) => ({ success: true, data });

function serverById(id: string) {
  return demoServers.find((s) => s.id === id) ?? demoServers[0];
}

function nodeById(id: string) {
  return demoNodes.find((n) => n.id === id) ?? demoNodes[0];
}

export function handleDemoRequest(
  method: string,
  rawPath: string,
): { handled: boolean; data: unknown } {
  const path = rawPath.split('?')[0];
  const m = method.toUpperCase();

  // Mutations are accepted but not persisted — the demo is read-only.
  if (m === 'POST' || m === 'PUT' || m === 'PATCH' || m === 'DELETE') {
    if (path === '/api/auth/login') {
      return { handled: true, data: { success: true, data: { userId: demoUser.id, email: demoUser.email, username: demoUser.username, name: demoUser.name, firstName: 'Demo', lastName: 'Admin', role: 'admin', permissions: ['*'], token: null } } };
    }
    if (path === '/api/auth/register') {
      return { handled: true, data: { success: true, data: { userId: demoUser.id, email: demoUser.email, username: demoUser.username, role: 'admin', permissions: ['*'], token: null } } };
    }
    if (path === '/api/system-errors/report') return { handled: true, data: ok(null) };
    if (path === '/api/admin/migration/test') return { handled: true, data: demoMigrationTest };
    if (path === '/api/admin/migration/start') return { handled: true, data: { jobId: demoMigrationJob.id } };
    if (path.startsWith('/api/servers/') && path.endsWith('/console/command')) {
      return { handled: true, data: ok(null) };
    }
    if (path === '/api/servers/eula') return { handled: true, data: ok(null) };
    // Pretend power actions / CRUD succeeded so buttons give feedback.
    if (
      path.startsWith('/api/servers') ||
      path.startsWith('/api/nodes') ||
      path.startsWith('/api/admin') ||
      path.startsWith('/api/alerts') ||
      path.startsWith('/api/alert-rules') ||
      path.startsWith('/api/templates') ||
      path.startsWith('/api/auth/profile') ||
      path.startsWith('/api/sftp')
    ) {
      return { handled: true, data: ok(null) };
    }
    return { handled: true, data: ok(null) };
  }

  // GET routes below.
  if (path === '/api/setup/status') return { handled: true, data: { setupRequired: false } };
  if (path === '/api/auth/me') {
    return {
      handled: true,
      data: ok({
        id: demoUser.id,
        email: demoUser.email,
        username: demoUser.username,
        name: demoUser.name,
        firstName: 'Demo',
        lastName: 'Admin',
        role: 'admin',
        permissions: ['*'],
        preferences: { theme: 'dark' },
      }),
    };
  }
  if (path === '/api/auth/profile') return { handled: true, data: ok(demoProfile) };
  if (path === '/api/auth/profile/api-keys') return { handled: true, data: ok([]) };
  if (path === '/api/auth/profile/audit-log') return { handled: true, data: ok({ logs: [], total: 0 }) };
  if (path === '/api/theme-settings/public') return { handled: true, data: ok(demoPublicTheme) };

  if (path === '/api/dashboard/stats') return { handled: true, data: ok(demoDashboardStats) };
  if (path === '/api/dashboard/activity') return { handled: true, data: ok(demoDashboardActivity) };
  if (path === '/api/dashboard/resources') return { handled: true, data: ok(demoResourceStats) };

  if (path === '/api/servers') return { handled: true, data: ok(demoServers) };
  // Literal sub-paths must precede the :id matcher below, which would
  // otherwise treat them as a server id (e.g. id='database-hosts').
  if (path === '/api/servers/database-hosts') return { handled: true, data: ok(demoDatabaseHosts) };
  {
    const serverMatch = path.match(/^\/api\/servers\/([^/]+)(\/.*)?$/);
    if (serverMatch && !path.includes('/invites')) {
      const [, id, suffix = ''] = serverMatch;
      const server = serverById(id);
      if (suffix === '' || suffix === '/') return { handled: true, data: ok(server) };
      if (suffix === '/metrics') {
        const history = demoMetricsHistory();
        return { handled: true, data: ok({ latest: history[history.length - 1], averages: { cpuPercent: 18, memoryUsageMb: 2100, diskUsageMb: 6144 }, history, count: history.length }) };
      }
      if (suffix === '/logs') return { handled: true, data: ok({ logs: demoConsoleLines, count: demoConsoleLines.length, requestedLines: 100 }) };
      if (suffix === '/activity') {
        return {
          handled: true,
          data: { success: true, data: [{ id: 'demo-log-1', userId: demoUser.id, action: 'server.start', resource: 'server', resourceId: id, details: {}, timestamp: now(), user: { id: demoUser.id, username: 'demo-admin', email: demoUser.email, name: 'Demo Admin' } }], pagination: { page: 1, limit: 25, total: 1, totalPages: 1 } },
        };
      }
      if (suffix === '/variables') return { handled: true, data: ok([{ name: 'EULA', description: 'Accept the Minecraft EULA', default: 'FALSE', required: true, input: 'checkbox', rules: [], value: 'TRUE' }]) };
      if (suffix === '/allocations') return { handled: true, data: ok([{ containerPort: 25565, hostPort: server.primaryPort ?? 25565, isPrimary: true, ip: server.primaryIp }]) };
      if (suffix === '/permissions') return { handled: true, data: { success: true, data: [], presets: { readOnly: ['server.read'], power: ['server.read', 'server.start', 'server.stop'], full: ['*'] } } };
      if (suffix === '/invites') return { handled: true, data: ok([]) };
      if (suffix === '/backup-settings') return { handled: true, data: ok({ storageMode: 'local', retentionCount: 5, retentionDays: 7 }) };
      if (suffix === '/backups') {
        return {
          handled: true,
          data: {
            backups: demoBackups.filter((b) => b.serverId === id),
            total: 1,
            page: 1,
            pageSize: 25,
            totalPages: 1,
          },
        };
      }
      {
        const backupMatch = suffix.match(/^\/backups\/([^/]+)(\/.*)?$/);
        if (backupMatch) return { handled: true, data: demoBackups.find((b) => b.id === backupMatch[1]) ?? demoBackups[0] };
      }
      if (suffix === '/databases') return { handled: true, data: ok(demoDatabases) };
      if (suffix === '/mod-manager/game-versions') return { handled: true, data: ok(['1.21.4', '1.21.1', '1.20.6']) };
      if (suffix === '/mod-manager/installed') return { handled: true, data: ok([]) };
      if (suffix === '/mod-manager/search') return { handled: true, data: ok({ hits: [], total_hits: 0 }) };
      if (suffix === '/mod-manager/versions') return { handled: true, data: ok([]) };
      if (suffix.startsWith('/console/stream')) return { handled: true, data: ok(null) };
      return { handled: true, data: ok(null) };
    }
  }
  if (path === '/api/servers/invites/accept') return { handled: true, data: ok(null) };

  if (path === '/api/nodes/accessible') return { handled: true, data: { success: true, data: demoNodes, hasWildcard: true } };
  if (path === '/api/nodes') return { handled: true, data: ok(demoNodes) };
  {
    const nodeMatch = path.match(/^\/api\/nodes\/([^/]+)(\/.*)?$/);
    if (nodeMatch) {
      const [, id, suffix = ''] = nodeMatch;
      const node = nodeById(id);
      if (suffix === '' || suffix === '/') return { handled: true, data: ok(node) };
      if (suffix === '/stats') return { handled: true, data: ok({ ...demoNodeStats, nodeId: node.id }) };
      if (suffix === '/metrics') {
        const history = demoMetricsHistory();
        return { handled: true, data: ok({ latest: history[history.length - 1], averages: { cpuPercent: 18, memoryUsageMb: 8192, diskUsageMb: 65536, containerCount: 2 }, history, count: history.length, node: { id: node.id, name: node.name, maxMemoryMb: 32768, maxCpuCores: 16, isOnline: node.isOnline } }) };
      }
      if (suffix === '/allocations') return { handled: true, data: ok([]) };
      if (suffix === '/ip-pools') return { handled: true, data: ok([]) };
      if (suffix === '/ip-availability') return { handled: true, data: ok([]) };
      if (suffix === '/assignments') return { handled: true, data: ok([]) };
      if (suffix === '/api-key') return { handled: true, data: ok({ exists: false, apiKey: null }) };
      if (suffix === '/unregistered-containers') return { handled: true, data: ok([]) };
      return { handled: true, data: ok(null) };
    }
  }

  if (path === '/api/templates') return { handled: true, data: ok(demoTemplates) };
  {
    const t = path.match(/^\/api\/templates\/([^/]+)$/);
    if (t) return { handled: true, data: ok(demoTemplates.find((x) => x.id === t[1]) ?? demoTemplates[0]) };
  }

  if (path === '/api/alerts') {
    return { handled: true, data: { alerts: demoAlerts, pagination: { page: 1, limit: 25, total: demoAlerts.length, totalPages: 1 } } };
  }
  if (path === '/api/alerts/stats') return { handled: true, data: { total: 2, unresolved: 1, bySeverity: { warning: 1, critical: 1 }, byType: { memory: 1, node_offline: 1 } } };
  if (path === '/api/alert-rules') return { handled: true, data: { rules: [] } };

  if (path === '/api/locations') return { handled: true, data: ok(demoLocations) };
  if (path === '/api/nests') return { handled: true, data: ok([]) };
  if (path === '/api/databases') return { handled: true, data: ok([]) };
  if (path === '/api/backups') return { handled: true, data: ok([]) };
  if (path === '/api/tasks') return { handled: true, data: ok([]) };
  if (path === '/api/files') return { handled: true, data: ok([]) };
  if (path === '/api/mod-manager/providers') return { handled: true, data: ok([]) };
  if (path === '/api/plugin-manager/installed') return { handled: true, data: ok([]) };
  if (path === '/api/plugins') return { handled: true, data: ok([]) };
  if (path === '/api/permissions/server') return { handled: true, data: ok([]) };
  if (path === '/api/sftp/connection-info') {
    return { handled: true, data: ok({ enabled: false, host: 'demo.invalid', port: 2022, username: null, sftpPassword: null, expiresAt: Date.now(), ttlMs: 3600000, ttlOptions: [] }) };
  }
  if (path === '/api/sftp/tokens') return { handled: true, data: ok([]) };

  if (path === '/api/admin/migration') return { handled: true, data: [demoMigrationJob] };
  if (path === '/api/admin/migration/catalyst-nodes') {
    return {
      handled: true,
      data: demoNodes.map((n) => ({
        id: n.id,
        name: n.name,
        hostname: n.hostname ?? n.name,
        isOnline: n.isOnline,
        lastSeenAt: n.lastSeenAt ?? null,
        maxMemoryMb: n.maxMemoryMb ?? 0,
        usedMemoryMb: 0,
        serverCount: n._count?.servers ?? 0,
        locationName: n.location?.name,
      })),
    };
  }
  {
    const migrationJobMatch = path.match(/^\/api\/admin\/migration\/([^/]+)(\/.*)?$/);
    if (migrationJobMatch) {
      if (migrationJobMatch[2] === '/steps') {
        return {
          handled: true,
          data: { steps: demoMigrationSteps, total: demoMigrationSteps.length, page: 1, totalPages: 1 },
        };
      }
      return { handled: true, data: demoMigrationJob };
    }
  }
  if (path === '/api/admin/stats') return { handled: true, data: demoAdminStats };
  if (path === '/api/admin/health') {
    return { handled: true, data: { status: 'healthy', database: 'connected', nodes: { total: 2, online: 1, offline: 1, stale: 0 }, timestamp: now() } };
  }
  if (path === '/api/admin/users') return { handled: true, data: { users: demoAdminUsers, pagination: { page: 1, limit: 25, total: demoAdminUsers.length, totalPages: 1 } } };
  {
    // Shape is { serverIds } (no envelope) — the edit-user wizard stores it
    // directly, so an envelope would crash it on .length/.includes.
    const userServersMatch = path.match(/^\/api\/admin\/users\/([^/]+)\/servers$/);
    if (userServersMatch) {
      const owned = userServersMatch[1] === 'demo-user-2' ? [] : ['demo-server-1', 'demo-server-2'];
      return { handled: true, data: { serverIds: owned } };
    }
  }
  if (path === '/api/admin/roles') return { handled: true, data: { roles: demoRoles } };
  if (path === '/api/admin/servers') {
    return {
      handled: true,
      data: {
        servers: demoServers.map((s) => ({ id: s.id, name: s.name, status: s.status, allocatedMemoryMb: s.allocatedMemoryMb, allocatedCpuCores: s.allocatedCpuCores, allocatedDiskMb: s.allocatedDiskMb, ownerId: s.ownerId, owner: s.owner, primaryIp: s.primaryIp, primaryPort: s.primaryPort, networkMode: s.networkMode, node: { id: s.nodeId, name: s.nodeName ?? '', hostname: s.nodeName ?? '' }, template: { id: s.templateId, name: s.template?.name ?? '' } })),
        pagination: { page: 1, limit: 25, total: demoServers.length, totalPages: 1 },
      },
    };
  }
  if (path === '/api/admin/nodes') {
    return {
      handled: true,
      data: { nodes: demoNodes.map((n) => ({ id: n.id, name: n.name, locationId: n.locationId, hostname: n.hostname, publicAddress: n.publicAddress, sftpPort: n.sftpPort, sftpEnabled: n.sftpEnabled, isOnline: n.isOnline, lastSeenAt: n.lastSeenAt, maxMemoryMb: n.maxMemoryMb, maxCpuCores: n.maxCpuCores, _count: n._count, location: n.location })) },
    };
  }
  if (path === '/api/admin/audit-logs') return { handled: true, data: { logs: demoAuditLogs, pagination: { page: 1, limit: 25, total: demoAuditLogs.length, totalPages: 1 } } };
  if (path === '/api/admin/system-errors') return { handled: true, data: { errors: [], pagination: { page: 1, limit: 25, total: 0, totalPages: 1 } } };
  if (path === '/api/admin/ip-pools') return { handled: true, data: ok([]) };
  if (path === '/api/admin/database-hosts') return { handled: true, data: ok([]) };
  if (path === '/api/admin/db-status') return { handled: true, data: ok({ connected: true, latency: 2, engine: 'postgres', tableCount: 24, sizeBytes: 1024, activeConnections: 1, rowCounts: { users: 4, servers: 3, nodes: 2, sessions: 1 } }) };
  if (path === '/api/admin/smtp') return { handled: true, data: ok({ host: null, port: null, username: null, password: null, from: null, replyTo: null, secure: false, requireTls: false, pool: false, maxConnections: null, maxMessages: null }) };
  if (path === '/api/admin/security-settings') return { handled: true, data: ok(null) };
  if (path === '/api/admin/settings/file-tunnel-upload-limit') return { handled: true, data: ok({ maxUploadMb: 100 }) };
  if (path === '/api/admin/localization-settings') return { handled: true, data: ok({ defaultLocale: null }) };
  if (path === '/api/admin/mod-manager') return { handled: true, data: ok({ curseforgeApiKey: null, modrinthApiKey: null }) };
  if (path === '/api/admin/auth-lockouts') return { handled: true, data: { lockouts: [], pagination: { page: 1, limit: 25, total: 0, totalPages: 1 } } };
  if (path === '/api/admin/theme-settings') return { handled: true, data: ok(demoPublicTheme) };
  if (path === '/api/admin/oidc-config') return { handled: true, data: ok({}) };
  if (path === '/api/admin/update/status') return { handled: true, data: { currentVersion: '1.58.1', latestVersion: '1.58.1', updateAvailable: false, lastCheckedAt: now(), releaseUrl: null, isDocker: false, autoUpdateEnabled: false } };
  if (path === '/api/admin/update/state') return { handled: true, data: { state: 'idle', message: null, startedAt: null, updatedAt: null, logs: [] } };
  if (path === '/api/admin/api-keys') return { handled: true, data: ok([]) };
  if (path === '/api/roles/presets') return { handled: true, data: ok([]) };
  if (path === '/api/roles') return { handled: true, data: ok(demoRoles) };
  {
    // Shape matches RoleUsersResponse ({ user, roles, permissions }) — the
    // edit-user wizard reads .roles.length, so a bare array would crash it.
    const userRolesMatch = path.match(/^\/api\/roles\/users\/([^/]+)\/roles$/);
    if (userRolesMatch) {
      const target = demoAdminUsers.find((u) => u.id === userRolesMatch[1]) ?? demoAdminUsers[0];
      return {
        handled: true,
        data: ok({
          user: { id: target.id, email: target.email, username: target.username },
          roles: demoRoles.filter((r) => target.roles.some((tr) => tr.id === r.id)),
          permissions: ['*'],
        }),
      };
    }
  }
  {
    const roleMatch = path.match(/^\/api\/roles\/([^/]+)$/);
    if (roleMatch && roleMatch[1] !== 'presets') {
      return {
        handled: true,
        data: ok({
          ...(demoRoles.find((r) => r.id === roleMatch[1]) ?? demoRoles[0]),
          serverGrants: [],
          nodeGrants: [],
        }),
      };
    }
  }
  if (path.startsWith('/api/roles/')) return { handled: true, data: ok([]) };

  // File browser / backups / databases / tasks per server.
  if (path.match(/^\/api\/servers\/[^/]+\/(files|backups|databases|tasks)$/)) {
    return { handled: true, data: ok([]) };
  }

  return { handled: false, data: null };
}
