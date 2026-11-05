/**
 * Authorization for user-controlled server environment maps.
 *
 * Install and rebuild run template scripts as root, so an arbitrary environment
 * map is not just game configuration: keys such as BASH_ENV and LD_PRELOAD alter
 * process execution. Non-admin callers may set only variables explicitly
 * declared by the template. Administrators, migrations, and internal callers do
 * not use this check and retain their existing trusted behavior.
 */

/** Panel-owned fields which are validated/resolved by their specific flows. */
export const AUTHORIZED_SERVER_ENVIRONMENT_KEYS = new Set([
  'IMAGE_VARIANT',
  'TEMPLATE_IMAGE',
  'CATALYST_NETWORK_IP',
]);

/**
 * Return request keys outside the template's declarations and panel-owned set.
 * Exact names are intentional: imported templates may use lowercase or other
 * unusual names, and a dangerous-key denylist would not cover shell/runtime
 * semantics generally.
 */
export function findDisallowedServerEnvironmentKeys(
  environment: Record<string, string> | undefined,
  templateVariables: unknown,
): string[] {
  if (!environment) return [];

  const allowedNames = authorizedServerEnvironmentNames(templateVariables);
  return Object.keys(environment).filter((name) => !allowedNames.has(name));
}

function authorizedServerEnvironmentNames(templateVariables: unknown): Set<string> {
  const allowedNames = new Set(AUTHORIZED_SERVER_ENVIRONMENT_KEYS);
  if (Array.isArray(templateVariables)) {
    for (const variable of templateVariables) {
      if (!variable || typeof variable !== 'object') continue;
      const name = (variable as { name?: unknown }).name;
      if (typeof name === 'string' && name.length > 0) allowedNames.add(name);
    }
  }
  return allowedNames;
}

/**
 * Who authorized the stored environment to reach a privileged installer.
 *
 * `non-admin` is deliberately different from `system`: a system-owned code path
 * can still be acting on behalf of an ordinary user (configuration clone is the
 * important example). Callers must choose the actor's trust explicitly.
 */
export type ServerEnvironmentExecutionTrust = 'non-admin' | 'admin' | 'migration' | 'system';

/**
 * Resolve the persisted portion of an installer environment.
 *
 * Existing rows predate request-time authorization and may also have been
 * changed directly in the database. Execution therefore cannot trust the route
 * checks which originally wrote them. For a non-admin action, retain only exact
 * template declarations and the separately validated panel-owned fields.
 * Trusted imports/migrations deliberately keep their legacy values.
 *
 * This function handles only stored data. Panel builtins are generated later by
 * buildInstallCommand so they cannot be stripped here or overridden by a stale
 * stored copy of SERVER_DIR/STARTUP/UUID/etc.
 */
export function resolveStoredServerEnvironment(
  environment: unknown,
  templateVariables: unknown,
  trust: ServerEnvironmentExecutionTrust,
): Record<string, string> {
  if (!environment || typeof environment !== 'object' || Array.isArray(environment)) return {};
  const stored = environment as Record<string, string>;
  if (trust !== 'non-admin') return { ...stored };

  const allowedNames = authorizedServerEnvironmentNames(templateVariables);
  return Object.fromEntries(Object.entries(stored).filter(([name]) => allowedNames.has(name)));
}
