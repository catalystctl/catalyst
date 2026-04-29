import type { FastifyRequest, FastifyReply } from 'fastify';
import { captureSystemError } from '../../services/error-logger';
import { performance } from 'perf_hooks';

export interface PluginGateConfig {
  pluginName: string;
  requestTimeoutMs: number;
  memoryLimitMb: number;
  maxConcurrentRequests: number;
}

export const DEFAULT_GATE_CONFIG: Omit<PluginGateConfig, 'pluginName'> = {
  requestTimeoutMs: 30000,
  memoryLimitMb: 256,
  maxConcurrentRequests: 10,
};

const activeRequests = new Map<string, number>();

/**
 * Creates a gated handler that enforces resource limits on plugin routes.
 */
export function createGatedHandler(
  config: PluginGateConfig,
  handler: (request: FastifyRequest, reply: FastifyReply) => Promise<any>,
): (request: FastifyRequest, reply: FastifyReply) => Promise<any> {
  const { pluginName, requestTimeoutMs, memoryLimitMb, maxConcurrentRequests } = config;

  return async (request: FastifyRequest, reply: FastifyReply) => {
    const startTime = performance.now();

    // Check memory
    const memUsage = process.memoryUsage();
    const heapMb = memUsage.heapUsed / 1024 / 1024;
    if (heapMb > memoryLimitMb) {
      captureSystemError({
        level: 'warn',
        component: 'PluginGateway',
        message: `Plugin ${pluginName} exceeded memory limit: ${Math.round(heapMb)}MB > ${memoryLimitMb}MB`,
        metadata: { pluginName, heapMb, memoryLimitMb },
      }).catch(() => {});
      return reply.status(503).send({
        success: false,
        error: `Plugin memory limit exceeded (${Math.round(heapMb)}MB > ${memoryLimitMb}MB)`,
      });
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
