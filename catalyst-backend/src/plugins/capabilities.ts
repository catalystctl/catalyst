/**
 * Plugin capability gates (B3-2): scoped facades over the raw WebSocket
 * gateway and file tunnel so a plugin with zero declared permissions cannot
 * drive the agent console, broadcast frames, or read/write files on any
 * node. Every check re-reads the plugin's LIVE effective grants so an admin
 * revocation takes effect on the next call.
 *
 * The pure classifiers (`classifyFileTunnelOp`, `canReadFiles`,
 * `canWriteFiles`, `canDriveAgentConsole`) are exported separately so they
 * are trivially unit-testable. `createPluginCapabilities` builds the facades
 * in one place so the gating logic is not duplicated across call sites.
 */

import type { Logger } from 'pino';
import type { WebSocketGateway } from '../websocket/gateway';
import type { PluginFileTunnel, PluginWebSocketHost } from './types';
import { hasGrant } from '../lib/permissions.js';

/**
 * File-tunnel ops that only read server directory contents.
 *
 * This set must match the operations the Rust agent implements in
 * `catalyst-agent/src/file_tunnel.rs` (the `match request.operation` arms).
 * `capability-gates.test.ts` parses those arms and fails if any op is missing
 * here, so the gate cannot silently deny a real operation after an agent
 * change.
 */
const FILE_READ_OPS: ReadonlySet<string> = new Set([
  'list',
  'download',
  'archive-contents',
]);

/**
 * File-tunnel ops that mutate server directory contents (or make the node
 * fetch something). `install-url` is the most privileged: it makes the agent
 * download a URL into the server directory, so it requires the same grant as
 * a write. Same agent-match contract as FILE_READ_OPS.
 */
const FILE_WRITE_OPS: ReadonlySet<string> = new Set([
  'upload',
  'write',
  'create',
  'delete',
  'rename',
  'permissions',
  'compress',
  'decompress',
  'install-url',
]);

/**
 * Classify a file-tunnel operation as read, write, or unknown.
 * Unknown ops fail closed (denied) so a new op the host supports cannot be
 * reached by a plugin until the gate is taught about it.
 */
export function classifyFileTunnelOp(op: string): 'read' | 'write' | 'unknown' {
  if (FILE_READ_OPS.has(op)) return 'read';
  if (FILE_WRITE_OPS.has(op)) return 'write';
  return 'unknown';
}

/**
 * True if the granted permissions let a plugin read files. Satisfied by any
 * of files.read, files.write, server.read, server.write (hasGrant semantics:
 * `*` and admin.write also satisfy).
 */
export function canReadFiles(grants: readonly string[]): boolean {
  return (
    hasGrant(grants, 'files.read') ||
    hasGrant(grants, 'files.write') ||
    hasGrant(grants, 'server.read') ||
    hasGrant(grants, 'server.write')
  );
}

/**
 * True if the granted permissions let a plugin write files. Satisfied by
 * files.write or server.write (hasGrant semantics: `*` and admin.write also
 * satisfy).
 */
export function canWriteFiles(grants: readonly string[]): boolean {
  return hasGrant(grants, 'files.write') || hasGrant(grants, 'server.write');
}

/**
 * True if the granted permissions let a plugin drive an agent console
 * (sendToAgent). Satisfied by console.write or server.write (hasGrant
 * semantics: `*` and admin.write also satisfy).
 */
export function canDriveAgentConsole(grants: readonly string[]): boolean {
  return hasGrant(grants, 'console.write') || hasGrant(grants, 'server.write');
}

/**
 * Build the scoped facades a plugin sees instead of the raw host objects.
 * The facades keep the same property names (`wsGateway`, `fileTunnel`) so
 * existing plugin code is unchanged; only the host internals (`clients`,
 * `agents`, …) are no longer reachable.
 *
 * Grant reads happen live per call (the caller's `getPermissions` is invoked
 * on every operation), so an admin revoke applies immediately.
 *
 * @returns `{ wsGateway, fileTunnel }` — `fileTunnel` is `undefined` when the
 *   host did not provide one, mirroring the optional context field.
 */
export function createPluginCapabilities(
  gateway: WebSocketGateway,
  fileTunnel: PluginFileTunnel | undefined,
  getPermissions: () => string[],
  logger: Logger,
  pluginName: string,
): { wsGateway: PluginWebSocketHost; fileTunnel: PluginFileTunnel | undefined } {
  const wsGateway: PluginWebSocketHost = {
    /** Send a frame to a node agent — gated on console.write / server.write. */
    async sendToAgent(nodeId: string, message: unknown): Promise<boolean> {
      if (!canDriveAgentConsole(getPermissions())) {
        logger.warn(
          { plugin: pluginName, nodeId },
          'Plugin sendToAgent denied: console.write or server.write required',
        );
        throw new Error(
          'Permission denied: console.write or server.write required to drive the agent console',
        );
      }
      return gateway.sendToAgent(nodeId, message);
    },

    /** Broadcast to every authenticated browser client (not gated). */
    broadcastToAuthenticated(message: unknown): void {
      gateway.broadcastToAuthenticated(message);
    },

    /** Send to one authenticated browser client; returns whether it was sent. */
    sendToClient(clientId: string, message: unknown): boolean {
      return gateway.sendToClient(clientId, message);
    },

    /** Register a prefixed plugin WS handler (delegated to the real gateway). */
    registerPluginWsHandler(
      type: string,
      handler: (data: any, clientId?: string, userId?: string) => Promise<void> | void,
      name: string,
    ): void {
      gateway.registerPluginWsHandler(type, handler, name);
    },

    /** Unregister every WS handler owned by a plugin (delegated). */
    unregisterPluginWsHandlers(name: string): void {
      gateway.unregisterPluginWsHandlers(name);
    },
  };

  const scopedFileTunnel: PluginFileTunnel | undefined = fileTunnel
    ? {
        async queueRequest(
          nodeId: string,
          operation: string,
          serverUuid: string,
          filePath: string,
          data?: Record<string, unknown>,
          uploadData?: Buffer,
        ): Promise<{ requestId: string; success: boolean; data?: unknown; error?: string; body?: Buffer }> {
          const grants = getPermissions();
          const cls = classifyFileTunnelOp(operation);
          if (cls === 'read' && !canReadFiles(grants)) {
            logger.warn(
              { plugin: pluginName, nodeId, operation },
              'Plugin file read denied: files.read/files.write/server.read/server.write required',
            );
            throw new Error(
              `Permission denied: file read operation "${operation}" requires files.read, files.write, server.read or server.write`,
            );
          }
          if (cls === 'write' && !canWriteFiles(grants)) {
            logger.warn(
              { plugin: pluginName, nodeId, operation },
              'Plugin file write denied: files.write or server.write required',
            );
            throw new Error(
              `Permission denied: file write operation "${operation}" requires files.write or server.write`,
            );
          }
          if (cls === 'unknown') {
            logger.warn(
              { plugin: pluginName, nodeId, operation },
              'Plugin file operation denied: unknown op fails closed',
            );
            throw new Error(
              `Permission denied: file tunnel operation "${operation}" is not permitted (unknown op)`,
            );
          }
          return fileTunnel.queueRequest(nodeId, operation, serverUuid, filePath, data, uploadData);
        },
      }
    : undefined;

  return { wsGateway, fileTunnel: scopedFileTunnel };
}
