/**
 * HTTP mapping for a refused CPU pin.
 *
 * Kept apart from `lib/cpu-affinity.ts` so the format module stays pure (no
 * Fastify, no error codes) — and so every stable error code appears exactly
 * once, inside an `apiError` call that supplies its message params. The i18n
 * checker scans backend sources for bare code mentions and requires the params
 * each catalog entry interpolates, so a lookup table of codes would be flagged.
 */
import type { FastifyReply } from 'fastify';
import { apiError } from './http-error.js';
import { ErrorCodes } from '../shared-types';
import {
  describeCpuAffinityError,
  type CpuAffinityWriteResult,
} from './cpu-affinity.js';

/**
 * Answer a create/update request whose pin was refused. Returns the reply so
 * call sites read `return cpuAffinityWriteError(reply, result);`.
 */
export function cpuAffinityWriteError(
  reply: FastifyReply,
  result: Extract<CpuAffinityWriteResult, { ok: false }>,
): FastifyReply {
  const message = describeCpuAffinityError(result.reason, result.params);
  switch (result.reason) {
    case 'invalid':
      return apiError(reply, 400, ErrorCodes.CPU_AFFINITY_INVALID, message, {
        params: result.params,
      });
    case 'unavailable':
      return apiError(reply, 400, ErrorCodes.CPU_AFFINITY_UNAVAILABLE, message, {
        params: result.params,
      });
    case 'below_allocation':
      return apiError(reply, 400, ErrorCodes.CPU_AFFINITY_BELOW_ALLOCATION, message, {
        params: result.params,
      });
  }
}
