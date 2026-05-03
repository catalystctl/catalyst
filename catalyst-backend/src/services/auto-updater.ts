import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import fetch from "node-fetch";
import { captureSystemError } from "./error-logger";

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
	currentVersion: "unknown",
	latestVersion: null,
	updateAvailable: false,
	releaseUrl: null,
	publishedAt: null,
	lastCheckedAt: null,
	isDocker: false,
	autoUpdateEnabled: false,
};

let checkInterval: ReturnType<typeof setInterval> | null = null;

export function getCurrentVersion(): string {
	try {
		const __dirname = path.dirname(fileURLToPath(import.meta.url));
		const pkgPath = path.resolve(__dirname, "..", "..", "..", "package.json");
		const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
		return (pkg.version as string) || "unknown";
	} catch {
		return "unknown";
	}
}

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

export async function performUpdate(logger?: any): Promise<{
	success: boolean;
	message: string;
}> {
	const inDocker = isDocker();

	if (inDocker) {
		const composePath = getComposePath();

		if (logger) {
			logger.info({ composePath }, "Initiating Docker-based auto-update");
		}

		try {
			await new Promise<void>((resolve, reject) => {
				const pull = spawn(
					"docker",
					["compose", "-f", composePath, "pull"],
					{
						stdio: "pipe",
					},
				);

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
			const up = spawn(
				"docker",
				["compose", "-f", composePath, "up", "-d"],
				{
					stdio: "pipe",
					detached: true,
				},
			);

			up.on("error", (err) => {
				if (logger) {
					logger.error({ err }, "docker compose up -d failed");
				}
			});

			return {
				success: true,
				message:
					"Update initiated: images pulled and containers restarting. The panel may be briefly unavailable.",
			};
		} catch (error: any) {
			const message = error?.message || "Docker update failed";
			if (logger) {
				logger.error({ err: error }, "Docker update failed");
			}
			captureSystemError({
				level: "error",
				component: "AutoUpdater",
				message,
				stack: error?.stack,
				metadata: { context: "perform_update" },
			}).catch(() => {});
			return { success: false, message };
		}
	}

	const message =
		"Direct-mode auto-update requires manual restart. Please update Catalyst manually.";
	if (logger) {
		logger.warn(message);
	}
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
