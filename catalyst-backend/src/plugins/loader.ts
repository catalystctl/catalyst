import fs from 'fs/promises';
import path from 'path';
import { watch } from 'chokidar';
import type { PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import type { FastifyInstance } from 'fastify';
import type { WebSocketGateway } from '../websocket/gateway';
import type { PluginManifest, PluginBackend, LoadedPlugin, PluginStatus } from './types';
import { validateManifest, isVersionCompatible } from './validator';
import { createPluginContext } from './context';
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
    options: { hotReload?: boolean } = {}
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
    
    // Discover and load plugins
    await this.discoverPlugins();
    
    // Enable hot-reload if configured
    if (this.hotReloadEnabled) {
      this.enableHotReload();
    }
    
    this.logger.info({ count: this.registry.count() }, 'Plugin system initialized');
  }
  
  /**
   * Discover plugins from filesystem
   */
  async discoverPlugins(): Promise<void> {
    this.logger.info('Discovering plugins');
    
    try {
      const entries = await fs.readdir(this.pluginsDir, { withFileTypes: true });
      const pluginDirs = entries.filter((e) => e.isDirectory());
      
      for (const dir of pluginDirs) {
        const pluginPath = path.join(this.pluginsDir, dir.name);
        await this.loadPlugin(pluginPath);
      }
      
      this.logger.info({ discovered: pluginDirs.length }, 'Plugin discovery complete');
    } catch (error: any) {
      this.logger.error({ error: error.message }, 'Plugin discovery failed');
    }
  }
  
  /**
   * Load a plugin from directory
   */
  async loadPlugin(pluginPath: string): Promise<void> {
    const pluginName = path.basename(pluginPath);
    this.logger.info({ plugin: pluginName }, 'Loading plugin');
    
    try {
      // Read manifest
      const manifestPath = path.join(pluginPath, 'plugin.json');
      const manifestData = await fs.readFile(manifestPath, 'utf-8');
      const manifest = validateManifest(JSON.parse(manifestData)) as PluginManifest;
      
      // Check version compatibility
      if (!isVersionCompatible(manifest.catalystVersion, CATALYST_VERSION)) {
        throw new Error(
          `Plugin requires Catalyst ${manifest.catalystVersion}, but running ${CATALYST_VERSION}`
        );
      }
      
      // Check if plugin already loaded
      if (this.registry.has(manifest.name)) {
        this.logger.warn({ plugin: manifest.name }, 'Plugin already loaded, skipping');
        return;
      }
      
      // Create plugin instance
      const loadedPlugin: LoadedPlugin = {
        manifest,
        status: 'loading' as PluginStatus,
        routes: [],
        middlewares: [],
        wsHandlers: new Map(),
        tasks: new Map(),
        eventHandlers: new Map(),
        context: {} as any, // Will be set below
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
      
      // Create plugin context
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
        (this.fastify as any).authenticate
      );
      
      loadedPlugin.context = context;
      
      // Load backend if exists
      if (manifest.backend?.entry) {
        const backendPath = path.resolve(pluginPath, manifest.backend.entry);
        const backendModule = await import(backendPath);
        loadedPlugin.backend = backendModule.default || backendModule;
        
        // Call onLoad lifecycle hook
        if (loadedPlugin.backend?.onLoad) {
          await loadedPlugin.backend.onLoad(context);
        }
      }
      
      // Register routes with Fastify IMMEDIATELY (before server starts)
      for (const route of loadedPlugin.routes) {
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
      // Call onEnable lifecycle hook
      if (plugin.backend?.onEnable) {
        await plugin.backend.onEnable(plugin.context);
      }
      
      // Note: Routes are already registered during load phase
      // We can't register routes after Fastify has started listening
      
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
      throw error;
    }
  }
  
  /**
   * Disable a plugin
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
   * Unload a plugin
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
    
    // Clear module cache
    const backendPath = path.resolve(pluginPath, plugin.manifest.backend?.entry || '');
    delete require.cache[require.resolve(backendPath)];
    
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
      const pluginName = filePath.split(path.sep)[filePath.split(path.sep).length - 2];
      
      if (!this.registry.has(pluginName)) return;
      
      this.logger.info({ plugin: pluginName, file: filePath }, 'Plugin file changed, reloading');
      
      try {
        await this.reloadPlugin(pluginName);
      } catch (error: any) {
        this.logger.error(
          { plugin: pluginName, error: error.message },
          'Hot-reload failed'
        );
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
          'Error unloading plugin during shutdown'
        );
      }
    }
    
    this.registry.clear();
    this.logger.info('Plugin system shut down');
  }
}
