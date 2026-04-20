import fs from 'fs/promises';
import path from 'path';
import { watch } from 'chokidar';
import type { PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { WebSocketGateway } from '../websocket/gateway';
import type { PluginManifest, PluginBackend, LoadedPlugin, PluginStatus } from './types';
import { validateManifest, isVersionCompatible, validateDependencies } from './validator';
import { createPluginContext, runMiddleware } from './context';
import { PluginRegistry } from './registry';
import EventEmitter from 'events';

const CATALYST_VERSION = '1.0.0';

export class PluginLoader {
  private pluginsDir: string;
  private prisma: PrismaClient;
  private logger: Logger;
  private wsGateway: WebSocketGateway;
  private fastify: FastifyInstance;
  private registry: PluginRegistry;
  private eventEmitter: EventEmitter;
  private watcher?: ReturnType<typeof watch>;
  private hotReloadEnabled: boolean;

  constructor(
    pluginsDir: string,
    prisma: PrismaClient,
    logger: Logger,
    wsGateway: WebSocketGateway,
    fastify: FastifyInstance,
    options: { hotReload?: boolean } = {},
  ) {
    this.pluginsDir = pluginsDir;
    this.prisma = prisma;
    this.logger = logger.child({ component: 'PluginLoader' });
    this.wsGateway = wsGateway;
    this.fastify = fastify;
    this.registry = new PluginRegistry();
    this.eventEmitter = new EventEmitter();
    this.hotReloadEnabled = options.hotReload ?? true;
  }

  /**
   * Initialize plugin system
   */
  async initialize(): Promise<void> {
    this.logger.info('Initializing plugin system');

    // Ensure plugins directory exists
    try {
      await fs.mkdir(this.pluginsDir, { recursive: true });
    } catch (error: any) {
      this.logger.error({ error: error.message }, 'Failed to create plugins directory');
      throw error;
    }

    // Discover and load plugins (with dependency ordering)
    await this.discoverPlugins();

    // Enable hot-reload if configured
    if (this.hotReloadEnabled) {
      this.enableHotReload();
    }

    this.logger.info({ count: this.registry.count() }, 'Plugin system initialized');
  }

  /**
   * Discover plugins from filesystem.
   * Three-pass approach:
   *   1. Read all manifests
   *   2. Validate dependencies & topological sort
   *   3. Load plugins in dependency order
   */
  async discoverPlugins(): Promise<void> {
    this.logger.info('Discovering plugins');

    try {
      const entries = await fs.readdir(this.pluginsDir, { withFileTypes: true });
      const pluginDirs = entries.filter((e) => e.isDirectory());

      // ── Pass 1: Read all manifests ──────────────────────────────────────
      const manifestEntries: { dirName: string; pluginPath: string; manifest: PluginManifest }[] = [];

      for (const dir of pluginDirs) {
        const pluginPath = path.join(this.pluginsDir, dir.name);
        const manifestPath = path.join(pluginPath, 'plugin.json');

        try {
          const manifestData = await fs.readFile(manifestPath, 'utf-8');
          const manifest = validateManifest(JSON.parse(manifestData)) as PluginManifest;

          // Check version compatibility early
          if (!isVersionCompatible(manifest.catalystVersion, CATALYST_VERSION)) {
            this.logger.warn(
              { plugin: manifest.name, required: manifest.catalystVersion, current: CATALYST_VERSION },
              'Plugin version incompatible, skipping',
            );
            continue;
          }

          manifestEntries.push({ dirName: dir.name, pluginPath, manifest });
        } catch (error: any) {
          this.logger.error(
            { plugin: dir.name, error: error.message },
            'Failed to read/validate plugin manifest, skipping',
          );
        }
      }

      if (manifestEntries.length === 0) {
        this.logger.info('No valid plugins found');
        return;
      }

      // ── Pass 2: Validate dependencies ───────────────────────────────────
      const pluginNames = manifestEntries.map((m) => m.manifest.name);
      const pluginVersions = new Map(manifestEntries.map((m) => [m.manifest.name, m.manifest.version]));

      for (const { manifest } of manifestEntries) {
        const result = validateDependencies(manifest.dependencies, pluginNames, pluginVersions);
        if (!result.valid) {
          for (const err of result.errors) {
            this.logger.error({ plugin: manifest.name, error: err }, 'Dependency validation error');
          }
        }
      }

      // ── Pass 3: Topological sort & load in order ────────────────────────
      const sorted = this.topologicalSort(manifestEntries);

      for (const { pluginPath } of sorted) {
        await this.loadPlugin(pluginPath);
      }

      this.logger.info({ discovered: pluginDirs.length, loaded: sorted.length }, 'Plugin discovery complete');
    } catch (error: any) {
      this.logger.error({ error: error.message }, 'Plugin discovery failed');
    }
  }

  /**
   * Topological sort of plugins based on dependency graph.
   * Uses Kahn's algorithm with cycle detection.
   */
  private topologicalSort(
    entries: { dirName: string; pluginPath: string; manifest: PluginManifest }[],
  ): typeof entries {
    const nameToEntry = new Map(entries.map((e) => [e.manifest.name, e]));
    const inDegree = new Map<string, number>();
    const dependents = new Map<string, string[]>(); // depName → plugins that depend on it

    // Initialize
    for (const { manifest } of entries) {
      inDegree.set(manifest.name, 0);
      dependents.set(manifest.name, []);
    }

    // Build graph: for each dependency, edge goes from dep → dependent
    for (const { manifest } of entries) {
      const deps = manifest.dependencies || {};
      for (const dep of Object.keys(deps)) {
        if (nameToEntry.has(dep)) {
          // dep must come before manifest.name
          inDegree.set(manifest.name, (inDegree.get(manifest.name) || 0) + 1);
          dependents.get(dep)!.push(manifest.name);
        }
      }
    }

    // Kahn's algorithm
    const queue: string[] = [];
    for (const [name, degree] of inDegree) {
      if (degree === 0) queue.push(name);
    }

    const sorted: string[] = [];
    while (queue.length > 0) {
      const name = queue.shift()!;
      sorted.push(name);

      for (const dependent of dependents.get(name) || []) {
        const newDegree = (inDegree.get(dependent) || 1) - 1;
        inDegree.set(dependent, newDegree);
        if (newDegree === 0) {
          queue.push(dependent);
        }
      }
    }

    // Detect circular dependencies
    if (sorted.length !== entries.length) {
      const missing = entries.filter((e) => !sorted.includes(e.manifest.name));
      const cyclePlugins = missing.map((e) => e.manifest.name).join(', ');
      this.logger.error(
        { plugins: cyclePlugins },
        'Circular dependency detected in plugins — loading partial order',
      );
      // Add remaining plugins that weren't sorted (they participate in cycles)
      for (const e of missing) {
        sorted.push(e.manifest.name);
      }
    }

    return sorted.map((name) => nameToEntry.get(name)!);
  }

  /**
   * Load a plugin from directory
   */
  async loadPlugin(pluginPath: string): Promise<void> {
    const pluginName = path.basename(pluginPath);
    // Prevent path traversal: ensure resolved path is within plugins directory
    const resolvedPath = path.resolve(pluginPath);
    const canonicalBase = path.resolve(this.pluginsDir);
    if (!resolvedPath.startsWith(canonicalBase + path.sep) && resolvedPath !== canonicalBase) {
      throw new Error(`Plugin path escapes plugins directory: ${pluginName}`);
    }
    this.logger.info({ plugin: pluginName }, 'Loading plugin');

    try {
      // Read manifest
      const manifestPath = path.join(resolvedPath, 'plugin.json');
      const manifestData = await fs.readFile(manifestPath, 'utf-8');
      const manifest = validateManifest(JSON.parse(manifestData)) as PluginManifest;

      // Check version compatibility
      if (!isVersionCompatible(manifest.catalystVersion, CATALYST_VERSION)) {
        throw new Error(
          `Plugin requires Catalyst ${manifest.catalystVersion}, but running ${CATALYST_VERSION}`,
        );
      }

      // Check if plugin already loaded
      if (this.registry.has(manifest.name)) {
        this.logger.warn({ plugin: manifest.name }, 'Plugin already loaded, skipping');
        return;
      }

      // Create plugin instance with enabled ref for route lifecycle
      const enabledRef = { value: false };

      const loadedPlugin: LoadedPlugin = {
        manifest,
        status: 'loading' as PluginStatus,
        routes: [],
        middlewares: [],
        wsHandlers: new Map(),
        tasks: new Map(),
        eventHandlers: new Map(),
        context: {} as any,
        enabledRef,
        originalHandlers: new Map(),
      };

      // Persist to database FIRST (before creating context)
      await this.prisma.plugin.upsert({
        where: { name: manifest.name },
        create: {
          name: manifest.name,
          version: manifest.version,
          enabled: false,
          config: manifest.config || {},
        },
        update: {
          version: manifest.version,
        },
      });

      // Create plugin context (pass registry for RPC support)
      const context = createPluginContext(
        manifest,
        this.prisma,
        this.logger,
        this.wsGateway,
        loadedPlugin.routes,
        loadedPlugin.middlewares,
        loadedPlugin.wsHandlers,
        loadedPlugin.tasks,
        loadedPlugin.eventHandlers,
        this.eventEmitter,
        (this.fastify as any).authenticate,
        this.registry,
      );

      loadedPlugin.context = context;

      // Load backend if exists
      if (manifest.backend?.entry) {
        const backendPath = path.resolve(resolvedPath, manifest.backend.entry);
        const backendModule = await import(backendPath + '?t=' + Date.now());
        loadedPlugin.backend = backendModule.default || backendModule;

        // Call onLoad lifecycle hook
        if (loadedPlugin.backend?.onLoad) {
          await loadedPlugin.backend.onLoad(context);
        }
      }

      // ── Apply middleware wrapping to all routes ─────────────────────────
      const globalMiddlewares = loadedPlugin.middlewares.filter((m) => m.scope === 'global');

      for (const route of loadedPlugin.routes) {
        const originalHandler = route.handler;
        const routeKey = `${route.method}:${route.url}`;

        // Store original handler for potential future use
        if (loadedPlugin.originalHandlers) {
          loadedPlugin.originalHandlers.set(routeKey, originalHandler);
        }

        // Build wrapped handler: middleware chain → enabled check → original handler
        route.handler = async (request: FastifyRequest, reply: FastifyReply) => {
          // Run global middleware chain
          for (const mw of globalMiddlewares) {
            try {
              await runMiddleware(mw.handler, request, reply);
            } catch (err: any) {
              reply.status(500).send({
                success: false,
                error: 'Middleware error',
                details: err.message,
              });
              return;
            }
            // If middleware already sent a reply, stop processing
            if (reply.sent) return;
          }

          // Check if plugin is enabled
          if (!enabledRef.value) {
            return reply.status(503).send({
              success: false,
              error: 'Plugin is disabled',
            });
          }

          // Call original handler
          return (originalHandler as Function)(request, reply);
        };

        // Register route with Fastify
        this.fastify.route(route);
      }

      // Register plugin in registry
      loadedPlugin.status = 'loaded' as PluginStatus;
      loadedPlugin.loadedAt = new Date();
      this.registry.register(loadedPlugin);

      this.logger.info({ plugin: manifest.name }, 'Plugin loaded successfully');
    } catch (error: any) {
      this.logger.error({ plugin: pluginName, error: error.message }, 'Failed to load plugin');

      // Register as error state
      const errorPlugin: LoadedPlugin = {
        manifest: { name: pluginName } as PluginManifest,
        status: 'error' as PluginStatus,
        routes: [],
        middlewares: [],
        wsHandlers: new Map(),
        tasks: new Map(),
        eventHandlers: new Map(),
        context: {} as any,
        error,
        enabledRef: { value: false },
      };
      this.registry.register(errorPlugin);
    }
  }

  /**
   * Enable a plugin
   */
  async enablePlugin(name: string): Promise<void> {
    const plugin = this.registry.get(name);
    if (!plugin) {
      throw new Error(`Plugin ${name} not found`);
    }

    if (plugin.status === 'enabled') {
      this.logger.warn({ plugin: name }, 'Plugin already enabled');
      return;
    }

    if (plugin.status === 'error') {
      throw new Error(`Cannot enable plugin in error state: ${plugin.error?.message}`);
    }

    this.logger.info({ plugin: name }, 'Enabling plugin');

    try {
      // Toggle the enabled ref so routes become active
      if (plugin.enabledRef) {
        plugin.enabledRef.value = true;
      }

      // Call onEnable lifecycle hook
      if (plugin.backend?.onEnable) {
        await plugin.backend.onEnable(plugin.context);
      }

      // Update status
      plugin.status = 'enabled' as PluginStatus;
      plugin.enabledAt = new Date();
      this.registry.updateStatus(name, 'enabled' as PluginStatus);

      // Update database
      await this.prisma.plugin.update({
        where: { name },
        data: { enabled: true, enabledAt: new Date() },
      });

      this.logger.info({ plugin: name }, 'Plugin enabled successfully');
    } catch (error: any) {
      this.logger.error({ plugin: name, error: error.message }, 'Failed to enable plugin');
      plugin.status = 'error' as PluginStatus;
      plugin.error = error;
      // Re-disable the ref on error
      if (plugin.enabledRef) {
        plugin.enabledRef.value = false;
      }
      throw error;
    }
  }

  /**
   * Disable a plugin - routes return 503, tasks stopped, events cleaned
   */
  async disablePlugin(name: string): Promise<void> {
    const plugin = this.registry.get(name);
    if (!plugin) {
      throw new Error(`Plugin ${name} not found`);
    }

    if (plugin.status !== 'enabled') {
      this.logger.warn({ plugin: name }, 'Plugin not enabled');
      return;
    }

    this.logger.info({ plugin: name }, 'Disabling plugin');

    try {
      // Toggle the enabled ref so routes return 503
      if (plugin.enabledRef) {
        plugin.enabledRef.value = false;
      }

      // Call onDisable lifecycle hook
      if (plugin.backend?.onDisable) {
        await plugin.backend.onDisable(plugin.context);
      }

      // Stop scheduled tasks
      for (const [taskId, task] of plugin.tasks) {
        if (task.job) {
          task.job.stop();
        }
      }

      // Unregister plugin WebSocket handlers from gateway
      if (this.wsGateway.unregisterPluginWsHandlers) {
        this.wsGateway.unregisterPluginWsHandlers(name);
      }

      // Update status
      plugin.status = 'disabled' as PluginStatus;
      this.registry.updateStatus(name, 'disabled' as PluginStatus);

      // Update database
      await this.prisma.plugin.update({
        where: { name },
        data: { enabled: false, enabledAt: null },
      });

      this.logger.info({ plugin: name }, 'Plugin disabled successfully');
    } catch (error: any) {
      this.logger.error({ plugin: name, error: error.message }, 'Failed to disable plugin');
      throw error;
    }
  }

  /**
   * Unload a plugin completely
   */
  async unloadPlugin(name: string): Promise<void> {
    const plugin = this.registry.get(name);
    if (!plugin) {
      throw new Error(`Plugin ${name} not found`);
    }

    this.logger.info({ plugin: name }, 'Unloading plugin');

    try {
      // Disable first if enabled
      if (plugin.status === 'enabled') {
        await this.disablePlugin(name);
      }

      // Call onUnload lifecycle hook
      if (plugin.backend?.onUnload) {
        await plugin.backend.onUnload(plugin.context);
      }

      // Remove event listeners
      for (const [event, handlers] of plugin.eventHandlers) {
        for (const handler of handlers) {
          this.eventEmitter.removeListener(event, handler);
        }
      }

      // Stop and remove tasks
      for (const [taskId, task] of plugin.tasks) {
        if (task.job) {
          task.job.stop();
          task.job.destroy();
        }
      }
      plugin.tasks.clear();

      // Unregister plugin WebSocket handlers
      if (this.wsGateway.unregisterPluginWsHandlers) {
        this.wsGateway.unregisterPluginWsHandlers(name);
      }

      // Remove exposed RPC APIs
      this.registry.removeExposedApis(name);

      // Clear original handlers
      plugin.originalHandlers?.clear();

      // Unregister from registry
      this.registry.unregister(name);

      this.logger.info({ plugin: name }, 'Plugin unloaded successfully');
    } catch (error: any) {
      this.logger.error({ plugin: name, error: error.message }, 'Failed to unload plugin');
      throw error;
    }
  }

  /**
   * Reload a plugin (hot-reload)
   */
  async reloadPlugin(name: string): Promise<void> {
    this.logger.info({ plugin: name }, 'Reloading plugin');

    const plugin = this.registry.get(name);
    if (!plugin) {
      throw new Error(`Plugin ${name} not found`);
    }

    const wasEnabled = plugin.status === 'enabled';
    const pluginPath = path.join(this.pluginsDir, name);

    // Unload existing plugin
    await this.unloadPlugin(name);

    // Clear module cache - robust approach for both CJS and ESM
    const backendPath = path.resolve(pluginPath, plugin.manifest.backend?.entry || '');
    try {
      // Try CJS cache clearing
      delete require.cache[require.resolve(backendPath)];
    } catch {
      // Not in require cache, that's fine
    }
    // Cache-busting query param is applied in loadPlugin via import(path + '?t=...')
    // This ensures ESM modules are re-imported fresh

    // Load plugin again
    await this.loadPlugin(pluginPath);

    // Enable if it was enabled before
    if (wasEnabled) {
      await this.enablePlugin(name);
    }

    this.logger.info({ plugin: name }, 'Plugin reloaded successfully');
  }

  /**
   * Enable hot-reload
   */
  enableHotReload(): void {
    this.logger.info('Enabling plugin hot-reload');

    this.watcher = watch(this.pluginsDir, {
      persistent: true,
      ignoreInitial: true,
      depth: 2,
    });

    this.watcher.on('change', async (filePath) => {
      // Robust path extraction - use path.dirname and get the plugin directory name
      const pluginPath = path.dirname(filePath);
      const pluginName = path.basename(pluginPath);

      // Fallback: if basename doesn't look like a valid plugin name, try second-to-last segment
      if (!/^[a-z0-9-]+$/i.test(pluginName)) {
        const pathParts = pluginPath.split(path.sep);
        if (pathParts.length >= 2) {
          this.logger.debug(
            { pluginPath, pluginName },
            'Using path basename for plugin identification',
          );
        }
      }

      if (!this.registry.has(pluginName)) return;

      this.logger.info({ plugin: pluginName, file: filePath }, 'Plugin file changed, reloading');

      try {
        await this.reloadPlugin(pluginName);
      } catch (error: any) {
        this.logger.error({ plugin: pluginName, error: error.message }, 'Hot-reload failed');
      }
    });
  }

  /**
   * Disable hot-reload
   */
  disableHotReload(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = undefined;
      this.logger.info('Hot-reload disabled');
    }
  }

  /**
   * Get registry
   */
  getRegistry(): PluginRegistry {
    return this.registry;
  }

  /**
   * Shutdown plugin system
   */
  async shutdown(): Promise<void> {
    this.logger.info('Shutting down plugin system');

    this.disableHotReload();

    // Unload all plugins
    const plugins = this.registry.getAll();
    for (const plugin of plugins) {
      try {
        await this.unloadPlugin(plugin.manifest.name);
      } catch (error: any) {
        this.logger.error(
          { plugin: plugin.manifest.name, error: error.message },
          'Error unloading plugin during shutdown',
        );
      }
    }

    this.registry.clear();
    this.logger.info('Plugin system shut down');
  }
}
