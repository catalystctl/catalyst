/**
 * Builds the `install_server` / `reinstall_server` agent command for a server.
 *
 * Shared by `POST /:serverId/install`, `POST /:serverId/reinstall` and the
 * configuration clone so the three paths cannot drift on environment assembly
 * (SERVER_DIR, template defaults, port sync, Pterodactyl compatibility vars).
 */

import {
  injectPterodactylCompatibilityVars,
  normalizeHostIp,
  parseStoredPortBindings,
  patchTemplateForRuntime,
  resolveTemplateImage,
  syncPortEnvironmentVariables,
} from '../routes/servers/_helpers.js';

export type InstallCommandType = 'install_server' | 'reinstall_server';

/**
 * Thrown when the host-network IP cannot be resolved. Callers translate the
 * code into an `apiError` so the route keeps its existing response shape.
 */
export class InstallPayloadError extends Error {
  readonly code: 'SERVER_NETWORK_IP_INVALID';
  constructor(message: string) {
    super(message);
    this.name = 'InstallPayloadError';
    this.code = 'SERVER_NETWORK_IP_INVALID';
  }
}

export type ServerForInstall = {
  id: string;
  uuid: string;
  name: string;
  nodeId: string;
  primaryIp: string | null;
  primaryPort: number;
  allocatedMemoryMb: number;
  allocatedCpuCores: number;
  allocatedDiskMb: number;
  networkMode: string;
  environment: unknown;
  startupCommand?: string | null;
  portBindings: unknown;
  template: {
    image?: string | null;
    startup?: string | null;
    stopCommand?: string | null;
    sendSignalTo?: string | null;
    installImage?: string | null;
    variables?: unknown;
  } | null;
  node: { serverDataDir: string | null; publicAddress: string };
};

/**
 * Assemble the environment + agent command for an install or reinstall.
 *
 * The returned `environment` is also useful for callers that want to persist
 * the fully-resolved environment (it is not written back by this helper).
 */
export function buildInstallCommand(
  server: ServerForInstall,
  type: InstallCommandType,
): { command: Record<string, unknown>; environment: Record<string, string> } {
  const serverDir = server.node.serverDataDir || '/var/lib/catalyst/servers';
  const fullServerDir = `${serverDir}/${server.uuid}`;

  const templateVariables = Array.isArray(server.template?.variables)
    ? (server.template?.variables as Array<{ name?: string; default?: unknown }>)
    : [];
  const templateDefaults = templateVariables.reduce<Record<string, string>>((acc, variable) => {
    if (variable?.name && variable?.default !== undefined) {
      acc[variable.name] = String(variable.default);
    }
    return acc;
  }, {});

  const environment: Record<string, string> = {
    ...templateDefaults,
    ...((server.environment as Record<string, string>) || {}),
    SERVER_DIR: fullServerDir,
  };

  if (server.template?.image) {
    const resolvedImage = resolveTemplateImage(
      server.template as { image: string; images?: unknown; defaultImage?: string | null },
      environment,
    );
    if (resolvedImage) environment.TEMPLATE_IMAGE = resolvedImage;
  }

  if (server.primaryIp && !environment.CATALYST_NETWORK_IP) {
    environment.CATALYST_NETWORK_IP = server.primaryIp;
  }
  if (server.networkMode === 'host' && !environment.CATALYST_NETWORK_IP) {
    try {
      environment.CATALYST_NETWORK_IP = normalizeHostIp(server.node.publicAddress) || '';
    } catch (error: any) {
      throw new InstallPayloadError(error?.message || 'Invalid network IP');
    }
  }

  const runtimeTemplate = patchTemplateForRuntime(server.template ?? {});
  // A per-server startup command overrides the template default on every runtime
  // path (start/restart/rebuild/install). Apply it here so install and
  // reinstall cannot drift from the start route.
  if (server.startupCommand) {
    runtimeTemplate.startup = server.startupCommand;
  }

  const portBindings = parseStoredPortBindings(server.portBindings);
  let syncedEnvironment = syncPortEnvironmentVariables(
    environment,
    server.primaryPort,
    portBindings,
  );
  syncedEnvironment = injectPterodactylCompatibilityVars(
    syncedEnvironment,
    {
      uuid: server.uuid,
      name: server.name,
      primaryIp: server.primaryIp,
      primaryPort: server.primaryPort,
      allocatedMemoryMb: server.allocatedMemoryMb,
      allocatedDiskMb: server.allocatedDiskMb,
    },
    portBindings,
    { startupCommand: runtimeTemplate.startup },
  );

  return {
    environment: syncedEnvironment,
    command: {
      type,
      serverId: server.id,
      serverUuid: server.uuid,
      template: runtimeTemplate,
      environment: syncedEnvironment,
      allocatedMemoryMb: server.allocatedMemoryMb,
      allocatedCpuCores: server.allocatedCpuCores,
      allocatedDiskMb: server.allocatedDiskMb,
      primaryPort: server.primaryPort,
      portBindings,
    },
  };
}
