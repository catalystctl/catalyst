/**
 * Catalyst - Rate Limiting Configuration
 *
 * Tiered rate limiting based on endpoint sensitivity.
 * Critical endpoints (login, password reset) have strict limits.
 * Read operations have higher limits.
 */

export const rateLimitTiers = {
  critical: {
    max: 5,
    window: '1 minute' as const,
    description: 'Critical endpoints (login, password reset)',
  },
  high: {
    max: 10,
    window: '1 minute' as const,
    description: 'High-risk endpoints (server start/stop)',
  },
  medium: {
    max: 30,
    window: '1 minute' as const,
    description: 'Medium-risk endpoints (file operations)',
  },
  normal: {
    max: 60,
    window: '1 minute' as const,
    description: 'General API endpoints',
  },
  read: {
    max: 120,
    window: '1 minute' as const,
    description: 'Read-only endpoints',
  },
} as const;

/**
 * Get rate limit configuration for a specific tier
 */
export const getRateLimit = (tier: keyof typeof rateLimitTiers) => {
  return rateLimitTiers[tier];
};

/**
 * Apply rate limiting to routes
 * Usage: { config: { rateLimit: getRateLimitConfig('critical') } }
 */
export const getRateLimitConfig = (tier: keyof typeof rateLimitTiers) => {
  const config = rateLimitTiers[tier];
  return {
    max: config.max,
    timeWindow: config.window,
  };
};

/**
 * Route-specific rate limit assignments
 */
export const routeRateLimits = {
  // Authentication routes
  'POST /api/auth/login': 'critical',
  'POST /api/auth/register': 'critical',
  'POST /api/auth/forgot-password': 'critical',
  'POST /api/auth/reset-password': 'critical',

  // Server operations
  'POST /api/servers': 'high',
  'POST /api/servers/:id/start': 'high',
  'POST /api/servers/:id/stop': 'high',
  'POST /api/servers/:id/restart': 'high',
  'DELETE /api/servers/:id': 'high',

  // File operations
  'GET /api/servers/:id/files/list': 'medium',
  'POST /api/servers/:id/files/read': 'medium',
  'POST /api/servers/:id/files/write': 'medium',
  'POST /api/servers/:id/files/upload': 'medium',
  'DELETE /api/servers/:id/files/delete': 'medium',

  // Read operations
  'GET /api/servers': 'read',
  'GET /api/servers/:id': 'read',
  'GET /api/nodes': 'read',
  'GET /api/templates': 'read',
} as const;
