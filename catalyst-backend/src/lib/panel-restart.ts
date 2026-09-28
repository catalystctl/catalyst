/**
 * Panel restart coordination for environment changes.
 *
 * An env override that needs a restart is only applied on the next boot, so
 * the admin UI offers a "Restart panel" button. This module schedules the
 * restart in a way that works in every supported deployment:
 *
 *  - single process (`WORKERS=0`): graceful SIGTERM; Docker's
 *    `restart: unless-stopped` / systemd `Restart=always` brings it back.
 *  - cluster worker: message the primary, which stops the workers and exits so
 *    the supervisor restarts the whole panel with the new environment.
 *  - standalone (local `pnpm dev`, no supervisor): the process still exits;
 *    the UI warns that a restart must be started manually.
 *
 * `CATALYST_RESTART_SUPERVISED=true` marks an otherwise-undetectable supervisor
 * (bare systemd unit, custom process manager) as restart-capable.
 */
import cluster from "node:cluster";
import { existsSync } from "node:fs";

export const RESTART_MESSAGE_TYPE = "catalyst:restart";

export type RestartStrategy = "cluster" | "supervised" | "standalone";

/** How a restart requested in this process will actually be carried out. */
export function panelRestartStrategy(): RestartStrategy {
	if (cluster.isWorker) return "cluster";
	if (
		process.env.CATALYST_RESTART_SUPERVISED === "true" ||
		process.env.container ||
		existsSync("/.dockerenv") ||
		existsSync("/run/.containerenv")
	) {
		return "supervised";
	}
	return "standalone";
}

/**
 * Ask the process (or, in cluster mode, the primary) to restart. The caller
 * should have sent its HTTP response first; `delayMs` gives it time to flush.
 */
export function schedulePanelRestart(delayMs = 500): void {
	setTimeout(() => {
		if (cluster.isWorker && typeof process.send === "function") {
			try {
				process.send({ type: RESTART_MESSAGE_TYPE });
			} catch {
				process.exit(0);
			}
			// The primary disconnects us; if the message was missed, exit anyway.
			setTimeout(() => process.exit(0), 5_000);
			return;
		}
		process.kill(process.pid, "SIGTERM");
	}, delayMs);
}
