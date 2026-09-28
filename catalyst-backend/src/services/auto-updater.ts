import fs from "fs";
import path from "path";
import { spawn, spawnSync } from "child_process";
import fetch from "node-fetch";
import { captureSystemError } from "./error-logger";
import { getCurrentVersion } from "../lib/panel-version";
import { getAutoUpdateSettings, DEFAULT_AUTO_UPDATE_INTERVAL_MS } from "./auto-update-settings";

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
	/** Apply a new panel release without an admin confirming it. */
	autoUpdateAutoTrigger: boolean;
	/** Panel release-check cadence, in milliseconds. */
	autoUpdateIntervalMs: number;
	/** Whether update polling is currently scheduled in this process. */
	autoUpdatePolling: boolean;
}

/**
 * Coarse progress state for a panel self-update, polled by the frontend
 * while an update runs. `idle` between updates; `pulling` while compose
 * downloads images; `restarting` once `compose up -d` has been launched
 * (the panel goes down briefly); `failed` when the pull/check phase
 * errored (the restarting phase cannot report failure — the process may
 * be killed at any moment during it).
 */
export interface UpdateState {
	state: "idle" | "pulling" | "restarting" | "failed";
	message: string | null;
	startedAt: string | null;
	updatedAt: string | null;
	logs: string[];
}

const MAX_UPDATE_LOG_LINES = 500;

let updateLogs: string[] = [];

function appendUpdateLog(line: string) {
	const ansiPattern = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
	const cleaned = line.replace(ansiPattern, "").trim();
	if (!cleaned) return;
	updateLogs.push(cleaned);
	if (updateLogs.length > MAX_UPDATE_LOG_LINES) {
		updateLogs = updateLogs.slice(updateLogs.length - MAX_UPDATE_LOG_LINES);
	}
	updateState = {
		...updateState,
		logs: [...updateLogs],
		updatedAt: new Date().toISOString(),
	};
}

function appendUpdateChunk(chunk: unknown) {
	const text = String(chunk ?? "");
	const parts = text.split(/\r?\n|\r/);
	for (const part of parts) {
		if (part.trim()) appendUpdateLog(part);
	}
}

function clearUpdateLogs() {
	updateLogs = [];
}

let updateState: UpdateState = {
	state: "idle",
	message: null,
	startedAt: null,
	updatedAt: null,
	logs: [],
};

function setUpdateState(state: UpdateState["state"], message?: string | null) {
	if (state === "pulling") {
		clearUpdateLogs();
	}
	updateState = {
		state,
		message: message ?? null,
		startedAt:
			state === "pulling"
				? new Date().toISOString()
				: updateState.startedAt,
		updatedAt: new Date().toISOString(),
		logs: [...updateLogs],
	};
}

export function getUpdateState(): UpdateState {
	return { ...updateState, logs: [...updateLogs] };
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
	autoUpdateAutoTrigger: false,
	autoUpdateIntervalMs: DEFAULT_AUTO_UPDATE_INTERVAL_MS,
	autoUpdatePolling: false,
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
	const settings = await getAutoUpdateSettings();

	try {
		const response = await fetch(
			"https://api.github.com/repos/catalystctl/catalyst/releases/latest",
			{ signal: AbortSignal.timeout(10_000) },
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
			autoUpdateEnabled: settings.enabled,
			autoUpdateAutoTrigger: settings.autoTrigger,
			autoUpdateIntervalMs: settings.intervalMs,
			autoUpdatePolling: checkInterval !== null,
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
			autoUpdateEnabled: settings.enabled,
			autoUpdateAutoTrigger: settings.autoTrigger,
			autoUpdateIntervalMs: settings.intervalMs,
			autoUpdatePolling: checkInterval !== null,
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
	return resolveComposeContext()?.composePath ?? "/app/docker-compose.yml";
}

export function composePathFromLabels(
	labels: Record<string, string> | null | undefined,
): string | null {
	return composeFilesFromLabels(labels)[0] ?? null;
}

export function composeFilesFromLabels(
	labels: Record<string, string> | null | undefined,
): string[] {
	if (!labels) return [];
	const files = labels["com.docker.compose.project.config_files"];
	if (files) {
		return files
			.split(",")
			.map((file) => file.trim())
			.filter(Boolean);
	}
	const dir = labels["com.docker.compose.project.working_dir"];
	return dir ? [path.join(dir, "docker-compose.yml")] : [];
}

export function formatDockerUpdateError(error: unknown): string {
	const code =
		error && typeof error === "object" && "code" in error
			? error.code
			: undefined;
	if (code === "ENOENT") {
		return (
			"docker CLI is not available in the backend container (spawn docker ENOENT). " +
			"Use a backend image that includes docker-cli and mount /var/run/docker.sock."
		);
	}
	return error instanceof Error ? error.message : "Docker update failed";
}

function dockerBin(): string {
	return process.env.DOCKER_BIN || "docker";
}

function readContainerId(): string | null {
	try {
		const cgroup = fs.readFileSync("/proc/self/cgroup", "utf-8");
		const match = cgroup.match(/([0-9a-f]{64})/);
		if (match?.[1]) return match[1];
	} catch {
		// cgroup may be missing outside Linux
	}
	try {
		const hostname = fs.readFileSync("/etc/hostname", "utf-8").trim();
		if (hostname) return hostname;
	} catch {
		return null;
	}
	return null;
}

export function inspectComposePathFromDocker(): string | null {
	return composePathFromLabels(inspectSelfLabels());
}

function inspectSelfLabels(): Record<string, string> | null {
	const id = readContainerId();
	if (!id) return null;
	const result = spawnSync(
		dockerBin(),
		["inspect", "--format", "{{json .Config.Labels}}", id],
		{ encoding: "utf-8", timeout: 8000 },
	);
	if (result.status !== 0 || !result.stdout) return null;
	try {
		return JSON.parse(result.stdout) as Record<string, string>;
	} catch {
		return null;
	}
}

function resolveComposeContext(): {
	composePath: string;
	composeDir: string;
	composeFiles: string[];
} | null {
	const envPath = process.env.AUTO_UPDATE_DOCKER_COMPOSE_PATH;
	if (envPath && fs.existsSync(envPath)) {
		return {
			composePath: envPath,
			composeDir: path.dirname(envPath),
			composeFiles: [envPath],
		};
	}

	const candidates = [
		"/app/docker-compose.yml",
		path.resolve(process.cwd(), "..", "catalyst-docker", "docker-compose.yml"),
		path.resolve(process.cwd(), "docker-compose.yml"),
	];
	for (const candidate of candidates) {
		if (fs.existsSync(candidate)) {
			return {
				composePath: candidate,
				composeDir: path.dirname(candidate),
				composeFiles: [candidate],
			};
		}
	}

	const labels = inspectSelfLabels();
	const labeledFiles = composeFilesFromLabels(labels);
	if (labeledFiles[0]) {
		const composeDir =
			labels?.["com.docker.compose.project.working_dir"] ||
			path.dirname(labeledFiles[0]);
		return {
			composePath: labeledFiles[0],
			composeDir,
			composeFiles: labeledFiles,
		};
	}

	if (envPath) {
		return {
			composePath: envPath,
			composeDir: path.dirname(envPath),
			composeFiles: [envPath],
		};
	}
	return null;
}

function spawnComposeHelper(
	context: { composePath: string; composeDir: string; composeFiles: string[] },
	args: string[],
	options: { detached?: boolean } = {},
) {
	const fileArgs = context.composeFiles.flatMap((file) => ["-f", file]);
	const nameArgs = options.detached
		? ["--name", "catalyst-apply-update"]
		: [];
	return spawn(
		dockerBin(),
		[
			"run",
			...(options.detached ? ["-d"] : []),
			"--rm",
			...nameArgs,
			"-v",
			"/var/run/docker.sock:/var/run/docker.sock",
			"-v",
			`${context.composeDir}:${context.composeDir}`,
			"-w",
			context.composeDir,
			"docker:cli",
			"compose",
			...fileArgs,
			"--project-directory",
			context.composeDir,
			...args,
		],
		{
			stdio: "pipe",
			detached: options.detached === true,
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

	// Fresh attempt (not already pulling/restarting): start with clean logs
	// so a retry does not mix with the previous run. Ongoing runs keep theirs.
	if (updateState.state === "idle" || updateState.state === "failed") {
		clearUpdateLogs();
	}

	if (inDocker) {
		const context = resolveComposeContext();
		if (!context) {
			const message =
				"Could not find docker-compose.yml. The backend was not started by Docker Compose " +
				"(no com.docker.compose.project.working_dir label) and AUTO_UPDATE_DOCKER_COMPOSE_PATH is unset.";
			logger?.error?.({ composePath: null }, message);
			setUpdateState("failed", message);
			appendUpdateLog(`Update failed: ${message}`);
			return { success: false, message };
		}
		const { composePath } = context;

		logger?.info?.({ composePath }, "Initiating Docker-based auto-update");
		setUpdateState(
			"pulling",
			"Downloading the latest Catalyst images (this can take a few minutes)…",
		);
		appendUpdateLog(`Panel update started (${new Date().toISOString()})`);
		appendUpdateLog(`Compose file: ${composePath}`);
		appendUpdateLog("$ docker compose pull");

		try {
			await new Promise<void>((resolve, reject) => {
				const pull = spawnComposeHelper(context, ["pull"]);

				let stderr = "";

				pull.stdout?.on("data", (data) => {
					appendUpdateChunk(data.toString());
				});

				pull.stderr?.on("data", (data) => {
					const text = data.toString();
					stderr += text;
					appendUpdateChunk(text);
				});

				pull.on("close", (code) => {
					if (code === 0) {
						appendUpdateLog("Pull complete — all images are up to date.");
						resolve();
					} else {
						appendUpdateLog(`Pull failed with exit code ${code}.`);
						reject(
							new Error(
								`docker compose pull exited with code ${code}: ${stderr}`,
							),
						);
					}
				});

				pull.on("error", (err) => {
					appendUpdateLog(`Failed to start pull: ${err.message}`);
					reject(err);
				});
			});

			// Recreating this container kills in-process compose. A sibling
			// docker:cli container bind-mounts the host compose dir and survives.
			setUpdateState(
				"restarting",
				"Images pulled. Restarting containers — the panel will be briefly unavailable.",
			);
			appendUpdateLog("$ docker compose up -d");
			appendUpdateLog("Restarting containers — the panel will go down briefly.");
			const apply = spawnComposeHelper(context, ["up", "-d"], {
				detached: true,
			});
			apply.stdout?.on("data", (data) => {
				appendUpdateChunk(data.toString());
			});
			apply.stderr?.on("data", (data) => {
				appendUpdateChunk(data.toString());
			});
			apply.unref();
			apply.on("error", (err) => {
				appendUpdateLog(`Failed to start restart helper: ${err.message}`);
				logger?.error?.({ err }, "failed to start compose apply helper");
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
			setUpdateState("failed", message);
			appendUpdateLog(`Update failed: ${message}`);
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
	setUpdateState("failed", message);
	appendUpdateLog(`Update failed: ${message}`);
	return { success: false, message };
}

/**
 * One polling tick: refresh the cached status, warn when a release is
 * available and self-update when the admin opted into automatic triggers.
 */
async function runUpdateCheck(logger?: any): Promise<UpdateStatus> {
	let status: UpdateStatus;
	try {
		status = await checkForUpdate(logger);
	} catch (err) {
		logger?.warn?.({ err }, "Update check failed");
		return cachedStatus;
	}

	if (status.updateAvailable && logger) {
		logger.warn(
			{
				currentVersion: status.currentVersion,
				latestVersion: status.latestVersion,
			},
			"A new version of Catalyst is available",
		);
	}
	if (status.updateAvailable && status.autoUpdateAutoTrigger) {
		performUpdate(logger).then((result) => {
			if (logger) {
				logger.info({ result }, "Auto-update triggered");
			}
		}).catch((err) =>
			logger?.warn?.({ err }, "Auto-update trigger failed"),
		);
	}
	return status;
}

/**
 * Start (or restart) release polling with the given cadence.
 *
 * Prefer `applyAutoUpdateScheme`, which reads the cadence from the database and
 * also stops polling when the admin disabled it. This is kept exported for
 * callers that already resolved the interval.
 */
export function scheduleUpdateCheck(intervalMs: number, logger?: any): void {
	if (checkInterval) {
		clearInterval(checkInterval);
		checkInterval = null;
	}

	cachedStatus = { ...cachedStatus, autoUpdatePolling: true };

	// Run initial check
	void runUpdateCheck(logger);

	checkInterval = setInterval(() => {
		void runUpdateCheck(logger);
	}, intervalMs);

	if (logger) {
		logger.info({ intervalMs }, "Auto-update check scheduled");
	}
}

/**
 * Reconcile release polling with the stored settings. Call on boot and after
 * an admin changes update automation, so a toggle takes effect immediately
 * instead of waiting for the next redeploy.
 */
export async function applyAutoUpdateScheme(logger?: any): Promise<UpdateStatus> {
	let settings;
	try {
		settings = await getAutoUpdateSettings();
	} catch (err) {
		logger?.warn?.({ err }, "Could not read auto-update settings");
		return cachedStatus;
	}

	if (!settings.enabled) {
		stopUpdateCheck();
		cachedStatus = {
			...cachedStatus,
			autoUpdateEnabled: false,
			autoUpdateAutoTrigger: settings.autoTrigger,
			autoUpdateIntervalMs: settings.intervalMs,
			autoUpdatePolling: false,
		};
		logger?.info?.("Auto-update is disabled");
		return cachedStatus;
	}

	scheduleUpdateCheck(settings.intervalMs, logger);
	return cachedStatus;
}

export function getUpdateStatus(): UpdateStatus {
	return cachedStatus;
}

export function stopUpdateCheck(): void {
	if (checkInterval) {
		clearInterval(checkInterval);
		checkInterval = null;
	}
	cachedStatus = { ...cachedStatus, autoUpdatePolling: false };
}
