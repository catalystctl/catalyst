import type { PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import type { FastifyRequest, FastifyReply, RouteOptions } from 'fastify';
import type { WebSocketGateway } from '../websocket/gateway';
import type {
  PluginManifest,
  PluginBackendContext,
  PluginMiddlewareEntry,
  PluginWebSocketHandler,
  PluginTaskHandler,
  PluginEventHandler,
  PluginCollectionAPI,
  PluginCollectionOptions,
  PluginEventSchema,
  PluginFileTunnel,
  ScopedPluginDB,
} from './types';
import type { PluginRegistry } from './registry';
import cron from 'node-cron';
import type { ScheduledTask } from 'node-cron';
import { describeError } from '../utils/describe-error.js';
import { createHmac } from 'node:crypto';
import EventEmitter from 'events';
import { captureSystemError } from '../services/error-logger';
import { createCollectionStorage } from './storage/collection-storage';
import { resolveConfigValue } from './config-utils';
import { matchFilter, applyUpdateOperators } from './path-utils';
import { normalizePermissionList } from './safety';

// ── Simple unique ID generator ──────────────────────────────────────────────
function generateId(): string {
  const timestamp = Date.now().toString(36);
  const counter = ((Math.random() * 1679616) | 0).toString(36).padStart(4, '0');
  const random = Math.random().toString(36).substring(2, 10);
  return `${timestamp}${counter}${random}`;
}

// ── Allowed fields for plugin database queries ──────────────────────────────
const SERVER_ALLOWED_SELECT_FIELDS = new Set([
  'id', 'name', 'uuid', 'description', 'status', 'createdAt', 'updatedAt',
  'nodeId', 'ownerId', 'templateId', 'locationId',
  'allocatedMemoryMb', 'allocatedCpuCores', 'allocatedDiskMb', 'allocatedSwapMb',
  'containerId', 'containerName', 'networkMode', 'primaryPort', 'primaryIp',
  'environment', 'startupCommand', 'suspendedAt', 'suspensionReason',
]);

const USER_ALLOWED_SELECT_FIELDS = new Set([
  'id', 'username', 'email', 'name', 'image', 'banned', 'createdAt', 'updatedAt',
  'firstName', 'lastName', 'role',
]);

/**
 * Sanitizes user-supplied select object, allowing only known-safe fields.
 * If user supplies an empty select, returns the full allowed set.
 * Any disallowed keys are silently dropped.
 */
function sanitizeServerSelect(userSelect?: Record<string, boolean>): Record<string, boolean> {
  if (!userSelect || typeof userSelect !== 'object') {
    const allowed: Record<string, boolean> = {};
    for (const f of SERVER_ALLOWED_SELECT_FIELDS) allowed[f] = true;
    return allowed;
  }
  const sanitized: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(userSelect)) {
    if (SERVER_ALLOWED_SELECT_FIELDS.has(key)) {
      sanitized[key] = value;
    }
  }
  if (Object.keys(sanitized).length === 0) {
    // Fallback to allowed set if user selects nothing valid
    for (const f of SERVER_ALLOWED_SELECT_FIELDS) sanitized[f] = true;
  }
  return sanitized;
}

function sanitizeUserSelect(userSelect?: Record<string, boolean>): Record<string, boolean> {
  if (!userSelect || typeof userSelect !== 'object') {
    const allowed: Record<string, boolean> = {};
    for (const f of USER_ALLOWED_SELECT_FIELDS) allowed[f] = true;
    return allowed;
  }
  const sanitized: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(userSelect)) {
    if (USER_ALLOWED_SELECT_FIELDS.has(key)) {
      sanitized[key] = value;
    }
  }
  if (Object.keys(sanitized).length === 0) {
    for (const f of USER_ALLOWED_SELECT_FIELDS) sanitized[f] = true;
  }
  return sanitized;
}

// Filter matching lives in path-utils.ts (dotted-path + $or/$and support).

// ── Field whitelist for write operations ────────────────────────────────────
const SERVER_WRITE_WHITELIST = new Set(['status']);
// roleIds intentionally omitted — plugins with only user.write must not escalate
// privileges by assigning roles. Admin-only role assignment stays outside plugins.
const USER_WRITE_WHITELIST = new Set<string>([]);

/**
 * Scoped database wrapper that limits plugin access to safe operations only.
 * Plugins should only access what they declare in their manifest permissions,
 * intersected with what the admin has granted. Permission checks are LIVE:
 * every table access and every write re-reads the current grant list, so an
 * admin revoking a permission takes effect immediately without a restart.
 */
class ScopedPluginDBClient implements ScopedPluginDB {
  private prisma: PrismaClient;
  private pluginName: string;
  private logger: Logger;
  /** Live view of the plugin's effective permission grants. */
  private getPermissions: () => string[];

  constructor(
    prisma: PrismaClient,
    pluginName: string,
    logger: Logger,
    getPermissions: () => string[],
  ) {
    this.prisma = prisma;
    this.pluginName = pluginName;
    this.logger = logger;
    this.getPermissions = getPermissions;
  }

  /** Current grants as a set (fresh on every call). */
  private currentPermissions(): Set<string> {
    return new Set(this.getPermissions() ?? []);
  }

  /** True if any of the required tokens is granted (`*` grants everything). */
  private hasAnyOf(...required: string[]): boolean {
    const perms = this.currentPermissions();
    return perms.has('*') || required.some((r) => perms.has(r));
  }

  /** Live table-access check derived from current grants. */
  private canAccessTable(table: string): boolean {
    return getAllowedTablesForPermissions(this.getPermissions() ?? []).includes(table);
  }

  // Server operations - READ ONLY by default, write with field whitelist
  get servers() {
    if (!this.canAccessTable('servers')) {
      this.logger.warn({ plugin: this.pluginName }, 'Plugin attempted to access servers without permission');
      throw new Error('Permission denied: servers access not declared in manifest');
    }
    this.logger.debug({ plugin: this.pluginName }, 'Plugin accessed servers (read)');
    const prisma = this.prisma;
    const pluginName = this.pluginName;
    const logger = this.logger;
    return {
      findMany: async (args?: any) =>
        prisma.server.findMany({
          ...args,
          select: sanitizeServerSelect(args?.select),
          ...(args?.where ? { where: args.where } : {}),
          ...(args?.take ? { take: args.take } : {}),
          ...(args?.skip ? { skip: args.skip } : {}),
          ...(args?.orderBy ? { orderBy: args.orderBy } : {}),
        }),
      findUnique: async (args: any) => {
        const result = await prisma.server.findUnique({
          ...args,
          select: sanitizeServerSelect(args?.select),
        });
        return result;
      },
      count: async (args?: any) => prisma.server.count(args),
      update: async (id: string, data: Record<string, any>) => {
        if (!this.hasAnyOf('server.write')) {
          logger.warn({ plugin: pluginName }, 'Plugin attempted server.update without server.write permission');
          throw new Error('Permission denied: server.write permission required for updates');
        }
        const filtered: Record<string, any> = {};
        for (const key of Object.keys(data)) {
          if (SERVER_WRITE_WHITELIST.has(key)) {
            filtered[key] = data[key];
          } else {
            logger.warn(
              { plugin: pluginName, field: key },
              'Plugin attempted to update non-whitelisted server field',
            );
          }
        }
        if (Object.keys(filtered).length === 0) {
          throw new Error('No whitelisted fields in update data. Allowed fields: status');
        }
        logger.info({ plugin: pluginName, serverId: id, fields: Object.keys(filtered) }, 'Plugin updated server');
        return prisma.server.update({ where: { id }, data: filtered });
      },
    };
  }

  // User operations - VERY LIMITED, basic info only, NO credentials or API keys
  get users() {
    if (!this.canAccessTable('users')) {
      this.logger.warn({ plugin: this.pluginName }, 'Plugin attempted to access users without permission');
      throw new Error('Permission denied: users access not declared in manifest');
    }
    this.logger.debug({ plugin: this.pluginName }, 'Plugin accessed users (read, limited)');
    const prisma = this.prisma;
    const pluginName = this.pluginName;
    const logger = this.logger;
    return {
      findMany: async (args?: any) =>
        prisma.user.findMany({
          ...args,
          select: sanitizeUserSelect(args?.select),
          ...(args?.where ? { where: args.where } : {}),
          ...(args?.take ? { take: args.take } : {}),
          ...(args?.skip ? { skip: args.skip } : {}),
          ...(args?.orderBy ? { orderBy: args.orderBy } : {}),
        }),
      findUnique: async (args: any) => {
        const result = await prisma.user.findUnique({
          ...args,
          select: sanitizeUserSelect(args?.select),
        });
        return result;
      },
      count: async (args?: any) => prisma.user.count(args),
      update: async (id: string, data: Record<string, any>) => {
        if (!this.hasAnyOf('user.write')) {
          logger.warn({ plugin: pluginName }, 'Plugin attempted user.update without user.write permission');
          throw new Error('Permission denied: user.write permission required for updates');
        }
        const filtered: Record<string, any> = {};
        for (const key of Object.keys(data)) {
          if (USER_WRITE_WHITELIST.has(key)) {
            filtered[key] = data[key];
          } else {
            logger.warn(
              { plugin: pluginName, field: key },
              'Plugin attempted to update non-whitelisted user field',
            );
          }
        }
        if (Object.keys(filtered).length === 0) {
          throw new Error(
            'No whitelisted fields in update data. user.write cannot modify roleIds (privilege escalation). Allowed fields: (none — use admin APIs for role assignment)',
          );
        }
        logger.info({ plugin: pluginName, userId: id, fields: Object.keys(filtered) }, 'Plugin updated user');
        return prisma.user.update({ where: { id }, data: filtered });
      },
    };
  }

  // BLOCKED: credentials, apiKeys, auditLogs - never accessible to plugins
  get credentials() {
    captureSystemError({
      level: 'critical',
      component: 'PluginSecurity',
      message: `Plugin ${this.pluginName} attempted to access credentials - BLOCKED`,
      metadata: { plugin: this.pluginName, resource: 'credentials' },
    }).catch(() => {});
    this.logger.error({ plugin: this.pluginName }, 'Plugin attempted to access credentials - BLOCKED');
    throw new Error('Access to credentials is prohibited for security reasons');
  }

  get apiKeys() {
    captureSystemError({
      level: 'critical',
      component: 'PluginSecurity',
      message: `Plugin ${this.pluginName} attempted to access apiKeys - BLOCKED`,
      metadata: { plugin: this.pluginName, resource: 'apiKeys' },
    }).catch(() => {});
    this.logger.error({ plugin: this.pluginName }, 'Plugin attempted to access apiKeys - BLOCKED');
    throw new Error('Access to API keys is prohibited for security reasons');
  }

  get auditLogs() {
    captureSystemError({
      level: 'critical',
      component: 'PluginSecurity',
      message: `Plugin ${this.pluginName} attempted to access auditLogs - BLOCKED`,
      metadata: { plugin: this.pluginName, resource: 'auditLogs' },
    }).catch(() => {});
    this.logger.error({ plugin: this.pluginName }, 'Plugin attempted to access auditLogs - BLOCKED');
    throw new Error('Access to audit logs is prohibited for security reasons');
  }

  // Plugin-scoped data only - plugins can always access their own storage
  get pluginStorage() {
    this.logger.debug({ plugin: this.pluginName }, 'Plugin accessed pluginStorage');
    const prisma = this.prisma;
    const pluginName = this.pluginName;
    return {
      findUnique: async (args: any) =>
        prisma.pluginStorage.findUnique({
          ...args,
          where: { ...args.where, pluginName },
        }),
      upsert: async (args: any) =>
        prisma.pluginStorage.upsert({
          ...args,
          create: { ...args.create, pluginName },
          update: args.update,
          where: { ...args.where, pluginName },
        }),
      deleteMany: async (args: any) =>
        prisma.pluginStorage.deleteMany({
          ...args,
          where: { ...args.where, pluginName },
        }),
      findMany: async (args?: any) =>
        prisma.pluginStorage.findMany({
          ...args,
          where: { ...args?.where, pluginName },
        }),
    };
  }

  // Plugin config - read-only, write requires explicit method
  get plugin() {
    return {
      findUnique: async (args: any) => this.prisma.plugin.findUnique(args),
      update: async (args: any) => {
        this.logger.warn(
          { plugin: this.pluginName },
          'Plugin attempted to modify plugin config directly - BLOCKED. Use context.setConfig() instead',
        );
        throw new Error(
          'Direct plugin config modification is prohibited. Use context.setConfig() method.',
        );
      },
    };
  }

  // Block all other tables
  get node() {
    captureSystemError({
      level: 'warn',
      component: 'PluginSecurity',
      message: `Plugin ${this.pluginName} attempted to access node - BLOCKED`,
      metadata: { plugin: this.pluginName, resource: 'node' },
    }).catch(() => {});
    this.logger.error({ plugin: this.pluginName }, 'Plugin attempted to access node - BLOCKED');
    throw new Error('Access to nodes is prohibited');
  }

  get role() {
    captureSystemError({
      level: 'warn',
      component: 'PluginSecurity',
      message: `Plugin ${this.pluginName} attempted to access role - BLOCKED`,
      metadata: { plugin: this.pluginName, resource: 'role' },
    }).catch(() => {});
    this.logger.error({ plugin: this.pluginName }, 'Plugin attempted to access role - BLOCKED');
    throw new Error('Access to roles is prohibited');
  }

  get session() {
    captureSystemError({
      level: 'warn',
      component: 'PluginSecurity',
      message: `Plugin ${this.pluginName} attempted to access session - BLOCKED`,
      metadata: { plugin: this.pluginName, resource: 'session' },
    }).catch(() => {});
    this.logger.error({ plugin: this.pluginName }, 'Plugin attempted to access session - BLOCKED');
    throw new Error('Access to sessions is prohibited');
  }

  get invite() {
    captureSystemError({
      level: 'warn',
      component: 'PluginSecurity',
      message: `Plugin ${this.pluginName} attempted to access invite - BLOCKED`,
      metadata: { plugin: this.pluginName, resource: 'invite' },
    }).catch(() => {});
    this.logger.error({ plugin: this.pluginName }, 'Plugin attempted to access invite - BLOCKED');
    throw new Error('Access to invites is prohibited');
  }

  // Catch-all for any other tables
  get $() {
    return new Proxy(
      {},
      {
        get: () => {
          captureSystemError({
            level: 'warn',
            component: 'PluginSecurity',
            message: `Plugin ${this.pluginName} attempted to access undeclared table - BLOCKED`,
            metadata: { plugin: this.pluginName, resource: '$' },
          }).catch(() => {});
          this.logger.error(
            { plugin: this.pluginName },
            'Plugin attempted to access undeclared table - BLOCKED',
          );
          throw new Error(
            'Access to this resource is not allowed. Declare required permissions in your manifest.',
          );
        },
      },
    );
  }

  // Structured collection storage
  collection(name: string): PluginCollectionAPI {
    return new PluginCollectionImpl(name, this.pluginName, this.prisma, this.logger);
  }
}

// ── Collection implementation ────────────────────────────────────────────────
class PluginCollectionImpl implements PluginCollectionAPI {
  private storageKey: string;

  constructor(
    private name: string,
    private pluginName: string,
    private prisma: PrismaClient,
    private logger: Logger,
  ) {
    this.storageKey = `collection:${name}`;
  }

  private async loadDocs(): Promise<any[]> {
    const storage = await this.prisma.pluginStorage.findUnique({
      where: {
        pluginName_key: { pluginName: this.pluginName, key: this.storageKey },
      },
    });
    return storage ? (Array.isArray(storage.value) ? storage.value : []) : [];
  }

  private async saveDocs(docs: any[]): Promise<void> {
    await this.prisma.pluginStorage.upsert({
      where: {
        pluginName_key: { pluginName: this.pluginName, key: this.storageKey },
      },
      create: {
        pluginName: this.pluginName,
        key: this.storageKey,
        value: docs as any,
      },
      update: {
        value: docs as any,
      },
    });
  }

  async find(filter?: any, options?: PluginCollectionOptions): Promise<any[]> {
    let docs = await this.loadDocs();

    if (filter) {
      docs = docs.filter((d) => matchFilter(d, filter));
    }

    if (options?.sort) {
      for (const [sortField, sortOrder] of Object.entries(options.sort)) {
        docs.sort((a, b) => {
          const aVal = a[sortField];
          const bVal = b[sortField];
          if (aVal === null && bVal === null) return 0;
          if (aVal === null) return 1 * sortOrder;
          if (bVal === null) return -1 * sortOrder;
          if (aVal < bVal) return -1 * sortOrder;
          if (aVal > bVal) return 1 * sortOrder;
          return 0;
        });
      }
    }

    if (options?.skip) {
      docs = docs.slice(options.skip);
    }

    if (options?.limit) {
      docs = docs.slice(0, options.limit);
    }

    if (options?.projection) {
      docs = docs.map((d) => {
        const projected: any = { _id: d._id };
        for (const [field, include] of Object.entries(options?.projection ?? {})) {
          if (include && d[field] !== undefined) {
            projected[field] = d[field];
          }
        }
        return projected;
      });
    }

    return docs;
  }

  async findOne(filter: any): Promise<any | null> {
    const docs = await this.loadDocs();
    const match = docs.find((d) => matchFilter(d, filter));
    return match || null;
  }

  async insert(doc: any): Promise<any> {
    const docs = await this.loadDocs();
    const now = new Date().toISOString();
    const newDoc = {
      ...doc,
      _id: generateId(),
      _createdAt: now,
      _updatedAt: now,
    };
    docs.push(newDoc);
    await this.saveDocs(docs);
    this.logger.debug({ plugin: this.pluginName, collection: this.name, _id: newDoc._id }, 'Collection document inserted');
    return newDoc;
  }

  async update(filter: any, updateData: any): Promise<number> {
    const docs = await this.loadDocs();
    let count = 0;

    for (let i = 0; i < docs.length; i++) {
      if (matchFilter(docs[i], filter)) {
        const now = new Date().toISOString();
        applyUpdateOperators(docs[i], updateData);
        docs[i]._updatedAt = now;
        count++;
      }
    }

    if (count > 0) {
      await this.saveDocs(docs);
      this.logger.debug(
        { plugin: this.pluginName, collection: this.name, count },
        'Collection documents updated',
      );
    }
    return count;
  }

  async delete(filter: any): Promise<number> {
    const docs = await this.loadDocs();
    const filtered = docs.filter((d) => !matchFilter(d, filter));
    const count = docs.length - filtered.length;
    if (count > 0) {
      await this.saveDocs(filtered);
      this.logger.debug(
        { plugin: this.pluginName, collection: this.name, count },
        'Collection documents deleted',
      );
    }
    return count;
  }

  async count(filter?: any): Promise<number> {
    const docs = await this.loadDocs();
    if (filter) return docs.filter((d) => matchFilter(d, filter)).length;
    return docs.length;
  }
}

/**
 * Fire-and-forget audit trail recording for plugin actions.
 * Records plugin activity without blocking or failing the main operation.
 */
async function recordAudit(
  prisma: PrismaClient,
  pluginName: string,
  action: string,
  details?: any,
  options?: { userId?: string; ipAddress?: string; duration?: number; success?: boolean; errorMessage?: string },
): Promise<void> {
  try {
    await prisma.pluginActionAudit.create({
      data: {
        pluginName,
        action,
        details: details ? (details as any) : null,
        userId: options?.userId ?? null,
        ipAddress: options?.ipAddress ?? null,
        duration: options?.duration ?? null,
        success: options?.success ?? true,
        errorMessage: options?.errorMessage ?? null,
      },
    });
  } catch {
    // Audit logging must never affect the main operation
  }
}

// Permission to table mapping
const PERMISSION_TO_TABLES: Record<string, string[]> = {
  'server.read': ['servers'],
  'server.write': [], // Write ops require explicit field whitelisting, not table-level access
  'user.read': ['users'],
  'user.write': [], // Write ops require explicit field whitelisting, not table-level access
  'admin.read': [], // Admin read is for admin routes, not direct DB access
  'admin.write': [], // Admin write is for admin routes, not direct DB access
};

// ── Plugin auth bridge helpers ──────────────────────────────────────────────

const AUTH_USER_SELECT = {
  id: true,
  email: true,
  username: true,
  name: true,
  image: true,
  emailVerified: true,
  banned: true,
  lockedUntil: true,
} as const;

type AuthUserRow = {
  id: string;
  email: string;
  username: string;
  name: string;
  image: string | null;
  emailVerified: boolean;
  banned: boolean;
  lockedUntil: Date | null;
};

function toAuthUser(row: AuthUserRow) {
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    name: row.name,
    image: row.image,
    emailVerified: row.emailVerified,
    banned: row.banned,
    lockedUntil: row.lockedUntil ? row.lockedUntil.toISOString() : null,
  };
}

/** Serialize a better-auth session cookie for a Set-Cookie header. */
function serializeSessionCookie(name: string, token: string, expiresAt: Date, rememberMe: boolean, secure: boolean): string {
  const parts = [`${name}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (secure) parts.push('Secure');
  if (rememberMe) {
    parts.push(`Expires=${expiresAt.toUTCString()}`);
    parts.push(`Max-Age=${Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000))}`);
  }
  return parts.join('; ');
}

/**
 * better-auth stores session cookies as `${token}.${signature}` where the
 * signature is base64(HMAC-SHA256(secret, token)) — getSession verifies it
 * via getSignedCookie and silently returns null for unsigned values. This
 * mirrors makeSignature() from better-auth's crypto module with node:crypto
 * (same raw-secret HMAC-SHA256 over the token bytes, standard base64).
 */
function signSessionToken(token: string, secret: string): string {
  return createHmac('sha256', Buffer.from(secret, 'utf8')).update(token, 'utf8').digest('base64');
}

const USERNAME_RE = /^[a-zA-Z0-9._-]{1,32}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;


function getAllowedTablesForPermissions(permissions: string[]): string[] {
  const allowed: string[] = [];
  for (const perm of permissions) {
    if (perm === '*') {
      allowed.push('servers', 'users');
      continue;
    }
    const tables = PERMISSION_TO_TABLES[perm];
    if (tables) {
      allowed.push(...tables);
    }
  }
  return [...new Set(allowed)];
}

/**
 * Creates plugin context for backend plugins.
 *
 * @param registry - PluginRegistry for RPC storage (must be passed for exposeApi/callPluginApi)
 * @param permissionsProvider - Optional live view of the plugin's effective grants.
 *   When provided, every permission check (DB table access, whitelisted writes,
 *   plugin.rpc) consults this on each call so admin revocations apply immediately.
 *   Defaults to the manifest's declared permissions.
 */
export function createPluginContext(
  manifest: PluginManifest,
  originalConfig: Record<string, any> | undefined,
  prisma: PrismaClient,
  logger: Logger,
  wsGateway: WebSocketGateway,
  routes: RouteOptions[],
  middlewares: PluginMiddlewareEntry[],
  wsHandlers: Map<string, PluginWebSocketHandler>,
  tasks: Map<string, { cron: string; handler: PluginTaskHandler; job?: ScheduledTask }>,
  eventHandlers: Map<string, Set<PluginEventHandler>>,
  eventEmitter: EventEmitter,
  authenticate?: Function,
  registry?: PluginRegistry,
  permissionsProvider?: () => string[],
  fileTunnel?: PluginFileTunnel,
): PluginBackendContext {
  const pluginLogger = logger.child({ plugin: manifest.name });

  // Live effective permissions. The default falls back to manifest-declared
  // permissions for backwards compatibility (tests, embedding hosts).
  const getPermissions: () => string[] =
    permissionsProvider ?? (() => normalizePermissionList(manifest.permissions || []));

  // Create scoped database wrapper based on live effective permissions
  const scopedDb = new ScopedPluginDBClient(prisma, manifest.name, pluginLogger, getPermissions);

  /** Live capability check for the auth bridge (`*` grants everything). */
  const hasCapability = (token: string) => {
    const perms = getPermissions();
    return perms.includes('*') || perms.includes(token);
  };

  /** Connect/disconnect roles on a user, gated on roles.assign and audited. */
  const modifyUserRoles = async (
    userId: string,
    roleIds: string[],
    op: 'connect' | 'disconnect',
    reason: string,
  ) => {
    if (!hasCapability('roles.assign')) {
      throw new Error('Permission denied: roles.assign permission required for role changes');
    }
    const ids = [...new Set((roleIds ?? []).filter((r) => typeof r === 'string' && r))];
    if (ids.length === 0) return;

    // Only touch roles that exist — unknown ids would make the write fail and
    // likely mean stale mappings.
    const existing = await prisma.role.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    });
    if (existing.length === 0) return;
    const existingIds = existing.map((r) => r.id);

    await prisma.user.update({
      where: { id: userId },
      data: { roles: { [op]: existingIds.map((id) => ({ id })) } },
    });

    recordAudit(prisma, manifest.name, op === 'connect' ? 'auth.roles_assigned' : 'auth.roles_removed', {
      userId,
      roles: existing.map((r) => r.name),
      reason,
    }, { userId });
    pluginLogger.info({ userId, op, roles: existing.map((r) => r.name), reason }, 'Plugin modified user roles');
  };

  const context: PluginBackendContext = {
    manifest,
    originalConfig,
    db: scopedDb,
    logger: pluginLogger,
    wsGateway,
    fileTunnel,

    registerRoute(options: RouteOptions) {
      // Prefix route path with plugin namespace
      const prefixedPath = `/api/plugins/${manifest.name}/${options.url.replace(/^\//, '')}`;

      // Auth mode: 'required' (default), 'optional' (session attached when
      // present, anonymous otherwise) or 'public' (never authenticated).
      // Non-required modes need the live `routes.public` grant — otherwise
      // the route is silently downgraded to required (and logged).
      const requestedMode = (options.config as { auth?: unknown } | undefined)?.auth;
      let authMode: 'required' | 'optional' | 'public' = 'required';
      if (requestedMode === 'public' || requestedMode === 'optional') {
        if (getPermissions().includes('routes.public') || getPermissions().includes('*')) {
          authMode = requestedMode;
        } else {
          pluginLogger.warn(
            { route: prefixedPath, requested: requestedMode },
            'Route requested non-required auth without routes.public grant — downgraded to required',
          );
        }
      }

      const routeOptions: RouteOptions = {
        ...options,
        url: prefixedPath,
        config: { ...(options.config as object | undefined), auth: authMode },
      };
      // SECURITY: Always inject host authentication middleware.
      // Plugin-provided preHandler/onRequest are run AFTER the host auth check.
      if (authenticate && authMode === 'required') {
        const existingPreHandler = options.preHandler;
        const existingOnRequest = options.onRequest;
        if (existingPreHandler || existingOnRequest) {
          pluginLogger.warn(
            { route: prefixedPath },
            'Plugin attempted to set its own preHandler/onRequest — host auth will still be enforced first',
          );
        }
        (routeOptions as any).preHandler = [
          authenticate,
          ...(Array.isArray(existingPreHandler) ? existingPreHandler : existingPreHandler ? [existingPreHandler] : []),
        ];
        if (existingOnRequest) {
          (routeOptions as any).onRequest = [
            ...(Array.isArray(existingOnRequest) ? existingOnRequest : [existingOnRequest]),
          ];
        }
      }
      // Wrap handler with audit trail
      const originalHandler = routeOptions.handler;
      routeOptions.handler = async (request: FastifyRequest, reply: FastifyReply) => {
        const start = Date.now();
        let success = true;
        let errorMessage: string | undefined;
        try {
          const result = await (originalHandler as Function)(request, reply);
          return result;
        } catch (err: any) {
          success = false;
          errorMessage = describeError(err);
          throw err;
        } finally {
          recordAudit(prisma, manifest.name, 'route.accessed', {
            route: prefixedPath,
            method: options.method,
            userId: (request as any).user?.userId || (request as any).user?.id,
            ipAddress: (request as any).ip,
          }, {
            duration: Date.now() - start,
            success,
            errorMessage,
            userId: (request as any).user?.userId || (request as any).user?.id,
            ipAddress: (request as any).ip,
          });
        }
      };
      routes.push(routeOptions);
      pluginLogger.info({ route: prefixedPath, method: options.method }, 'Registered route');
    },

    registerMiddleware(handler: any, options?: { scope?: 'global' | 'route' }) {
      const scope = options?.scope || 'global';
      middlewares.push({ handler, scope });
      pluginLogger.info({ scope }, 'Registered middleware');
    },

    onWebSocketMessage(type: string, handler: PluginWebSocketHandler) {
      // Store locally for backward compat
      wsHandlers.set(type, handler);
      // Also register with gateway using prefixed type for dispatch
      const prefixedType = `plugin:${manifest.name}:${type}`;
      if (wsGateway.registerPluginWsHandler) {
        wsGateway.registerPluginWsHandler(prefixedType, handler, manifest.name);
      }
      pluginLogger.info({ type, prefixedType }, 'Registered WebSocket handler');
    },

    sendWebSocketMessage(target: string, message: any) {
      if (target === '*') {
        // Broadcast to all authenticated clients
        if (wsGateway.broadcastToAuthenticated) {
          wsGateway.broadcastToAuthenticated(message);
        }
        return;
      }
      // Send to specific client
      const client = (wsGateway as any).clients?.get?.(target);
      if (client) {
        try {
          client.socket.send(JSON.stringify(message));
        } catch (error: any) {
          captureSystemError({
            level: 'warn',
            component: 'PluginWebSocket',
            message: `Failed to send WebSocket message: ${describeError(error)}`,
            stack: error?.stack,
            metadata: { plugin: manifest.name, target },
          }).catch(() => {});
          pluginLogger.error({ error: error.message, target }, 'Failed to send WebSocket message');
        }
      } else {
        pluginLogger.warn({ target }, 'WebSocket client not found');
      }
    },

    scheduleTask(cronExpression: string, handler: PluginTaskHandler) {
      const taskId = `${manifest.name}:${cronExpression}`;

      // Validate cron expression
      if (!cron.validate(cronExpression)) {
        throw new Error(`Invalid cron expression: ${cronExpression}`);
      }

      // De-dupe: stop any existing job for the same expression (common on re-enable)
      const existing = tasks.get(taskId);
      if (existing?.job) {
        try {
          existing.job.stop();
        } catch {
          /* ignore */
        }
      }

      const job = cron.schedule(cronExpression, async () => {
        try {
          await handler();
        } catch (error: any) {
          captureSystemError({
            level: 'error',
            component: 'PluginTaskScheduler',
            message: `Plugin task execution failed: ${describeError(error)}`,
            stack: error?.stack,
            metadata: { plugin: manifest.name, cron: cronExpression, taskId },
          }).catch(() => {});
          pluginLogger.error({ error: error.message }, 'Task execution failed');
        }
      });

      tasks.set(taskId, { cron: cronExpression, handler, job });
      pluginLogger.info({ cron: cronExpression }, 'Scheduled task');
    },

    on(event: string, handler: PluginEventHandler) {
      if (!eventHandlers.has(event)) {
        eventHandlers.set(event, new Set());
      }
      eventHandlers.get(event)?.add(handler);

      // Register with event emitter
      eventEmitter.on(event, handler);
      pluginLogger.info({ event }, 'Registered event handler');
    },

    emit(event: string, data: any) {
      eventEmitter.emit(event, data);
      pluginLogger.debug({ event }, 'Emitted event');
    },

    getConfig<T = any>(key: string): T | undefined {
      // Runtime values only — schema objects from plugin.json are unwrapped to `.default`.
      return resolveConfigValue<T>(manifest.config?.[key]);
    },

    async setConfig<T = any>(key: string, value: T): Promise<void> {
      const start = Date.now();
      // Persist plain values only (never re-store schema field objects).
      const currentRuntime: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(manifest.config || {})) {
        currentRuntime[k] = resolveConfigValue(v);
      }
      currentRuntime[key] = value as unknown;

      await prisma.plugin.update({
        where: { name: manifest.name },
        data: {
          config: currentRuntime as any,
        },
      });

      // Update in-memory runtime config (plain values)
      if (!manifest.config) {
        manifest.config = {};
      }
      manifest.config[key] = value;

      pluginLogger.info({ key }, 'Updated config');

      recordAudit(prisma, manifest.name, 'config.updated', { key, value }, {
        duration: Date.now() - start,
        success: true,
      });
    },

    async getStorage<T = any>(key: string): Promise<T | null> {
      const start = Date.now();
      const storage = await prisma.pluginStorage.findUnique({
        where: {
          pluginName_key: {
            pluginName: manifest.name,
            key,
          },
        },
      });

      recordAudit(prisma, manifest.name, 'storage.read', { key }, {
        duration: Date.now() - start,
        success: true,
      });

      return storage ? (storage.value as T) : null;
    },

    async setStorage<T = any>(key: string, value: T): Promise<void> {
      const start = Date.now();
      await prisma.pluginStorage.upsert({
        where: {
          pluginName_key: {
            pluginName: manifest.name,
            key,
          },
        },
        create: {
          pluginName: manifest.name,
          key,
          value: value as any,
        },
        update: {
          value: value as any,
        },
      });

      pluginLogger.debug({ key }, 'Updated storage');

      recordAudit(prisma, manifest.name, 'storage.write', { key }, {
        duration: Date.now() - start,
        success: true,
      });
    },

    async deleteStorage(key: string): Promise<void> {
      const start = Date.now();
      await prisma.pluginStorage.deleteMany({
        where: {
          pluginName: manifest.name,
          key,
        },
      });

      pluginLogger.debug({ key }, 'Deleted storage');

      recordAudit(prisma, manifest.name, 'storage.delete', { key }, {
        duration: Date.now() - start,
        success: true,
      });
    },

    // ── Structured storage ─────────────────────────────────────────────────
    collection(name: string): PluginCollectionAPI {
      // Opt-in to dedicated table storage via manifest field
      if ((manifest as any).storageEngine === 'dedicated') {
        const dedicated = createCollectionStorage(prisma, manifest.name)(name);
        // Wrap with audit for collection operations
        return new Proxy(dedicated, {
          get(target, prop) {
            const method = (target as any)[prop];
            if (typeof method !== 'function') return method;
            return async (...args: any[]) => {
              const start = Date.now();
              let success = true;
              let errorMessage: string | undefined;
              try {
                const result = await method.apply(target, args);
                return result;
              } catch (err: any) {
                success = false;
                errorMessage = describeError(err);
                throw err;
              } finally {
                recordAudit(prisma, manifest.name, `collection.${String(prop)}`, { collection: name, args }, {
                  duration: Date.now() - start,
                  success,
                  errorMessage,
                });
              }
            };
          },
        });
      }
      return scopedDb.collection(name);
    },

    // ── Event type safety ──────────────────────────────────────────────────
    getDeclaredEvents(): Record<string, PluginEventSchema> | undefined {
      return manifest.events;
    },

    emitTyped(event: string, data: any): void {
      const declaredEvents = manifest.events;
      if (declaredEvents && declaredEvents[event]) {
        const schema = declaredEvents[event];
        // Validate payload against declared schema - warn on mismatch, don't throw
        if (schema.payload) {
          for (const [field, _type] of Object.entries(schema.payload)) {
            if (data && typeof data === 'object' && !(field in data)) {
              pluginLogger.warn(
                { event, field, declaredFields: Object.keys(schema.payload), providedFields: Object.keys(data) },
                'emitTyped: event payload missing declared field',
              );
            }
          }
        }
      } else if (declaredEvents) {
        pluginLogger.warn({ event, declared: Object.keys(declaredEvents) }, 'emitTyped: event not declared in manifest');
      }
      // Emit regardless of validation result
      eventEmitter.emit(event, data);
      pluginLogger.debug({ event }, 'Emitted typed event');
    },

    // ── Plugin-to-plugin RPC ──────────────────────────────────────────────
    exposeApi(name: string, handler: (params: any) => Promise<any>): void {
      if (!registry) {
        pluginLogger.warn('Cannot expose API: no registry available');
        return;
      }
      registry.registerExposedApi(manifest.name, name, handler);
      pluginLogger.info({ api: name }, 'Exposed API for plugin-to-plugin RPC');
    },

    async callPluginApi(pluginName: string, apiName: string, params?: any): Promise<any> {
      if (!registry) {
        throw new Error('Cannot call plugin API: no registry available');
      }

      // Permission check — LIVE against current effective grants
      const perms = new Set(getPermissions());
      if (!perms.has('plugin.rpc') && !perms.has('*')) {
        pluginLogger.warn(
          { targetPlugin: pluginName, api: apiName },
          'Plugin attempted RPC without plugin.rpc permission',
        );
        throw new Error('Permission denied: plugin.rpc permission required');
      }

      const api = registry.getExposedApi(pluginName, apiName);
      if (!api) {
        throw new Error(`Plugin "${pluginName}" does not expose API: "${apiName}"`);
      }

      // Call with timeout + simple consecutive-failure circuit breaker
      const timeoutMs = 10000;
      const circuitKey = `${pluginName}.${apiName}`;
      if (registry.isRpcCircuitOpen?.(circuitKey)) {
        throw new Error(`RPC circuit open for ${circuitKey} — too many recent failures`);
      }
      try {
        const result = await Promise.race([
          api(params),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`RPC call to ${pluginName}.${apiName} timed out`)), timeoutMs),
          ),
        ]);
        registry.recordRpcSuccess?.(circuitKey);
        return result;
      } catch (err) {
        registry.recordRpcFailure?.(circuitKey);
        throw err;
      }
    },

    /**
     * Host auth helper — Better Auth sets `request.user.userId` (not `.id`).
     * Prefer this over reading the raw request shape.
     */
    getUserId(request: any): string | null {
      return request?.user?.userId || request?.user?.id || null;
    },

    /**
     * True when the request user holds any of the given permission strings
     * (or `*`). Use for soft checks inside handlers.
     */
    hasPermission(request: any, ...required: string[]): boolean {
      const perms: string[] = request?.user?.permissions ?? [];
      if (perms.includes('*')) return true;
      return required.some((p) => perms.includes(p));
    },

    /**
     * Fastify-style preHandler that requires at least one of the given permissions.
     *
     * @example
     * context.registerRoute({
     *   method: 'POST',
     *   url: '/admin-only',
     *   preHandler: context.requirePermission('admin.write'),
     *   handler: async (req, reply) => ({ ok: true }),
     * });
     */
    requirePermission(...required: string[]) {
      return async (request: FastifyRequest, reply: FastifyReply) => {
        const perms: string[] = (request as any)?.user?.permissions ?? [];
        if (perms.includes('*') || required.some((p) => perms.includes(p))) {
          return;
        }
        return reply.status(403).send({
          success: false,
          error: `Permission denied: requires one of [${required.join(', ')}]`,
        });
      };
    },

    // ── Auth bridge (external sign-in plugins) ──────────────────────────
    // Every method is live-gated on manifest permissions so an admin can
    // revoke mid-flight: auth.sessions → createSession, auth.users →
    // findUser/createUser, roles.assign → role operations.
    auth: {
      async findUser(by: { userId?: string; email?: string; username?: string }) {
        if (!hasCapability('auth.users')) {
          throw new Error('Permission denied: auth.users permission required to look up users');
        }
        const where: Record<string, string> = {};
        if (by.userId) where.id = by.userId;
        else if (by.email) where.email = by.email;
        else if (by.username) where.username = by.username;
        else {
          throw new Error('findUser requires one of userId, email or username');
        }
        const row = await prisma.user.findFirst({
          where: by.email ? { email: { equals: where.email, mode: 'insensitive' as const } } : where,
          select: AUTH_USER_SELECT,
        });
        return row ? toAuthUser(row) : null;
      },

      async createUser(input: { email: string; username: string; name: string; emailVerified?: boolean; image?: string | null }) {
        if (!hasCapability('auth.users')) {
          throw new Error('Permission denied: auth.users permission required to create users');
        }
        if (!EMAIL_RE.test(input.email) || !USERNAME_RE.test(input.username) || !input.name?.trim()) {
          throw new Error('Invalid email, username or display name');
        }
        try {
          const row = await prisma.user.create({
            data: {
              email: input.email.toLowerCase(),
              username: input.username,
              name: input.name.trim().slice(0, 100),
              emailVerified: input.emailVerified ?? false,
              image: input.image ?? null,
            },
            select: AUTH_USER_SELECT,
          });
          pluginLogger.info({ userId: row.id }, 'Plugin created panel user');
          recordAudit(prisma, manifest.name, 'auth.user_created', {
            userId: row.id,
            email: row.email,
            username: row.username,
          }, { userId: row.id });
          return toAuthUser(row);
        } catch (err: any) {
          if (String(err?.code) === 'P2002') {
            throw new Error(`A panel user with that ${err?.meta?.target?.includes('email') ? 'email' : 'username'} already exists`);
          }
          throw err;
        }
      },

      async createSession(
        userId: string,
        opts?: { rememberMe?: boolean; ipAddress?: string; userAgent?: string; reply?: any },
      ) {
        if (!hasCapability('auth.sessions')) {
          throw new Error('Permission denied: auth.sessions permission required to create sessions');
        }
        const rememberMe = opts?.rememberMe !== false;
        // Lazy import: auth.ts enforces env secrets at module load, which must
        // not run for tooling that imports the plugin context directly.
        const { getAuth } = await import('../auth');
        const auth = getAuth();
        // better-auth's createBetterAuth assigns the async init's return value
        // WITHOUT awaiting it — `$context` is a Promise of the context in
        // 1.6.x. Await either shape so this works across versions.
        const rawContext = (auth as any).$context;
        const ctx =
          rawContext && typeof (rawContext as Promise<unknown>).then === 'function'
            ? await rawContext
            : rawContext;
        if (!ctx?.internalAdapter?.createSession) {
          throw new Error('Host auth instance does not expose session creation');
        }
        const session = await ctx.internalAdapter.createSession(userId, !rememberMe, {
          ipAddress: opts?.ipAddress ?? '',
          userAgent: opts?.userAgent ?? '',
        });
        recordAudit(prisma, manifest.name, 'auth.session_created', { userId }, { userId });
        pluginLogger.info({ userId }, 'Plugin created session');

        if (opts?.reply) {
          const cookie = ctx.authCookies?.sessionToken;
          if (cookie?.name && typeof ctx.secret === 'string') {
            const signedToken = `${session.token}.${signSessionToken(session.token, ctx.secret)}`;
            opts.reply.header(
              'set-cookie',
              serializeSessionCookie(cookie.name, signedToken, new Date(session.expiresAt), rememberMe, Boolean(cookie.attributes?.secure)),
            );
          } else if (cookie?.name) {
            pluginLogger.warn('Session cookie could not be signed — host auth secret unavailable');
          }
        }
        return { token: session.token, expiresAt: new Date(session.expiresAt) };
      },

      async listRoles() {
        if (!hasCapability('roles.assign')) {
          throw new Error('Permission denied: roles.assign permission required to list roles');
        }
        const roles = await prisma.role.findMany({
          select: { id: true, name: true, description: true },
          orderBy: { name: 'asc' },
        });
        return roles;
      },

      async listUserRoles(userId: string) {
        if (!hasCapability('roles.assign')) {
          throw new Error('Permission denied: roles.assign permission required to list user roles');
        }
        const user = await prisma.user.findUnique({
          where: { id: userId },
          select: { roles: { select: { id: true, name: true, description: true } } },
        });
        return user?.roles ?? [];
      },

      async assignRoles(userId: string, roleIds: string[], options?: { reason?: string }) {
        await modifyUserRoles(userId, roleIds, 'connect', options?.reason ?? 'plugin role sync');
      },

      async removeRoles(userId: string, roleIds: string[], options?: { reason?: string }) {
        await modifyUserRoles(userId, roleIds, 'disconnect', options?.reason ?? 'plugin role sync');
      },
    },
  };

  return context;
}

/**
 * Run a middleware handler, supporting both Express-style (3 params with next) and
 * Fastify-style (2 params, async). Used by the loader when wrapping route handlers.
 */
export async function runMiddleware(
  handler: (...args: any[]) => any,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (handler.length >= 3) {
    // Express-style: (req, reply, next) - next is error-first callback
    await new Promise<void>((resolve, reject) => {
      const done = (err?: any) => {
        if (err) reject(err instanceof Error ? err : new Error(describeError(err)));
        else resolve();
      };
      try {
        const result = handler(request, reply, done);
        if (result && typeof result === 'object' && typeof result.then === 'function') {
          result.catch(reject);
        }
      } catch (err) {
        reject(err);
      }
    });
  } else {
    // Fastify-style: (req, reply) => Promise<void> | void
    const result = handler(request, reply);
    if (result && typeof result === 'object' && typeof result.then === 'function') {
      await result;
    }
  }
}
