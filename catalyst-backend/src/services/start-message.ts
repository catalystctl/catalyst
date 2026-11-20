/**
 * One builder for the agent payloads that (re)create a server container.
 *
 * Why this exists: seven call sites used to hand-write this object and they
 * drifted. Every restart path — manual restart, cron `restart`, start after a
 * scheduled backup — omitted `allocatedSwapMb` and `ioWeight`, and the agent
 * implements `restart_server` as stop + start with the same message
 * (`catalyst-agent/src/websocket_handler/mod.rs:2370` -> `start_server_with_details`),
 * whose defaults are swap 0 and io weight 500. So those restarts silently
 * recreated the container with no swap and default I/O weight. Adding one more
 * field per site is how that drift happened; every producer goes through here
 * instead.
 *
 * Unifying the object was not enough. The inputs to it were derived by hand at
 * each site too, and they diverged the same way: only the HTTP power routes
 * resolved `TEMPLATE_IMAGE` (so a server with an image variant that a task or a
 * crash restarted pulled the template's default image), only some paths folded
 * the per-server startup command over the template's, and only some merged the
 * template's variable defaults. `buildServerStartMessage` below derives all of
 * that from the server row once, and every producer calls it.
 *
 * `autoRestart` stays an explicit input rather than being derived from the
 * server row: some callers intentionally do not send it, and changing which
 * paths enable crash-restart is a separate behaviour decision.
 */

import {
  parseStoredPortBindings,
  patchTemplateForRuntime,
  resolveTemplateImage,
  syncPortEnvironmentVariables,
} from "../lib/template-runtime.js";
import { injectPterodactylCompatibilityVars } from "../utils/pterodactyl-env.js";
import { normalizeHostIp } from "../utils/ipam.js";

/** Where a server's data lives when neither the node nor the env says. */
export const DEFAULT_SERVER_DATA_DIR = "/var/lib/catalyst/servers";

/** Resource/identity fields the builder reads off a server row. */
export interface StartMessageServer {
  id: string;
  uuid: string;
  allocatedMemoryMb: number;
  allocatedCpuCores: number;
  allocatedDiskMb: number;
  allocatedSwapMb?: number | null;
  ioWeight?: number | null;
  /** Canonical cpuset list (`"0-3,6"`); null/undefined = no pinning. */
  cpuAffinity?: string | null;
  primaryPort: number;
  networkMode: string;
  /** Stored bindings, used only when the caller does not pass resolved ones. */
  portBindings?: unknown;
  restartPolicy?: string | null;
  maxCrashCount?: number | null;
}

export interface AgentAutoRestartPolicy {
  enabled: boolean;
  delay: number;
  maxRestarts: number;
  windowSecs: number;
}

export type StartMessageType = "start_server" | "restart_server";

export interface StartMessageInput {
  type: StartMessageType;
  server: StartMessageServer;
  /** Template already patched for runtime (image variant, startup override). */
  template: unknown;
  environment: Record<string, string>;
  /**
   * Resolved container->host port map, or the row's stored `portBindings` JSON.
   * Opaque here: the value is forwarded to the agent as-is, and callers
   * disagree on which form they have (resolved map vs stored column).
   */
  portBindings?: unknown;
  autoRestart?: AgentAutoRestartPolicy;
}

/**
 * Build a `start_server` / `restart_server` message.
 *
 * Every field the agent's container spec consumes is emitted unconditionally,
 * so a caller cannot forget one: memory, CPU cores, disk, swap, io weight, CPU
 * affinity, port, bindings and network mode.
 */
export function buildStartServerMessage(input: StartMessageInput): Record<string, unknown> {
  const { type, server, template, environment, autoRestart } = input;
  const portBindings =
    input.portBindings ??
    (server.portBindings as Record<number, number> | null | undefined) ??
    {};

  const message: Record<string, unknown> = {
    type,
    serverId: server.id,
    serverUuid: server.uuid,
    template,
    environment,
    allocatedMemoryMb: server.allocatedMemoryMb,
    allocatedCpuCores: server.allocatedCpuCores,
    allocatedDiskMb: server.allocatedDiskMb,
    // Absent on old rows: fall back to the agent's own defaults rather than
    // dropping the key (the agent stores the message and replays it on crash).
    allocatedSwapMb: server.allocatedSwapMb ?? 0,
    ioWeight: server.ioWeight ?? 500,
    // Explicit null so "pinned before, unpinned now" is never ambiguous.
    cpuAffinity: server.cpuAffinity ?? null,
    primaryPort: server.primaryPort,
    portBindings,
    networkMode: server.networkMode,
  };

  if (autoRestart) {
    message.autoRestart = autoRestart;
  }

  return message;
}

/** The server row shape the composer needs (Prisma's `include: { node, template }`). */
export interface StartMessageServerRow extends StartMessageServer {
  name: string;
  environment: unknown;
  primaryIp?: string | null;
  startupCommand?: string | null;
  template: Record<string, any>;
  node?: { serverDataDir?: string | null; publicAddress?: string | null } | null;
}

export interface ServerStartMessageInput {
  type: StartMessageType;
  server: StartMessageServerRow;
  /** Pass resolved bindings when the caller already computed them. */
  portBindings?: Record<number, number>;
  /** Crash-restart policy for the agent; omitted by callers that do not send it. */
  autoRestart?: AgentAutoRestartPolicy;
  serverDataDir?: string | null;
}

export interface ServerStartMessageResult {
  /**
   * Message ready for `sendToAgent`. `hostNetworkIpError` is set when the
   * server uses host networking, no IP was already known, and the node's
   * `publicAddress` is not a usable IP: the env var is then omitted (the
   * failure is reported, not turned into a half-built payload) so a caller can
   * answer 400 / skip-and-warn instead of guessing.
   */
  message: Record<string, unknown>;
  hostNetworkIpError?: string;
}

/**
 * Build the (re)start message for a server row, the same way for every caller.
 *
 * The environment is composed in the order the install scripts expect:
 * template variable defaults, then the server's stored values on top, then the
 * runtime additions (`SERVER_DIR`, the resolved `TEMPLATE_IMAGE`, the network
 * IP), then the port variables synced to the allocation and the
 * Pterodactyl-compatible builtins. The template is patched for runtime and the
 * server's own startup command — when it has one — replaces the template's.
 */
export function buildServerStartMessage(input: ServerStartMessageInput): ServerStartMessageResult {
  const { server } = input;
  const template = server.template ?? {};

  const serverDir =
    input.serverDataDir ??
    server.node?.serverDataDir ??
    process.env.SERVER_DATA_DIR ??
    DEFAULT_SERVER_DATA_DIR;

  const environment: Record<string, string> = {};
  const templateVariables = Array.isArray(template.variables) ? (template.variables as any[]) : [];
  for (const variable of templateVariables) {
    if (variable?.name && variable.default !== undefined) {
      environment[variable.name] = String(variable.default);
    }
  }
  for (const [key, value] of Object.entries((server.environment ?? {}) as Record<string, unknown>)) {
    if (value === null || value === undefined) continue;
    environment[key] = typeof value === "string" ? value : String(value);
  }
  environment.SERVER_DIR = `${serverDir}/${server.uuid}`;
  if (template.image) {
    environment.TEMPLATE_IMAGE = resolveTemplateImage(template as any, environment);
  }
  if (server.primaryIp && !environment.CATALYST_NETWORK_IP) {
    environment.CATALYST_NETWORK_IP = server.primaryIp;
  }
  let hostNetworkIpError: string | undefined;
  if (server.networkMode === "host" && !environment.CATALYST_NETWORK_IP) {
    try {
      const normalized = normalizeHostIp(server.node?.publicAddress);
      if (normalized) environment.CATALYST_NETWORK_IP = normalized;
    } catch (error: any) {
      hostNetworkIpError = error?.message ?? "Invalid host network IP";
    }
  }

  const runtimeTemplate = patchTemplateForRuntime(template);
  if (server.startupCommand) {
    runtimeTemplate.startup = server.startupCommand;
  }

  const portBindings = input.portBindings ?? parseStoredPortBindings(server.portBindings);
  const syncedEnvironment = injectPterodactylCompatibilityVars(
    syncPortEnvironmentVariables(environment, server.primaryPort, portBindings),
    {
      uuid: server.uuid,
      name: server.name,
      primaryIp: server.primaryIp ?? null,
      primaryPort: server.primaryPort,
      allocatedMemoryMb: server.allocatedMemoryMb,
      allocatedDiskMb: server.allocatedDiskMb,
    },
    portBindings,
    { startupCommand: runtimeTemplate.startup ?? null },
  );

  return {
    message: buildStartServerMessage({
      type: input.type,
      server,
      template: runtimeTemplate,
      environment: syncedEnvironment,
      portBindings,
      autoRestart: input.autoRestart,
    }),
    hostNetworkIpError,
  };
}
