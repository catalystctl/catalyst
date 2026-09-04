import type { FastifyInstance, FastifyReply } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import type { PluginLoader } from '../plugins/loader';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { z } from 'zod';
import { getWsGateway } from '../websocket/gateway';
import { isValidPluginName } from '../plugins/validator';
import { PluginMarketplaceService, browseMarketplaces, annotateMarketplaceEntries, PackagingError, listMarketplaceSources, addMarketplaceSource, setMarketplaceSourceEnabled, removeMarketplaceSource } from '../plugins/marketplace/service';
import {
  DISCLAIMER_VERSION,
  computeConsentState,
  diffGrants,
  normalizePermissionList,
  resolveCapabilitySummaries,
} from '../plugins/safety';

const EnablePluginSchema = z.object({
  enabled: z.boolean(),
  safety: z
    .object({
      disclaimerVersion: z.string(),
    })
    .optional(),
});

const UpdatePluginConfigSchema = z.object({
  config: z.record(z.string(), z.any()),
});

const UpdatePluginPermissionsSchema = z.object({
  granted: z.array(z.string()),
});

const ensureAdmin = (
  request: any,
  reply: FastifyReply,
  requiredPermission: 'admin.read' | 'admin.write' = 'admin.read',
) => {
  const perms: string[] = request.user?.permissions ?? [];
  const isAdmin =
    perms.includes('*') ||
    perms.includes('admin.write') ||
    (requiredPermission === 'admin.read' && perms.includes('admin.read'));
  if (!isAdmin) {
    reply.status(403).send({
      success: false,
      error: 'Admin access required',
    });
    return false;
  }
  return true;
};

/**
 * Pure admin predicate — unlike ensureAdmin it does NOT send a 403, so it is
 * safe to use inside expressions where the response body is still being built
 * (read endpoints that degrade gracefully for non-admin callers).
 */
const isAdminCaller = (
  request: any,
  requiredPermission: 'admin.read' | 'admin.write' = 'admin.read',
) => {
  const perms: string[] = request.user?.permissions ?? [];
  return (
    perms.includes('*') ||
    perms.includes('admin.write') ||
    (requiredPermission === 'admin.read' && perms.includes('admin.read'))
  );
};

/**
 * SECURITY: strip runtime config VALUES of password-typed fields from plugin
 * manifests before returning them to non-admins. After loader rehydration
 * `manifest.config` maps field keys to plain runtime values (e.g.
 * `ghToken: "ghp_…"`), so password-typed entries (egg-explorer's ghToken)
 * would otherwise leak live secrets to any authenticated user via the detail
 * / frontend-manifest endpoints. The schema (originalConfig) declares which
 * keys are password-typed; keys absent from the schema are also dropped
 * (fail closed) since their sensitivity is unknown.
 */
function redactPluginConfigForNonAdmin(
  config: unknown,
  configSchema: unknown,
): Record<string, unknown> {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return {};
  }
  const passwordKeys = new Set<string>();
  let schemaIsObject = false;
  if (configSchema && typeof configSchema === 'object' && !Array.isArray(configSchema)) {
    schemaIsObject = true;
    for (const [key, field] of Object.entries(configSchema)) {
      if (
        field &&
        typeof field === 'object' &&
        (field as Record<string, unknown>).type === 'password'
      ) {
        passwordKeys.add(key);
      }
    }
  }
  if (!schemaIsObject) {
    // No schema available → sensitivity of every value is unknown. Fail closed.
    return {};
  }
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config as Record<string, unknown>)) {
    if (passwordKeys.has(key)) continue;
    // Not declared in the schema → unknown sensitivity, fail closed.
    if (!(key in (configSchema as Record<string, unknown>))) {
      continue;
    }
    safe[key] = value;
  }
  return safe;
}

/** Safety-relevant columns from the Plugin table. */
const SAFETY_SELECT = {
  safetyAcceptedAt: true,
  safetyAcceptedBy: true,
  safetyDisclaimerVersion: true,
  safetyAcceptedPluginVersion: true,
  safetyAcceptedPermissions: true,
  grantedPermissions: true,
} as const;

type PluginSafetyRow = {
  safetyAcceptedAt: Date | null;
  safetyAcceptedBy: string | null;
  safetyDisclaimerVersion: string | null;
  safetyAcceptedPluginVersion: string | null;
  safetyAcceptedPermissions: unknown;
  grantedPermissions: unknown;
};

/** Fire-and-forget audit trail entry for admin plugin actions. */
async function writeAudit(
  prisma: PrismaClient,
  action: string,
  pluginName: string,
  details: Record<string, unknown>,
  userId?: string,
): Promise<void> {
  try {
    await prisma.pluginActionAudit.create({
      data: {
        pluginName,
        action,
        details: details as any,
        userId: userId ?? null,
        success: true,
      },
    });
  } catch {
    // Audit logging must never fail the request
  }
}

/**
 * Permission/consent summary shared by list and detail endpoints. All consent
 * conclusions are computed server-side so the UI cannot bypass them.
 */
function buildConsentSummary(plugin: any, row: PluginSafetyRow | null) {
  const declaredPermissions = normalizePermissionList(plugin.manifest.permissions ?? []);
  const storedGrants = Array.isArray(row?.grantedPermissions)
    ? normalizePermissionList(row.grantedPermissions as unknown[])
    : null;
  const effectiveGrants = storedGrants ?? [...declaredPermissions];
  const { granted, revoked } = diffGrants(declaredPermissions, effectiveGrants);

  const state = computeConsentState({
    hasAcceptance: !!row?.safetyAcceptedAt,
    acceptedDisclaimerVersion: row?.safetyDisclaimerVersion ?? null,
    acceptedPluginVersion: row?.safetyAcceptedPluginVersion ?? null,
    acceptedPermissions: Array.isArray(row?.safetyAcceptedPermissions)
      ? normalizePermissionList(row.safetyAcceptedPermissions as unknown[])
      : null,
    manifestPermissions: declaredPermissions,
    manifestVersion: plugin.manifest.version,
  });

  // Reviewer-facing capability copy: builtin scopes come pre-described;
  // plugin-provided descriptions (validated against declared at discovery)
  // cover custom scopes.
  const manifestDescriptions = plugin.manifest.permissionDescriptions ?? {};
  const permissionDescriptions = Object.fromEntries(
    Object.entries(manifestDescriptions).filter(([key]) => declaredPermissions.includes(key)),
  ) as Record<string, string>;

  return {
    // Permissions
    declaredPermissions,
    grantedPermissions: granted,
    revokedPermissions: revoked,
    /** Fully-resolved reviewer copy for each declared scope. */
    permissionSummaries: resolveCapabilitySummaries(declaredPermissions, permissionDescriptions),
    permissionDescriptions,
    // Consent
    consentRequired: state.consentRequired,
    consentReason: state.reason ?? null,
    disclaimerVersion: DISCLAIMER_VERSION,
    safetyAcceptedAt: row?.safetyAcceptedAt ?? null,
    legacyAcceptance: !!row?.safetyAcceptedAt && !row?.safetyAcceptedBy,
  };
}

/**
 * Plugin management routes
 */
export async function pluginRoutes(app: FastifyInstance, pluginLoader: PluginLoader, prisma: PrismaClient) {
  // ── Marketplace plumbing ────────────────────────────────────────────────
  const marketplaceService = new PluginMarketplaceService(
    pluginLoader.getPluginsDir(),
    prisma,
    app.log,
    (name) => pluginLoader.discoverSingle(name),
    { allowLocalDownloads: process.env.PLUGIN_MARKETPLACE_ALLOW_LOCAL === 'true' },
  );
  /**
   * GET /api/plugins/marketplace
   * Browse configured marketplace indexes together (official index first
   * unless PLUGIN_MARKETPLACE_DISABLE_OFFICIAL is set, plus comma-separated
   * PLUGIN_MARKETPLACE_URLS and panel-added sources). Cached per source for
   * 5 minutes.
   */
  app.get(
    '/api/plugins/marketplace',
    {
      onRequest: [app.authenticate],
    },
    async (request, reply) => {
      const isAdmin = ensureAdmin(request, reply, 'admin.read');
      if (!isAdmin) return;
      const { forceRefresh } = request.query as { forceRefresh?: string };
      const result = await browseMarketplaces(app.log, { forceRefresh: forceRefresh === 'true', prisma });
      const installedVersions = new Map(
        pluginLoader.getRegistry().getAll().map((p) => [p.manifest.name, p.manifest.version]),
      );
      return {
        success: true,
        data: {
          sources: result.sources,
          entries: annotateMarketplaceEntries(result.entries, installedVersions),
        },
      };
    },
  );

  /**
   * GET /api/plugins/marketplace/sources
   * List every marketplace source: official + env (read-only) plus sources
   * added from the panel (editable). Powers the in-panel source manager.
   */
  app.get(
    '/api/plugins/marketplace/sources',
    {
      onRequest: [app.authenticate],
    },
    async (request, reply) => {
      const isAdmin = ensureAdmin(request, reply, 'admin.read');
      if (!isAdmin) return;
      const sources = await listMarketplaceSources(prisma);
      return { success: true, data: sources };
    },
  );

  const AddMarketplaceSourceSchema = z.object({
    url: z.string().min(1).max(2048),
    label: z.string().max(100).optional(),
  });

  /**
   * POST /api/plugins/marketplace/sources
   * Add a marketplace index from the panel — no env edit or restart needed.
   */
  app.post(
    '/api/plugins/marketplace/sources',
    {
      onRequest: [app.authenticate],
    },
    async (request, reply) => {
      const isAdmin = ensureAdmin(request, reply, 'admin.write');
      if (!isAdmin) return;
      const userId: string | undefined = request.user?.userId;
      const body = AddMarketplaceSourceSchema.parse(request.body);
      try {
        const created = await addMarketplaceSource(prisma, body.url, body.label ?? null, userId ?? null);
        await writeAudit(prisma, 'marketplace.source.added', 'marketplace', { url: created.url, label: created.label }, userId);
        return { success: true, data: created };
      } catch (error: any) {
        if (error?.message === 'That marketplace is already configured') {
          return reply.status(409).send({ success: false, error: error.message });
        }
        return reply.status(400).send({ success: false, error: error.message });
      }
    },
  );

  const UpdateMarketplaceSourceSchema = z.object({
    enabled: z.boolean(),
  });

  /**
   * PATCH /api/plugins/marketplace/sources/:id
   * Enable or disable a panel-added source.
   */
  app.patch(
    '/api/plugins/marketplace/sources/:id',
    {
      onRequest: [app.authenticate],
    },
    async (request, reply) => {
      const isAdmin = ensureAdmin(request, reply, 'admin.write');
      if (!isAdmin) return;
      const userId: string | undefined = request.user?.userId;
      const { id } = request.params as { id: string };
      const body = UpdateMarketplaceSourceSchema.parse(request.body);
      try {
        const updated = await setMarketplaceSourceEnabled(prisma, id, body.enabled);
        await writeAudit(prisma, 'marketplace.source.updated', 'marketplace', { url: updated.url, enabled: body.enabled }, userId);
        return { success: true, data: updated };
      } catch {
        return reply.status(404).send({ success: false, error: 'Marketplace source not found' });
      }
    },
  );

  /**
   * DELETE /api/plugins/marketplace/sources/:id
   * Remove a panel-added source. Official and env sources are read-only.
   */
  app.delete(
    '/api/plugins/marketplace/sources/:id',
    {
      onRequest: [app.authenticate],
    },
    async (request, reply) => {
      const isAdmin = ensureAdmin(request, reply, 'admin.write');
      if (!isAdmin) return;
      const userId: string | undefined = request.user?.userId;
      const { id } = request.params as { id: string };
      if (id === 'official' || id.startsWith('env:')) {
        return reply.status(400).send({ success: false, error: 'That marketplace source is managed outside the panel' });
      }
      try {
        const removed = await removeMarketplaceSource(prisma, id);
        await writeAudit(prisma, 'marketplace.source.removed', 'marketplace', { url: removed.url }, userId);
        return { success: true, data: { id } };
      } catch {
        return reply.status(404).send({ success: false, error: 'Marketplace source not found' });
      }
    },
  );

  const InstallPluginSchema = z.object({
    url: z.string().url(),
    sha256: z.string().regex(/^[0-9a-fA-F]{64}$/).optional(),
  });

  /**
   * POST /api/plugins/install
   * Download, verify and stage a plugin package (.catpkg.zip). The code lands
   * inert — it cannot execute until an admin accepts the safety disclaimer
   * and enables it via the normal gate.
   */
  app.post(
    '/api/plugins/install',
    {
      onRequest: [app.authenticate],
    },
    async (request, reply) => {
      const isAdmin = ensureAdmin(request, reply, 'admin.write');
      if (!isAdmin) return;
      const userId: string | undefined = request.user?.userId;
      const body = InstallPluginSchema.parse(request.body);

      try {
        const result = await marketplaceService.installFromUrl(body.url, body.sha256);

        await writeAudit(prisma, result.upgraded ? 'plugin.upgraded' : 'plugin.installed', result.name, {
          url: body.url,
          version: result.version,
          sha256: result.sha256,
        }, userId);

        try {
          const wsGateway = getWsGateway();
          wsGateway?.pushToAdminSubscribers('plugin_updated', {
            name: result.name,
            action: result.upgraded ? 'upgraded' : 'installed',
            version: result.version,
          });
        } catch { /* ignore — WS push is best-effort */ }

        return {
          success: true,
          message: `Plugin ${result.name}@${result.version} ${result.upgraded ? 'upgraded' : 'installed'}. Accept the safety disclaimer to enable it.`,
          data: result,
        };
      } catch (error: any) {
        if (error instanceof PackagingError) {
          return reply.status(400).send({ success: false, code: error.code, error: error.message });
        }
        return reply.status(400).send({ success: false, error: error.message });
      }
    },
  );

  const UninstallPluginSchema = z.object({
    purgeData: z.boolean().optional(),
  });

  /**
   * POST /api/plugins/:name/uninstall
   * Disable (if needed), remove the plugin directory and drop it from the
   * registry. `purgeData` also deletes persisted storage + the Plugin row.
   */
  app.post(
    '/api/plugins/:name/uninstall',
    {
      onRequest: [app.authenticate],
    },
    async (request, reply) => {
      const isAdmin = ensureAdmin(request, reply, 'admin.write');
      if (!isAdmin) return;
      const userId: string | undefined = request.user?.userId;
      const { name } = request.params as { name: string };
      if (!isValidPluginName(name)) {
        return reply.status(400).send({ success: false, error: 'Invalid plugin name' });
      }
      // Never allow uninstalling a directory outside pluginsDir canon
      const pluginsRoot = path.resolve(pluginLoader.getPluginsDir());
      const targetDir = path.join(pluginsRoot, name);
      if (path.dirname(targetDir) !== pluginsRoot || targetDir === pluginsRoot) {
        return reply.status(400).send({ success: false, error: 'Invalid plugin name' });
      }
      const body = UninstallPluginSchema.parse(request.body ?? {});

      try {
        const loaded = pluginLoader.getRegistry().get(name);
        if (loaded?.status === 'enabled') {
          await pluginLoader.disablePlugin(name);
        }
        try {
          await marketplaceService.uninstall(name, { purgeData: body.purgeData });
        } catch (uninstallError: any) {
          // A registry-only copy (on-disk dir already gone) still needs to be
          // dropped from memory so reinstalls start clean.
          if (uninstallError instanceof PackagingError && uninstallError.code === 'NOT_FOUND' && loaded) {
            await pluginLoader.unloadPlugin(name).catch(() => {});
            await writeAudit(prisma, 'plugin.uninstalled', name, { purgeData: !!body.purgeData }, userId);
            return { success: true, message: `Plugin ${name} uninstalled` };
          }
          throw uninstallError;
        }
        try {
          await pluginLoader.unloadPlugin(name);
        } catch { /* not loaded — fine */ }

        await writeAudit(prisma, 'plugin.uninstalled', name, { purgeData: !!body.purgeData }, userId);
        try {
          const wsGateway = getWsGateway();
          wsGateway?.pushToAdminSubscribers('plugin_updated', { name, action: 'uninstalled' });
        } catch { /* ignore */ }

        return { success: true, message: `Plugin ${name} uninstalled` };
      } catch (error: any) {
        if (error instanceof PackagingError && error.code === 'NOT_FOUND') {
          return reply.status(404).send({ success: false, error: error.message });
        }
        return reply.status(400).send({ success: false, error: error.message });
      }
    },
  );

  /**
   * GET /plugins-assets/:name/:filename
   * Serves runtime frontend bundles for INSTALLED plugins
   * (`frontend/frontend.mjs` convention). Authenticated like every other
   * plugin surface; strictly single-segment names with an extension allowlist.
   */
  const ASSET_EXTENSIONS = new Set(['.mjs', '.js', '.css', '.map', '.svg', '.png', '.woff2']);
  const CONTENT_TYPES: Record<string, string> = {
    '.mjs': 'text/javascript',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.map': 'application/json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.woff2': 'font/woff2',
  };

  app.get(
    '/plugins-assets/:name/:filename',
    {
      onRequest: [app.authenticate],
    },
    async (request, reply) => {
      const { name, filename } = request.params as { name: string; filename: string };
      if (!isValidPluginName(name)) {
        return reply.status(404).send({ success: false });
      }
      const ext = path.extname(filename).toLowerCase();
      if (
        !ASSET_EXTENSIONS.has(ext) ||
        !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(filename)
      ) {
        return reply.status(404).send({ success: false });
      }

      const pluginsRoot = path.resolve(pluginLoader.getPluginsDir());
      const candidate = path.join(pluginsRoot, name, 'frontend', filename);
      if (path.dirname(candidate) !== path.join(pluginsRoot, name, 'frontend')) {
        return reply.status(404).send({ success: false });
      }

      let stat;
      try {
        stat = await fsp.stat(candidate);
        if (!stat.isFile()) throw new Error('not a file');
      } catch {
        return reply.status(404).send({ success: false });
      }

      const stream = fs.createReadStream(candidate);
      return reply
        .header('content-type', CONTENT_TYPES[ext])
        .header('content-length', stat.size)
        .header('cache-control', 'no-cache')
        .send(stream);
    },
  );

  /**
   * GET /api/plugins
   * List all plugins with permission/consent state
   */
  app.get(
    '/api/plugins',
    {
      onRequest: [app.authenticate],
    },
    async (request) => {
      const registry = pluginLoader.getRegistry();
      const plugins = registry.getAll();

      const rows = await prisma.plugin.findMany({ select: { name: true, ...SAFETY_SELECT } });
      const rowsByName = new Map(rows.map((r) => [r.name, r]));

      const pluginList = plugins.map((p) => {
        const summary = buildConsentSummary(p, rowsByName.get(p.manifest.name) ?? null);
        return {
          name: p.manifest.name,
          version: p.manifest.version,
          displayName: p.manifest.displayName,
          description: p.manifest.description,
          author: p.manifest.author,
          status: p.status,
          enabled: p.status === 'enabled',
          loadedAt: p.loadedAt,
          enabledAt: p.enabledAt,
          error: p.error?.message,
          hasBackend: !!p.manifest.backend,
          hasFrontend: !!p.manifest.frontend,
          dependencies: p.manifest.dependencies,
          capabilityCounts: {
            routes: p.routes.length,
            tasks: p.tasks.size,
            wsHandlers: p.wsHandlers.size,
            events: p.manifest.events ? Object.keys(p.manifest.events).length : 0,
          },
          ...summary,
        };
      });

      return {
        success: true,
        data: pluginList,
      };
    },
  );

  /**
   * GET /api/plugins/:name
   * Get plugin details including capabilities and permission/consent state
   */
  app.get(
    '/api/plugins/:name',
    {
      onRequest: [app.authenticate],
    },
    async (request, reply) => {
      const { name } = request.params as { name: string };
      const registry = pluginLoader.getRegistry();
      const plugin = registry.get(name);

      if (!plugin) {
        return reply.status(404).send({
          success: false,
          error: 'Plugin not found',
        });
      }

      const row = await prisma.plugin.findUnique({ where: { name }, select: SAFETY_SELECT });

      const isAdminUser = isAdminCaller(request, 'admin.read');

      return {
        success: true,
        data: {
          name: plugin.manifest.name,
          version: plugin.manifest.version,
          displayName: plugin.manifest.displayName,
          description: plugin.manifest.description,
          author: plugin.manifest.author,
          catalystVersion: plugin.manifest.catalystVersion,
          status: plugin.status,
          enabled: plugin.status === 'enabled',
          loadedAt: plugin.loadedAt,
          enabledAt: plugin.enabledAt,
          error: plugin.error?.message,
          hasBackend: !!plugin.manifest.backend,
          hasFrontend: !!plugin.manifest.frontend,
          // SECURITY: password-typed config values are only revealed to admins.
          config: isAdminUser
            ? plugin.manifest.config
            : redactPluginConfigForNonAdmin(
                plugin.manifest.config,
                plugin.context.originalConfig,
              ),
          configSchema: isAdminUser ? plugin.context.originalConfig : undefined,
          capabilities: {
            routes: plugin.routes.map((r) => ({ method: r.method, url: r.url })),
            tasks: Array.from(plugin.tasks.values()).map((t) => ({ cron: t.cron })),
            wsHandlers: Array.from(plugin.wsHandlers.keys()),
            events: plugin.manifest.events,
            exposedApis: registry.getExposedApiNames(name),
          },
          dependencies: plugin.manifest.dependencies,
          ...buildConsentSummary(plugin, row),
        },
      };
    },
  );

  /**
   * POST /api/plugins/:name/enable
   * Enable or disable a plugin. Enabling requires an up-to-date acceptance of
   * the plugin safety disclaimer; clients send `safety.disclaimerVersion` to
   * record the acceptance alongside the enable request.
   */
  app.post(
    '/api/plugins/:name/enable',
    {
      onRequest: [app.authenticate],
    },
    async (request, reply) => {
      const isAdmin = ensureAdmin(request, reply, 'admin.write');
      if (!isAdmin) return;
      const userId: string | undefined = request.user?.userId;
      const { name } = request.params as { name: string };
      const body = EnablePluginSchema.parse(request.body);

      try {
        if (body.enabled) {
          // ── Safety consent gate ────────────────────────────────────────
          const plugin = pluginLoader.getRegistry().get(name);
          if (!plugin || plugin.status === 'error') {
            throw new Error(plugin ? `Cannot enable plugin in error state` : 'Plugin not found');
          }
          const row = await prisma.plugin.findUnique({ where: { name }, select: SAFETY_SELECT });
          const summary = buildConsentSummary(plugin, row);
          if (summary.consentRequired && body.safety?.disclaimerVersion !== DISCLAIMER_VERSION) {
            return reply.status(409).send({
              success: false,
              code: 'SAFETY_CONSENT_REQUIRED',
              reason: summary.consentReason,
              error: 'Safety disclaimer must be accepted before enabling this plugin',
              requestedPermissions: summary.declaredPermissions,
              /** Reviewer-ready copy for the consent dialog. */
              requestedCapabilities: summary.permissionSummaries,
              disclaimerVersion: DISCLAIMER_VERSION,
              author: plugin.manifest.author,
              version: plugin.manifest.version,
            });
          }
          if (summary.consentRequired) {
            // Record who accepted what — prevents silent re-enables by others
            // claiming an earlier blanket acceptance.
            await prisma.plugin.update({
              where: { name },
              data: {
                safetyAcceptedAt: new Date(),
                safetyAcceptedBy: userId ?? null,
                safetyDisclaimerVersion: DISCLAIMER_VERSION,
                safetyAcceptedPluginVersion: plugin.manifest.version,
                safetyAcceptedPermissions: summary.declaredPermissions,
              },
            });
            await writeAudit(prisma, 'safety.accepted', name, {
              disclaimerVersion: DISCLAIMER_VERSION,
              pluginVersion: plugin.manifest.version,
              permissions: summary.declaredPermissions,
            }, userId);
          }

          await pluginLoader.enablePlugin(name);
        } else {
          await pluginLoader.disablePlugin(name);
        }

        try {
          const wsGateway = getWsGateway();
          wsGateway?.pushToAdminSubscribers('plugin_updated', { name, action: body.enabled ? 'enabled' : 'disabled' });
        } catch { /* ignore — WS push is best-effort */ }

        return {
          success: true,
          message: `Plugin ${body.enabled ? 'enabled' : 'disabled'} successfully`,
        };
      } catch (error: any) {
        return reply.status(400).send({
          success: false,
          error: error.message,
        });
      }
    },
  );

  /**
   * POST /api/plugins/:name/reload
   * Reload a plugin (hot-reload)
   */
  app.post(
    '/api/plugins/:name/reload',
    {
      onRequest: [app.authenticate],
    },
    async (request, reply) => {
      const isAdmin = ensureAdmin(request, reply, 'admin.write');
      if (!isAdmin) return;
      const { name } = request.params as { name: string };
      if (!isValidPluginName(name)) {
        return reply.status(400).send({
          success: false,
          error: 'Invalid plugin name',
        });
      }

      try {
        await pluginLoader.reloadPlugin(name);

        try {
          const wsGateway = getWsGateway();
          wsGateway?.pushToAdminSubscribers('plugin_updated', { name, action: 'reloaded' });
        } catch { /* ignore — WS push is best-effort */ }

        return {
          success: true,
          message: 'Plugin reloaded successfully',
        };
      } catch (error: any) {
        return reply.status(400).send({
          success: false,
          error: error.message,
        });
      }
    },
  );

  /**
   * PUT /api/plugins/:name/permissions
   * Replace the admin-controlled effective grants for a plugin. Grants must be
   * a subset of the manifest's declared permissions. Revocations take effect
   * immediately for the plugin's data/RPC access; mounted routes, scheduled
   * tasks and event handlers remain until the plugin is disabled.
   */
  app.put(
    '/api/plugins/:name/permissions',
    {
      onRequest: [app.authenticate],
    },
    async (request, reply) => {
      const isAdmin = ensureAdmin(request, reply, 'admin.write');
      if (!isAdmin) return;
      const userId: string | undefined = request.user?.userId;
      const { name } = request.params as { name: string };
      if (!isValidPluginName(name)) {
        return reply.status(400).send({
          success: false,
          error: 'Invalid plugin name',
        });
      }

      const body = UpdatePluginPermissionsSchema.parse(request.body);
      const plugin = pluginLoader.getRegistry().get(name);
      if (!plugin || plugin.status === 'error') {
        return reply.status(404).send({
          success: false,
          error: 'Plugin not found or in error state',
        });
      }

      const declared = normalizePermissionList(plugin.manifest.permissions ?? []);
      const grants = normalizePermissionList(body.granted);
      const invalid = grants.filter((g) => !declared.includes(g));
      if (invalid.length > 0) {
        return reply.status(400).send({
          success: false,
          error: `Grant list contains undeclared permissions: ${invalid.join(', ')}`,
        });
      }

      const previous = new Set(pluginLoader.getEffectivePermissions(name));
      const added = grants.filter((g) => !previous.has(g));
      const removed = [...previous].filter((p) => !grants.includes(p));

      try {
        // Persist first (source of truth across restarts), then apply live.
        await prisma.plugin.update({
          where: { name },
          data: { grantedPermissions: grants },
        });
        pluginLoader.setEffectivePermissions(name, grants);

        if (added.length > 0 || removed.length > 0) {
          await writeAudit(prisma, 'permissions.updated', name, {
            granted: grants,
            added,
            removed,
          }, userId);
        }

        try {
          const wsGateway = getWsGateway();
          wsGateway?.pushToAdminSubscribers('plugin_updated', { name, action: 'permissions_updated' });
        } catch { /* ignore — WS push is best-effort */ }

        const { granted: grantedList, revoked } = diffGrants(declared, grants);
        return {
          success: true,
          message: 'Plugin permissions updated',
          data: {
            declaredPermissions: declared,
            grantedPermissions: grantedList,
            revokedPermissions: revoked,
          },
        };
      } catch (error: any) {
        return reply.status(400).send({
          success: false,
          error: error.message,
        });
      }
    },
  );

  /**
   * PUT /api/plugins/:name/config
   * Update plugin configuration
   */
  app.put(
    '/api/plugins/:name/config',
    {
      onRequest: [app.authenticate],
    },
    async (request, reply) => {
      const isAdmin = ensureAdmin(request, reply, 'admin.write');
      if (!isAdmin) return;
      const { name } = request.params as { name: string };
      const body = UpdatePluginConfigSchema.parse(request.body);

      const registry = pluginLoader.getRegistry();
      const plugin = registry.get(name);

      if (!plugin) {
        return reply.status(404).send({
          success: false,
          error: 'Plugin not found',
        });
      }

      try {
        // Update each config key
        for (const [key, value] of Object.entries(body.config)) {
          await plugin.context.setConfig(key, value);
        }

        try {
          const wsGateway = getWsGateway();
          wsGateway?.pushToAdminSubscribers('plugin_updated', { name, action: 'config_updated' });
        } catch { /* ignore — WS push is best-effort */ }

        return {
          success: true,
          message: 'Plugin configuration updated',
        };
      } catch (error: any) {
        return reply.status(400).send({
          success: false,
          error: error.message,
        });
      }
    },
  );

  /**
   * GET /api/plugins/:name/frontend-manifest
   * Get plugin frontend manifest with real data from plugin.json
   */
  app.get(
    '/api/plugins/:name/frontend-manifest',
    {
      onRequest: [app.authenticate],
    },
    async (request, reply) => {
      const { name } = request.params as { name: string };
      const registry = pluginLoader.getRegistry();
      const plugin = registry.get(name);

      if (!plugin) {
        return reply.status(404).send({
          success: false,
          error: 'Plugin not found',
        });
      }

      if (!plugin.manifest.frontend) {
        return reply.status(404).send({
          success: false,
          error: 'Plugin has no frontend',
        });
      }

      return {
        success: true,
        data: {
          name: plugin.manifest.name,
          displayName: plugin.manifest.displayName,
          entry: plugin.manifest.frontend.entry,
          // SECURITY: see redactPluginConfigForNonAdmin — do not leak stored
          // secret values (password fields) to non-admin callers.
          config: isAdminCaller(request, 'admin.read')
            ? plugin.manifest.config
            : redactPluginConfigForNonAdmin(
                plugin.manifest.config,
                plugin.context.originalConfig,
              ),
          permissions: plugin.manifest.permissions ?? [],
          events: plugin.manifest.events,
        },
      };
    },
  );
}
