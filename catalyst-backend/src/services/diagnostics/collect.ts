import type { PrismaClient } from "@prisma/client";
import type { FileTunnelResponse } from "../file-tunnel.js";
import { getCurrentVersion } from "../../lib/panel-version.js";
import {
	redactEnvContent,
	redactLogText,
	redactValue,
	type RedactionMode,
} from "../../lib/secret-redaction.js";
import { validateAndNormalizePath } from "../../lib/path-validation.js";
import { collectPanelEnvironment, collectPanelLogs, type CommandRunner } from "./panel-logs.js";

/**
 * Troubleshooting export: gathers the last N hours of panel logs, system
 * errors, node (agent) logs and per-server console logs into one redacted ZIP
 * that support can read without shell access to any host.
 *
 * Every section is independent and best-effort — one unreachable node must
 * never abort the whole bundle. Failures are surfaced as `warnings` in the
 * manifest so the recipient knows what is missing rather than assuming silence
 * means "no errors".
 */

export const DIAGNOSTICS_SECTIONS = ["panel", "errors", "nodes", "servers", "env"] as const;
export type DiagnosticsSection = (typeof DIAGNOSTICS_SECTIONS)[number];

/** Agent-side line cap (`MAX_AGENT_LOG_LINES`); the window narrows the slice. */
export const NODE_LOG_LINES = 5000;
export const SERVER_LOG_ROW_CAP = 20_000;
export const SYSTEM_ERROR_CAP = 10_000;
export const MAX_NODE_LOG_BYTES = 8 * 1024 * 1024;
export const MAX_SERVER_LOG_BYTES = 8 * 1024 * 1024;
export const MAX_ENV_BYTES = 512 * 1024;
export const AGENT_TIMEOUT_MS = 25_000;
export const TUNNEL_TIMEOUT_MS = 70_000;
export const GLOBAL_DEADLINE_MS = 150_000;

export interface DiagnosticsNodeTarget {
	id: string;
	name: string;
	online: boolean;
}

export interface DiagnosticsServerTarget {
	id: string;
	name: string;
	uuid: string;
	nodeId: string;
	/** Whether the actor may read server files (required for `.env`). */
	includeEnv: boolean;
	/** When false, skip the `.env` tunnel call instead of waiting for a timeout. */
	nodeOnline?: boolean;
}

export interface DiagnosticsEntry {
	path: string;
	content: Buffer | string;
}

export interface DiagnosticsActor {
	userId: string;
	username?: string;
}

export interface DiagnosticsNodeSummary {
	id: string;
	name: string;
	online: boolean;
	lines: number;
	truncated: boolean;
	error?: string;
}

export interface DiagnosticsServerSummary {
	id: string;
	name: string;
	lines: number;
	truncated: boolean;
	envIncluded: boolean;
	error?: string;
}

export interface DiagnosticsManifest {
	generatedAt: string;
	generatedBy: DiagnosticsActor;
	panel: { version: string; nodeEnv: string; uptimeSeconds: number };
	window: { from: string; to: string; hours: number };
	redaction: RedactionMode;
	sections: {
		panelLogs?: { lines: number; source: string; truncated: boolean };
		panelEnvironment?: { variables: number };
		systemErrors?: { count: number; truncated: boolean };
		nodes?: DiagnosticsNodeSummary[];
		servers?: DiagnosticsServerSummary[];
	};
	warnings: string[];
}

export interface CollectDiagnosticsDeps {
	prisma: PrismaClient;
	wsGateway?: {
		requestFromAgent(nodeId: string, message: unknown, timeoutMs?: number): Promise<unknown>;
	} | null;
	fileTunnel?: {
		queueRequest(
			nodeId: string,
			operation: string,
			serverUuid: string,
			filePath: string,
			data?: Record<string, unknown>,
			uploadData?: Buffer,
		): Promise<FileTunnelResponse>;
	} | null;
	logger?: { warn(obj: unknown, message?: string): void };
}

export interface CollectDiagnosticsOptions {
	from: Date;
	to: Date;
	redaction: RedactionMode;
	sections: Set<DiagnosticsSection>;
	nodes: DiagnosticsNodeTarget[];
	servers: DiagnosticsServerTarget[];
	actor: DiagnosticsActor;
	/** Pinned by tests; defaults to the running process environment. */
	env?: Record<string, string | undefined>;
	/** Injectable clock so tests do not depend on wall time. */
	now?: () => number;
	/** Injectable container-log runner; defaults to spawning docker/podman. */
	panelLogRunner?: CommandRunner;
}

export interface CollectDiagnosticsResult {
	entries: DiagnosticsEntry[];
	manifest: DiagnosticsManifest;
}

/** Reject after `ms` without leaking the loser's late rejection. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
	let timer: ReturnType<typeof setTimeout>;
	const timeout = new Promise<never>((_resolve, reject) => {
		timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
	});
	// The race may already have settled on timeout; swallow the original
	// rejection so it never surfaces as an unhandled promise rejection.
	promise.catch(() => {});
	return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Run async work with bounded concurrency, preserving input order. */
async function mapLimit<T, R>(
	items: T[],
	limit: number,
	fn: (item: T) => Promise<R>,
): Promise<R[]> {
	const results: R[] = new Array(items.length);
	let cursor = 0;
	const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
		while (true) {
			const index = cursor++;
			if (index >= items.length) return;
			results[index] = await fn(items[index]);
		}
	});
	await Promise.all(workers);
	return results;
}

function truncateToBytes(content: string, maxBytes: number): { content: string; truncated: boolean } {
	if (Buffer.byteLength(content, "utf8") <= maxBytes) return { content, truncated: false };
	const slice = Buffer.from(content, "utf8").subarray(0, maxBytes).toString("utf8");
	return { content: `${slice}\n…[truncated at ${maxBytes} bytes]`, truncated: true };
}

/**
 * Drop agent entries outside the window. Agents that predate the `since`/`until`
 * support ignore those fields and return their last N lines regardless, so the
 * panel re-applies the window. Entries with an unparseable timestamp are kept —
 * dropping them would lose real output for a formatting quirk.
 */
function filterNodeLogsToWindow(logs: unknown[], from: Date, to: Date): unknown[] {
	const fromMs = from.getTime();
	const toMs = to.getTime();
	return logs.filter((raw) => {
		const entry = (raw ?? {}) as Record<string, unknown>;
		if (typeof entry.timestamp !== "string") return true;
		const parsed = Date.parse(entry.timestamp);
		if (Number.isNaN(parsed)) return true;
		return parsed >= fromMs && parsed <= toMs;
	});
}

function formatNodeLogs(logs: unknown[], redaction: RedactionMode): string {
	return logs
		.map((raw) => {
			const entry = (raw ?? {}) as Record<string, unknown>;
			const timestamp = typeof entry.timestamp === "string" ? entry.timestamp : "";
			const level = typeof entry.level === "string" ? entry.level : "info";
			const target = typeof entry.target === "string" ? entry.target : "agent";
			const message =
				typeof entry.message === "string" ? entry.message : JSON.stringify(entry);
			return redactLogText(`${timestamp} [${level}] ${target}: ${message}`, redaction);
		})
		.join("\n");
}

interface ServerLogRow {
	stream: string;
	data: string;
	timestamp: Date;
}

function formatServerLogs(rows: ServerLogRow[], redaction: RedactionMode): string {
	return rows
		.map((row) => {
			const data = row.data.replace(/\n+$/, "");
			return redactLogText(
				`[${row.timestamp.toISOString()}] [${row.stream}] ${data}`,
				redaction,
			);
		})
		.join("\n");
}

/**
 * Build the bundle contents. Never throws for a single failing source; those
 * become manifest warnings.
 */
export async function collectDiagnostics(
	deps: CollectDiagnosticsDeps,
	options: CollectDiagnosticsOptions,
): Promise<CollectDiagnosticsResult> {
	const nowMs = options.now ?? Date.now;
	const deadline = nowMs() + GLOBAL_DEADLINE_MS;
	const redaction = options.redaction;
	const env = options.env ?? process.env;
	const warnings: string[] = [];
	const entries: DiagnosticsEntry[] = [];
	const manifest: DiagnosticsManifest = {
		generatedAt: new Date(nowMs()).toISOString(),
		generatedBy: options.actor,
		panel: {
			version: getCurrentVersion(),
			nodeEnv: env.NODE_ENV ?? "unknown",
			uptimeSeconds: Math.round(process.uptime()),
		},
		window: {
			from: options.from.toISOString(),
			to: options.to.toISOString(),
			hours: Math.max(
				0,
				Math.round(((options.to.getTime() - options.from.getTime()) / 3_600_000) * 10) / 10,
			),
		},
		redaction,
		sections: {},
		warnings,
	};

	// ── Panel logs + environment ──────────────────────────────────────────────
	if (options.sections.has("panel")) {
		try {
			const panelLogs = await collectPanelLogs({
				since: options.from,
				until: options.to,
				redaction,
				env,
				runner: options.panelLogRunner,
			});
			entries.push({ path: "panel/logs.txt", content: panelLogs.content });
			manifest.sections.panelLogs = {
				lines: panelLogs.lines,
				source: panelLogs.source,
				truncated: panelLogs.truncated,
			};
			if (panelLogs.warning) warnings.push(panelLogs.warning);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			warnings.push(`Panel logs could not be collected: ${message}`);
			deps.logger?.warn({ err: error }, "Diagnostics: panel log collection failed");
		}
	}

	if (options.sections.has("env")) {
		try {
			const panelEnv = collectPanelEnvironment(redaction, env);
			entries.push({ path: "panel/environment.txt", content: panelEnv });
			manifest.sections.panelEnvironment = {
				variables: panelEnv ? panelEnv.split("\n").length : 0,
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			warnings.push(`Panel environment could not be collected: ${message}`);
		}
	}

	// ── System errors ─────────────────────────────────────────────────────────
	if (options.sections.has("errors")) {
		try {
			const rows = await deps.prisma.systemError.findMany({
				where: { createdAt: { gte: options.from, lte: options.to } },
				orderBy: { createdAt: "desc" },
				take: SYSTEM_ERROR_CAP + 1,
			});
			const truncated = rows.length > SYSTEM_ERROR_CAP;
			const errors = (truncated ? rows.slice(0, SYSTEM_ERROR_CAP) : rows).map((row) => ({
				id: row.id,
				level: row.level,
				component: row.component,
				message: redactLogText(row.message, redaction),
				stack: row.stack ? redactLogText(row.stack, redaction) : null,
				metadata: redactValue(row.metadata, redaction),
				requestId: row.requestId,
				userId: row.userId,
				nodeId: row.nodeId,
				resolved: row.resolved,
				createdAt: row.createdAt.toISOString(),
			}));
			entries.push({
				path: "panel/system-errors.json",
				content: JSON.stringify(
					{
						exportedAt: manifest.generatedAt,
						window: manifest.window,
						count: errors.length,
						truncated,
						errors,
					},
					null,
					2,
				),
			});
			manifest.sections.systemErrors = { count: errors.length, truncated };
			if (truncated) {
				warnings.push(
					`System errors were capped at ${SYSTEM_ERROR_CAP} rows; narrow the window for a complete list.`,
				);
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			warnings.push(`System errors could not be collected: ${message}`);
			deps.logger?.warn({ err: error }, "Diagnostics: system error collection failed");
		}
	}

	// ── Node (agent) logs ─────────────────────────────────────────────────────
	if (options.sections.has("nodes") && options.nodes.length > 0) {
		const nodeResults = await mapLimit(
			options.nodes,
			4,
			async (node): Promise<{ entry: DiagnosticsEntry | null; summary: DiagnosticsNodeSummary }> => {
				const empty: DiagnosticsNodeSummary = {
					id: node.id,
					name: node.name,
					online: node.online,
					lines: 0,
					truncated: false,
				};
				if (!node.online) {
					return { entry: null, summary: { ...empty, error: "node offline" } };
				}
				if (nowMs() > deadline) {
					return { entry: null, summary: { ...empty, error: "skipped: collection deadline reached" } };
				}
				if (!deps.wsGateway) {
					return { entry: null, summary: { ...empty, error: "websocket gateway unavailable" } };
				}
				try {
					const response = (await withTimeout(
						deps.wsGateway.requestFromAgent(
							node.id,
							{
								type: "agent_logs",
								lines: NODE_LOG_LINES,
								// Older agents ignore unknown fields and fall back to `lines`.
								since: options.from.toISOString(),
								until: options.to.toISOString(),
							},
							AGENT_TIMEOUT_MS,
						),
						AGENT_TIMEOUT_MS + 5_000,
						`agent logs for node ${node.id}`,
					)) as { logs?: unknown[] } | null;
					const logs = Array.isArray(response?.logs) ? response.logs : [];
					const truncated = logs.length >= NODE_LOG_LINES;
					const inWindow = filterNodeLogsToWindow(logs, options.from, options.to);
					const { content, truncated: byteTruncated } = truncateToBytes(
						formatNodeLogs(inWindow, redaction),
						MAX_NODE_LOG_BYTES,
					);
					return {
						entry: { path: `nodes/${node.id}.log`, content },
						summary: {
							id: node.id,
							name: node.name,
							online: node.online,
							lines: inWindow.length,
							truncated: truncated || byteTruncated,
						},
					};
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					deps.logger?.warn({ err: error, nodeId: node.id }, "Diagnostics: node log collection failed");
					return { entry: null, summary: { ...empty, error: message } };
				}
			},
		);
		const summaries = nodeResults.map((result) => result.summary);
		for (const result of nodeResults) {
			if (result.entry) entries.push(result.entry);
		}
		manifest.sections.nodes = summaries;
		const failed = summaries.filter((summary) => summary.error);
		if (failed.length > 0) {
			warnings.push(
				`Node logs missing for ${failed.length} of ${options.nodes.length} node(s): ${failed
					.map((summary) => `${summary.name} (${summary.error})`)
					.join(", ")}`,
			);
		}
		if (summaries.some((summary) => summary.truncated)) {
			warnings.push(
				`At least one node hit the log line cap (${NODE_LOG_LINES}); narrow the window for complete output.`,
			);
		}
	}

	// ── Server console logs (+ optional .env) ─────────────────────────────────
	if (options.sections.has("servers") && options.servers.length > 0) {
		const serverResults = await mapLimit(
			options.servers,
			4,
			async (server): Promise<{ entries: DiagnosticsEntry[]; summary: DiagnosticsServerSummary }> => {
				const summary: DiagnosticsServerSummary = {
					id: server.id,
					name: server.name,
					lines: 0,
					truncated: false,
					envIncluded: false,
				};
				const serverEntries: DiagnosticsEntry[] = [];
				try {
					const rows = await deps.prisma.serverLog.findMany({
						where: {
							serverId: server.id,
							timestamp: { gte: options.from, lte: options.to },
						},
						orderBy: [{ timestamp: "asc" }, { id: "asc" }],
						take: SERVER_LOG_ROW_CAP + 1,
					});
					const truncated = rows.length > SERVER_LOG_ROW_CAP;
					const sliced = truncated ? rows.slice(0, SERVER_LOG_ROW_CAP) : rows;
					summary.lines = sliced.length;
					const { content, truncated: byteTruncated } = truncateToBytes(
						formatServerLogs(sliced, redaction),
						MAX_SERVER_LOG_BYTES,
					);
					summary.truncated = truncated || byteTruncated;
					serverEntries.push({ path: `servers/${server.id}/console.log`, content });
				} catch (error) {
					summary.error = error instanceof Error ? error.message : String(error);
					deps.logger?.warn({ err: error, serverId: server.id }, "Diagnostics: server log collection failed");
				}

				if (
					options.sections.has("env") &&
					server.includeEnv &&
					server.nodeOnline !== false &&
					deps.fileTunnel
				) {
					try {
						const normalized = validateAndNormalizePath("/.env", server.uuid, options.actor.userId);
						const response = await withTimeout(
							deps.fileTunnel.queueRequest(server.nodeId, "download", server.uuid, normalized),
							TUNNEL_TIMEOUT_MS,
							`.env fetch for server ${server.id}`,
						);
						const body = response?.body;
						if (response?.success && body && body.length > 0) {
							if (body.length > MAX_ENV_BYTES) {
								warnings.push(
									`Server ${server.name}: .env exceeded ${MAX_ENV_BYTES} bytes and was truncated.`,
								);
							}
							const raw = body.subarray(0, MAX_ENV_BYTES).toString("utf8");
							serverEntries.push({
								path: `servers/${server.id}/.env`,
								content: redactEnvContent(raw, redaction),
							});
							summary.envIncluded = true;
						} else if (response && !response.success) {
							// Most game servers simply have no .env; only a real
							// transport/config failure is worth surfacing.
							const reason = response.error ?? "unavailable";
							if (!/not found|missing|no such|does not exist/i.test(reason)) {
								summary.error = summary.error
									? `${summary.error}; .env: ${reason}`
									: `.env: ${reason}`;
							}
						}
					} catch (error) {
						// A missing .env is the common case, not a failure worth surfacing loudly.
						const message = error instanceof Error ? error.message : String(error);
						deps.logger?.warn({ err: error, serverId: server.id }, "Diagnostics: server .env collection failed");
						summary.error = summary.error ? `${summary.error}; .env: ${message}` : `.env: ${message}`;
					}
				}
				return { entries: serverEntries, summary };
			},
		);
		for (const result of serverResults) entries.push(...result.entries);
		manifest.sections.servers = serverResults.map((result) => result.summary);
		const failed = manifest.sections.servers.filter((summary) => summary.error);
		if (failed.length > 0) {
			warnings.push(
				`Incomplete server data for ${failed.length} of ${options.servers.length} server(s); see manifest.sections.servers.`,
			);
		}
	}

	// ── Human-readable manifest + README ──────────────────────────────────────
	entries.push({
		path: "manifest.json",
		content: JSON.stringify(manifest, null, 2),
	});
	entries.push({
		path: "README.txt",
		content: buildReadme(manifest),
	});

	return { entries, manifest };
}

function buildReadme(manifest: DiagnosticsManifest): string {
	const lines = [
		"Catalyst troubleshooting bundle",
		"===============================",
		"",
		`Generated: ${manifest.generatedAt}`,
		`Window:    ${manifest.window.from}  →  ${manifest.window.to}  (${manifest.window.hours}h)`,
		`Panel:     v${manifest.panel.version} (${manifest.panel.nodeEnv})`,
		`Redaction: ${manifest.redaction}${
			manifest.redaction === "strict"
				? " — secret values, IPs and hostnames are masked"
				: " — secret values are masked; IPs/hostnames are preserved for debugging"
		}`,
		"",
		"Contents",
		"--------",
		"  panel/logs.txt          panel container output for the window",
		"  panel/environment.txt   effective panel configuration (secrets redacted)",
		"  panel/system-errors.json  persisted system errors for the window",
		"  nodes/<nodeId>.log      node agent logs for the window",
		"  servers/<serverId>/console.log  server console output for the window",
		"  servers/<serverId>/.env         server environment file (secrets redacted)",
		"  manifest.json           machine-readable index of everything above",
		"",
	];
	if (manifest.warnings.length > 0) {
		lines.push("Warnings", "--------", ...manifest.warnings.map((warning) => `  - ${warning}`), "");
	}
	lines.push(
		"Review this bundle before sharing it. Redaction covers known secret",
		"patterns, but log contents can still contain customer data.",
		"",
	);
	return lines.join("\n");
}
