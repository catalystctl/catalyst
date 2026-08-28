/**
 * Plugin safety consent + effective permission helpers.
 *
 * Pure logic only — no Prisma/fastify imports — so it is trivially unit-testable
 * and reusable from the loader, routes, and the startup backfill.
 *
 * Consent model (see docs/plugins.md "Safety consent & permission control"):
 *  - Enabling a plugin the first time requires accepting the safety disclaimer.
 *  - Re-acceptance is required when the plugin version changes, when its declared
 *    permissions grow beyond the accepted snapshot, or when DISCLAIMER_VERSION bumps.
 *  - Acceptance records WHO accepted, WHEN, and WHAT was accepted. A record with a
 *    timestamp but no user id marks a legacy/backfill acceptance (grandfathered).
 */

export const DISCLAIMER_VERSION = '1';

/** Reason consent must be (re-)accepted before enabling. */
export type ConsentReason = 'never_accepted' | 'plugin_updated' | 'permissions_grew' | 'disclaimer_updated';

export interface ConsentInputs {
  /** Whether any acceptance exists at all. */
  hasAcceptance: boolean;
  /** Disclaimer version recorded at acceptance time (null when never accepted). */
  acceptedDisclaimerVersion: string | null;
  /** Plugin version recorded at acceptance time (null when never accepted). */
  acceptedPluginVersion: string | null;
  /** Declared-permission snapshot recorded at acceptance time (null when never accepted). */
  acceptedPermissions: string[] | null;
  /** Plugin's currently declared permissions from plugin.json. */
  manifestPermissions: string[];
  /** Plugin's current version from plugin.json. */
  manifestVersion: string;
}

export interface ConsentState {
  consentRequired: boolean;
  reason?: ConsentReason;
}

/** Risk weighting used for UI ordering/coloring. */
export type PermissionRiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface PermissionInfo {
  label: string;
  riskLevel: PermissionRiskLevel;
  description: string;
}

/**
 * Human-facing metadata for known plugin permissions. Unknown tokens fall back
 * to a generic entry rather than being rejected — plugins may declare new scopes.
 */
export const PERMISSION_INFO: Record<string, PermissionInfo> = {
  '*': {
    label: 'Full access',
    riskLevel: 'critical',
    description:
      'Wildcard access to every data scope the plugin system exposes and all capabilities. Only grant to fully trusted plugins.',
  },
  'server.read': {
    label: 'Read servers',
    riskLevel: 'medium',
    description: 'View details of all servers on this panel, including configuration and resource allocations.',
  },
  'server.write': {
    label: 'Modify server status',
    riskLevel: 'high',
    description: 'Change whitelisted server fields (currently: status). Can suspend or resume servers.',
  },
  'user.read': {
    label: 'Read users',
    riskLevel: 'medium',
    description: 'View usernames, emails, names and role assignments of panel users.',
  },
  'user.write': {
    label: 'Modify users',
    riskLevel: 'low',
    description:
      'Whitelisted user-field writes only. Role assignment is deliberately blocked to prevent privilege escalation.',
  },
  'admin.read': {
    label: 'Read admin routes',
    riskLevel: 'medium',
    description: 'Register API routes that surface admin-level information.',
  },
  'admin.write': {
    label: 'Register admin actions',
    riskLevel: 'high',
    description: 'Register API routes that can change admin-level settings.',
  },
  'plugin.rpc': {
    label: 'Call other plugins',
    riskLevel: 'medium',
    description: 'Invoke APIs exposed by other installed plugins.',
  },
};

const PERMISSION_TOKEN_RE = /^[a-zA-Z0-9_.*-]{1,64}$/;

/**
 * Normalize a declared permission list: trim, validate token shape, dedupe,
 * preserve order, drop empties. Invalid tokens are discarded so a malformed
 * manifest cannot smuggle surprising capability strings.
 */
export function normalizePermissionList(permissions: unknown): string[] {
  if (!Array.isArray(permissions)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of permissions) {
    if (typeof raw !== 'string') continue;
    const token = raw.trim();
    if (!token || !PERMISSION_TOKEN_RE.test(token) || seen.has(token)) continue;
    seen.add(token);
    result.push(token);
  }
  return result;
}

/**
 * True when every requested permission is covered by the accepted set.
 * Mirrors runtime grant semantics: `*` in the accepted set covers everything;
 * requesting `*` requires `*` to have been accepted.
 */
export function isSubsetOf(requested: string[], accepted: string[]): boolean {
  const acceptedSet = new Set(accepted);
  if (!acceptedSet.has('*') && requested.includes('*')) return false;
  return requested.every((perm) => acceptedSet.has(perm) || acceptedSet.has('*'));
}

/**
 * Decide whether enabling this plugin needs a fresh disclaimer acceptance.
 * Returns the first failing reason in priority order.
 */
export function computeConsentState(inputs: ConsentInputs): ConsentState {
  const { hasAcceptance, acceptedDisclaimerVersion, acceptedPluginVersion, acceptedPermissions } = inputs;
  if (!hasAcceptance || acceptedDisclaimerVersion === null) {
    return { consentRequired: true, reason: 'never_accepted' };
  }
  if (acceptedDisclaimerVersion !== DISCLAIMER_VERSION) {
    return { consentRequired: true, reason: 'disclaimer_updated' };
  }
  if (acceptedPluginVersion !== inputs.manifestVersion) {
    return { consentRequired: true, reason: 'plugin_updated' };
  }
  // Null/undefined snapshot with an otherwise-valid acceptance should not be
  // treated as "accepted everything" — force re-acceptance so we capture it.
  if (!Array.isArray(acceptedPermissions)) {
    return { consentRequired: true, reason: 'permissions_grew' };
  }
  if (!isSubsetOf(normalizePermissionList(inputs.manifestPermissions), acceptedPermissions)) {
    return { consentRequired: true, reason: 'permissions_grew' };
  }
  return { consentRequired: false };
}

/**
 * Split declared permissions into granted vs revoked given effective grants.
 * Grants of null mean "everything declared is granted".
 */
export function diffGrants(
  declared: string[],
  grants: string[] | null | undefined,
): { granted: string[]; revoked: string[] } {
  if (grants === null || grants === undefined) {
    return { granted: [...declared], revoked: [] };
  }
  const grantedSet = new Set(grants);
  const granted: string[] = [];
  const revoked: string[] = [];
  for (const perm of declared) {
    (grantedSet.has(perm) ? granted : revoked).push(perm);
  }
  return { granted, revoked };
}

/** Metadata for a permission token, with graceful fallback for unknown scopes. */
export function getPermissionInfo(token: string): PermissionInfo {
  return (
    PERMISSION_INFO[token] ?? {
      label: token,
      riskLevel: 'medium',
      description: 'Custom capability requested by this plugin.',
    }
  );
}

/**
 * Fully-resolved reviewer-facing summary of one declared capability.
 * Precedence: plugin-provided description > builtin copy > generic fallback.
 * This is what consent dialogs and permission reviewers should render.
 */
export interface CapabilitySummary {
  /** Raw permission token (used for grants/revokes). */
  token: string;
  label: string;
  description: string;
  riskLevel: PermissionRiskLevel;
  /** Where the description came from — 'builtin', 'plugin', or 'fallback'. */
  source: 'builtin' | 'plugin' | 'fallback';
}

/** Humanize a raw token for unknown scopes: "tickets.read" → "Tickets read". */
function humanizeToken(token: string): string {
  const words = token.split(/[._-]+/).filter(Boolean).join(' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function resolveCapabilitySummaries(
  declared: string[],
  pluginDescriptions?: Record<string, string> | null,
): CapabilitySummary[] {
  const descriptions = pluginDescriptions ?? {};
  return declared.map((token) => {
    const builtin = PERMISSION_INFO[token];
    const custom = typeof descriptions[token] === 'string' ? descriptions[token].trim() : '';
    if (custom) {
      return { token, label: humanizeToken(token), description: custom, riskLevel: builtin?.riskLevel ?? 'medium', source: 'plugin' as const };
    }
    if (builtin) {
      return { token, label: builtin.label, description: builtin.description, riskLevel: builtin.riskLevel, source: 'builtin' as const };
    }
    return {
      token,
      label: humanizeToken(token),
      description: 'Custom capability requested by this plugin.',
      riskLevel: 'medium' as const,
      source: 'fallback' as const,
    };
  });
}
