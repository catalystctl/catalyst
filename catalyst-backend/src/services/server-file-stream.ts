/**
 * One place that moves a server's data directory between nodes.
 *
 * Used by the node-transfer route and by full clones so the same-node and
 * cross-node paths cannot drift. Same-node copies go straight to the local
 * agent (`cp -a`); cross-node copies stream a tar from the source agent through
 * the backend to a restoring target agent (the backend never buffers the data).
 */

import crypto from 'crypto';

export interface StreamServerDataOptions {
  /** WebSocket gateway (typed `any` like the rest of the gateway call sites). */
  gateway: any;
  sourceNodeId: string;
  targetNodeId: string;
  /** UUID of the directory being read. */
  sourceUuid: string;
  /** UUID of the directory being written. */
  targetUuid: string;
  /** Server id used for agent-side correlation and logs. */
  serverId: string;
  /** Target node's configured server-data directory. */
  targetServerDataDir: string;
  onStage?: (stage: string, progress: number) => void;
  sameNodeTimeoutMs?: number;
  crossNodeTimeoutMs?: number;
}

export interface StreamServerDataResult {
  sameNode: boolean;
  /** Bytes reported by the agent, when it reports them. */
  bytes: number | null;
}

function numberOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export async function streamServerData(
  opts: StreamServerDataOptions,
): Promise<StreamServerDataResult> {
  const {
    gateway,
    sourceNodeId,
    targetNodeId,
    sourceUuid,
    targetUuid,
    serverId,
    targetServerDataDir,
    onStage,
  } = opts;

  if (!gateway) {
    throw new Error('WebSocket gateway not available');
  }

  if (sourceNodeId === targetNodeId) {
    onStage?.('Copying server files', 40);
    const result = await gateway.requestFromAgent(
      targetNodeId,
      {
        type: 'clone_server_files',
        serverId,
        sourceServerUuid: sourceUuid,
        targetServerUuid: targetUuid,
      },
      opts.sameNodeTimeoutMs ?? 300000,
    );
    if (!result?.success) {
      throw new Error(result?.error || 'Agent file copy failed');
    }
    onStage?.('Finalizing', 85);
    return { sameNode: true, bytes: numberOrNull(result?.bytes) };
  }

  // Cross-node: tar stream from source → backend relay → target extract.
  const requestId = crypto.randomUUID();

  onStage?.('Preparing target node', 20);
  const prepareResult = await gateway.requestFromAgent(
    targetNodeId,
    {
      type: 'prepare_restore_stream',
      requestId,
      serverId,
      serverUuid: targetUuid,
      serverDir: `${targetServerDataDir}/${targetUuid}`,
    },
    15000,
  );
  if (!prepareResult?.success) {
    throw new Error(prepareResult?.error || 'Target agent failed to prepare for file copy');
  }

  onStage?.('Streaming files to target node', 55);
  const relayPromise = gateway.relayBackupStream(sourceNodeId, targetNodeId, requestId);

  // Fire-and-forget: the relay promise resolves when the source reports
  // backup_stream_complete.
  gateway.sendToAgent(sourceNodeId, {
    type: 'start_backup_stream',
    requestId,
    serverId,
    serverUuid: sourceUuid,
  });

  try {
    await relayPromise;
  } catch (err: any) {
    throw new Error(`Backup stream relay failed: ${err?.message ?? err}`);
  }

  onStage?.('Finalizing', 85);
  const finishResult = await gateway.requestFromAgent(
    targetNodeId,
    {
      type: 'finish_restore_stream',
      requestId,
      serverId,
      serverUuid: targetUuid,
    },
    // The target agent answers only after its tar process has exited, i.e.
    // after the whole extracted tree is on disk. 30s is fine for a toy server
    // and far too short for a real one, so allow several minutes.
    opts.crossNodeTimeoutMs ?? 300000,
  );
  if (!finishResult?.success) {
    throw new Error(finishResult?.error || 'Target agent failed to finish file copy');
  }

  return { sameNode: false, bytes: numberOrNull(finishResult?.bytes) };
}
