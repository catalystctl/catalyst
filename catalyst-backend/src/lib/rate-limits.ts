/**
 * Catalyst - Rate Limiting Configuration
 *
 * Tiered rate limiting based on endpoint sensitivity.
 * Critical endpoints (login, password reset) have strict limits.
 * Read operations have higher limits.
 *
 * Rate limits are keyed by user ID for authenticated requests and by IP
 * for unauthenticated requests, so these are per-user/per-IP ceilings.
 *
 * Design principles:
 * - Limits must accommodate power users with multiple browser tabs,
 *   automated workflows, and rapid admin operations (bulk server
 *   creation, batch template imports, etc.)
 * - Auth-adjacent mutations (password change, 2FA setup, passkey
 *   management) are separate from brute-force-sensitive auth (login,
 *   register) and need higher limits for legitimate use
 * - Read endpoints auto-poll at 10–30s intervals; limits must absorb
 *   the polling load from multiple tabs without blocking user actions
 */

export const rateLimitTiers = {
  /** Brute-force-sensitive auth (login, register, forgot/reset password) */
  critical: {
    max: 10,
    window: '1 minute' as const,
    description: 'Critical auth endpoints (login, register, password reset)',
  },
  /** Security mutations (2FA enable/disable, passkey add/remove, password change) */
  security: {
    max: 20,
    window: '1 minute' as const,
    description: 'Security mutations (2FA, passkeys, password change)',
  },
  /** Destructive or expensive server operations */
  high: {
    max: 30,
    window: '1 minute' as const,
    description: 'High-risk endpoints (server start/stop/restart/delete)',
  },
  /** File and mod/plugin operations */
  medium: {
    max: 60,
    window: '1 minute' as const,
    description: 'Medium-risk endpoints (file ops, mod/plugin installs)',
  },
  /** General API mutations (create, update, delete resources) */
  normal: {
    max: 60,
    window: '1 minute' as const,
    description: 'General API endpoints (CRUD mutations)',
  },
  /** Read-only endpoints (list, get, search) */
  read: {
    max: 200,
    window: '1 minute' as const,
    description: 'Read-only endpoints',
  },
  /** Strict long-window limits (password reset validation, account deletion) */
  strict: {
    max: 10,
    window: '15 minutes' as const,
    description: 'Strict long-window (password reset validate, account delete)',
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
  // Brute-force-sensitive auth
  'POST /api/auth/login': 'critical',
  'POST /api/auth/register': 'critical',
  'POST /api/auth/forgot-password': 'critical',
  'POST /api/auth/reset-password': 'critical',

  // Security mutations (higher than critical — legitimate bulk setup)
  'POST /api/auth/profile/change-password': 'security',
  'POST /api/auth/profile/set-password': 'security',
  'POST /api/auth/profile/two-factor': 'security',
  'POST /api/auth/profile/two-factor/disable': 'security',
  'POST /api/auth/profile/two-factor/generate-backup-codes': 'security',
  'POST /api/auth/profile/passkeys': 'security',
  'POST /api/auth/profile/passkeys/verify': 'security',
  'DELETE /api/auth/profile/passkeys/:id': 'security',
  'PATCH /api/auth/profile/passkeys/:id': 'security',
  'DELETE /api/auth/profile/sso/accounts': 'security',
  'PATCH /api/auth/profile/preferences': 'security',

  // Strict long-window
  'POST /api/auth/reset-password/validate': 'strict',
  'GET /api/auth/profile/audit-log': 'strict',

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
