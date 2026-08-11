/**
 * Emit dense install / transfer / clone progress to SSE subscribers.
 * Uses both routeToClients (per-server + global) when available.
 */
export type OperationProgressPayload = {
  serverId: string;
  operation: 'install' | 'reinstall' | 'transfer' | 'clone' | string;
  stage: string;
  /** 0–100 when known */
  progress?: number;
  /** free-form detail (bytes, file count, etc.) */
  detail?: string;
  state?: string;
};

export function emitServerOperationProgress(
  wsGateway: any,
  payload: OperationProgressPayload,
): void {
  if (!wsGateway) return;
  const message = {
    type: 'server_operation_progress',
    ...payload,
    timestamp: Date.now(),
  };
  try {
    if (typeof wsGateway.routeToClients === 'function') {
      void wsGateway.routeToClients(payload.serverId, message).catch(() => {});
    } else if (typeof wsGateway.pushToGlobalSubscribers === 'function') {
      wsGateway.pushToGlobalSubscribers('server_operation_progress', message);
    }
  } catch {
    /* non-fatal */
  }
}
