/**
 * Pure runtime derivation shared by every server start/restart path.
 *
 * These four helpers used to live in `routes/servers/_helpers.ts`, which meant
 * only the HTTP power routes could reach them — and the paths that do not go
 * through an HTTP request (cron tasks, crash auto-restart, start after a
 * scheduled backup, replay after a node reboot) each re-implemented a subset by
 * hand. They drifted: only the HTTP start/restart routes resolved
 * `TEMPLATE_IMAGE`, so a server with an image variant restarted by a task pulled
 * the template's default image instead of its variant.
 *
 * They live here (no imports, no I/O) so `services/start-message.ts` can compose
 * one payload for every producer. `_helpers.ts` re-exports them for the routes
 * that still import them by name.
 */

export const MAX_PORT = 65535;

/** Numeric port or null. Accepts the string form the panel round-trips. */
export const parsePortValue = (value: unknown) => {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(parsed)) return null;
  const port = Number(parsed);
  if (!Number.isInteger(port) || port <= 0 || port > MAX_PORT) {
    return null;
  }
  return port;
};

/**
 * Normalise the stored `portBindings` JSON (`{"25565": 25565}`) into a
 * containerPort -> hostPort map, dropping anything that is not a valid port.
 */
export const parseStoredPortBindings = (value: unknown): Record<number, number> => {
  if (!value || typeof value !== "object") {
    return {};
  }
  const bindings: Record<number, number> = {};
  for (const [containerKey, hostValue] of Object.entries(value as Record<string, unknown>)) {
    const containerPort = parsePortValue(containerKey);
    const hostPort = parsePortValue(hostValue);
    if (!containerPort || !hostPort) {
      continue;
    }
    bindings[containerPort] = hostPort;
  }
  return bindings;
};

/**
 * Keep the port-shaped environment variables in step with the allocation the
 * container is actually created with.
 */
export const syncPortEnvironmentVariables = (
  environment: Record<string, string>,
  primaryPort: number,
  portBindings?: Record<number, number>
): Record<string, string> => {
  const syncedEnv = { ...environment };

  // List of common primary port environment variable names
  const primaryPortVarNames = ["SERVER_PORT", "PORT", "GAME_PORT"];

  // Sync primary port variables if they exist in the environment
  for (const varName of primaryPortVarNames) {
    if (syncedEnv[varName] !== undefined) {
      syncedEnv[varName] = String(primaryPort);
    }
  }

  // Handle QUERY_PORT specially - if it's the primary port + 1, update it accordingly
  if (syncedEnv.QUERY_PORT !== undefined && portBindings) {
    // Find if there's a secondary port binding that's primary + 1
    const queryBinding = Object.entries(portBindings).find(
      ([containerPort, hostPort]) => {
        const cp = Number(containerPort);
        const hp = Number(hostPort);
        // Check if this is a query port (typically game port + 1)
        return cp === primaryPort + 1 || hp === primaryPort + 1;
      }
    );
    if (queryBinding) {
      syncedEnv.QUERY_PORT = queryBinding[0]; // Use container port
    }
  }

  return syncedEnv;
};

/** Fill in the runtime-only template fields older rows do not have. */
export const patchTemplateForRuntime = (template: any) => ({
  ...template,
  stopCommand: template.stopCommand ?? 'stop',
  sendSignalTo: template.sendSignalTo ?? 'SIGTERM',
  installImage: template.installImage ?? 'alpine:3.19',
});

/**
 * The image the container must pull: the selected variant (`IMAGE_VARIANT`) or
 * the template default. The agent reads it from `environment.TEMPLATE_IMAGE`
 * and only falls back to `template.image` when that is absent.
 */
export const resolveTemplateImage = (
  template: { image: string; images?: any; defaultImage?: string | null },
  environment: Record<string, string>
) => {
  const options = Array.isArray(template.images) ? template.images : [];
  if (!options.length) return template.image;
  const requested = environment.IMAGE_VARIANT;
  if (requested) {
    const match = options.find((option) => option?.name === requested);
    if (match?.image) {
      return match.image;
    }
  }
  if (template.defaultImage) {
    const defaultMatch = options.find((option) => option?.image === template.defaultImage);
    if (defaultMatch?.image) {
      return defaultMatch.image;
    }
    return template.defaultImage;
  }
  return template.image;
};
