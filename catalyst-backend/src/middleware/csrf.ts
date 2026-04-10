/**
 * Catalyst - CSRF Protection Middleware
 *
 * Adds CSRF protection for state-changing operations.
 * This prevents cross-site request forgery attacks by validating
 * CSRF tokens on POST, PUT, DELETE, and PATCH requests.
 *
 * Note: API key authentication bypasses CSRF protection since
 * API keys are already secure and don't use cookie-based sessions.
 */

import type { FastifyRequest, FastifyReply } from "fastify";
import { randomBytes } from "crypto";

/**
 * Generate a secure CSRF token
 * @returns Random 32-byte hex string
 */
export function generateCSRFToken(): string {
  return randomBytes(32).toString('hex');
}

/**
 * CSRF validation middleware for state-changing operations
 *
 * This middleware:
 * 1. Skips validation for API key authentication (already secure)
 * 2. Skips validation for safe methods (GET, HEAD, OPTIONS)
 * 3. Validates CSRF token for state-changing methods (POST, PUT, DELETE, PATCH)
 * 4. Generates new CSRF token for authenticated sessions
 *
 * @param request - Fastify request
 * @param reply - Fastify reply
 */
export const csrfMiddleware = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  // Skip CSRF for API key authentication (already secure)
  const apiKey = request.headers['x-api-key'] as string ||
                 request.headers['authorization']?.startsWith('catalyst_') ?
                 request.headers['authorization'] : null;

  if (apiKey) {
    return; // API key authentication is already secure
  }

  // Skip CSRF for safe methods
  const method = request.method.toUpperCase();
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    return;
  }

  // For state-changing operations, validate CSRF token
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
    const csrfToken = request.headers['x-csrf-token'] as string;
    const session = (request as any).session;

    if (!session) {
      return reply.status(401).send({ error: "Unauthorized - No session" });
    }

    const sessionToken = session.csrfToken;

    if (!csrfToken || csrfToken !== sessionToken) {
      return reply.status(403).send({ error: "Invalid CSRF token" });
    }
  }
};

/**
 * Generate and set CSRF token for authenticated sessions
 * This should be called after successful authentication
 *
 * @param request - Fastify request
 * @returns CSRF token or null if no session
 */
export const setCSRFToken = (request: FastifyRequest): string | null => {
  const session = (request as any).session;
  if (!session) {
    return null;
  }

  const token = generateCSRFToken();
  session.csrfToken = token;
  return token;
};

/**
 * Extend session type to include CSRF token
 */
declare module "fastify" {
  interface Session {
    csrfToken?: string;
  }
}
