import type { PluginTabTemplateFilter } from './types';

export interface FilterableServer {
  template?: { name?: string | null } | null;
  environment?: Record<string, string | null | undefined> | null;
}

/**
 * Whether a server plugin tab applies to a server.
 * Tabs without a filter apply everywhere. A tab with a filter applies when
 * the template name matches OR every declared environment value matches.
 * Fails closed (hidden) while the server is still loading and when the
 * declared name pattern does not compile.
 */
export function matchesTemplateFilter(
  filter: PluginTabTemplateFilter | undefined,
  server: FilterableServer | undefined | null,
): boolean {
  if (!filter) return true;
  const hasNamePattern = typeof filter.namePattern === 'string' && filter.namePattern.length > 0;
  const envEntries = filter.env ? Object.entries(filter.env) : [];
  if (!hasNamePattern && envEntries.length === 0) return true;
  if (!server) return false;

  if (hasNamePattern) {
    try {
      if (new RegExp(filter.namePattern as string, 'i').test(server.template?.name ?? '')) {
        return true;
      }
    } catch {
      // Invalid pattern matches nothing; fall through to env matching.
    }
  }

  if (envEntries.length > 0) {
    const env = server.environment ?? {};
    const lowered = new Map(
      Object.entries(env).map(([k, v]) => [k.toLowerCase(), String(v ?? '').trim().toLowerCase()]),
    );
    const allMatch = envEntries.every(
      ([k, v]) => lowered.get(k.toLowerCase()) === String(v).trim().toLowerCase(),
    );
    if (allMatch) return true;
  }

  return false;
}
