/**
 * Pure helpers for third-party plugin licensing disclosure.
 *
 * Catalyst is deliberately NOT a licensing authority: it never issues keys,
 * never validates them, and never sees one. Its whole job is to declare the
 * capability in `plugin.json`, disclose it to the admin before enablement, and
 * hand the plugin a stable `ctx.installId`. Everything else is vendor code.
 *
 * Pure logic only (no Prisma/fastify) so it stays trivially unit-testable and
 * reusable from the routes, the loader and the packaging gate.
 */

/** Activation cache lifetime when `licensing.cacheTtlHours` is omitted. */
export const LICENSING_CACHE_TTL_HOURS = 168;

/** Max declared contact hostnames. */
export const LICENSING_CONTACT_HOSTS_MAX = 8;

/** Hostnames a plugin is expected to contact for licensing. */
export function licensingContactHosts(licensing: {
  contact?: string[];
  licenseServer?: string;
} | null | undefined): string[] {
  if (!licensing) return [];
  if (Array.isArray(licensing.contact) && licensing.contact.length > 0) {
    return licensing.contact.slice(0, LICENSING_CONTACT_HOSTS_MAX);
  }
  if (!licensing.licenseServer) return [];
  try {
    return [new URL(licensing.licenseServer).hostname];
  } catch {
    return [];
  }
}

/** Resolved cache lifetime in hours. */
export function licensingCacheTtlHours(licensing: { cacheTtlHours?: number } | null | undefined): number {
  const raw = licensing?.cacheTtlHours;
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 1 && raw <= 8760
    ? raw
    : LICENSING_CACHE_TTL_HOURS;
}

/**
 * Reviewer-facing disclosure rendered verbatim in the safety-consent dialog.
 * Returns null when the plugin declares no licensing block — the common case.
 */
export interface LicensingDisclosure {
  licenseServer: string;
  contactHosts: string[];
  encrypted: boolean;
  failMode: 'closed' | 'open';
  cacheTtlHours: number;
  buyUrl: string | null;
}

export function summarizeLicensing(
  licensing: {
    licenseServer?: string;
    contact?: string[];
    buyUrl?: string;
    encrypted?: boolean;
    failMode?: 'closed' | 'open';
    cacheTtlHours?: number;
  } | null | undefined,
): LicensingDisclosure | null {
  if (!licensing || typeof licensing.licenseServer !== 'string' || !licensing.licenseServer) {
    return null;
  }
  return {
    licenseServer: licensing.licenseServer,
    contactHosts: licensingContactHosts(licensing),
    // `failMode` is meaningless without a key, so it is ignored when the
    // payload is encrypted: an encrypted plugin structurally cannot fall open.
    encrypted: licensing.encrypted === true,
    failMode: licensing.encrypted === true ? 'closed' : (licensing.failMode ?? 'closed'),
    cacheTtlHours: licensingCacheTtlHours(licensing),
    buyUrl: typeof licensing.buyUrl === 'string' && licensing.buyUrl ? licensing.buyUrl : null,
  };
}

/**
 * True when an extracted package directory carries at least one `backend/*.enc`
 * payload. Enforced at install time when `licensing.encrypted` is set, so a
 * mispackaged plugin fails before an admin ever tries to enable it.
 */
export function hasEncryptedPayload(backendFileNames: Iterable<string>): boolean {
  for (const name of backendFileNames) {
    const base = name.split(/[\\/]/).pop() ?? '';
    if (base.endsWith('.enc') && !base.startsWith('.')) return true;
  }
  return false;
}
