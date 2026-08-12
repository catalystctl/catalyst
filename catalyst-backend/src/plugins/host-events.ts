/**
 * Emit plugin host lifecycle events from core routes.
 * Best-effort — never throws into the request path.
 */
export function emitPluginHostEvent(app: { pluginLoader?: any } | any, event: string, data: unknown): void {
  try {
    const loader = app?.pluginLoader;
    if (loader && typeof loader.emitHostEvent === 'function') {
      loader.emitHostEvent(event, data);
    }
  } catch {
    /* ignore — host events are best-effort */
  }
}

/** Convenience: server status transitions that plugins commonly listen for. */
export function emitServerStatusEvent(
  app: any,
  serverId: string,
  status: string,
  extra: Record<string, unknown> = {},
): void {
  const payload = { serverId, status, ...extra, timestamp: new Date().toISOString() };
  emitPluginHostEvent(app, 'server:status-changed', payload);
  if (status === 'running' || status === 'starting') {
    // `server:started` fires on start accept (starting) and confirmed running.
    // Plugins that need only fully-up should filter status === 'running'.
    emitPluginHostEvent(app, 'server:started', payload);
  }
  if (status === 'stopped' || status === 'stopping') {
    emitPluginHostEvent(app, 'server:stopped', payload);
  }
}
