import type { Worker } from 'worker_threads';
import type { PluginManifest } from '../types';

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export class PluginWorkerHost {
  private worker: Worker | null = null;
  private pendingRequests = new Map<string, PendingRequest>();
  private initialized = false;
  private shutdownRequested = false;

  constructor(
    private manifest: PluginManifest,
    private pluginDir: string,
    private onCrash?: (err: Error) => void,
  ) {}

  async start(): Promise<void> {
    // The worker currently cannot proxy the host-side PluginBackendContext.
    // Refuse to start rather than allowing a plugin to appear isolated while
    // silently losing host API calls (or falling back in-process elsewhere).
    throw new Error(
      'Isolated plugin execution is unavailable: worker host IPC does not implement PluginBackendContext',
    );
  }

  async callMethod(method: string, args: any[] = [], timeoutMs = 10000): Promise<any> {
    const worker = this.worker;
    if (!worker || !this.initialized) {
      throw new Error('Plugin worker not initialized');
    }

    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`Plugin "${this.manifest.name}" method "${method}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pendingRequests.set(requestId, { resolve, reject, timeout: timer });
      worker.postMessage({ type: 'call', method, args, requestId });
    });
  }

  private handleMessage(msg: any): void {
    if (msg.type === 'result') {
      const pending = this.pendingRequests.get(msg.requestId);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(msg.requestId);
        if (msg.error) pending.reject(new Error(msg.error));
        else pending.resolve(msg.data);
      }
    } else if (msg.type === 'log') {
      const { level, args } = msg;
      const method = ['error', 'warn', 'info', 'debug'].includes(level) ? level : 'info';
      (console as any)[method](`[Plugin:${this.manifest.name}]`, ...args);
    }
  }

  private handleError(err: Error): void {
    console.error(`[PluginWorker:${this.manifest.name}] Error:`, err);
    this.onCrash?.(err);
  }

  private handleExit(code: number): void {
    if (code !== 0 && !this.shutdownRequested) {
      const err = new Error(`Plugin worker "${this.manifest.name}" exited with code ${code}`);
      console.error(`[PluginWorker:${this.manifest.name}] Exit code:`, code);
      this.onCrash?.(err);
    }
  }

  async terminate(): Promise<void> {
    this.shutdownRequested = true;
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Plugin worker is shutting down'));
    }
    this.pendingRequests.clear();
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
    }
    this.initialized = false;
  }
}
