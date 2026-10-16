/**
 * Derive a template's primary port from a Pterodactyl/Pelican egg.
 *
 * Mirrors `catalyst-backend/src/utils/egg-port.ts` (the frontend cannot import
 * backend sources). Keep the two in sync — the panel pre-fills the create-server
 * dialog from the value this returns.
 *
 * Pterodactyl eggs have no top-level port field: the port is only implied by the
 * egg's own config-file bindings, and the panel allocates a real port per server
 * anyway. Historically the importers guessed by looking for a variable *display
 * name* of SERVER_PORT/PORT/GAME_PORT/QUERY_PORT and fell back to Minecraft's
 * 25565 — which stamped 25565 onto every non-Minecraft egg (Enshrouded listens
 * on 15637, Palworld on 8211, …).
 *
 * Evidence order: explicit `ports` array → literal port in the egg's own
 * config-file bindings → a variable pinned to one value by its rules.
 * Returns null when the egg pins nothing, so callers fall back to the panel
 * default only as a last resort.
 */

const MIN_PORT = 1024;
const MAX_PORT = 65535;

/** Config-file keys that conventionally carry the server's own port. */
const PORT_KEYS = new Set([
  'port',
  'queryport',
  'server-port',
  'serverport',
  'gameport',
  'game-port',
  'listen_port',
  'listenport',
]);

/** Variable display/env names that may carry a port, most specific first. */
const PORT_VAR_NAMES = ['QUERY_PORT', 'SERVER_PORT', 'GAME_PORT', 'PORT'];

function toPort(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value >= MIN_PORT && value <= MAX_PORT ? value : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    // Only a bare integer — "15637/udp" or "{{...}}" is not a port.
    if (!/^\d+$/.test(trimmed)) return null;
    const n = Number(trimmed);
    return n >= MIN_PORT && n <= MAX_PORT ? n : null;
  }
  return null;
}

/** Parse an egg's `config.files`, which may be a JSON string or an object. */
export function parseEggConfigFiles(raw: unknown): Record<string, unknown> | null {
  if (!raw) return null;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
}

/** Does a placeholder value refer to the panel's primary port? */
function isPrimaryPortPlaceholder(value: string): boolean {
  return /\{\{\s*server\.build\.(default\.port|ports\.primary)\s*\}\}/.test(value);
}

/** Rules like "required|integer|in:15637" pin a variable to one value. */
function pinnedPortFromRules(rules: string): number | null {
  for (const rule of rules.split('|')) {
    const trimmed = rule.trim();
    if (!trimmed.toLowerCase().startsWith('in:')) continue;
    const values = trimmed.slice(3).split(',');
    if (values.length !== 1) continue;
    return toPort(values[0].trim());
  }
  return null;
}

export interface EggPortSource {
  variables?: Array<Record<string, unknown>> | undefined;
  config?: Record<string, unknown> | undefined;
  ports?: unknown;
}

/**
 * Derive the template's primary port from the egg itself.
 * @returns the port, or null when the egg does not pin one.
 */
export function deriveTemplatePort(egg: EggPortSource): number | null {
  // 1. Explicit list on the egg (Catalyst extension / newer egg formats).
  if (Array.isArray(egg.ports)) {
    for (const entry of egg.ports) {
      const candidate = toPort(
        entry && typeof entry === 'object'
          ? ((entry as Record<string, unknown>).port ?? (entry as Record<string, unknown>).default)
          : entry,
      );
      if (candidate !== null) return candidate;
    }
  }

  // 2. The egg's own config-file bindings — strongest available evidence.
  const files = parseEggConfigFiles(egg.config?.files);
  if (files) {
    let seesPrimaryPortPlaceholder = false;
    for (const meta of Object.values(files)) {
      if (!meta || typeof meta !== 'object') continue;
      const find = (meta as Record<string, unknown>).find;
      if (!find || typeof find !== 'object') continue;
      for (const [key, value] of Object.entries(find as Record<string, unknown>)) {
        const normalised = key.toLowerCase().replace(/[^a-z]/g, '');
        if (!PORT_KEYS.has(normalised) && !PORT_KEYS.has(key.toLowerCase())) continue;
        if (typeof value !== 'string') continue;
        const literal = toPort(value);
        if (literal !== null) return literal;
        if (isPrimaryPortPlaceholder(value)) seesPrimaryPortPlaceholder = true;
      }
    }
    // A placeholder with no literal means "whatever the panel allocates" — the
    // egg pins no game-specific port, so report null rather than guessing.
    if (seesPrimaryPortPlaceholder) return null;
  }

  // 3. A variable explicitly pinned to a single port value.
  const variables = Array.isArray(egg.variables) ? egg.variables : [];
  for (const name of PORT_VAR_NAMES) {
    for (const variable of variables) {
      if (!variable || typeof variable !== 'object') continue;
      const label = String((variable as Record<string, unknown>).name ?? '');
      const env = String((variable as Record<string, unknown>).env_variable ?? '');
      if (label.toUpperCase() !== name && env.toUpperCase() !== name) continue;
      const pinned = pinnedPortFromRules(String((variable as Record<string, unknown>).rules ?? ''));
      if (pinned !== null) return pinned;
    }
  }

  return null;
}
