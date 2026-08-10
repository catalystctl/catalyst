import cluster from 'cluster';
import os from 'os';
import { initCacheBusPrimary } from './lib/cache-bus.js';

/**
 * Multi-worker bootstrap.
 *
 * When WORKERS > 0, the primary process only forks workers; it does NOT run
 * the HTTP server or background jobs. Each forked worker runs `mainFn`.
 *
 * Background jobs (task scheduler, alert service, retention, stuck-backup
 * watchdog, auto-updater) MUST run on exactly one worker to avoid N-way
 * duplicate execution. Use `shouldRunBackgroundJobs()` for that gate:
 *   - single-process mode (WORKERS unset/0): always true
 *   - clustered mode: only worker with id === 1 (first forked worker)
 *
 * Process-local caches (agent-auth, permissions, admin-user, node-access):
 * There is no Redis. Invalidations are broadcast across workers via the
 * cluster IPC bus in `lib/cache-bus.ts`. Primary relays worker→worker.
 * Brute-force account lockouts and IP rate limits are stored in Postgres
 * (User + AuthLockout) so they are inherently multi-worker-safe.
 *
 * Recommendation: prefer WORKERS=0 / single process for small installs.
 * Multi-worker is supported for HTTP fan-out, but WebSocket agent sessions
 * and requestFromAgent pending maps remain process-local (sticky agents
 * to one worker, or terminate TLS at a sticky LB).
 *
 * Note: cluster.worker.id is 1-based and assigned by the primary. Using id 0
 * is incorrect — Node never assigns worker id 0.
 */
export function bootstrapCluster(mainFn: () => Promise<void>) {
  if (cluster.isPrimary) {
    const workers = Number(process.env.WORKERS) || os.cpus().length;
    // Arm IPC relay before any worker can broadcast cache invalidations.
    initCacheBusPrimary();
    console.log(
      `[cluster] Primary ${process.pid} forking ${workers} worker(s). ` +
        `Background jobs will run only on worker id=1. ` +
        `Cache invalidations use cluster IPC (no Redis).`,
    );
    for (let i = 0; i < workers; i++) cluster.fork();
    cluster.on('exit', (worker, code, signal) => {
      console.error(
        `Worker ${worker.process.pid} (id=${worker.id}) died (code=${code}, signal=${signal}). Restarting...`,
      );
      cluster.fork();
    });
  } else {
    mainFn().catch((err) => {
      console.error(err);
      process.exit(1);
    });
  }
}

/**
 * Returns true when this process should start singleton background jobs.
 *
 * - Non-clustered (WORKERS=0 / unset): always true (single process owns jobs).
 * - Clustered: only the first worker (cluster.worker.id === 1).
 *
 * HTTP request handling still runs on every worker; only schedulers/retention
 * are gated.
 */
export function shouldRunBackgroundJobs(): boolean {
  const workersEnv = Number(process.env.WORKERS || 0);
  if (!workersEnv || workersEnv <= 0) {
    return true;
  }
  // In a worker process, cluster.worker is defined and id is 1-based.
  if (cluster.isWorker && cluster.worker) {
    return cluster.worker.id === 1;
  }
  // Primary never runs mainFn under bootstrapCluster, but be defensive.
  return false;
}

/** Convenience: current worker label for logs. */
export function backgroundJobOwnerLabel(): string {
  if (!Number(process.env.WORKERS || 0)) {
    return `pid=${process.pid} (single-process)`;
  }
  return `workerId=${cluster.worker?.id ?? 'n/a'} pid=${process.pid}`;
}
