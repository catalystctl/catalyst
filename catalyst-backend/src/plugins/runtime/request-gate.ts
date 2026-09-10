import type { FastifyRequest, FastifyReply } from 'fastify';
import { captureSystemError } from '../../services/error-logger';
import { performance } from 'perf_hooks';

export interface PluginGateConfig {
  pluginName: string;
  requestTimeoutMs: number;
  /** Process-wide heap-pressure observation threshold (see DEFAULT_GATE_CONFIG). */
  memoryLimitMb: number;
  maxConcurrentRequests: number;
}

export const DEFAULT_GATE_CONFIG: Omit<PluginGateConfig, 'pluginName'> = {
  requestTimeoutMs: 30000,
  // Process-wide heap pressure threshold (NOT per-plugin usage — plugins run
  // in-process, so process.memoryUsage() cannot be attributed to one plugin).
  // 256MB was tripping on normal backend heaps (350MB+); 1024MB only fires
  // under genuine memory pressure. Overridable via PLUGIN_PROCESS_HEAP_LIMIT_MB.
  memoryLimitMb: Number(process.env.PLUGIN_PROCESS_HEAP_LIMIT_MB) > 0
    ? Number(process.env.PLUGIN_PROCESS_HEAP_LIMIT_MB)
    : 1024,
  maxConcurrentRequests: 10,
};

const activeRequests = new Map<string, number>();

// Throttle pressure warnings so a hot backend does not spam a systemError row
// on every plugin request while heap stays above the threshold.
const lastMemoryWarnAt = new Map<string, number>();
const MEMORY_WARN_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Plugins whose Fastify routes should hard-deny all traffic.
 * Used on disable/unload because Fastify cannot easily unregister routes —
 * handlers stay mounted but the gate rejects them until re-enabled (or forever
 * after unload, including stale duplicate routes from hot-reload).
 */
const disabledPlugins = new Set<string>();

/**
 * Mark a plugin's gated routes as accepting or denying traffic.
 * Call with enabled=false on disable/unload; enabled=true on enable.
 */
export function setPluginGateEnabled(pluginName: string, enabled: boolean): void {
  if (enabled) {
    disabledPlugins.delete(pluginName);
  } else {
    disabledPlugins.add(pluginName);
  }
}

export function isPluginGateEnabled(pluginName: string): boolean {
  return !disabledPlugins.has(pluginName);
}

/**
 * Creates a gated handler that enforces resource limits on plugin routes.
 */
export function createGatedHandler(
  config: PluginGateConfig,
  handler: (request: FastifyRequest, reply: FastifyReply) => Promise<any>,
): (request: FastifyRequest, reply: FastifyReply) => Promise<any> {
  const { pluginName, requestTimeoutMs, memoryLimitMb, maxConcurrentRequests } = config;

  // New/loaded plugins start denied until enablePlugin flips the gate on.
  disabledPlugins.add(pluginName);

  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (disabledPlugins.has(pluginName)) {
      return reply.status(503).send({
        success: false,
        error: 'Plugin is disabled or unloaded',
      });
    }

    const startTime = performance.now();

    // Backend heap-pressure observation (warn-only, never rejects).
    // Plugins run in-process, so process.memoryUsage() is process-wide and
    // cannot be attributed to one plugin. Rejecting here blamed whichever
    // plugin received the request (e.g. cs16-admin 503s at 355MB > 256MB on
    // a healthy backend) and made that plugin unusable while the heap was
    // high for unrelated reasons. Log throttled pressure warnings instead.
    const memUsage = process.memoryUsage();
    const heapMb = memUsage.heapUsed / 1024 / 1024;
    if (heapMb > memoryLimitMb) {
      const now = Date.now();
      const lastWarn = lastMemoryWarnAt.get(pluginName) ?? 0;
      if (now - lastWarn >= MEMORY_WARN_INTERVAL_MS) {
        lastMemoryWarnAt.set(pluginName, now);
        captureSystemError({
          level: 'warn',
          component: 'PluginGateway',
          message: `Backend process heap pressure while serving plugin ${pluginName}: ${Math.round(heapMb)}MB > ${memoryLimitMb}MB (process-wide, not per-plugin usage)`,
          metadata: { pluginName, heapMb, memoryLimitMb, scope: 'process' },
        }).catch(() => {});
      }
    }

    // Check concurrent request count
    const current = activeRequests.get(pluginName) || 0;
    if (current >= maxConcurrentRequests) {
      return reply.status(503).send({
        success: false,
        error: 'Plugin concurrent request limit exceeded',
      });
    }
    activeRequests.set(pluginName, current + 1);

    try {
      const result = await Promise.race([
        handler(request, reply),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Request timeout')), requestTimeoutMs)
        ),
      ]);

      const duration = performance.now() - startTime;
      if (duration > requestTimeoutMs / 2) {
        console.warn('[PluginGate]', {
          plugin: pluginName,
          duration: Math.round(duration),
          path: request.url,
          timeoutMs: requestTimeoutMs,
        });
      }

      return result;
    } catch (err: any) {
      if (err?.message === 'Request timeout') {
        return reply.status(504).send({
          success: false,
          error: `Plugin request timed out after ${requestTimeoutMs}ms`,
        });
      }
      throw err;
    } finally {
      const remaining = activeRequests.get(pluginName) || 1;
      if (remaining <= 1) {
        activeRequests.delete(pluginName);
      } else {
        activeRequests.set(pluginName, remaining - 1);
      }
    }
  };
}
