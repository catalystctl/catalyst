import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import fetch from "node-fetch";
import { captureSystemError } from "./error-logger";
import { getCurrentVersion } from "../lib/panel-version";

export { getCurrentVersion };

export interface UpdateStatus {
	currentVersion: string;
	latestVersion: string | null;
	updateAvailable: boolean;
	releaseUrl: string | null;
	publishedAt: string | null;
	lastCheckedAt: string | null;
	isDocker: boolean;
	autoUpdateEnabled: boolean;
}

let cachedStatus: UpdateStatus = {
	currentVersion: getCurrentVersion(),
	latestVersion: null,
	updateAvailable: false,
	releaseUrl: null,
	publishedAt: null,
	lastCheckedAt: null,
	isDocker: false,
	autoUpdateEnabled: false,
};

let checkInterval: ReturnType<typeof setInterval> | null = null;

function normalizeVersion(version: string): string {
	return version.replace(/^v/, "");
}

function compareVersions(current: string, latest: string): boolean {
	const currentParts = normalizeVersion(current).split(".").map(Number);
	const latestParts = normalizeVersion(latest).split(".").map(Number);
	const maxLen = Math.max(currentParts.length, latestParts.length);
	for (let i = 0; i < maxLen; i++) {
		const cur = currentParts[i] || 0;
		const lat = latestParts[i] || 0;
		if (lat > cur) return true;
		if (lat < cur) return false;
	}
	return false;
}

export async function checkForUpdate(logger?: any): Promise<UpdateStatus> {
	const currentVersion = getCurrentVersion();
	const isDockerEnv = isDocker();

	try {
		const response = await fetch(
			"https://api.github.com/repos/catalystctl/catalyst/releases/latest",
		);
		if (!response.ok) {
			throw new Error(`GitHub API returned ${response.status}`);
		}
		const data = (await response.json()) as any;

		const latestVersion = data.tag_name ? String(data.tag_name) : null;
		const releaseUrl = data.html_url ? String(data.html_url) : null;
		const publishedAt = data.published_at ? String(data.published_at) : null;

		const updateAvailable =
			latestVersion !== null &&
			currentVersion !== "unknown" &&
			compareVersions(currentVersion, latestVersion);

		cachedStatus = {
			currentVersion,
			latestVersion,
			updateAvailable,
			releaseUrl,
			publishedAt,
			lastCheckedAt: new Date().toISOString(),
			isDocker: isDockerEnv,
			autoUpdateEnabled: process.env.AUTO_UPDATE_ENABLED === "true",
		};

		if (logger) {
			logger.info(
				{ currentVersion, latestVersion, updateAvailable },
				"Update check completed",
			);
		}

		return cachedStatus;
	} catch (error: any) {
		if (logger) {
			logger.error({ err: error }, "Failed to check for updates");
		}
		captureSystemError({
			level: "error",
			component: "AutoUpdater",
			message: error?.message || "Failed to check for updates",
			stack: error?.stack,
			metadata: { context: "check_for_update" },
		}).catch(() => {});

		cachedStatus = {
			currentVersion,
			latestVersion: null,
			updateAvailable: false,
			releaseUrl: null,
			publishedAt: null,
			lastCheckedAt: new Date().toISOString(),
			isDocker: isDockerEnv,
			autoUpdateEnabled: process.env.AUTO_UPDATE_ENABLED === "true",
		};

		return cachedStatus;
	}
}

export function isDocker(): boolean {
	try {
		if (fs.existsSync("/.dockerenv")) {
			return true;
		}
		const cgroup = fs.readFileSync("/proc/self/cgroup", "utf-8");
		return cgroup.includes("docker");
	} catch {
		return false;
	}
}

export function getComposePath(): string {
	const envPath = process.env.AUTO_UPDATE_DOCKER_COMPOSE_PATH;
	if (envPath) return envPath;

	const candidates = [
		"/app/docker-compose.yml",
		path.resolve(process.cwd(), "..", "catalyst-docker", "docker-compose.yml"),
		path.resolve(process.cwd(), "docker-compose.yml"),
	];

	for (const candidate of candidates) {
		if (fs.existsSync(candidate)) {
			return candidate;
		}
	}

	return candidates[0]!;
}

export function formatDockerUpdateError(error: unknown): string {
	const err = error as NodeJS.ErrnoException;
	if (err?.code === "ENOENT") {
		return (
			"docker CLI is not available in the backend container (spawn docker ENOENT). " +
			"Use a backend image that includes docker-cli, mount /var/run/docker.sock, " +
			"and set AUTO_UPDATE_DOCKER_COMPOSE_PATH to the compose file bind-mounted at the same host path."
		);
	}
	return err?.message || "Docker update failed";
}

function spawnCompose(
	composePath: string,
	args: string[],
	options: { detached?: boolean } = {},
) {
	const composeDir = path.dirname(composePath);
	const dockerBin = process.env.DOCKER_BIN || "docker";
	return spawn(
		dockerBin,
		["compose", "-f", composePath, "--project-directory", composeDir, ...args],
		{
			stdio: "pipe",
			detached: options.detached === true,
			cwd: composeDir,
			env: process.env,
		},
	);
}

export async function performUpdate(logger?: {
	info?: (obj: unknown, msg?: string) => void;
	error?: (obj: unknown, msg?: string) => void;
	warn?: (msg: string) => void;
}): Promise<{
	success: boolean;
	message: string;
}> {
	const inDocker =
		process.env.AUTO_UPDATE_FORCE_DOCKER === "true" || isDocker();

	if (inDocker) {
		const composePath = getComposePath();

		if (!fs.existsSync(composePath)) {
			const message =
				`docker-compose.yml not found at ${composePath}. ` +
				"Set AUTO_UPDATE_DOCKER_COMPOSE_PATH to the host compose file and bind-mount that directory at the same path.";
			logger?.error?.({ composePath }, message);
			return { success: false, message };
		}

		logger?.info?.({ composePath }, "Initiating Docker-based auto-update");

		try {
			await new Promise<void>((resolve, reject) => {
				const pull = spawnCompose(composePath, ["pull"]);

				let stderr = "";

				pull.stderr?.on("data", (data) => {
					stderr += data.toString();
				});

				pull.on("close", (code) => {
					if (code === 0) {
						resolve();
					} else {
						reject(
							new Error(
								`docker compose pull exited with code ${code}: ${stderr}`,
							),
						);
					}
				});

				pull.on("error", (err) => {
					reject(err);
				});
			});

			// Fire and forget the up -d since this container may restart
			const up = spawnCompose(composePath, ["up", "-d"], { detached: true });

			up.on("error", (err) => {
				logger?.error?.({ err }, "docker compose up -d failed");
			});

			return {
				success: true,
				message:
					"Update initiated: images pulled and containers restarting. The panel may be briefly unavailable.",
			};
		} catch (error: unknown) {
			const message = formatDockerUpdateError(error);
			if (logger?.error) {
				logger.error({ err: error }, "Docker update failed");
			}
			captureSystemError({
				level: "error",
				component: "AutoUpdater",
				message,
				stack: error instanceof Error ? error.stack : undefined,
				metadata: { context: "perform_update" },
			}).catch(() => {});
			return { success: false, message };
		}
	}

	const message =
		"Direct-mode auto-update requires manual restart. Please update Catalyst manually.";
	logger?.warn?.(message);
	return { success: false, message };
}

export function scheduleUpdateCheck(intervalMs: number, logger?: any): void {
	if (process.env.AUTO_UPDATE_ENABLED !== "true") {
		if (logger) {
			logger.info("Auto-update is disabled");
		}
		return;
	}

	if (checkInterval) {
		clearInterval(checkInterval);
		checkInterval = null;
	}

	// Run initial check
	checkForUpdate(logger).then((status) => {
		if (status.updateAvailable && logger) {
			logger.warn(
				{
					currentVersion: status.currentVersion,
					latestVersion: status.latestVersion,
				},
				"A new version of Catalyst is available",
			);
		}
		if (
			status.updateAvailable &&
			process.env.AUTO_UPDATE_AUTO_TRIGGER === "true"
		) {
			performUpdate(logger).then((result) => {
				if (logger) {
					logger.info({ result }, "Auto-update triggered");
				}
			});
		}
	});

	checkInterval = setInterval(() => {
		checkForUpdate(logger).then((status) => {
			if (status.updateAvailable && logger) {
				logger.warn(
					{
						currentVersion: status.currentVersion,
						latestVersion: status.latestVersion,
					},
					"A new version of Catalyst is available",
				);
			}
			if (
				status.updateAvailable &&
				process.env.AUTO_UPDATE_AUTO_TRIGGER === "true"
			) {
				performUpdate(logger).then((result) => {
					if (logger) {
						logger.info({ result }, "Auto-update triggered");
					}
				});
			}
		});
	}, intervalMs);

	if (logger) {
		logger.info({ intervalMs }, "Auto-update check scheduled");
	}
}

export function getUpdateStatus(): UpdateStatus {
	return cachedStatus;
}

export function stopUpdateCheck(): void {
	if (checkInterval) {
		clearInterval(checkInterval);
		checkInterval = null;
	}
}
