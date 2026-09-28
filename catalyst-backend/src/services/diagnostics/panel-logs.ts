import { spawn } from "node:child_process";
import { redactEnvVar, redactLogText, type RedactionMode } from "../../lib/secret-redaction.js";

/**
 * Panel logs are written to stdout and captured by the container runtime, so
 * the panel has no log file of its own. The backend image ships the container
 * CLIs and compose mounts /var/run/docker.sock, which lets the export read its
 * own container logs for the requested window.
 */

export interface CommandResult {
	stdout: string;
	stderr: string;
	exitCode: number | null;
	/** True when output exceeded the byte budget and collection stopped early. */
	truncated: boolean;
	/** Set when the process could not be started (e.g. CLI not installed). */
	spawnError?: string;
}

export interface CommandOptions {
	timeoutMs: number;
	maxBytes: number;
}

export type CommandRunner = (
	command: string,
	args: string[],
	options: CommandOptions,
) => Promise<CommandResult>;

export interface PanelLogsResult {
	content: string;
	lines: number;
	source: "docker" | "podman" | "unavailable";
	truncated: boolean;
	/** Human-readable reason the logs are missing or partial. */
	warning?: string;
}

/** Collect a child process's stdout/stderr without ever buffering past maxBytes. */
export const runCommand: CommandRunner = (command, args, options) =>
	new Promise<CommandResult>((resolve) => {
		const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
		const stdoutChunks: Buffer[] = [];
		const stderrChunks: Buffer[] = [];
		let stdoutBytes = 0;
		let stderrBytes = 0;
		let truncated = false;
		let settled = false;

		const finish = (result: CommandResult) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve(result);
		};

		const timer = setTimeout(() => {
			truncated = true;
			child.kill("SIGKILL");
		}, options.timeoutMs);

		child.stdout.on("data", (chunk: Buffer) => {
			if (stdoutBytes >= options.maxBytes) {
				truncated = true;
				return;
			}
			const remaining = options.maxBytes - stdoutBytes;
			const slice = chunk.byteLength > remaining ? chunk.subarray(0, remaining) : chunk;
			stdoutChunks.push(slice);
			stdoutBytes += slice.byteLength;
			if (slice.byteLength < chunk.byteLength) truncated = true;
		});
		// stderr is diagnostic only (CLI errors); a small cap is enough.
		child.stderr.on("data", (chunk: Buffer) => {
			if (stderrBytes >= 64 * 1024) return;
			stderrChunks.push(chunk);
			stderrBytes += chunk.byteLength;
		});

		child.on("error", (error) => {
			finish({
				stdout: "",
				stderr: "",
				exitCode: null,
				truncated: false,
				spawnError: error.message,
			});
		});

		child.on("close", (code) => {
			finish({
				stdout: Buffer.concat(stdoutChunks).toString("utf8"),
				stderr: Buffer.concat(stderrChunks).toString("utf8"),
				exitCode: code,
				truncated,
			});
		});
	});

/**
 * Resolve which container to read logs from. `HOSTNAME` is the short container
 * id inside Docker, which is stable even when the container is not named
 * `catalyst-backend` (compose sets `container_name`, other installs may not).
 */
export function resolvePanelContainer(env: Record<string, string | undefined> = process.env): string {
	const explicit = env.DIAGNOSTICS_PANEL_CONTAINER?.trim();
	if (explicit) return explicit;
	const hostname = env.HOSTNAME?.trim();
	if (hostname && /^[0-9a-f]{12,64}$/i.test(hostname)) return hostname;
	return "catalyst-backend";
}

function looksLikeUnknownFlag(stderr: string): boolean {
	return /unknown (flag|shorthand)|invalid|unrecognized|usage:/i.test(stderr);
}

/**
 * Read the panel container's logs for a window. Falls back from docker to
 * podman, and drops `--until` for very old CLIs that predate the flag.
 */
export async function collectPanelLogs(options: {
	since: Date;
	until: Date;
	redaction?: RedactionMode;
	maxBytes?: number;
	timeoutMs?: number;
	runner?: CommandRunner;
	env?: Record<string, string | undefined>;
}): Promise<PanelLogsResult> {
	const runner = options.runner ?? runCommand;
	const env = options.env ?? process.env;
	const maxBytes = options.maxBytes ?? 32 * 1024 * 1024;
	const timeoutMs = options.timeoutMs ?? 60_000;
	const container = resolvePanelContainer(env);

	const runtimes: Array<"docker" | "podman"> = env.DIAGNOSTICS_CONTAINER_RUNTIME
		? [env.DIAGNOSTICS_CONTAINER_RUNTIME === "podman" ? "podman" : "docker"]
		: ["docker", "podman"];

	let lastError = "";
	for (const runtime of runtimes) {
		for (const withUntil of [true, false]) {
			const args = [
				"logs",
				"--timestamps",
				"--since",
				options.since.toISOString(),
				...(withUntil ? ["--until", options.until.toISOString()] : []),
				container,
			];
			const result = await runner(runtime, args, { timeoutMs, maxBytes });
			if (result.spawnError) {
				lastError = `${runtime}: ${result.spawnError}`;
				break; // runtime not installed — try the next one
			}
			if (result.exitCode === 0) {
				const content = redactLogText(result.stdout, options.redaction ?? "standard");
				if (!content.trim()) {
					return {
						content,
						lines: 0,
						source: runtime,
						truncated: result.truncated,
						warning: "The panel container produced no log output in this window.",
					};
				}
				return {
					content,
					lines: content.split("\n").length,
					source: runtime,
					truncated: result.truncated,
					warning: result.truncated
						? "Panel logs were truncated at the size cap; narrow the time range for a complete file."
						: undefined,
				};
			}
			lastError = `${runtime}: ${result.stderr.trim() || `exit ${result.exitCode}`}`;
			if (withUntil && looksLikeUnknownFlag(result.stderr)) continue; // retry without --until
			break;
		}
	}

	return {
		content: "",
		lines: 0,
		source: "unavailable",
		truncated: false,
		warning: `Panel logs are unavailable in this deployment (${lastError || "no container runtime found"}).`,
	};
}

/**
 * Dump the panel's own environment. In container installs the `.env` file is
 * not present in the container — these variables ARE the effective config.
 */
export function collectPanelEnvironment(
	redaction: RedactionMode = "standard",
	env: Record<string, string | undefined> = process.env,
): string {
	return Object.keys(env)
		.sort()
		.map((key) => {
			// Identity/path plumbing: useful for support, never a secret.
			if (key === "PATH" || key === "HOSTNAME") return `${key}=${env[key] ?? ""}`;
			return `${key}=${redactEnvVar(key, env[key] ?? "", redaction)}`;
		})
		.join("\n");
}
