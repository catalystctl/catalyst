/**
 * Server cloning: resolve → plan → persist → copy/install.
 *
 * `buildClonePlan` is the single source of truth for both the preflight route
 * and the submit route: the preflight returns the plan (including the
 * node-specific change set and every blocker/warning), and the submit re-runs
 * the exact same resolution and refuses to proceed when the fingerprint moved.
 *
 * Two modes:
 * - `full`          configuration + the entire server data directory
 * - `configuration` configuration only; a fresh template install runs
 */

import crypto from 'crypto';
import { prisma } from '../db.js';
import { getRedis } from '../lib/redis.js';
import { cacheKey } from '../lib/cache-keys.js';
import {
  DatabaseProvisioningError,
  allocateIpForServer,
  collectUsedHostPortsByIp,
  dropDatabase,
  findAvailableHostPort,
  findPortConflict,
  generateSafeIdentifier,
  isValidDatabaseIdentifier,
  normalizeHostIp,
  OWNER_SERVER_PERMISSIONS,
  parsePortValue,
  parseStoredPortBindings,
  provisionDatabase,
  resolveTemplateImage,
  ServerState,
  shouldUseIpam,
  uuidv4,
  validateVariableRule,
  WILDCARD_HOST,
} from '../routes/servers/_helpers.js';
import { ErrorCodes } from '../shared-types';
import {
  requestedCgroupMemoryMb,
  SERVER_CGROUP_MEMORY_SELECT,
  sumCgroupMemoryMb,
} from '../utils/java-memory.js';
import { buildInstallCommand } from './server-install.js';
import { streamServerData } from './server-file-stream.js';

export type CloneMode = 'full' | 'configuration';

export interface CloneRequest {
  mode: CloneMode;
  name?: string;
  description?: string;
  targetNodeId: string;
  allocationId?: string;
  networkMode?: string;
  ownerId?: string;
  allocatedMemoryMb?: number;
  allocatedCpuCores?: number;
  allocatedDiskMb?: number;
  allocatedSwapMb?: number;
  ioWeight?: number;
  backupAllocationMb?: number;
  databaseAllocation?: number;
  environment?: Record<string, string>;
  backupStorageMode?: string;
  copyBackupCredentials?: boolean;
  includeAccess: boolean;
  includeRoleGrants: boolean;
  includeScheduledTasks: boolean;
  includeDatabases: boolean;
  includeInstalledMods?: boolean;
}

export interface CloneAuth {
  userId: string;
  /** server.create (or admin.write) */
  canCreate: boolean;
  /** user.create (or admin.write) — required to set a different owner. */
  canSetOwner: boolean;
  /** server.transfer (or admin.write) — required for a cross-node target. */
  canTransfer: boolean;
  /** admin.write — may clone a suspended source / copy backup credentials. */
  canManageSuspended: boolean;
  /** Caller can reach the target node. */
  canAccessTargetNode: boolean;
}

export interface CloneProbe {
  sourceBytes: number | null;
  targetFreeBytes: number | null;
}

export interface CloneBlocker {
  code: string;
  message: string;
  field?: string;
  /** Values for `{{placeholders}}` in the translated error message. */
  params?: Record<string, unknown>;
}

export interface CloneWarning {
  code: string;
  message: string;
  field?: string;
}

export interface CloneChange {
  field: string;
  label: string;
  from: string | number | null;
  to: string | number | null;
  nodeSpecific: boolean;
}

export interface ClonePlan {
  mode: CloneMode;
  crossNode: boolean;
  source: {
    id: string;
    uuid: string;
    name: string;
    status: string;
    nodeId: string;
    nodeName: string;
    locationId: string;
    locationName: string;
    templateId: string;
    templateName: string;
    networkMode: string;
    primaryIp: string | null;
    primaryPort: number;
    dataDir: string;
    dataSizeBytes: number | null;
    installedMods: number;
    scheduledTasks: number;
    subUsers: number;
    databases: number;
    /** Template variable names, used for stale-env detection. */
    templateVariables: string[];
  };
  target: {
    nodeId: string;
    nodeName: string;
    locationId: string;
    locationName: string;
    isOnline: boolean;
    agentVersion: string | null;
    serverDataDir: string;
    sftpPort: number;
    publicAddress: string;
    supportedNetworkModes: string[];
    capacity: {
      memoryFreeMb: number | 'unlimited';
      cpuFreeCores: number | 'unlimited';
      diskFreeBytes: number | null;
    };
  };
  resolved: {
    name: string;
    ownerId: string;
    nodeId: string;
    locationId: string;
    templateId: string;
    networkMode: string;
    primaryIp: string | null;
    primaryPort: number;
    portBindings: Record<number, number>;
    allocatedMemoryMb: number;
    allocatedCpuCores: number;
    allocatedDiskMb: number;
    allocatedSwapMb: number;
    ioWeight: number;
    backupAllocationMb: number;
    databaseAllocation: number;
    backupStorageMode: string;
    environment: Record<string, string>;
    image: string;
    /** True once the owner row + include-* surfaces are written. */
    includeInstalledMods: boolean;
  };
  allocations: {
    required: boolean;
    mode: 'ipam' | 'allocation' | 'host-public' | 'none';
    available: Array<{ id: string; ip: string; port: number; alias: string | null }>;
    selected: { id: string; ip: string; port: number } | null;
  };
  /** Portable panel surfaces included in this clone. */
  includeSurfaces: {
    access: boolean;
    roleGrants: boolean;
    scheduledTasks: boolean;
    databases: boolean;
  };
  requirements: {
    sourceStopped: boolean;
    installWillRun: boolean;
    estimatedDurationSec: number | null;
  };
  changes: CloneChange[];
  blockers: CloneBlocker[];
  warnings: CloneWarning[];
}

/** A resolution failure the route translates into an `apiError`. */
export class ClonePlanError extends Error {
  readonly code: string;
  readonly status: number;
  readonly params?: Record<string, unknown>;
  constructor(code: string, message: string, status = 400, params?: Record<string, unknown>) {
    super(message);
    this.name = 'ClonePlanError';
    this.code = code;
    this.status = status;
    this.params = params;
  }
}

const TRANSITIONAL_STATUSES = new Set<string>([
  ServerState.INSTALLING,
  ServerState.CLONING,
  ServerState.TRANSFERRING,
  ServerState.RESTORING,
  ServerState.CREATING_BACKUP,
]);

const FULL_CLONE_ALLOWED_STATUSES = new Set<string>([ServerState.STOPPED, ServerState.CRASHED, ServerState.ERROR]);

const PREFLIGHT_TTL_SEC = 600;
const PREFLIGHT_NAMESPACE = 'clone';
const ESTIMATED_THROUGHPUT_BYTES_PER_SEC = 40 * 1024 * 1024;

// ── Preflight store (Redis, memory fallback) ────────────────────────────────

type MemoryPreflight = { value: string; expiresAt: number };
const memoryPreflights = new Map<string, MemoryPreflight>();

function preflightKey(id: string): string {
  return cacheKey(PREFLIGHT_NAMESPACE, 'preflight', id);
}

/** Non-consuming read used before ownership is confirmed. */
function memoryPeek(id: string): string | null {
  const entry = memoryPreflights.get(id);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    memoryPreflights.delete(id);
    return null;
  }
  return entry.value;
}

/** Persist a plan for confirmation and return the plan with its `preflightId`. */
export async function storeClonePreflight(
  plan: ClonePlan,
  userId: string,
): Promise<ClonePlan & { preflightId: string; fingerprint: string }> {
  const preflightId = crypto.randomUUID();
  const fingerprint = cloneFingerprint(plan);
  const record = JSON.stringify({ userId, plan, fingerprint });
  const redis = getRedis();
  if (redis) {
    try {
      await redis.set(preflightKey(preflightId), record, PREFLIGHT_TTL_SEC);
    } catch {
      memoryPreflights.set(preflightId, { value: record, expiresAt: Date.now() + PREFLIGHT_TTL_SEC * 1000 });
    }
  } else {
    memoryPreflights.set(preflightId, { value: record, expiresAt: Date.now() + PREFLIGHT_TTL_SEC * 1000 });
  }
  // Opportunistic sweep so the fallback map cannot grow unbounded.
  if (memoryPreflights.size > 5000) {
    const now = Date.now();
    for (const [key, entry] of memoryPreflights) {
      if (now > entry.expiresAt) memoryPreflights.delete(key);
    }
  }
  return Object.assign(plan, { preflightId, fingerprint });
}

/** Single-use read. Returns null for unknown, expired or foreign preflights. */
export async function takeClonePreflight(
  preflightId: string,
  userId: string,
): Promise<{ plan: ClonePlan; fingerprint: string } | null> {
  const redis = getRedis();
  let raw: string | null = null;
  let fromRedis = false;
  if (redis) {
    try {
      raw = await redis.get(preflightKey(preflightId));
      fromRedis = true;
    } catch {
      fromRedis = false;
    }
  }
  if (raw === null && !fromRedis) {
    // Redis miss (or unavailable): fall back to the process-local store.
    raw = memoryPeek(preflightId);
  }
  if (!raw) return null;
  let parsed: { userId: string; plan: ClonePlan; fingerprint: string };
  try {
    parsed = JSON.parse(raw) as { userId: string; plan: ClonePlan; fingerprint: string };
  } catch {
    return null;
  }
  // Ownership is checked BEFORE consuming: a foreign caller must not be able to
  // burn another user's preflight by guessing its id.
  if (parsed.userId !== userId) return null;
  if (fromRedis && redis) {
    await redis.del(preflightKey(preflightId)).catch(() => {});
  } else {
    memoryPreflights.delete(preflightId);
  }
  return { plan: parsed.plan, fingerprint: parsed.fingerprint };
}

/** Exposed for tests: clear the in-memory fallback store. */
export function clearClonePreflightMemory(): void {
  memoryPreflights.clear();
}

// ── Clone provenance (retry support) ────────────────────────────────────────
//
// A finished clone is a normal server; the panel only needs to remember which
// server it came from so a failed file copy can be retried. Kept in Redis (with
// a process-local fallback) rather than a schema column so no migration is
// needed and the data is purely operational.

export interface CloneProvenance {
  sourceId: string;
  targetNodeId: string;
  mode: CloneMode;
}

const PROVENANCE_TTL_SEC = 30 * 24 * 3600;
type MemoryProvenance = { value: string; expiresAt: number };
const memoryProvenance = new Map<string, MemoryProvenance>();

function provenanceKey(cloneServerId: string): string {
  return cacheKey('clone', 'provenance', cloneServerId);
}

export async function storeCloneProvenance(
  cloneServerId: string,
  value: CloneProvenance,
): Promise<void> {
  const record = JSON.stringify(value);
  const redis = getRedis();
  if (redis) {
    try {
      await redis.set(provenanceKey(cloneServerId), record, PROVENANCE_TTL_SEC);
      return;
    } catch {
      /* fall through to memory */
    }
  }
  memoryProvenance.set(cloneServerId, {
    value: record,
    expiresAt: Date.now() + PROVENANCE_TTL_SEC * 1000,
  });
}

export async function getCloneProvenance(cloneServerId: string): Promise<CloneProvenance | null> {
  const redis = getRedis();
  if (redis) {
    try {
      const raw = await redis.get(provenanceKey(cloneServerId));
      if (raw) return JSON.parse(raw) as CloneProvenance;
    } catch {
      /* fall through to memory */
    }
  }
  const entry = memoryProvenance.get(cloneServerId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    memoryProvenance.delete(cloneServerId);
    return null;
  }
  try {
    return JSON.parse(entry.value) as CloneProvenance;
  } catch {
    return null;
  }
}

/** Exposed for tests. */
export function clearCloneProvenanceMemory(): void {
  memoryProvenance.clear();
}

// ── Mode + source loading ───────────────────────────────────────────────────

/** Map the legacy `copyFiles` boolean onto the explicit clone modes. */
export function resolveCloneMode(raw: { mode?: CloneMode; copyFiles?: boolean }): CloneMode {
  if (raw.mode) return raw.mode;
  if (raw.copyFiles === true) return 'full';
  return 'configuration';
}

export async function loadCloneSource(serverId: string) {
  const server = await prisma.server.findUnique({
    where: { id: serverId },
    include: {
      template: true,
      node: true,
      location: true,
      _count: {
        select: { installedMods: true, scheduledTasks: true, access: true, databases: true },
      },
    },
  });
  if (!server) return null;
  // Counts requested above double as the clone-summary numbers.
  return server;
}

// ── Planning ────────────────────────────────────────────────────────────────

function uniquePorts(ports: number[]): number[] {
  return Array.from(new Set(ports)).sort((a, b) => a - b);
}

/**
 * Host networking gives the container the host's network namespace, so port
 * bindings are identity mappings — the only way to avoid a collision with an
 * existing server is to shift the whole port block. Returns the delta applied.
 */
function findHostPortDelta(
  usedPorts: Map<string, Set<number>>,
  hostIp: string | null,
  containerPorts: number[],
): number {
  const maxAttempts = 20000;
  for (let delta = 0; delta < maxAttempts; delta++) {
    const shifted = containerPorts.map((port) => port + delta);
    if (shifted.some((port) => port > 65535)) break;
    if (shifted.some((port) => port < 1)) break;
    const conflict = shifted.some((port) => findPortConflict(usedPorts, hostIp, [port]));
    if (!conflict) return delta;
  }
  throw new Error('No available host port range found on this node');
}

export async function buildClonePlan(args: {
  source: any;
  raw: CloneRequest;
  auth: CloneAuth;
  probe?: CloneProbe;
}): Promise<ClonePlan> {
  const { source, raw, auth } = args;
  const mode = raw.mode;
  const blockers: CloneBlocker[] = [];
  const warnings: CloneWarning[] = [];
  const changes: CloneChange[] = [];

  const targetNodeId = raw.targetNodeId;
  if (!targetNodeId) {
    throw new ClonePlanError(ErrorCodes.VALIDATION_ERROR, 'Target node is required');
  }

  // 1. Source status gates.
  const sourceStatus = String(source.status);
  if (TRANSITIONAL_STATUSES.has(sourceStatus)) {
    blockers.push({
      code: ErrorCodes.CLONE_SOURCE_TRANSITIONAL,
      message: `Source server is busy (${sourceStatus}); wait for the current operation to finish.`,
      field: 'source',
    });
  }
  if (mode === 'full' && !FULL_CLONE_ALLOWED_STATUSES.has(sourceStatus)) {
    blockers.push({
      code: ErrorCodes.CLONE_SOURCE_NOT_STOPPED,
      message: 'The source server must be stopped before it can be fully cloned.',
      field: 'source',
    });
  }
  if (source.suspendedAt && !auth.canManageSuspended) {
    blockers.push({
      code: ErrorCodes.CLONE_SOURCE_SUSPENDED,
      message: 'This server is suspended and cannot be cloned.',
      field: 'source',
    });
  }

  // 2. Template checks.
  const template = source.template;
  if (!template) {
    blockers.push({
      code: ErrorCodes.CLONE_TEMPLATE_MISSING,
      message: 'The source server template no longer exists. Re-import it before cloning.',
      field: 'source',
    });
  }

  const templateVariables: Array<{ name?: string; default?: unknown; required?: boolean; rules?: string[] }> =
    Array.isArray(template?.variables) ? (template.variables as any[]) : [];
  const templateDefaults = templateVariables.reduce<Record<string, string>>((acc, variable) => {
    if (variable?.name && variable?.default !== undefined) {
      acc[variable.name] = String(variable.default);
    }
    return acc;
  }, {});
  const sourceEnvironment = (source.environment as Record<string, string>) || {};

  const resolvedEnvironment: Record<string, string> = {
    ...templateDefaults,
    ...sourceEnvironment,
    ...(raw.environment || {}),
  };
  delete resolvedEnvironment.CATALYST_NETWORK_IP;
  delete resolvedEnvironment.TEMPLATE_IMAGE;

  const declaredNames = new Set(templateVariables.map((v) => String(v.name)));
  const staleKeys = Object.keys(sourceEnvironment).filter(
    (key) => !declaredNames.has(key) && key !== 'CATALYST_NETWORK_IP' && key !== 'TEMPLATE_IMAGE',
  );
  if (staleKeys.length > 0) {
    warnings.push({
      code: 'CLONE_SOURCE_ENV_STALE',
      message: `These variables are no longer declared by the template and will be carried over: ${staleKeys.join(', ')}`,
      field: 'environment',
    });
  }
  if (sourceEnvironment.CATALYST_NETWORK_IP || sourceEnvironment.TEMPLATE_IMAGE) {
    warnings.push({
      code: 'CLONE_SOURCE_ENV_DROPPED',
      message: 'Runtime-injected variables (CATALYST_NETWORK_IP, TEMPLATE_IMAGE) are re-resolved for the clone.',
      field: 'environment',
    });
  }

  let resolvedImage = '';
  if (template) {
    resolvedImage = resolveTemplateImage(template, resolvedEnvironment) || '';
    if (!resolvedImage) {
      blockers.push({
        code: ErrorCodes.CLONE_TEMPLATE_IMAGE_UNRESOLVED,
        message: 'The template image could not be resolved for the clone.',
        field: 'source',
      });
    }
    const requiredVars = templateVariables.filter((v) => v.required && v.name);
    const missingVars = requiredVars.filter((v) => !resolvedEnvironment[v.name as string]);
    if (missingVars.length > 0) {
      blockers.push({
        code: ErrorCodes.CLONE_MISSING_TEMPLATE_VARIABLES,
        message: `Missing required template variables: ${missingVars.map((v) => v.name).join(', ')}`,
        field: 'environment',
      });
    }
    for (const variable of templateVariables) {
      const value = variable.name ? resolvedEnvironment[variable.name] : undefined;
      if (!value || !variable.rules) continue;
      const rules: string[] = variable.rules;
      for (const rule of rules) {
        if (rule.startsWith('between:')) {
          const err = validateVariableRule(value, rule, rules);
          if (err) {
            blockers.push({
              code: ErrorCodes.SERVER_VARIABLE_INVALID,
              params: { name: variable.name },
              message: `Variable ${variable.name} ${err}`,
              field: 'environment',
            });
          }
        } else if (rule.startsWith('in:')) {
          const allowedValues = rule.substring(3).split(',');
          if (!allowedValues.includes(value)) {
            blockers.push({
              code: ErrorCodes.SERVER_VARIABLE_INVALID,
              params: { name: variable.name },
              message: `Variable ${variable.name} must be one of: ${allowedValues.join(', ')}`,
              field: 'environment',
            });
          }
        } else if (rule.startsWith('regex:')) {
          let pattern = rule.substring(6);
          if (pattern.startsWith('/') && pattern.endsWith('/')) pattern = pattern.slice(1, -1);
          const dangerousPatterns = [/\(.*\)\{/, /\(\?[=:!]/, /\*.*\+|\+.*\*|\{.*,.*\}/];
          if (dangerousPatterns.some((p) => p.test(pattern))) {
            blockers.push({
              code: ErrorCodes.SERVER_VARIABLE_PATTERN_INVALID,
              params: { name: variable.name },
              message: `Invalid regex pattern for variable ${variable.name}`,
              field: 'environment',
            });
            continue;
          }
          try {
            const regex = new RegExp(pattern);
            const testValue = value.length > 4096 ? value.slice(0, 4096) : value;
            if (!regex.test(testValue)) {
              blockers.push({
                code: ErrorCodes.SERVER_VARIABLE_INVALID,
                params: { name: variable.name },
                message: `Variable ${variable.name} does not match the required pattern`,
                field: 'environment',
              });
            }
          } catch {
            blockers.push({
              code: ErrorCodes.SERVER_VARIABLE_PATTERN_INVALID,
              params: { name: variable.name },
              message: `Invalid regex pattern for variable ${variable.name}: ${pattern}`,
              field: 'environment',
            });
          }
        }
      }
    }
  }

  // 3. Target node access + load.
  if (source.nodeId !== targetNodeId && !auth.canAccessTargetNode) {
    blockers.push({
      code: ErrorCodes.CLONE_TARGET_NODE_INACCESSIBLE,
      message: 'You do not have access to the selected node.',
      field: 'nodeId',
    });
  }

  const node = await prisma.node.findUnique({
    where: { id: targetNodeId },
    include: {
      location: true,
      servers: {
        select: {
          id: true,
          allocatedCpuCores: true,
          primaryPort: true,
          primaryIp: true,
          portBindings: true,
          networkMode: true,
          ...SERVER_CGROUP_MEMORY_SELECT,
        },
      },
    },
  });
  if (!node) {
    throw new ClonePlanError(ErrorCodes.NODE_NOT_FOUND, 'Target node not found', 404);
  }

  const ipPools = await prisma.ipPool.findMany({
    where: { nodeId: targetNodeId },
    select: { networkName: true },
  });
  const poolNetworks = new Set(ipPools.map((pool) => pool.networkName));
  const supportedNetworkModes = ['bridge', 'host', 'macvlan', 'mc-lan-static', 'mc-lan-dynamic'].filter(
    (candidate) => (shouldUseIpam(candidate) ? poolNetworks.has(candidate) : true),
  );

  // 4. Resource resolution.
  const resolvedMemoryMb = raw.allocatedMemoryMb ?? source.allocatedMemoryMb;
  const resolvedCpuCores = raw.allocatedCpuCores ?? source.allocatedCpuCores;
  const resolvedDiskMb = raw.allocatedDiskMb ?? source.allocatedDiskMb;
  const resolvedSwapMb = raw.allocatedSwapMb ?? source.allocatedSwapMb ?? 0;
  const resolvedIoWeight = raw.ioWeight ?? source.ioWeight ?? 500;
  const resolvedBackupAllocationMb = raw.backupAllocationMb ?? source.backupAllocationMb ?? 0;
  const resolvedDatabaseAllocation = raw.databaseAllocation ?? source.databaseAllocation ?? 0;
  const resolvedBackupStorageMode = raw.copyBackupCredentials
    ? source.backupStorageMode || 'local'
    : source.backupStorageMode && source.backupStorageMode !== 'local'
      ? 'local'
      : source.backupStorageMode || 'local';

  const hasBackupCredentials =
    (source.backupS3Config && Object.keys(source.backupS3Config as object).length > 0) ||
    (source.backupSftpConfig && Object.keys(source.backupSftpConfig as object).length > 0);
  if (hasBackupCredentials && !raw.copyBackupCredentials) {
    warnings.push({
      code: 'CLONE_BACKUP_CREDENTIALS_DROPPED',
      message: 'Backup storage credentials are not copied; the clone uses local backup storage.',
      field: 'backupStorageMode',
    });
  }

  // 5. Owner resolution.
  let effectiveOwnerId = auth.userId;
  if (raw.ownerId && raw.ownerId !== auth.userId) {
    if (!auth.canSetOwner) {
      throw new ClonePlanError(
        ErrorCodes.CLONE_OWNER_PERMISSION,
        'Insufficient permissions to create a server for another user',
        403,
      );
    }
    const targetUser = await prisma.user.findUnique({ where: { id: raw.ownerId } });
    if (!targetUser) {
      throw new ClonePlanError(ErrorCodes.CLONE_OWNER_NOT_FOUND, 'Specified owner does not exist', 400);
    }
    effectiveOwnerId = raw.ownerId;
  } else if (raw.ownerId) {
    effectiveOwnerId = raw.ownerId;
  }

  // 6. Capacity.
  const totalAllocatedMemory = sumCgroupMemoryMb(node.servers);
  const totalAllocatedCpu = node.servers.reduce((sum, s) => sum + (s.allocatedCpuCores || 0), 0);
  const requiredMemory = requestedCgroupMemoryMb(resolvedMemoryMb, {
    startup: source.startupCommand || template?.startup,
    image: template?.image,
    environment: raw.environment ?? sourceEnvironment,
  });
  const effectiveMaxMemory =
    node.memoryOverallocatePercent === -1
      ? Infinity
      : Math.floor(node.maxMemoryMb * (1 + node.memoryOverallocatePercent / 100));
  const effectiveMaxCpu =
    node.cpuOverallocatePercent === -1
      ? Infinity
      : node.maxCpuCores * (1 + node.cpuOverallocatePercent / 100);

  if (totalAllocatedMemory + requiredMemory > effectiveMaxMemory) {
    blockers.push({
      code: ErrorCodes.INSUFFICIENT_RESOURCES,
      message: `Insufficient memory on the target node. Available: ${
        effectiveMaxMemory === Infinity ? 'unlimited' : `${effectiveMaxMemory - totalAllocatedMemory}MB`
      }`,
      field: 'allocatedMemoryMb',
    });
  }
  if (totalAllocatedCpu + resolvedCpuCores > effectiveMaxCpu) {
    blockers.push({
      code: ErrorCodes.INSUFFICIENT_RESOURCES,
      message: `Insufficient CPU on the target node. Available: ${
        effectiveMaxCpu === Infinity ? 'unlimited' : `${effectiveMaxCpu - totalAllocatedCpu} cores`
      }`,
      field: 'allocatedCpuCores',
    });
  }

  // 7. Network mode + ports.
  const desiredNetworkMode = raw.networkMode || source.networkMode || 'mc-lan-static';
  if (desiredNetworkMode !== source.networkMode) {
    changes.push({
      field: 'networkMode',
      label: 'Network mode',
      from: source.networkMode,
      to: desiredNetworkMode,
      nodeSpecific: true,
    });
  }
  const modeSupported = shouldUseIpam(desiredNetworkMode)
    ? poolNetworks.has(desiredNetworkMode)
    : true;
  if (!modeSupported) {
    blockers.push({
      code: ErrorCodes.CLONE_NETWORK_MODE_UNSUPPORTED,
      message: `The target node has no IP pool for network mode "${desiredNetworkMode}".`,
      field: 'networkMode',
    });
  }
  const isHostNetwork = desiredNetworkMode === 'host';

  let resolvedHostIp: string | null = null;
  try {
    resolvedHostIp =
      typeof resolvedEnvironment?.CATALYST_NETWORK_IP === 'string'
        ? normalizeHostIp(resolvedEnvironment.CATALYST_NETWORK_IP)
        : null;
  } catch (error: any) {
    blockers.push({
      code: ErrorCodes.SERVER_NETWORK_IP_INVALID,
      message: error?.message || 'Invalid network IP',
      field: 'environment',
    });
  }

  let hostNetworkIp: string | null = null;
  if (isHostNetwork) {
    try {
      hostNetworkIp = resolvedHostIp ?? normalizeHostIp(node.publicAddress);
    } catch (error: any) {
      blockers.push({
        code: ErrorCodes.SERVER_NETWORK_IP_INVALID,
        message: error?.message || 'Invalid node public address',
        field: 'nodeId',
      });
    }
  }

  // Host-network servers bind ports directly on the node, so include them:
  // otherwise a clone would reuse a port an existing host-network server holds.
  const usedPorts = collectUsedHostPortsByIp(node.servers, undefined, { includeHost: true });
  const sourceBindings = parseStoredPortBindings(source.portBindings);
  const sourcePrimary = parsePortValue(source.primaryPort) ?? 25565;
  const sourceContainerPorts = uniquePorts([
    ...Object.keys(sourceBindings).map((key) => parsePortValue(key)).filter((p): p is number => p !== null),
    sourcePrimary,
  ]);

  const clonePortBindings: Record<number, number> = {};
  let clonePrimaryPort = sourcePrimary;

  if (isHostNetwork) {
    // Identity mapping; shift the whole port block to avoid collisions.
    const delta = findHostPortDelta(usedPorts, hostNetworkIp ?? resolvedHostIp, sourceContainerPorts);
    for (const containerPort of sourceContainerPorts) {
      const shifted = containerPort + delta;
      clonePortBindings[shifted] = shifted;
      if (containerPort === sourcePrimary) clonePrimaryPort = shifted;
    }
    if (delta > 0) {
      warnings.push({
        code: 'CLONE_HOST_PORTS_SHIFTED',
        message: `Host networking cannot remap ports, so the port block was shifted by ${delta} to stay free on this node.`,
        field: 'primaryPort',
      });
    }
  } else if (shouldUseIpam(desiredNetworkMode)) {
    for (const containerPort of sourceContainerPorts) {
      clonePortBindings[containerPort] = containerPort;
    }
  } else {
    const ipKey = resolvedHostIp || WILDCARD_HOST;
    for (const containerPort of sourceContainerPorts) {
      const hostPort = findAvailableHostPort(usedPorts, resolvedHostIp, containerPort);
      clonePortBindings[containerPort] = hostPort;
      let portsForIp = usedPorts.get(ipKey);
      if (!portsForIp) {
        portsForIp = new Set();
        usedPorts.set(ipKey, portsForIp);
      }
      portsForIp.add(hostPort);
      if (containerPort === sourcePrimary) clonePrimaryPort = hostPort;
    }
  }

  // 8. Allocation.
  let allocationIp: string | null = null;
  let allocationPort: number | null = null;
  let allocationMode: ClonePlan['allocations']['mode'] = shouldUseIpam(desiredNetworkMode)
    ? 'ipam'
    : isHostNetwork
      ? 'host-public'
      : 'allocation';
  const allocationRequired = false;

  const allocationRows = shouldUseIpam(desiredNetworkMode)
    ? []
    : await prisma.nodeAllocation.findMany({
        where: { nodeId: targetNodeId, serverId: null },
        select: { id: true, ip: true, port: true, alias: true },
        orderBy: [{ ip: 'asc' }, { port: 'asc' }],
        take: 200,
      });

  if (raw.allocationId) {
    if (shouldUseIpam(desiredNetworkMode)) {
      blockers.push({
        code: ErrorCodes.SERVER_NETWORK_MODE_INVALID,
        message: 'Allocation IDs are only valid for host/bridge networking.',
        field: 'allocationId',
      });
    } else {
      const allocation = await prisma.nodeAllocation.findUnique({ where: { id: raw.allocationId } });
      if (!allocation || allocation.nodeId !== targetNodeId) {
        throw new ClonePlanError(ErrorCodes.ALLOCATION_NOT_FOUND, 'Allocation not found', 404);
      }
      if (allocation.serverId) {
        throw new ClonePlanError(
          ErrorCodes.ALLOCATION_ALREADY_ASSIGNED,
          'Allocation is already assigned to a server',
          409,
        );
      }
      allocationIp = allocation.ip;
      allocationPort = allocation.port;
      clonePrimaryPort = allocation.port;
      hostNetworkIp = allocation.ip;
      allocationMode = 'allocation';
    }
  }

  const finalEnvironment: Record<string, string> = {
    ...resolvedEnvironment,
    ...(allocationIp ? { CATALYST_NETWORK_IP: allocationIp } : {}),
    ...(isHostNetwork && hostNetworkIp && !allocationIp ? { CATALYST_NETWORK_IP: hostNetworkIp } : {}),
  };

  // 9. Disk capacity (full clone only).
  const probe = args.probe;
  if (mode === 'full') {
    if (!probe || probe.sourceBytes === null || probe.targetFreeBytes === null) {
      warnings.push({
        code: 'CLONE_SOURCE_SIZE_UNKNOWN',
        message: 'Could not measure the source data size; the disk-space check was skipped.',
        field: 'source',
      });
    } else if (probe.targetFreeBytes < probe.sourceBytes * 1.1) {
      blockers.push({
        code: ErrorCodes.CLONE_INSUFFICIENT_DISK,
        message: 'The target node does not have enough free disk space for this clone.',
        field: 'nodeId',
      });
    } else if (probe.targetFreeBytes < probe.sourceBytes * 1.5) {
      warnings.push({
        code: 'CLONE_DISK_TIGHT',
        message: 'Free disk space on the target node is less than 1.5× the source size.',
        field: 'nodeId',
      });
    }
  }

  // 10. Omitted surfaces.
  if (source._count?.databases > 0 && !raw.includeDatabases) {
    warnings.push({
      code: 'CLONE_DATABASES_OMITTED',
      message: source._count.databases === 1
        ? 'The source has 1 database; the clone will not have one.'
        : `The source has ${source._count.databases} databases; the clone will not have them.`,
      field: 'includeDatabases',
    });
  }
  if (source._count?.scheduledTasks > 0 && !raw.includeScheduledTasks) {
    warnings.push({
      code: 'CLONE_SCHEDULES_OMITTED',
      message: 'Scheduled tasks are not copied by default.',
      field: 'includeScheduledTasks',
    });
  }

  const includeInstalledMods =
    raw.includeInstalledMods ?? mode === 'full';

  if (mode === 'configuration' && includeInstalledMods && source._count?.installedMods > 0) {
    warnings.push({
      code: 'CLONE_MODS_NOT_REINSTALLED',
      message: 'Installed-mod records are copied, but the template install must also place the files.',
      field: 'includeInstalledMods',
    });
  }

  // 11. Cross-node change set.
  const crossNode = source.nodeId !== targetNodeId;
  if (crossNode && !auth.canTransfer) {
    blockers.push({
      code: ErrorCodes.PERMISSION_DENIED,
      message: 'The server.transfer permission is required to clone onto a different node.',
      field: 'nodeId',
    });
  }
  const sourceDataDir = `${source.node?.serverDataDir || '/var/lib/catalyst/servers'}/${source.uuid}`;
  const targetDataDir = `${node.serverDataDir || '/var/lib/catalyst/servers'}/<new-uuid>`;

  if (crossNode) {
    changes.unshift(
      {
        field: 'node',
        label: 'Node',
        from: source.node?.name ?? source.nodeId,
        to: node.name,
        nodeSpecific: true,
      },
      {
        field: 'location',
        label: 'Location',
        from: source.location?.name ?? source.locationId,
        to: node.location?.name ?? node.locationId,
        nodeSpecific: true,
      },
      {
        field: 'dataDir',
        label: 'Data directory',
        from: sourceDataDir,
        to: targetDataDir,
        nodeSpecific: true,
      },
      {
        field: 'sftp',
        label: 'SFTP endpoint',
        from: `${source.node?.hostname ?? ''}:${source.node?.sftpPort ?? ''}`,
        to: `${node.hostname}:${node.sftpPort}`,
        nodeSpecific: true,
      },
    );
  }
  changes.push(
    {
      field: 'primaryIp',
      label: 'IP address',
      from: source.primaryIp,
      to: allocationIp ?? (shouldUseIpam(desiredNetworkMode) ? 'auto-assigned' : hostNetworkIp),
      nodeSpecific: true,
    },
    {
      field: 'primaryPort',
      label: 'Primary port',
      from: sourcePrimary,
      to: clonePrimaryPort,
      nodeSpecific: true,
    },
    {
      field: 'portBindings',
      label: 'Port mappings',
      from: JSON.stringify(sourceBindings),
      to: JSON.stringify(clonePortBindings),
      nodeSpecific: true,
    },
  );

  const estimatedDurationSec =
    mode === 'full' && probe?.sourceBytes
      ? Math.max(5, Math.round(probe.sourceBytes / ESTIMATED_THROUGHPUT_BYTES_PER_SEC))
      : null;

  const plan: ClonePlan = {
    mode,
    crossNode,
    source: {
      id: source.id,
      uuid: source.uuid,
      name: source.name,
      status: sourceStatus,
      nodeId: source.nodeId,
      nodeName: source.node?.name ?? source.nodeId,
      locationId: source.locationId,
      locationName: source.location?.name ?? source.locationId,
      templateId: source.templateId,
      templateName: template?.name ?? source.templateId,
      networkMode: source.networkMode,
      primaryIp: source.primaryIp,
      primaryPort: sourcePrimary,
      dataDir: sourceDataDir,
      dataSizeBytes: probe?.sourceBytes ?? null,
      installedMods: source._count?.installedMods ?? 0,
      scheduledTasks: source._count?.scheduledTasks ?? 0,
      subUsers: source._count?.access ?? 0,
      databases: source._count?.databases ?? 0,
      templateVariables: Array.from(declaredNames),
    },
    target: {
      nodeId: node.id,
      nodeName: node.name,
      locationId: node.locationId,
      locationName: node.location?.name ?? node.locationId,
      isOnline: Boolean(node.isOnline),
      agentVersion: node.agentVersion ?? null,
      serverDataDir: node.serverDataDir || '/var/lib/catalyst/servers',
      sftpPort: node.sftpPort,
      publicAddress: node.publicAddress,
      supportedNetworkModes,
      capacity: {
        memoryFreeMb:
          effectiveMaxMemory === Infinity ? 'unlimited' : effectiveMaxMemory - totalAllocatedMemory,
        cpuFreeCores: effectiveMaxCpu === Infinity ? 'unlimited' : effectiveMaxCpu - totalAllocatedCpu,
        diskFreeBytes: probe?.targetFreeBytes ?? null,
      },
    },
    resolved: {
      name: raw.name ?? `${source.name} Copy`,
      ownerId: effectiveOwnerId,
      nodeId: node.id,
      locationId: node.locationId,
      templateId: source.templateId,
      networkMode: desiredNetworkMode,
      primaryIp: allocationIp ?? (shouldUseIpam(desiredNetworkMode) ? null : hostNetworkIp),
      primaryPort: clonePrimaryPort,
      portBindings: clonePortBindings,
      allocatedMemoryMb: resolvedMemoryMb,
      allocatedCpuCores: resolvedCpuCores,
      allocatedDiskMb: resolvedDiskMb,
      allocatedSwapMb: resolvedSwapMb,
      ioWeight: resolvedIoWeight,
      backupAllocationMb: resolvedBackupAllocationMb,
      databaseAllocation: resolvedDatabaseAllocation,
      backupStorageMode: resolvedBackupStorageMode,
      environment: finalEnvironment,
      image: resolvedImage,
      includeInstalledMods,
    },
    allocations: {
      required: allocationRequired,
      mode: allocationMode,
      available: allocationRows.map((row) => ({
        id: row.id,
        ip: row.ip,
        port: row.port,
        alias: row.alias ?? null,
      })),
      selected: allocationIp && allocationPort
        ? { id: raw.allocationId as string, ip: allocationIp, port: allocationPort }
        : null,
    },
    requirements: {
      sourceStopped: mode === 'full',
      installWillRun: mode === 'configuration',
      estimatedDurationSec,
    },
    includeSurfaces: {
      access: raw.includeAccess,
      roleGrants: raw.includeRoleGrants,
      scheduledTasks: raw.includeScheduledTasks,
      databases: raw.includeDatabases,
    },
    changes,
    blockers,
    warnings,
  };

  // Target node offline blocks both modes: full clone needs the agent to copy
  // and a configuration clone needs it to install.
  if (!node.isOnline) {
    plan.blockers.push({
      code: ErrorCodes.CLONE_TARGET_NODE_OFFLINE,
      message: 'The target node is offline.',
      field: 'nodeId',
    });
  }

  return plan;
}

/** Stable fingerprint of everything that must not change between preflight and submit. */
export function cloneFingerprint(plan: ClonePlan): string {
  const stable = {
    source: plan.source.id,
    sourceStatus: plan.source.status,
    targetNodeId: plan.resolved.nodeId,
    mode: plan.mode,
    networkMode: plan.resolved.networkMode,
    allocationId: plan.allocations.selected?.id ?? null,
    ownerId: plan.resolved.ownerId,
    memory: plan.resolved.allocatedMemoryMb,
    cpu: plan.resolved.allocatedCpuCores,
    disk: plan.resolved.allocatedDiskMb,
    primaryPort: plan.resolved.primaryPort,
    portBindings: plan.resolved.portBindings,
    includeInstalledMods: plan.resolved.includeInstalledMods,
    includeSurfaces: plan.includeSurfaces,
  };
  return crypto.createHash('sha256').update(JSON.stringify(stable)).digest('hex').slice(0, 32);
}

/** Throw the first blocker as a `ClonePlanError` — used by the submit path. */
export function assertPlanHasNoBlockers(plan: ClonePlan): void {
  const blocker = plan.blockers[0];
  if (blocker) {
    throw new ClonePlanError(blocker.code, blocker.message, 400, {
      field: blocker.field,
      ...(blocker.params ?? {}),
    });
  }
}

// ── Persistence ─────────────────────────────────────────────────────────────

export interface PersistedClone {
  server: any;
  node: any;
  provisionedDatabases: Array<{ hostId: string; name: string; username: string }>;
}

export async function persistClone(plan: ClonePlan, auth: CloneAuth): Promise<PersistedClone> {
  const source = await prisma.server.findUnique({
    where: { id: plan.source.id },
    include: { template: true, node: true },
  });
  if (!source) {
    throw new ClonePlanError(ErrorCodes.SERVER_NOT_FOUND, 'Source server not found', 404);
  }
  if (!source.template) {
    throw new ClonePlanError(ErrorCodes.CLONE_TEMPLATE_MISSING, 'Source server template not found');
  }

  const targetNode = await prisma.node.findUnique({ where: { id: plan.resolved.nodeId } });
  if (!targetNode) {
    throw new ClonePlanError(ErrorCodes.NODE_NOT_FOUND, 'Target node not found', 404);
  }

  const newNodeId = plan.resolved.nodeId;
  const allocationId = plan.allocations.selected?.id;

  let server: any;
  try {
    server = await prisma.$transaction(async (tx) => {
      const created = await tx.server.create({
        data: {
          uuid: uuidv4(),
          name: plan.resolved.name,
          description: source.description,
          templateId: source.templateId,
          nodeId: newNodeId,
          locationId: targetNode.locationId,
          ownerId: plan.resolved.ownerId,
          allocatedMemoryMb: plan.resolved.allocatedMemoryMb,
          allocatedCpuCores: plan.resolved.allocatedCpuCores,
          allocatedDiskMb: plan.resolved.allocatedDiskMb,
          allocatedSwapMb: plan.resolved.allocatedSwapMb,
          ioWeight: plan.resolved.ioWeight,
          backupAllocationMb: plan.resolved.backupAllocationMb,
          databaseAllocation: plan.resolved.databaseAllocation,
          backupStorageMode: plan.resolved.backupStorageMode,
          backupRetentionCount: source.backupRetentionCount,
          backupRetentionDays: source.backupRetentionDays,
          restartPolicy: source.restartPolicy,
          maxCrashCount: source.maxCrashCount,
          primaryPort: plan.resolved.primaryPort,
          portBindings: plan.resolved.portBindings,
          networkMode: plan.resolved.networkMode,
          environment: {
            ...plan.resolved.environment,
            TEMPLATE_IMAGE: plan.resolved.image,
          },
          // A clone is never copied in a runtime state.
          status: ServerState.STOPPED,
        },
      });

      if (allocationId) {
        const allocationIp = plan.allocations.selected?.ip ?? null;
        const allocationPort = plan.allocations.selected?.port ?? plan.resolved.primaryPort;
        await tx.server.update({
          where: { id: created.id },
          data: {
            primaryIp: allocationIp,
            primaryPort: allocationPort,
            environment: {
              ...plan.resolved.environment,
              TEMPLATE_IMAGE: plan.resolved.image,
              CATALYST_NETWORK_IP: allocationIp,
            },
          },
        });
        const claim = await tx.nodeAllocation.updateMany({
          where: { id: allocationId, nodeId: newNodeId, serverId: null },
          data: { serverId: created.id },
        });
        if (claim.count === 0) throw new Error('ALLOCATION_TAKEN');

        const secondaryHostPorts = Object.values(plan.resolved.portBindings).filter(
          (port) => port !== allocationPort,
        );
        if (secondaryHostPorts.length > 0) {
          const secondary = await tx.nodeAllocation.updateMany({
            where: {
              nodeId: newNodeId,
              serverId: null,
              port: { in: secondaryHostPorts },
              ...(allocationIp ? { ip: allocationIp } : {}),
            },
            data: { serverId: created.id },
          });
          if (secondary.count === 0) throw new Error('ALLOCATION_TAKEN');
        }
      } else if (shouldUseIpam(plan.resolved.networkMode)) {
        const allocatedIp = await allocateIpForServer(tx as any, {
          nodeId: newNodeId,
          networkName: plan.resolved.networkMode,
          serverId: created.id,
          requestedIp: null,
        });
        if (!allocatedIp) throw new Error('NO_IP_POOL');
        await tx.server.update({
          where: { id: created.id },
          data: {
            primaryIp: allocatedIp,
            environment: {
              ...plan.resolved.environment,
              TEMPLATE_IMAGE: plan.resolved.image,
              CATALYST_NETWORK_IP: allocatedIp,
            },
          },
        });
      }

      return tx.server.findUniqueOrThrow({ where: { id: created.id } });
    });
  } catch (error: any) {
    if (error?.message === 'ALLOCATION_TAKEN') {
      throw new ClonePlanError(
        ErrorCodes.ALLOCATION_ALREADY_ASSIGNED,
        'Allocation is no longer available',
        409,
      );
    }
    if (error?.message === 'NO_IP_POOL') {
      throw new ClonePlanError(
        ErrorCodes.CLONE_NETWORK_MODE_UNSUPPORTED,
        'No IP pool configured for this network on the target node',
      );
    }
    throw new ClonePlanError(ErrorCodes.SERVER_CLONE_FAILED, error?.message || 'Clone failed', 400);
  }

  // Owner permissions + optional configuration surfaces.
  await prisma.serverAccess.create({
    data: {
      userId: plan.resolved.ownerId,
      serverId: server.id,
      permissions: [...OWNER_SERVER_PERMISSIONS],
    },
  });

  if (plan.mode === 'full' || plan.resolved.includeInstalledMods) {
    const includeInstalledMods = plan.resolved.includeInstalledMods;
    if (includeInstalledMods) {
      const mods = await prisma.installedMod.findMany({ where: { serverId: source.id } });
      if (mods.length > 0) {
        await prisma.installedMod.createMany({
          data: mods.map((mod) => ({
            serverId: server.id,
            filename: mod.filename,
            type: mod.type,
            provider: mod.provider,
            game: mod.game,
            projectId: mod.projectId,
            versionId: mod.versionId,
            projectName: mod.projectName,
            latestVersionId: mod.latestVersionId,
            latestVersionName: mod.latestVersionName,
            hasUpdate: mod.hasUpdate,
          })),
          skipDuplicates: true,
        });
      }
    }
  }

  if (plan.includeSurfaces.access) {
    const access = await prisma.serverAccess.findMany({
      where: { serverId: source.id, userId: { not: plan.resolved.ownerId } },
    });
    if (access.length > 0) {
      await prisma.serverAccess.createMany({
        data: access.map((row) => ({
          userId: row.userId,
          serverId: server.id,
          permissions: row.permissions,
        })),
        skipDuplicates: true,
      });
    }
  }

  if (plan.includeSurfaces.roleGrants) {
    const roles = await prisma.serverRole.findMany({ where: { serverId: source.id } });
    if (roles.length > 0) {
      await prisma.serverRole.createMany({
        data: roles.map((role) => ({ serverId: server.id, roleId: role.roleId })),
        skipDuplicates: true,
      });
    }
  }

  if (plan.includeSurfaces.scheduledTasks) {
    const tasks = await prisma.scheduledTask.findMany({ where: { serverId: source.id } });
    if (tasks.length > 0) {
      await prisma.scheduledTask.createMany({
        data: tasks.map((task) => ({
          serverId: server.id,
          name: task.name,
          description: task.description,
          action: task.action,
          payload: task.payload ?? undefined,
          schedule: task.schedule,
          timeOffset: task.timeOffset,
          sequenceId: task.sequenceId,
          enabled: task.enabled,
          // A clone's schedule starts clean.
          runCount: 0,
        })),
      });
    }
  }

  const provisionedDatabases: PersistedClone['provisionedDatabases'] = [];
  if (plan.includeSurfaces.databases) {
    const sourceDatabases = await prisma.serverDatabase.findMany({ where: { serverId: source.id } });
    try {
      const { encryptSecretValue, isCredentialEncryptionConfigured } = await import(
        './backup-credentials.js'
      );
      if (sourceDatabases.length > 0 && !isCredentialEncryptionConfigured()) {
        throw new ClonePlanError(
          ErrorCodes.CREDENTIAL_ENCRYPTION_KEY_MISSING,
          'Database passwords cannot be stored: BACKUP_CREDENTIALS_ENCRYPTION_KEY is not configured',
        );
      }
      const shortServer = server.id.replace(/[^a-z0-9]/gi, '').slice(0, 6).toLowerCase() || 'srv';
      for (const sourceDb of sourceDatabases) {
        const host = await prisma.databaseHost.findUnique({ where: { id: sourceDb.hostId } });
        if (!host) continue;
        const databaseName = generateSafeIdentifier('srv_', 12);
        const databaseUsername = generateSafeIdentifier(`srv_${shortServer}_`, 8);
        const databasePassword = generateSafeIdentifier('p', 24);
        if (!isValidDatabaseIdentifier(databaseName) || !isValidDatabaseIdentifier(databaseUsername)) {
          throw new ClonePlanError(
            ErrorCodes.CLONE_DATABASE_PROVISION_FAILED,
            'Unable to generate a valid database identifier for the clone',
          );
        }
        await provisionDatabase(host, databaseName, databaseUsername, databasePassword);
        provisionedDatabases.push({ hostId: host.id, name: databaseName, username: databaseUsername });
        await prisma.serverDatabase.create({
          data: {
            serverId: server.id,
            hostId: host.id,
            name: databaseName,
            username: databaseUsername,
            password: (encryptSecretValue(databasePassword) ?? databasePassword) as string,
          },
        });
      }
    } catch (error: any) {
      // Roll back: drop what we provisioned and remove the half-created clone.
      for (const db of provisionedDatabases) {
        try {
          const host = await prisma.databaseHost.findUnique({ where: { id: db.hostId } });
          if (host) await dropDatabase(host, db.name, db.username);
        } catch {
          /* best effort */
        }
      }
      await prisma.server.delete({ where: { id: server.id } }).catch(() => {});
      if (error instanceof ClonePlanError) throw error;
      if (error instanceof DatabaseProvisioningError || error?.name === 'DatabaseProvisioningError') {
        throw new ClonePlanError(
          ErrorCodes.CLONE_DATABASE_PROVISION_FAILED,
          `Database provisioning failed: ${error.message}`,
        );
      }
      throw new ClonePlanError(
        ErrorCodes.CLONE_DATABASE_PROVISION_FAILED,
        error?.message || 'Database provisioning failed',
      );
    }
  }

  return { server, node: targetNode, provisionedDatabases };
}

// ── File copy + install ─────────────────────────────────────────────────────

export async function copyCloneData(args: {
  source: { id: string; uuid: string; nodeId: string };
  cloneUuid: string;
  targetNodeId: string;
  targetServerDataDir: string;
  gateway: any;
  onStage?: (stage: string, progress: number) => void;
}): Promise<{ bytes: number | null; sameNode: boolean }> {
  return streamServerData({
    gateway: args.gateway,
    sourceNodeId: args.source.nodeId,
    targetNodeId: args.targetNodeId,
    sourceUuid: args.source.uuid,
    targetUuid: args.cloneUuid,
    serverId: args.source.id,
    targetServerDataDir: args.targetServerDataDir,
    onStage: args.onStage,
  });
}

/**
 * Kick off the template install for a configuration clone. Mirrors the
 * `POST /:serverId/install` route but sends directly (the caller already holds
 * the server row and has set `status = installing`).
 */
export async function startCloneInstall(serverId: string, gateway: any): Promise<void> {
  const server = await prisma.server.findUnique({
    where: { id: serverId },
    include: { template: true, node: true },
  });
  if (!server) {
    throw new ClonePlanError(ErrorCodes.SERVER_NOT_FOUND, 'Server not found', 404);
  }
  if (!server.template) {
    throw new ClonePlanError(ErrorCodes.CLONE_TEMPLATE_MISSING, 'Template not found');
  }
  if (!gateway) {
    throw new ClonePlanError(ErrorCodes.GATEWAY_NOT_AVAILABLE, 'WebSocket gateway not available', 500);
  }
  const payload = buildInstallCommand(server as any, 'install_server');
  const ok = await gateway.sendToAgent(server.nodeId, payload.command);
  if (!ok) {
    throw new ClonePlanError(ErrorCodes.AGENT_COMMAND_FAILED, 'Failed to send install command to agent', 503);
  }
}
