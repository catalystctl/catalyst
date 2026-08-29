import cluster from 'cluster';
import os from 'os';
import { initCacheBusPrimary } from './lib/cache-bus.js';

/**
 * PID of the clustered worker that owns background jobs. Tracked by PID (not
 * worker id) because replacement workers forked after a crash get NEW ids —
 * gating on `id === 1` silently stops all background jobs after any worker
 * death. `null` when unassigned or running non-clustered.
 *
 * Module state is NOT shared across processes: the primary learns the owner
 * PID from cluster.fork() here, while the designated worker seeds its own
 * copy below from the CATALYST_BACKGROUND_JOB_OWNER env flag passed at fork
 * time (deterministic — no IPC race at startup).
 */
export let backgroundJobWorkerPid: number | null = null;

if (cluster.isWorker && process.env.CATALYST_BACKGROUND_JOB_OWNER === '1') {
  backgroundJobWorkerPid = process.pid;
}

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
 *   - clustered mode: only the tracked background-job worker (the first
 *     forked worker; by PID so replacements after a crash inherit the role)
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
    console.warn(
      `[cluster] Primary ${process.pid} forking ${workers} worker(s). ` +
        `Background jobs will run only on the tracked background-job worker. ` +
        `Cache invalidations use cluster IPC (no Redis).`,
    );
    if (workers > 1) {
      // Agent WebSocket sessions and requestFromAgent pending maps are
      // process-local: an agent socket lives in exactly one worker, so HTTP
      // requests that need to reach the agent must land on the same worker.
      // Without sticky routing, node operations will fail intermittently.
      console.error(
        `[cluster] WORKERS=${workers} with agent WebSocket connections is NOT fully supported.\n` +
          `[cluster] Agent sockets live in one worker while API requests round-robin across workers,\n` +
          `[cluster] so sendToAgent()/requestFromAgent() fail when they hit a worker without the socket.\n` +
          `[cluster] Fix: set WORKERS=0 or 1 (recommended), or terminate TLS at a sticky load balancer\n` +
          `[cluster] that routes by nodeId/cookie to a single backend instance.`,
      );
    }
    // The first worker forked owns background jobs. Track it by PID: after a
    // worker dies and is re-forked, the replacement gets a NEW worker.id, so
    // an id-based gate would never match again and background jobs would
    // silently stop. Exactly one worker owns jobs at any time. The flag env
    // var lets the designated worker recognize itself after fork (module
    // state is process-local).
    let backgroundJobsAssigned = false;
    const forkWorker = () => {
      const worker = cluster.fork({
        ...(backgroundJobsAssigned
          ? {}
          : { CATALYST_BACKGROUND_JOB_OWNER: '1' }),
      });
      if (!backgroundJobsAssigned) {
        backgroundJobsAssigned = true;
        backgroundJobWorkerPid = worker.process.pid ?? null;
      }
      return worker;
    };
    for (let i = 0; i < workers; i++) forkWorker();
    cluster.on('exit', (worker, code, signal) => {
      if (worker.process.pid === backgroundJobWorkerPid) {
        backgroundJobWorkerPid = null;
        backgroundJobsAssigned = false;
        console.error(
          `Worker ${worker.process.pid} (id=${worker.id}) owned background jobs — reassigning to its replacement.`,
        );
      }
      console.error(
        `Worker ${worker.process.pid} (id=${worker.id}) died (code=${code}, signal=${signal}). Restarting...`,
      );
      forkWorker();
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
 * - Clustered: only the worker whose PID matches the tracked background-job
 *   owner (initially the first forked worker; re-assigned to the replacement
 *   if that worker dies).
 *
 * HTTP request handling still runs on every worker; only schedulers/retention
 * are gated.
 */
export function shouldRunBackgroundJobs(): boolean {
  const workersEnv = Number(process.env.WORKERS || 0);
  if (!workersEnv || workersEnv <= 0) {
    return true;
  }
  // In a worker process, compare against the PID the primary designated as
  // the background-job owner. Exactly one worker matches at any time.
  if (cluster.isWorker && backgroundJobWorkerPid !== null) {
    return process.pid === backgroundJobWorkerPid;
  }
  // Primary never runs mainFn under bootstrapCluster, but be defensive.
  return false;
}

/** Convenience: current worker label for logs. */
export function backgroundJobOwnerLabel(): string {
  if (!Number(process.env.WORKERS || 0)) {
    return `pid=${process.pid} (single-process)`;
  }
  const isOwner = backgroundJobWorkerPid !== null && process.pid === backgroundJobWorkerPid;
  return `workerId=${cluster.worker?.id ?? 'n/a'} pid=${process.pid}${isOwner ? ' (background-job owner)' : ''}`;
}
