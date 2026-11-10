/**
 * Panel-managed server environment keys.
 *
 * A server's environment map mixes three kinds of entry, and only the first is
 * something the panel's raw editor should own:
 *
 *  - template variables (`GAME_VERSION`, `SEED`, …) — the editable ones.
 *  - panel-owned fields the panel derives and keeps in the same map:
 *      IMAGE_VARIANT        the image *choice*: a name from `template.images[]`
 *      TEMPLATE_IMAGE       the image *resolved* from it (`repo:tag`) — what the
 *                           agent actually pulls; recomputed on create, update,
 *                           install and every start, so a hand-edited value is
 *                           discarded on the next write
 *      CATALYST_NETWORK_IP  assigned by the IPAM/network flow
 *
 * Editing TEMPLATE_IMAGE by hand looks meaningful but is not, which is why the
 * editor renders these read-only and the Image card owns the variant choice.
 * Keep this list in step with the backend's
 * `AUTHORIZED_SERVER_ENVIRONMENT_KEYS` (catalyst-backend/src/lib/server-environment.ts).
 */
export const PANEL_MANAGED_ENV_KEYS = [
  'IMAGE_VARIANT',
  'TEMPLATE_IMAGE',
  'CATALYST_NETWORK_IP',
] as const;

const MANAGED = new Set<string>(PANEL_MANAGED_ENV_KEYS);

export function isPanelManagedEnvKey(key: string): boolean {
  return MANAGED.has(key.trim());
}

export interface EnvRow {
  key: string;
  value: string;
}

/** The managed entries of a stored environment, in a stable order. */
export function panelManagedEnvironment(
  environment: Record<string, string> | null | undefined,
): EnvRow[] {
  if (!environment || typeof environment !== 'object') return [];
  return PANEL_MANAGED_ENV_KEYS.filter((key) => key in environment).map((key) => ({
    key,
    value: String(environment[key] ?? ''),
  }));
}

/**
 * Build the environment to send from the editor's rows.
 *
 * Managed keys always come from the stored server state: a row that happens to
 * use one of those names cannot shadow what the panel derived (the backend
 * re-resolves TEMPLATE_IMAGE anyway, so sending a different one only misleads).
 * Everything else follows the rows, so deleting a row removes the variable.
 */
export function buildEnvironmentPayload(
  environment: Record<string, string> | null | undefined,
  rows: EnvRow[],
): Record<string, string> {
  const next: Record<string, string> = {};
  for (const { key, value } of panelManagedEnvironment(environment)) {
    next[key] = value;
  }
  for (const row of rows) {
    const key = row.key.trim();
    if (!key || isPanelManagedEnvKey(key)) continue;
    next[key] = row.value;
  }
  return next;
}
