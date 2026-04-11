import { FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../db";
import { auth } from "../auth";

/**
 * Check if an API key-authenticated request has the required permission scope.
 * API key permissions are stored as Record<string, string[]>, e.g. { "servers": ["read", "start"] }.
 * If the API key has no permissions defined (null/empty), it inherits full user access.
 * Returns true if the action is allowed or if not an API key request.
 */
export function checkApiKeyScope(request: FastifyRequest, category: string, action: string): boolean {
  const user = request.user;
  if (!user?.isApiKeyAuth) return true; // Not API key auth — no restriction
  const perms = user.apiKeyPermissions;
  if (!perms || typeof perms !== "object" || Object.keys(perms).length === 0) {
    return true; // No scoped permissions — full access (backwards compatible)
  }
  const allowed = perms[category];
  if (!Array.isArray(allowed)) return false;
  return allowed.includes(action) || allowed.includes("*");
}

/**
 * Middleware that supports both JWT session auth AND API key auth.
 * Tries JWT first, falls back to API key if Authorization header matches pattern.
 */
export async function authOrApiKey(request: FastifyRequest, reply: FastifyReply) {
  const authHeader = request.headers.authorization;

  // Try API key authentication if header matches Bearer pattern
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.substring(7);

    // Check if it's an API key (starts with prefix)
    if (token.startsWith("catalyst_")) {
      try {
        const apiKey = await prisma.apikey.findUnique({
          where: { key: token },
        });

        if (!apiKey) {
          return reply.status(401).send({
            success: false,
            error: "Invalid API key",
          });
        }

        // Check if key is enabled
        if (!apiKey.enabled) {
          return reply.status(401).send({
            success: false,
            error: "API key is disabled",
          });
        }

        // Check if key is expired
        if (apiKey.expiresAt && new Date(apiKey.expiresAt) < new Date()) {
          return reply.status(401).send({
            success: false,
            error: "API key has expired",
          });
        }

        // Rate limiting check
        if (apiKey.rateLimitEnabled) {
          const now = new Date();
          const lastRequest = apiKey.lastRequest ? new Date(apiKey.lastRequest) : null;
          const timeWindow = apiKey.rateLimitTimeWindow || 60000;
          const maxRequests = apiKey.rateLimitMax || 100;

          if (lastRequest && now.getTime() - lastRequest.getTime() < timeWindow) {
            const requestCount = apiKey.requestCount || 0;
            if (requestCount >= maxRequests) {
              return reply.status(429).send({
                success: false,
                error: "Rate limit exceeded for API key",
                retryAfter: Math.ceil((timeWindow - (now.getTime() - lastRequest.getTime())) / 1000),
              });
            }
          } else {
            // Reset counter if outside window
            await prisma.apikey.update({
              where: { id: apiKey.id },
              data: {
                requestCount: 0,
                lastRequest: now,
              },
            });
          }
        }

        // Update usage stats
        await prisma.apikey.update({
          where: { id: apiKey.id },
          data: {
            requestCount: { increment: 1 },
            lastRequest: new Date(),
          },
        });

        // Load user and attach to request
        const user = await prisma.user.findUnique({
          where: { id: apiKey.userId },
          include: { roles: true },
        });

        if (!user) {
          return reply.status(401).send({
            success: false,
            error: "User associated with API key not found",
          });
        }

        // Attach user and API key permissions to request
        request.user = {
          userId: user.id,
          email: user.email,
          username: user.username,
          isApiKeyAuth: true,
          apiKeyPermissions: (apiKey.permissions as Record<string, string[]>) || {},
        };

        return; // Continue to route handler
      } catch (error: any) {
        request.log.error(error, "API key authentication error");
        return reply.status(500).send({
          success: false,
          error: "Authentication error",
        });
      }
    }
  }

  // Fall back to normal session authentication
  try {
    const session = await auth.api.getSession({ 
      headers: request.headers as any 
    });
    
    if (!session?.user) {
      return reply.status(401).send({
        success: false,
        error: "Unauthorized - valid session or API key required",
      });
    }

    // Attach user to request
    const sessionUser = session.user;
    request.user = {
      userId: sessionUser.id,
      email: sessionUser.email,
      username: sessionUser.username || sessionUser.name,
    };
  } catch (error: any) {
    request.log.error(error, "Session authentication error");
    return reply.status(401).send({
      success: false,
      error: "Unauthorized",
    });
  }
}
