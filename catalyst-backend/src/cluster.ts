import cluster from 'cluster';
import os from 'os';
import { config } from './config.js';
import { initCacheBusPrimary } from './lib/cache-bus.js';
import { isRedisConfigured } from './lib/redis.js';
import { RESTART_MESSAGE_TYPE } from './lib/panel-restart.js';

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

if (cluster.isWorker && config.cluster.backgroundJobOwner) {
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
 * Browser SSE fan-out across workers REQUIRES Redis. Cross-worker event
 * relay goes through `event-bus.publishFanout`, which returns early (no-ops)
 * when REDIS_URL is not set. With WORKERS>1 and no REDIS_URL, an event
 * emitted on one worker is silently lost to every client connected to the
 * other workers — including all background-job emissions (task scheduler,
 * alert service, error logger, backup retention), which run only on the
 * job-owner worker. There is no sequence/replay/ack even with Redis:
 * delivery is best-effort (duplicates possible on reconnect).
 *
 * Process-local caches (agent-auth, permissions, admin-user, node-access):
 * Invalidations are broadcast across workers via the cluster IPC bus in
 * `lib/cache-bus.ts` and additionally via Redis pub/sub when REDIS_URL is
 * set, so multi-host backends stay coherent. Primary relays worker→worker.
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
    const workers = config.server.workers || os.cpus().length;
    // Arm IPC relay before any worker can broadcast cache invalidations.
    initCacheBusPrimary();
    console.warn(
      `[cluster] Primary ${process.pid} forking ${workers} worker(s). ` +
        `Background jobs will run only on the tracked background-job worker. ` +
        `Cache invalidations use cluster IPC with Redis pub/sub across hosts.`,
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
      if (!isRedisConfigured()) {
        // publishFanout()/publishAgentCommand() no-op without REDIS_URL, so
        // every cross-worker realtime event is silently dropped. Repeated so
        // it cannot scroll out of view in a busy log.
        const redisMsg =
          `[cluster] CRITICAL: WORKERS=${workers} but REDIS_URL is not set — cross-worker SSE fan-out is TOTALLY BROKEN.\n` +
          `[cluster] Events emitted on one worker (server state, console, metrics, admin stream, task\n` +
          `[cluster] scheduler, alerts, retention) never reach clients connected to the other workers.\n` +
          `[cluster] Fix: set REDIS_URL (required for WORKERS>1), or run single-process (WORKERS=0/1).`;
        console.error(redisMsg);
        const reminder = setInterval(() => console.error(redisMsg), 60_000);
        reminder.unref?.();
        // Dynamic import keeps the Prisma client out of the primary on the
        // normal (correctly configured) path.
        void import('./services/error-logger.js')
          .then(({ captureSystemError }) =>
            captureSystemError({
              level: 'critical',
              component: 'Cluster',
              message:
                `WORKERS=${workers} without REDIS_URL: cross-worker SSE fan-out is totally broken — ` +
                'events emitted on one worker never reach subscribers on the others. Set REDIS_URL or run single-process.',
              metadata: { workers },
            }),
          )
          .catch(() => { /* error logging must not crash the primary */ });
      }
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

    // A worker asked for a full panel restart (an environment change that needs
    // a reboot): stop every worker and exit the primary, so the container /
    // systemd unit restarts the whole panel with the new environment. Restarting
    // only the requesting worker would leave the others on the old env.
    cluster.on('message', (_worker, message: { type?: string } | undefined) => {
      if (message?.type !== RESTART_MESSAGE_TYPE) return;
      console.warn(
        '[cluster] Panel restart requested — stopping workers and exiting for the supervisor to restart.',
      );
      for (const worker of Object.values(cluster.workers ?? {})) {
        try {
          worker?.process.kill('SIGTERM');
        } catch {
          /* already gone */
        }
      }
      setTimeout(() => process.exit(0), 3_000).unref?.();
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
  const workersEnv = config.server.workers;
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
  if (!config.server.workers) {
    return `pid=${process.pid} (single-process)`;
  }
  const isOwner = backgroundJobWorkerPid !== null && process.pid === backgroundJobWorkerPid;
  return `workerId=${cluster.worker?.id ?? 'n/a'} pid=${process.pid}${isOwner ? ' (background-job owner)' : ''}`;
}
