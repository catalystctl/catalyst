/**
 * Route-contract harness — one Fastify app per worker carrying every route
 * module at its production prefix (mirrors src/server.ts:792-1365), a
 * persona-injecting authenticate decorator (P-A/P-C pattern from
 * diagnostics-export.test.ts / power-access-rbac.test.ts), and the stub
 * decoration set proven by power-access-rbac.test.ts:41-57.
 *
 * Persona switching is module-level: vitest runs `it` blocks sequentially
 * within a file, so `setContractPersona('ar')` immediately before `inject`
 * is race-free.
 */
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { authRoutes } from '../routes/auth.js';
import { setupRoutes } from '../routes/setup.js';
import { settingsRoutes } from '../routes/settings.js';
import { nodeRoutes } from '../routes/nodes.js';
import { serverRoutes } from '../routes/servers.js';
import { consoleStreamRoutes } from '../routes/console-stream.js';
import { sseEventsRoutes } from '../routes/sse-events.js';
import { metricsStreamRoutes } from '../routes/metrics-stream.js';
import { templateRoutes } from '../routes/templates.js';
import { nestRoutes } from '../routes/nests.js';
import { locationRoutes } from '../routes/locations.js';
import { metricsRoutes } from '../routes/metrics.js';
import { backupRoutes } from '../routes/backups.js';
import { adminRoutes } from '../routes/admin.js';
import { envRoutes } from '../routes/env.js';
import { updateRoutes } from '../routes/update.js';
import { adminEventsRoutes } from '../routes/admin-events.js';
import { roleRoutes } from '../routes/roles.js';
import { taskRoutes } from '../routes/tasks.js';
import { bulkServerRoutes } from '../routes/bulk-servers.js';
import { alertRoutes } from '../routes/alerts.js';
import { dashboardRoutes } from '../routes/dashboard.js';
import { providerKeyRoutes } from '../routes/provider-keys.js';
import { apiKeyRoutes } from '../routes/api-keys.js';
import { pluginRoutes } from '../routes/plugins.js';
import { fileTunnelRoutes } from '../routes/file-tunnel.js';
import { migrationRoutes } from '../routes/migration.js';
import { mcpRoutes } from '../routes/mcp.js';
import { sftpRoutes } from '../routes/sftp.js';
import type { ContractFixtures, PersonaInfo } from './route-contract-fixtures.js';

export type PersonaId = 'star' | 'ar' | 'aw' | 'pu' | 'owner';

let currentPersona: PersonaId = 'pu';

export function setContractPersona(persona: PersonaId): void {
  currentPersona = persona;
}

export function getContractPersona(): PersonaId {
  return currentPersona;
}

function personaOf(fx: ContractFixtures, persona: PersonaId): PersonaInfo {
  return fx[persona];
}

/**
 * buildContractApp — registers every route module at its production prefix.
 * Registration is asynchronous (Fastify plugins); await the returned app's
 * `ready()` (the runner does it once in beforeAll).
 */
export function buildContractApp(fx: ContractFixtures): FastifyInstance {
  const app = Fastify({ logger: false });

  app.decorate('authenticate', async (request: any) => {
    const persona = personaOf(fx, currentPersona);
    // Session truth = the persona's DB roles (exactly like production
    // resolveUserPermissions) so DB-driven gates agree with injected perms.
    const user = await prisma.user.findUnique({
      where: { id: persona.userId },
      select: { roles: { select: { permissions: true } } },
    });
    const perms = user?.roles.flatMap((role) => role.permissions as string[]) ?? [];
    request.user = {
      userId: persona.userId,
      email: `contract-${currentPersona}@example.com`,
      username: `contract-${currentPersona}`,
      permissions: perms,
    };
  });

  app.decorate('wsGateway', {
    pushToAdminSubscribers: () => {},
    pushToGlobalSubscribers: () => {},
    sendToAgent: async () => true,
    requestFromAgent: async () => ({ success: true, logs: [] }),
    relayBackupStream: async () => {},
    isAgentConnected: () => true,
    routeToClients: async () => {},
  } as any);

  app.decorate('webhookService', {
    serverCreated: async () => {},
    serverDeleted: async () => {},
    serverBulkSuspended: async () => {},
    serverBulkUnsuspended: async () => {},
  } as any);

  app.decorate('fileTunnel', {
    createTunnel: async () => ({ tunnelId: 'contract-tunnel' }),
  } as any);

  app.decorate('taskScheduler', {
    scheduleTask: () => {},
    unscheduleTask: () => {},
  } as any);

  app.decorate('alertService', {} as any);

  const pluginLoaderStub: any = {
    getPluginsDir: () => '/tmp/contract-test-plugins',
    getRegistry: () => ({
      getAll: () => [],
      get: () => undefined,
      getExposedApiNames: () => [],
    }),
  };

  const tunnelLogger: any = {
    child: () => ({
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    }),
  };

  // ── Registration map (prefixes mirror src/server.ts) ─────────────────────
  void (async () => {
    await app.register(authRoutes, { prefix: '/api/auth' });
    await app.register(setupRoutes, { prefix: '/api/setup' });
    await app.register(settingsRoutes, { prefix: '/api/settings' });
    await app.register(nodeRoutes, { prefix: '/api/nodes' });
    await app.register(serverRoutes, { prefix: '/api/servers' });
    await app.register((sub: any) => consoleStreamRoutes(sub, (app as any).wsGateway), {
      prefix: '/api/servers',
    });
    await app.register((sub: any) => sseEventsRoutes(sub, (app as any).wsGateway), {
      prefix: '/api/servers',
    });
    await app.register((sub: any) => metricsStreamRoutes(sub, (app as any).wsGateway), {
      prefix: '/api/servers',
    });
    await app.register(templateRoutes, { prefix: '/api/templates' });
    await app.register(nestRoutes, { prefix: '/api/nests' });
    await app.register(locationRoutes, { prefix: '/api/locations' });
    await app.register(metricsRoutes, { prefix: '/api' });
    await app.register(backupRoutes, { prefix: '/api/servers' });
    await app.register(adminRoutes, { prefix: '/api/admin' });
    await app.register(envRoutes, { prefix: '/api/admin/environment' });
    await app.register(updateRoutes, { prefix: '/api/admin/update' });
    await app.register((sub: any) => adminEventsRoutes(sub, (app as any).wsGateway), {
      prefix: '/api/admin/events',
    });
    await app.register(roleRoutes, { prefix: '/api/roles' });
    await app.register(taskRoutes, { prefix: '/api/servers' });
    await app.register(bulkServerRoutes, { prefix: '/api/servers' });
    await app.register(alertRoutes, { prefix: '/api' });
    await app.register(dashboardRoutes, { prefix: '/api/dashboard' });
    await app.register(providerKeyRoutes, { prefix: '/api/providers' });
    await app.register(apiKeyRoutes);
    await app.register((sub: any) => pluginRoutes(sub, pluginLoaderStub, prisma));
    await app.register((sub: any) => fileTunnelRoutes(sub, prisma, tunnelLogger, (app as any).fileTunnel));
    await app.register((sub: any) => migrationRoutes(sub));
    await app.register(mcpRoutes, { prefix: '/api' });
    await app.register(sftpRoutes);
  })();

  return app;
}
