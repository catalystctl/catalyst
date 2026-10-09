// Load .env before anything else — Bun did this automatically, Node.js does not
import "dotenv/config";

import Fastify from "fastify";
import type { FastifyBaseLogger, FastifyReply, FastifyRequest } from "fastify";
import fastifyCompress from "@fastify/compress";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import fastifyWebsocket from "@fastify/websocket";
import fastifyCors from "@fastify/cors";
import fastifyRateLimit from "@fastify/rate-limit";
import { RedisRateLimitStore } from "./lib/rate-limit-store";
import fastifyHelmet from "@fastify/helmet";
import fastifyMultipart from "@fastify/multipart";
import fastifySwagger from "@fastify/swagger";
import { describeError } from "./utils/describe-error.js";
import { redactUrlForLog } from "./lib/secret-redaction.js";
import fastifySwaggerUi from "@fastify/swagger-ui";
import pino from "pino";
import { prisma } from "./db";
import "./types"; // Load type augmentations
import { WebSocketGateway, setWsGateway } from "./websocket/gateway";
import { setErrorLoggerGateway, captureSystemError } from "./services/error-logger";
import { mapHttpError, apiError } from "./lib/http-error";
import { ErrorCodes } from "./shared-types";
import { applyRemoteCacheInvalidate, onCacheInvalidate } from "./lib/cache-bus";
import { subscribeCacheInvalidations } from "./lib/event-bus";
import { cachedConfig } from "./lib/config-cache";
import { createAuthenticate, enforceRouteKeyScope } from "./middleware/authenticate";
import { hasGrant } from "./lib/permissions";
import { closeRedis, getRedis, getRedisStats } from "./lib/redis";
import { authRoutes } from "./routes/auth";
import { nodeRoutes } from "./routes/nodes";
import { serverRoutes } from "./routes/servers";
import { templateRoutes } from "./routes/templates";
import { nestRoutes } from "./routes/nests";
import { locationRoutes } from "./routes/locations";
import { metricsRoutes } from "./routes/metrics";
import { adminEventsRoutes } from "./routes/admin-events";
import { metricsStreamRoutes } from "./routes/metrics-stream";
import { backupRoutes } from "./routes/backups";
import { adminRoutes } from "./routes/admin";
import { envRoutes } from "./routes/env";
import { roleRoutes } from "./routes/roles";
import { taskRoutes } from "./routes/tasks";
import { bulkServerRoutes } from "./routes/bulk-servers";
import { consoleStreamRoutes } from "./routes/console-stream";
import { sseEventsRoutes } from "./routes/sse-events";
import { WebhookService } from "./services/webhook-service";
import { TaskScheduler } from "./services/task-scheduler";
import { alertRoutes } from "./routes/alerts";
import { dashboardRoutes } from "./routes/dashboard";
import { providerKeyRoutes } from "./routes/provider-keys";
import { setupRoutes } from "./routes/setup";
import { settingsRoutes } from "./routes/settings";
import { resolveApiKeySecret } from "./services/api-key-service";
import { apiKeyRoutes } from "./routes/api-keys";
import { AlertService } from "./services/alert-service";
import { getSecuritySettings, MAX_UPLOAD_MB_CEILING } from "./services/mailer";
import {
	bootstrapCluster,
	shouldRunBackgroundJobs,
	backgroundJobOwnerLabel,
} from "./cluster";
import { createServerBackup } from "./services/create-backup";
import { validateSftpToken } from "./services/sftp-token-manager";
import { startAuditRetention } from "./services/audit-retention";
import { startStatRetention } from "./services/stat-retention";
import { startBackupRetention, startStuckBackupStateWatchdog } from "./services/backup-retention";
import { startLogRetention } from "./services/log-retention";
import { startMetricsRetention } from "./services/metrics-retention";
import { startAuthRetention } from "./services/auth-retention";
import { auth } from "./auth";
import { normalizeHostIp } from "./utils/ipam";
import { PluginLoader } from "./plugins/loader";
import { collectAuthProviders } from "./plugins/auth-providers";
import { DISCLAIMER_VERSION } from "./plugins/safety";
import { pluginRoutes } from "./routes/plugins";
import { FileTunnelService } from "./services/file-tunnel";
import { fileTunnelRoutes } from "./routes/file-tunnel";
import { migrationRoutes } from "./routes/migration";
import { mcpRoutes } from "./routes/mcp";
import { updateRoutes } from "./routes/update";
import { sftpRoutes } from "./routes/sftp";
import { verifyAgentApiKey } from "./lib/agent-auth";
import { getCurrentVersion, normalizePanelVersion } from "./lib/panel-version";
import {
	agentBinaryDir,
	agentMuslAssetName,
	agentReleaseRepo,
	defaultAgentVersion,
	githubReleaseAssetUrl,
	normalizeAgentArch,
	resolveLocalAgentBinary,
	resolveLocalAgentChecksum,
} from "./lib/agent-binary";
import { initializeMetrics, registerMetricsEndpoint, getMetrics } from "./services/metrics-exporter";
import { requestIdMiddleware } from "./middleware/request-id";

// Resolve API_KEY_SECRET early (falls back to BETTER_AUTH_SECRET). Fail fast if
// neither is set so deployment-token / API-key routes never 500 mid-request.
if (process.env.NODE_ENV !== "test") {
	resolveApiKeySecret();
}

const logger = pino(
	process.env.NODE_ENV === "production"
		? { level: process.env.LOG_LEVEL || "info" }
		: {
				transport: {
					target: "pino-pretty",
					options: { colorize: true },
				},
			},
);

// TRUST_PROXY defaults FALSE: client IPs must not be taken from X-Forwarded-*
// unless the process is behind a known proxy. Set TRUST_PROXY=true (or 1/yes/on)
// only when a trusted reverse proxy strips/spoofs headers correctly.
const trustProxyEnv = process.env.TRUST_PROXY;
const trustProxy =
	trustProxyEnv === undefined || trustProxyEnv === ""
		? false
		: ["1", "true", "yes", "on"].includes(trustProxyEnv.toLowerCase());

const app = Fastify({
	// Share the module logger with Fastify so request logs honor LOG_LEVEL and
	// go through pino-pretty in dev (previously `logger: true` built a second,
	// default pino instance that logged every request at info in production).
	// The cast is type-only: pino's Logger satisfies FastifyBaseLogger at
	// runtime, but pino 10's BaseLogger declares msgPrefix which Fastify's
	// structural type does not.
	loggerInstance: logger as FastifyBaseLogger,
	// Request logging (the default incoming/completed lines) is the largest
	// fixed per-request cost once handlers are cached — 2 log lines × every
	// request. Errors still log via the error handler and request.log.* calls.
	// Production defaults to OFF (opt back in with REQUEST_LOGGING=true); dev
	// keeps it ON; REQUEST_LOGGING=false disables everywhere.
	disableRequestLogging:
		process.env.REQUEST_LOGGING === "false" ||
		(process.env.NODE_ENV === "production" &&
			process.env.REQUEST_LOGGING !== "true"),
	bodyLimit: 10485760, // 10MB global — upload/file routes override with a higher per-route limit
	trustProxy,
	// Keep client connections (and idle pooled connections from reverse
	// proxies) alive across Node's 5s default so benchmark/load traffic does
	// not churn TCP handshakes; aligned above the typical nginx 60s upstream
	// idle timeout.
	keepAliveTimeout: 61_000,
});

// Parse application/octet-stream as raw Buffer (used by file tunnel stream responses)
app.addContentTypeParser(
	"application/octet-stream",
	(_request, payload, done) => {
		// Keep the body as a readable stream. Consumers which need a durable body
		// (file tunnel responses) spool it to disk with their own byte limit. The
		// old parser concatenated arbitrarily large agent responses in the heap.
		done(null, payload);
	},
);

app.setErrorHandler((error, request, reply) => {
	const mapped = mapHttpError(error);
	const requestId =
		typeof request.id === "string" && request.id.length > 0
			? request.id
			: undefined;
	const logPayload = {
		err: error,
		statusCode: mapped.status,
		code: mapped.code,
		url: redactUrlForLog(request.url),
		method: request.method,
		requestId,
	};
	if (mapped.status >= 500) {
		logger.error(logPayload, "HTTP error");
	} else {
		logger.warn(logPayload, "HTTP client error");
	}
	// Persist 5xx always. Persist mapped Prisma 4xx as warn so unique-constraint
	// / FK failures remain visible in the admin feed without 401/404 spam.
	if (mapped.status >= 500 || mapped.prismaCode) {
		captureSystemError({
			level: mapped.status >= 500 ? "error" : "warn",
			component: "HTTP",
			message: (error as Error).message || "Internal Server Error",
			stack: (error as Error).stack,
			requestId,
			metadata: {
				statusCode: mapped.status,
				code: mapped.code,
				prismaCode: mapped.prismaCode,
				url: redactUrlForLog(request.url),
				method: request.method,
			},
			userId: (request as { user?: { userId?: string } }).user?.userId,
		}).catch(() => {});
	}
	reply.status(mapped.status).send({
		error: mapped.message,
		code: mapped.code,
		...(requestId ? { requestId } : {}),
	});
});

app.setNotFoundHandler((_request, reply) => {
	reply.status(404).send({ error: "Not Found" });
});

const wsGateway = new WebSocketGateway(prisma, logger);
setWsGateway(wsGateway);
setErrorLoggerGateway(wsGateway);
// Cross-host cache coherence: apply Redis invalidations locally (no-op without REDIS_URL).
subscribeCacheInvalidations((channel, payload) => {
  // Routes into the onCacheInvalidate handlers, including 'server-access' below.
  applyRemoteCacheInvalidate(channel, payload);
}).catch(() => { /* degraded mode */ });
// Keep the gateway's server-access allowlist coherent across workers/hosts:
// a revocation on instance A must not keep streaming on instance B for 30s.
// cache-bus relays invalidations over cluster IPC (same-host multi-worker,
// works WITHOUT Redis) and over Redis pub/sub (cross-host, applied through
// applyRemoteCacheInvalidate above) — this handler covers both paths exactly
// once, plus the mutating worker's own local broadcast.
onCacheInvalidate('server-access', (payload) => {
  wsGateway.invalidateServerAccess(payload.flushAll ? undefined : payload.serverId);
});
// Best-effort Redis connect so the first command does not pay dial latency.
getRedis()?.connect().catch(() => { /* degraded mode */ });
// Bounded observability for Redis outages: at most one warn log / SystemError
// per 30s window (enforced by the client), plus a signal when the circuit opens.
const redisClient = getRedis();
if (redisClient) {
  redisClient.failureEventSink = (event) => {
    const message = event === 'circuit-open'
      ? 'Redis circuit opened — degraded mode until it recovers'
      : 'Redis failure — operating in degraded mode';
    logger.warn({ component: 'Redis', event }, message);
    if (event === 'circuit-open') {
      void captureSystemError({
        component: 'Redis',
        level: 'warn',
        message,
        metadata: { stats: getRedisStats() },
      });
    }
  };
}
const taskScheduler = new TaskScheduler(prisma, logger);
const webhookService = new WebhookService(prisma, logger);
const alertService = new AlertService(prisma, logger);
const fileTunnel = new FileTunnelService(logger);
const pluginLoader = new PluginLoader(
	process.env.PLUGINS_DIR || "/var/lib/catalyst/plugins",
	prisma,
	logger,
	wsGateway,
	app,
	{ hotReload: process.env.PLUGIN_HOT_RELOAD !== "false" },
);
let auditRetentionInterval: ReturnType<typeof setInterval> | null = null;
let statRetentionInterval: ReturnType<typeof setInterval> | null = null;
let backupRetentionInterval: ReturnType<typeof setInterval> | null = null;
let stuckBackupStateInterval: ReturnType<typeof setInterval> | null = null;
let logRetentionInterval: ReturnType<typeof setInterval> | null = null;
let metricsRetentionInterval: ReturnType<typeof setInterval> | null = null;
let authRetentionInterval: ReturnType<typeof setInterval> | null = null;

// Set task executor for the scheduler
taskScheduler.setTaskExecutor({
	executeTask: async (task: any) => {
		const action = task.action;
		if (!action) {
			logger.warn({ taskId: task.id }, "Scheduled task missing action");
			return;
		}
		const server = task.serverId
			? await prisma.server.findUnique({
					where: { id: task.serverId },
					include: { template: true, node: true },
				})
			: null;
		if (!server) {
			logger.warn({ taskId: task.id }, "Scheduled task server not found");
			return;
		}
		if (process.env.SUSPENSION_ENFORCED !== "false" && server.suspendedAt) {
			logger.warn(
				{ taskId: task.id, serverId: server.id },
				"Scheduled task blocked: server suspended",
			);
			return;
		}
		const serverDir =
			process.env.SERVER_DATA_DIR || "/var/lib/catalyst/servers";
		const fullServerDir = `${serverDir}/${server.uuid}`;
		const environment: Record<string, string> = {
			...(server.environment as Record<string, string>),
			SERVER_DIR: fullServerDir,
		};
		if (server.primaryIp && !environment.CATALYST_NETWORK_IP) {
			environment.CATALYST_NETWORK_IP = server.primaryIp;
		}
		if (server.networkMode === "host" && !environment.CATALYST_NETWORK_IP) {
			try {
				const normalized = normalizeHostIp(server.node.publicAddress);
				if (normalized) {
					environment.CATALYST_NETWORK_IP = normalized;
				}
			} catch (error: any) {
				logger.warn(
					{
						nodeId: server.nodeId,
						hostIp: server.node.publicAddress,
						error: error.message,
					},
					"Invalid host network IP",
				);
			}
		}
		if (action === "backup") {
			// Use the same locking / quota / DB-row path as HTTP create-backup.
			const result = await createServerBackup({
				prisma,
				logger,
				server,
				name: typeof task.payload?.name === "string" ? task.payload.name : undefined,
				sendToAgent: (nodeId, message) => wsGateway.sendToAgent(nodeId, message),
				onStarted: async ({ serverId, backupId, backupName }) => {
					if (wsGateway.routeToClients) {
						await wsGateway
							.routeToClients(serverId, {
								type: "backup_started",
								serverId,
								backupId,
								backupName,
								timestamp: Date.now(),
								scheduled: true,
								taskId: task.id,
							})
							.catch(() => {});
					}
				},
			});
			if (!result.ok) {
				logger.warn(
					{ taskId: task.id, serverId: server.id, error: result.error, statusCode: result.statusCode },
					"Scheduled backup failed pre-checks or agent dispatch",
				);
				throw new Error(result.error);
			}
			logger.info(
				{ taskId: task.id, serverId: server.id, backupId: result.backupId },
				"Scheduled backup started",
			);
			return;
		}

		if (action === "command") {
			const command = task.payload?.command;
			if (!command) {
				logger.warn(
					{ taskId: task.id },
					"Scheduled task command missing payload.command",
				);
				return;
			}
			await wsGateway.sendToAgent(server.nodeId, {
				type: "console_input",
				serverId: server.id,
				serverUuid: server.uuid,
				data: `${command}\n`,
			});
			return;
		}

		if (action === "restart") {
			await wsGateway.sendToAgent(server.nodeId, {
				type: "restart_server",
				serverId: server.id,
				serverUuid: server.uuid,
				template: server.template,
				environment,
				allocatedMemoryMb: server.allocatedMemoryMb,
				allocatedCpuCores: server.allocatedCpuCores,
				allocatedDiskMb: server.allocatedDiskMb,
				primaryPort: server.primaryPort,
				portBindings: server.portBindings ?? {},
				networkMode: server.networkMode,
			});
			return;
		}

		if (action === "start") {
			await wsGateway.sendToAgent(server.nodeId, {
				type: "start_server",
				serverId: server.id,
				serverUuid: server.uuid,
				template: server.template,
				environment,
				allocatedMemoryMb: server.allocatedMemoryMb,
				allocatedCpuCores: server.allocatedCpuCores,
				allocatedDiskMb: server.allocatedDiskMb,
				primaryPort: server.primaryPort,
				portBindings: server.portBindings ?? {},
				networkMode: server.networkMode,
			});
			return;
		}

		if (action === "stop") {
			await wsGateway.sendToAgent(server.nodeId, {
				type: "stop_server",
				serverId: server.id,
				serverUuid: server.uuid,
			});
			return;
		}

		logger.warn({ taskId: task.id, action }, "Unknown scheduled task action");
	},
});

// ============================================================================
// MIDDLEWARE
// ============================================================================

const authenticate = createAuthenticate({ logger });

(app as any).authenticate = authenticate;
// Key-scope ceiling: API-key requests must hold the route's declared
// permission(s) via config.requiredPermission (the same route config
// object as rateLimit). App-level preHandler hooks run before
// route-level preHandlers, so routes that authenticate via preHandler
// are covered by the tail-check inside authenticate itself; both
// checks are idempotent.
app.addHook("preHandler", async (request: FastifyRequest, reply: FastifyReply) => {
	enforceRouteKeyScope(request, reply);
});
(app as any).wsGateway = wsGateway;
(app as any).fileTunnel = fileTunnel;
(app as any).taskScheduler = taskScheduler;
(app as any).webhookService = webhookService;
(app as any).alertService = alertService;
// (app as any).auth is set after initAuth() below
(app as any).prisma = prisma;
(app as any).pluginLoader = pluginLoader;

// ============================================================================
// SETUP
// ============================================================================

function getPanelVersion(): string {
	return getCurrentVersion();
}

async function bootstrap() {
	try {
		logger.info(`Catalyst Backend v${getPanelVersion()}`);
		
		// Initialize Prometheus metrics exporter
		const metricsExporter = initializeMetrics();
		
		// Add request ID middleware for distributed tracing
		app.addHook("onRequest", requestIdMiddleware);
		
		// Track HTTP request duration and count for Prometheus
		app.addHook("onRequest", async (request) => {
			(request as any).startTime = process.hrtime.bigint();
		});
		app.addHook("onResponse", async (request, reply) => {
			const startTime = (request as any).startTime;
			if (startTime && metricsExporter) {
				const durationNs = process.hrtime.bigint() - startTime;
				const durationSeconds = Number(durationNs) / 1_000_000_000;
				metricsExporter.recordHttpRequest(
					request.method,
					request.url,
					reply.statusCode,
					durationSeconds,
				);
			}
		});
		
		// Register security plugins
		// Response compression — gzip/br/deflate for smaller payloads
		// Enabled by default; set ENABLE_COMPRESSION=false to disable.
		if (process.env.ENABLE_COMPRESSION !== "false") {
			await app.register(fastifyCompress, {
				global: true,
				encodings: ["gzip", "br", "deflate"],
				threshold: 1024, // Only compress responses > 1KB
				// Never compress SSE or raw binary downloads — curl -f / mid-stream
				// gzip aborts look like HTTP 200 with a truncated body.
				customTypes: /^(?!text\/event-stream)(?!application\/octet-stream).*/i,
			} as any);
			app.addHook("onSend", async (_request, reply, _payload) => {
				const ct = reply.getHeader("content-type")?.toString() ?? "";
				if (
					ct.includes("text/event-stream") ||
					ct.includes("application/octet-stream")
				) {
					reply.removeHeader("content-encoding");
					reply.header("content-encoding", "identity");
				}
			});
		}

		await app.register(fastifyHelmet, {
			contentSecurityPolicy: {
				directives: {
					defaultSrc: ["'self'"],
					styleSrc: ["'self'"],
					scriptSrc: ["'self'"],
					imgSrc: ["'self'", "data:", "https:"],
				},
			},
			crossOriginEmbedderPolicy: false, // Allow WebSocket connections
			hsts:
				process.env.NODE_ENV === "production"
					? { maxAge: 31536000, includeSubDomains: true, preload: true }
					: false,
		});

		// --- Benchmark fair mode: disable rate limiting for max-throughput tests ---
		// Set DISABLE_RATE_LIMIT=1, BENCHMARK_DISABLE_RATE_LIMIT=1, or BENCHMARK_FAIR=1
		// to bypass all rate limiting (global + per-route). Also disables external
		// polling (auto-updater) and background retention noise for fair comparisons.
		// Never honored in production.
		const fairMode =
			process.env.NODE_ENV !== "production" &&
			(process.env.DISABLE_RATE_LIMIT === "1" ||
			process.env.DISABLE_RATE_LIMIT === "true" ||
			process.env.BENCHMARK_DISABLE_RATE_LIMIT === "1" ||
			process.env.BENCHMARK_DISABLE_RATE_LIMIT === "true" ||
			process.env.BENCHMARK_FAIR === "1" ||
			process.env.BENCHMARK_FAIR === "true");
		if (fairMode) {
			logger.warn("BENCHMARK FAIR MODE active: rate limiting disabled, external polling suppressed");
		}

		await app.register(fastifyRateLimit, {
			global: true,
			max: fairMode ? 1_000_000 : 1200, // 1M/min in fair mode = effectively disabled; 1200 normal
			timeWindow: "1 minute",
			// Shared counters across workers/hosts via Redis (atomic INCR+PEXPIRE
			// Lua); the store falls back to per-process memory when Redis is
			// unavailable, so degraded mode keeps single-process behavior.
			store: fairMode ? undefined : RedisRateLimitStore,
			// In fair mode, never block on errors — ensure max throughput
			skipOnError: !!fairMode,
			errorResponseBuilder: (_req, context) => {
				const err = new Error("Too many requests. Please try again later.");
				(err as any).statusCode = context.statusCode;
				return err;
			},
			keyGenerator: (request) => {
				// Key by socket+auth identity, not just IP: NAT/CGNAT clients
				// share IPs, so IP-only buckets let one abuser exhaust the
				// budget for everyone behind the same egress.
				const ip = request.ip || "unknown";
				const socketKey = (() => {
					try {
						const addr = (request.socket as { remoteAddress?: string; remotePort?: number } | undefined);
						return addr?.remotePort ? `${addr.remoteAddress ?? ip}:${addr.remotePort}` : null;
					} catch {
						return null;
					}
				})();
				const authHeader = typeof request.headers.authorization === "string"
					? request.headers.authorization
					: "";
				const xApiKey = typeof request.headers["x-api-key"] === "string"
					? request.headers["x-api-key"]
					: "";
				let apiKeyMaterial = "";
				if (authHeader.toLowerCase().startsWith("bearer ")) {
					const token = authHeader.slice(7).trim();
					if (token.startsWith("catalyst")) {
						apiKeyMaterial = token;
					}
				} else if (xApiKey.startsWith("catalyst")) {
					apiKeyMaterial = xApiKey.trim();
				}
				if (apiKeyMaterial) {
					const keyHash = crypto.createHash("sha256")
						.update(apiKeyMaterial)
						.digest("hex")
						.slice(0, 16);
					// Socket distinguishes connections behind shared IPs; the
					// key hash distinguishes credentials on the same socket pool.
					return socketKey ? `sock:${socketKey}|ip:${ip}|key:${keyHash}` : `ip:${ip}|key:${keyHash}`;
				}
				// Prefer authenticated user id when available (route-level rate limits after auth).
				if (request.user?.userId) {
					return socketKey ? `sock:${socketKey}|user:${request.user.userId}` : `user:${request.user.userId}`;
				}
				return socketKey ? `sock:${socketKey}|ip:${ip}` : `ip:${ip}`;
			},
			allowList: async (request) => {
				// Benchmark fair mode: bypass ALL rate limiting for max throughput
				if (fairMode) return true;

				// Only bypass rate limiting for internal/agent endpoints.
				// User-facing endpoints are rate-limited even when agent headers are present,
				// to prevent abuse if an agent API key is compromised.
				const url = request.url ?? "";
				const isAgentEndpoint =
					url.startsWith("/api/internal/") ||
					url.startsWith("/api/agent/") ||
					url.startsWith("/ws") ||
					url.startsWith("/api/sftp/") ||
					(url.startsWith("/api/servers/") && url.includes("/file-tunnel"));
				if (!isAgentEndpoint) {
					return false;
				}

				// Node agent API keys bypass rate limiting for agent-internal endpoints
				const query =
					(request.query as { nodeId?: string; token?: string }) || {};
				const headerNodeId =
					typeof (
						request.headers["x-catalyst-node-id"] ??
						request.headers["x-catalyst-nodeid"]
					) === "string"
						? (request.headers["x-catalyst-node-id"] ??
							request.headers["x-catalyst-nodeid"])
						: null;
				const headerToken =
					typeof request.headers["x-catalyst-node-token"] === "string"
						? request.headers["x-catalyst-node-token"]
						: typeof request.headers["x-node-api-key"] === "string"
							? request.headers["x-node-api-key"]
							: null;
				const nodeId =
					headerNodeId ??
					(typeof query.nodeId === "string" ? query.nodeId : null);
				const token =
					headerToken ?? (typeof query.token === "string" ? query.token : null);
				if (!nodeId || !token) {
					return false;
				}
				return verifyAgentApiKey(prisma, nodeId as string, token);
			},
		});

		await app.register(fastifyMultipart, {
			limits: {
				fileSize: MAX_UPLOAD_MB_CEILING * 1024 * 1024,
			},
			attachFieldsToBody: false,
		});

		// Register plugins
		const allowedOrigins = [
			...(process.env.CORS_ORIGIN?.split(",").map((s) => s.trim()) ?? []),
			...(process.env.PUBLIC_URL ? [process.env.PUBLIC_URL] : []),
			...(process.env.FRONTEND_URL ? [process.env.FRONTEND_URL] : []),
			// Allow localhost origins only in development
			...(process.env.NODE_ENV !== "production"
				? [
						"http://localhost:3000",
						"http://localhost:5173",
						"http://127.0.0.1:3000",
						"http://127.0.0.1:5173",
						...(process.env.DEV_EXTRA_ORIGINS
							? process.env.DEV_EXTRA_ORIGINS.split(",").map((s) => s.trim())
							: []),
					]
				: []),
		].filter(Boolean) as string[];
		const isAllowedOrigin = (origin?: string) =>
			Boolean(origin && allowedOrigins.includes(origin));

		await app.register(fastifyCors, {
			origin: (origin, callback) => {
				callback(null, isAllowedOrigin(origin));
			},
			methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
			allowedHeaders: [
				"Content-Type",
				"Authorization",
				"X-Requested-With",
				"X-Client-Info",
			],
			credentials: true,
			maxAge: 86400,
		});
		// NOTE: Agent auth headers (X-Catalyst-Node-Id, X-Catalyst-Node-Token, X-Node-Api-Key)
		// are intentionally NOT included in allowedHeaders. Agent requests are server-to-server
		// and never originate from browsers. Exposing them in CORS would allow malicious
		// web pages to probe agent authentication from a user's browser.

		await app.register(fastifySwagger, {
			openapi: {
				info: {
					title: "Catalyst API",
					description: "Catalyst backend API documentation",
					version: "1.0.0",
				},
			},
		});

		await app.register(fastifySwaggerUi, {
			routePrefix: "/docs",
			uiConfig: {
				docExpansion: "list",
				deepLinking: false,
			},
		});
		app.addHook("onRequest", async (request, reply) => {
			if (request.url === "/docs" || request.url.startsWith("/docs/")) {
				if (process.env.DOCS_ENABLED !== "true" && process.env.NODE_ENV === "production") {
					return reply.status(404).send({ error: "Not found" });
				}
			}
		});

		const wsMinPayload = 1 * 1024 * 1024;
		const wsMaxAllowed = 2 * 1024 * 1024;
		const wsConfigured = Number(process.env.WS_MAX_PAYLOAD_BYTES);
		const wsMaxPayload = Number.isFinite(wsConfigured) && wsConfigured > 0
			? Math.min(wsMaxAllowed, Math.max(wsMinPayload, wsConfigured))
			: wsMaxAllowed;
		await app.register(fastifyWebsocket, {
			options: {
				maxPayload: wsMaxPayload,
				idleTimeout: 120_000,
				perMessageDeflate: { threshold: 1024, concurrencyLimit: 4, maxPayload: wsMaxPayload },
			},
			errorHandler: (error) => {
				captureSystemError({
					level: 'error',
					component: 'Index',
					message: (error as Error)?.message || 'WebSocket error handler',
					stack: (error as Error)?.stack,
					metadata: { context: 'websocket' },
				}).catch(() => {});
				logger.error(error, "WebSocket error handler");
			},
		});

		// Health check (liveness only; no version or diagnostic detail).
		// Redis is OPTIONAL: degraded Redis never fails liveness, it is reported.
		// Served at both /health (direct) and /api/health (through the panel's
		// nginx, which only proxies /api, /auth, /ws and /docs).
		// The SELECT 1 result is cached briefly (HEALTH_DB_CACHE_MS, default
		// 2s, 0 disables) because monitoring and load balancers poll this
		// endpoint constantly — a cached healthy probe skips the per-hit DB
		// round trip. Failures are never cached, so an outage is still
		// reported on the very next probe.
		const healthDbCacheMs = Math.max(
			0,
			Number(process.env.HEALTH_DB_CACHE_MS ?? 2000),
		);
		let healthDbOkUntil = 0;
		const healthHandler = async (_request: FastifyRequest, reply: FastifyReply) => {
			const redis = getRedisStats();
			if (healthDbCacheMs > 0 && Date.now() < healthDbOkUntil) {
				return {
					status: "ok",
					redis: redis.configured ? redis.status : "disabled",
				};
			}
			try {
				await prisma.$queryRaw`SELECT 1`;
			} catch (dbError: any) {
				captureSystemError({
					level: 'error',
					component: 'Index',
					message: dbError?.message || 'Health check: database unreachable',
					stack: dbError?.stack,
					metadata: { context: 'health_check' },
				}).catch(() => {});
				return reply.status(503).send({
					status: "unhealthy",
				});
			}
			healthDbOkUntil = Date.now() + healthDbCacheMs;
			return {
				status: "ok",
				redis: redis.configured ? redis.status : "disabled",
			};
		};
		const healthConfig = {
			config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
			schema: {
				summary: "Check panel liveness",
				tags: ["Health"],
				response: {
					200: { type: "object", required: ["status", "redis"], properties: { status: { type: "string", const: "ok" }, redis: { type: "string" } } },
					503: { type: "object", required: ["status"], properties: { status: { type: "string", const: "unhealthy" } } },
				},
			},
		};
		app.get("/health", healthConfig, healthHandler);
		app.get("/api/health", healthConfig, healthHandler);

		// WebSocket gateway - exempt from global rate limiting (authentication happens via handshake)
		app.register(async (app) => {
			app.get(
				"/ws",
				{
					websocket: true,
					config: { rateLimit: { max: 10000, timeWindow: "1 minute" } },
				},
				async (socket, request) => {
					await wsGateway.handleConnection(socket, request);
				},
			);
		});

		// API Routes
		const authRateLimit = {
			config: {
				rateLimit: {
					max: async () => {
						const settings = await getSecuritySettings();
						return settings.authRateLimitMax;
					},
					timeWindow: async () => {
						const settings = await getSecuritySettings();
						return settings.authRateLimitWindowMs;
					},
					allowList: (request) => request.url.startsWith("/api/auth/passkey/"),
				},
			},
		};
		await app.register(authRoutes, { prefix: "/api/auth", ...authRateLimit });
		await app.register(setupRoutes, { prefix: "/api/setup" });
await app.register(settingsRoutes, { prefix: "/api/settings" });
		app.route({
			method: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
			url: "/api/auth/*",
			config: authRateLimit.config,
			handler: async (request, reply) => {
				if (request.method === "OPTIONS") {
					return reply.status(204).send();
				}
				// Routes handled by custom authRoutes above — skip the catch-all proxy.
				// Fastify's route matching already prioritises specific routes over wildcards,
				// but this guard prevents accidentally reaching the proxy on edge cases.
				// Safety net: Fastify already prioritises specific routes registered by
				// the authRoutes plugin over this wildcard catch-all.  This guard is a
				// redundant backstop — if a request somehow reaches the proxy for a path
				// that has a custom handler, return 404 instead of forwarding it to
				// better-auth (which would produce confusing errors).
				//
				// NOTE: This list does NOT need to be exhaustive.  Missing a path here
				// won't cause a bug — Fastify will route to the correct handler anyway.
				// The guard only prevents unauthenticated requests from reaching the
				// Better Auth catch-all when a custom Fastify route exists for the same path.
				//
				// Routes NOT listed here that are registered as Fastify routes:
				//   PATCH /profile, POST /profile/avatar, DELETE /profile/avatar,
				//   PATCH /profile/preferences, POST /profile/sso/unlink,
				//   DELETE /profile/sessions/:id, POST /profile/delete,
				//   GET /profile/audit-log, GET /profile/export, GET /profile/api-keys
				// These are safe because Fastify matches them before the catch-all.
				//
				// Better Auth's catch-all proxy natively handles:
				//   sign-in, sign-up, sign-out, change-password, set-password,
				//   reset-password, 2FA (enable/disable/backup-codes), passkeys,
				//   sessions (list/revoke), SSO (link/list-accounts/unlink-account),
				//   send-verification-email, admin (ban/unban/set-role/list-users/...)
				const customAuthPaths = [
					"/api/auth/login",       // brute-force + permission enrichment
					"/api/auth/register",     // welcome email + duplicate detection
					"/api/auth/me",           // permissions + role enrichment
					"/api/auth/profile",      // cross-cutting aggregation (preferences, accounts, etc.)
					"/api/auth/forgot-password", // email normalization
					"/api/auth/reset-password/validate", // timing-safe token check (POST)
				];
				if (
					customAuthPaths.some(
						(p) => request.url === p || request.url.startsWith(`${p  }/`),
					)
				) {
					return reply.status(404).send({ error: "Not found" });
				}
				const url = new URL(
					request.url,
					`http://${request.headers.host ?? "localhost:3000"}`,
				);
				const headers = new Headers();
				Object.entries(request.headers).forEach(([key, value]) => {
					if (typeof value === "string") {
						headers.append(key, value);
					} else if (Array.isArray(value)) {
						value.forEach((item) => headers.append(key, item));
					}
				});
				const body =
					request.method === "GET" ||
					request.method === "HEAD" ||
					request.body === null
						? undefined
						: typeof request.body === "string"
							? request.body
							: Buffer.isBuffer(request.body)
								? request.body
								: JSON.stringify(request.body);
				const req = new Request(url.toString(), {
					method: request.method,
					headers,
					...(body
						? { body: Buffer.isBuffer(body) ? body.toString() : body }
						: {}),
				});
				const response = await auth.handler(req);
				reply.status(response.status);

				const rawSetCookie =
					typeof (response.headers as any).getSetCookie === "function"
						? (response.headers as any).getSetCookie()
						: response.headers.get("set-cookie");
				const setCookies: string[] = [];
				if (rawSetCookie) {
					if (Array.isArray(rawSetCookie)) {
						setCookies.push(...rawSetCookie);
					} else {
						setCookies.push(
							...rawSetCookie
								.split(/,(?=[^;]+=[^;]+)/)
								.map((cookie) => cookie.trim())
								.filter(Boolean),
						);
					}
				}
				if (url.pathname === "/api/auth/sign-out") {
					setCookies.push(
						"better-auth-passkey=; Max-Age=0; Path=/; SameSite=Lax; HttpOnly",
					);
					// Keep the session cache coherent even if Better Auth's sign-out
					// response was served by another worker or its cookie was stale.
					const { invalidateAuthSessionCache } = await import("./lib/auth-session-cache.js");
					invalidateAuthSessionCache();
				}
				if (setCookies.length > 0) {
					setCookies.forEach((cookie) => reply.header("set-cookie", cookie));
				}
				response.headers.forEach((value, key) => {
					if (key.toLowerCase() === "set-cookie") {
						return;
					}
					reply.header(key, value);
				});
				const text = await response.text();
				reply.send(text || null);
			},
		});
		await app.register(nodeRoutes, { prefix: "/api/nodes" });
		await app.register(serverRoutes, {
			prefix: "/api/servers",
		});
		// SSE console streaming — GET stream + POST command
		await app.register((app) => consoleStreamRoutes(app, wsGateway), {
			prefix: "/api/servers",
		});
		// SSE events: server → client real-time push (state, backups, alerts, EULA)
		await app.register((app) => sseEventsRoutes(app, wsGateway), {
			prefix: "/api/servers",
		});
		await app.register((app) => metricsStreamRoutes(app, wsGateway), {
			prefix: "/api/servers",
		});
		await app.register(templateRoutes, { prefix: "/api/templates" });
		await app.register(nestRoutes, { prefix: "/api/nests" });
		await app.register(locationRoutes, { prefix: "/api/locations" });
		await app.register(metricsRoutes, { prefix: "/api" });
		await app.register(backupRoutes, { prefix: "/api/servers" });
		await app.register(adminRoutes, { prefix: "/api/admin" });
		await app.register(envRoutes, { prefix: "/api/admin/environment" });
		await app.register(updateRoutes, { prefix: "/api/admin/update" });
		await app.register((app) => adminEventsRoutes(app, wsGateway), {
			prefix: "/api/admin/events",
		});
		await app.register(roleRoutes, { prefix: "/api/roles" });
		await app.register(taskRoutes, { prefix: "/api/servers" });
		await app.register(bulkServerRoutes, { prefix: "/api/servers" });
		await app.register(alertRoutes, { prefix: "/api" });
		await app.register(dashboardRoutes, { prefix: "/api/dashboard" });
await app.register(providerKeyRoutes, { prefix: "/api/providers" });
		await app.register(apiKeyRoutes);
		await app.register((app) => pluginRoutes(app, pluginLoader, prisma));
		// File tunnel routes need a high body limit; the panel setting is
		// enforced in FileTunnelService so changing it does not require a restart.
		const fileTunnelBodyLimit = MAX_UPLOAD_MB_CEILING * 1024 * 1024;
		await app.register(
			(app) => fileTunnelRoutes(app, prisma, logger, fileTunnel),
			{ bodyLimit: fileTunnelBodyLimit },
		);

		// Migration routes (Pterodactyl → Catalyst)
		await app.register((app) => migrationRoutes(app));

		// Panel-hosted MCP (Streamable HTTP, stateless). Bearer-key only,
		// master switch in MCP settings; 404s while disabled.
		await app.register(mcpRoutes, { prefix: "/api" });

		// Prometheus metrics endpoint (unauthenticated, for scraping)
		registerMetricsEndpoint(app);

		// Panel + agent version (authenticated; bootstrap uses AGENT_VERSION env or default binary).
		app.get(
			"/api/agent/version",
			{
				schema: { summary: "Get the installed agent version", tags: ["Agent"], response: { 200: { type: "object", required: ["version", "agentVersion", "releaseRepo"], properties: { version: { type: ["string", "null"] }, agentVersion: { type: ["string", "null"] }, releaseRepo: { type: "string" } } } } },
				preHandler: [(app as any).authenticate],
				config: { rateLimit: { max: 60, timeWindow: "1 minute" }, keyScopeExemptReason: 'auth-only informational: agent version constant' },
			},
			async (_request, reply) => {
				const version = getCurrentVersion();
				return reply.send({
					version,
					agentVersion: normalizePanelVersion(version) ?? null,
					releaseRepo: agentReleaseRepo(),
				});
			},
		);

		// Agent binary download endpoint (public)
		// Priority: 1) local binary (air-gapped / self-hosted), 2) GitHub Releases proxy
		// Default version is the running panel so a 1.18.x panel never installs 1.19.x.
		app.get(
			"/api/agent/download",
			{
				schema: { summary: "Download the node agent", tags: ["Agent"], querystring: { type: "object", properties: { arch: { type: "string", enum: ["x86_64", "aarch64", "arm64", "amd64"] }, version: { type: "string", pattern: "^v?[0-9]+\\.[0-9]+\\.[0-9]+" } } }, response: { 200: { type: "string", format: "binary", contentMediaType: "application/octet-stream" }, 400: { type: "object", properties: { error: { type: "string" } } }, 502: { type: "object", properties: { error: { type: "string" } } } } },
				config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
			},
			async (request, reply) => {
			const query = request.query as { arch?: string; version?: string };
			const requested = query.version;
			if (requested && !normalizePanelVersion(requested)) {
				return reply.status(400).send({
					error: "Invalid version format",
				});
			}

			const version = defaultAgentVersion(requested);
			const normalizedArch = normalizeAgentArch(query.arch);
			const assetName = agentMuslAssetName(normalizedArch);
			const localDir = agentBinaryDir();

			const localPath = resolveLocalAgentBinary(localDir, normalizedArch, assetName);
			if (localPath) {
				app.log.info(`Serving agent binary from local file: ${localPath}`);
				const stat = fs.statSync(localPath);
				reply.header("Content-Type", "application/octet-stream");
				reply.header(
					"Content-Disposition",
					`attachment; filename=${assetName}`,
				);
				reply.header("Content-Encoding", "identity");
				reply.header("Content-Length", String(stat.size));
				return reply.send(fs.createReadStream(localPath));
			}

			const githubUrl = githubReleaseAssetUrl(
				agentReleaseRepo(),
				assetName,
				version,
			);

			app.log.info(
				`No local binary found — proxying from GitHub Releases: ${githubUrl}`,
			);

			try {
				const response = await fetch(githubUrl, {
					redirect: "follow",
					signal: AbortSignal.timeout(120_000),
				});

				if (!response.ok) {
					app.log.error(
						`GitHub Releases returned ${response.status} for ${githubUrl}`,
					);
					return reply.status(502).send({
						error: `Failed to download agent binary`,
					});
				}

				reply.header("Content-Type", "application/octet-stream");
				reply.header(
					"Content-Disposition",
					`attachment; filename=${assetName}`,
				);
				reply.header("Content-Encoding", "identity");

				const buffer = Buffer.from(await response.arrayBuffer());
				reply.header("Content-Length", String(buffer.length));
				return reply.send(buffer);
			} catch (err) {
				app.log.error(
					{ err },
					"Failed to proxy agent binary from GitHub Releases",
				);
				return reply.status(502).send({
					error: "Failed to download agent binary",
				});
			}
		});

		// Agent binary checksum endpoint — mirrors /api/agent/download
		// but serves the .sha256 sidecar file for integrity verification.
		app.get(
			"/api/agent/download-checksum",
			{
				schema: { summary: "Download the node agent checksum", tags: ["Agent"], querystring: { type: "object", properties: { arch: { type: "string", enum: ["x86_64", "aarch64", "arm64", "amd64"] }, version: { type: "string", pattern: "^v?[0-9]+\\.[0-9]+\\.[0-9]+" } } }, response: { 200: { type: "string", contentMediaType: "text/plain" }, 400: { type: "object", properties: { error: { type: "string" } } }, 502: { type: "object", properties: { error: { type: "string" } } } } },
				config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
			},
			async (request, reply) => {
			const query = request.query as { arch?: string; version?: string };
			const requested = query.version;
			if (requested && !normalizePanelVersion(requested)) {
				return reply.status(400).send({ error: "Invalid version format" });
			}

			const version = defaultAgentVersion(requested);
			const normalizedArch = normalizeAgentArch(query.arch);
			const assetName = agentMuslAssetName(normalizedArch);

			const localChecksum = resolveLocalAgentChecksum(agentBinaryDir(), assetName);
			if (localChecksum) {
				return reply.type("text/plain").send(fs.createReadStream(localChecksum));
			}

			const githubUrl = `${githubReleaseAssetUrl(
				agentReleaseRepo(),
				assetName,
				version,
			)}.sha256`;

			try {
				const response = await fetch(githubUrl, {
					redirect: "follow",
					signal: AbortSignal.timeout(30_000),
				});
				if (!response.ok) {
					return reply.status(502).send({ error: `Failed to fetch agent checksum` });
				}
				const text = await response.text();
				return reply.type("text/plain").send(text);
			} catch (err) {
				return reply.status(502).send({
					error: "Failed to fetch agent checksum",
				});
			}
		});

		// Canonical node deployment script endpoint (public)
		app.get(
			"/api/agent/deploy-script",
			{
				schema: { summary: "Download the agent deployment script", tags: ["Agent"], response: { 200: { type: "string", contentMediaType: "text/x-shellscript" }, 404: { type: "object", properties: { error: { type: "string" } } } } },
				config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
			},
			async (_request, reply) => {
			const deployScriptPath =
				process.env.DEPLOY_SCRIPT_PATH ||
				path.resolve(process.cwd(), "..", "scripts", "deploy-agent.sh");

			if (!fs.existsSync(deployScriptPath)) {
				return reply.status(404).send({ error: "Deploy script not found" });
			}

			reply.header("Content-Type", "text/x-shellscript");
			reply.header(
				"Content-Disposition",
				"attachment; filename=deploy-agent.sh",
			);
			reply.header("Cache-Control", "no-store");
			return reply.send(fs.createReadStream(deployScriptPath));
		});

		// Node deployment script endpoint (public). Single-use short-lived
		// token in the URL only; the long-lived agent API key travels via the
		// Authorization Bearer header (or not at all — the response is the
		// rendered script). Query strings are logged by proxies; the API key
		// must never appear there.
		app.get(
			"/api/deploy/:token",
			{
				schema: { summary: "Fetch a single-use node deployment script", tags: ["Agent"], params: { type: "object", required: ["token"], properties: { token: { type: "string" } } }, headers: { type: "object", properties: { authorization: { type: "string", description: "Bearer node API key." } } }, response: { 200: { type: "string", contentMediaType: "text/plain" }, 400: { type: "object", properties: { error: { type: "string" } } }, 401: { type: "object", properties: { error: { type: "string" } } } } },
				config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
			},
			async (request, reply) => {
			const { token } = request.params as { token: string };
			const authHeader = typeof request.headers.authorization === "string"
				? request.headers.authorization
				: "";
			const bearerKey = authHeader.toLowerCase().startsWith("bearer ")
				? authHeader.slice(7).trim()
				: "";

			const deployToken = await prisma.deploymentToken.findUnique({
				where: { token },
				include: { node: true },
			});

			if (!deployToken || new Date() > deployToken.expiresAt) {
				return reply.status(401).send({ error: "Invalid deployment credentials" });
			}

			// Single-use: reject tokens already consumed by a successful deploy script fetch.
			if (deployToken.usedAt) {
				return reply.status(401).send({ error: "Invalid deployment credentials" });
			}

			const apiKeyValue = bearerKey;
			if (!apiKeyValue) {
				return reply
					.status(401)
					.send({ error: "Invalid deployment credentials" });
			}
			// Refuse a key echoed back in the query string: proxies log URLs,
			// so ?apiKey= would leak the long-lived credential.
			const queryKey = (request.query as { apiKey?: string })?.apiKey;
			if (typeof queryKey === "string" && queryKey.trim()) {
				request.log.warn("Deploy script requested with apiKey in query string");
				return reply
					.status(401)
					.send({ error: "Invalid deployment credentials" });
			}

			const apiKeyValid = await verifyAgentApiKey(
				prisma,
				deployToken.node.id,
				apiKeyValue,
			);
			if (!apiKeyValid) {
				return reply
					.status(401)
					.send({ error: "Invalid deployment credentials" });
			}

			// Atomically mark the token used before emitting the script so concurrent
			// fetches cannot both succeed (usedAt null → set once).
			const consume = await prisma.deploymentToken.updateMany({
				where: { id: deployToken.id, usedAt: null },
				data: { usedAt: new Date() },
			});
			if (consume.count !== 1) {
				return reply.status(401).send({ error: "Invalid deployment credentials" });
			}

			// For the deploy script, use the externally-reachable address.
			// BACKEND_URL is typically the server's internal listen address (e.g. localhost),
			// so prefer the request host or BACKEND_EXTERNAL_ADDRESS so the remote node
			// can actually reach the server.
			const externalBase =
				process.env.BACKEND_EXTERNAL_ADDRESS ||
				`${request.protocol}://${request.headers.host}`;
			const baseUrl = externalBase;
			if (/[;&|`$()\[\]{}]/.test(baseUrl)) {
				return reply.status(400).send({ error: 'Invalid backend URL' });
			}
			const script = generateDeploymentScript(
				baseUrl,
				deployToken.node.id,
				deployToken.node.hostname,
				apiKeyValue,
				deployToken.node,
			);

			reply.type("text/plain").send(script);
		});

		// ── Agent SFTP token validation (internal — agent-authenticated) ──
		// The SFTP server now runs on each node. When an SFTP client connects,
		// the node calls this endpoint to validate the token and get the
		// associated userId + permissions without exposing the token manager
		// internals to the agent.
		app.post(
			"/api/agent/sftp/validate-token",
			{
				schema: { summary: "Validate an agent SFTP token", tags: ["Agent"], headers: { type: "object", required: ["x-catalyst-node-id", "x-catalyst-node-token"], properties: { "x-catalyst-node-id": { type: "string" }, "x-catalyst-node-token": { type: "string" } } }, body: { type: "object", required: ["token", "serverId"], properties: { token: { type: "string" }, serverId: { type: "string" } } }, response: { 200: { type: "object", required: ["success", "data"], properties: { success: { type: "boolean" }, data: { type: "object", required: ["valid"], properties: { valid: { type: "boolean" }, userId: { type: "string" }, serverId: { type: "string" }, serverUuid: { type: "string" }, permissions: { type: "array", items: { type: "string" } } } } } }, 400: { type: "object", properties: { error: { type: "string" } } }, 401: { type: "object", properties: { error: { type: "string" } } }, 404: { type: "object", properties: { success: { type: "boolean" }, data: { type: "object" } } } } },
			},
			async (request, reply) => {
				// Agent auth: verify x-catalyst-node-id + x-catalyst-node-token
				const headerNodeId =
					typeof (
						request.headers["x-catalyst-node-id"] ??
						request.headers["x-catalyst-nodeid"]
					) === "string"
						? (request.headers["x-catalyst-node-id"] ??
							request.headers["x-catalyst-nodeid"]) as string
						: null;
				const headerToken =
					typeof request.headers["x-catalyst-node-token"] === "string"
						? request.headers["x-catalyst-node-token"] as string
						: typeof request.headers["x-node-api-key"] === "string"
							? request.headers["x-node-api-key"] as string
							: null;

				if (!headerNodeId || !headerToken) {
					return reply
						.status(401)
						.send({ error: "Missing agent credentials" });
				}

				const apiKeyValid = await verifyAgentApiKey(
					prisma,
					headerNodeId,
					headerToken,
				);
				if (!apiKeyValid) {
					return reply.status(401).send({ error: "Invalid agent credentials" });
				}

				const { token, serverId } = request.body as {
					token: string;
					serverId: string;
				};

				if (!token || !serverId) {
					return reply
						.status(400)
						.send({ error: "token and serverId are required" });
				}

				const result = validateSftpToken(token, serverId);
				if (!result) {
					return reply.send({ success: true, data: { valid: false } });
				}

				// SEC-M-01: bind the token's server to the calling node. A token
				// minted for server S on node A must not validate when presented
				// by node B (cross-node replay). Look up the server's nodeId and
				// reject mismatches explicitly (401) vs unknown servers (404).
				// Look up the user's permissions for this server
				const serverAccess = await prisma.serverAccess.findFirst({
					where: { serverId: result.serverId, userId: result.userId },
					select: { permissions: true },
				});

				// SECURITY: a suspended server must not accept SFTP sessions —
				// the HTTP file routes already 423 on suspension, and SFTP would
				// otherwise bypass that enforcement for the lifetime of a minted
				// token (up to 24 h).
				const sftpvServer = await prisma.server.findUnique({
					where: { id: result.serverId },
					select: { uuid: true, suspendedAt: true, nodeId: true, ownerId: true },
				});
				if (!sftpvServer) {
					return reply.status(404).send({ success: true, data: { valid: false } });
				}
				if (sftpvServer.nodeId !== headerNodeId) {
					request.log.warn(
						{ serverId: result.serverId, expectedNodeId: sftpvServer.nodeId, actualNodeId: headerNodeId },
						"SFTP validate-token node mismatch",
					);
					return reply.status(401).send({ success: true, data: { valid: false } });
				}
				if (
					process.env.SUSPENSION_ENFORCED !== "false" &&
					sftpvServer?.suspendedAt
				) {
					return reply.send({ success: true, data: { valid: false } });
				}

				// Derive the session's permissions from the caller's EFFECTIVE
				// server permissions (owner/admin full set, admin.read read
				// subset, subuser row subset) — never raw user roles: the old
				// isAdmin?["*"]:row derivation handed owners and read-admins an
				// empty set, which the agent froze into the SFTP session.
				const { getEffectiveServerPermissions } = await import(
					"./routes/servers/_helpers.js"
				);
				const permissions = await getEffectiveServerPermissions(
					result.userId,
					{
						id: result.serverId,
						ownerId: sftpvServer.ownerId,
						nodeId: sftpvServer.nodeId,
					},
					serverAccess
						? [
								{
									userId: result.userId,
									permissions: serverAccess.permissions,
								},
							]
						: [],
				);

				// The server UUID names the agent's FileManager data directory
				// (e.g. /var/lib/catalyst/<uuid>).

				return reply.send({
					success: true,
					data: {
						valid: true,
						userId: result.userId,
						serverId: result.serverId,
						serverUuid: sftpvServer?.uuid ?? result.serverId,
						permissions,
					},
				});
			},
		);

		// SFTP routes extracted to src/routes/sftp.ts (mint/rotate gate on
		// effective file.read, key-scope enforced, token-value visibility).
		await app.register(sftpRoutes);

		// ── Server permission catalog (the shared subuser/role checklist) ──
		// Single source: ALL_SERVER_PERMISSIONS in lib/permissions-catalog.ts.
		// Consumed by the subuser UI and the role wizard's scoped-access step,
		// so new server permissions appear in both automatically.
		app.get(
			"/api/permissions/server",
			{ schema: { summary: "List server permissions", tags: ["Permissions"], response: { 200: { type: "object", required: ["success", "data"], properties: { success: { type: "boolean" }, data: { type: "array", items: { type: "string" } } } } } }, preHandler: [authenticate], config: { keyScopeExemptReason: 'auth-only: server-scoped permission list for the subuser UI checklist' }},
			async (_request, reply) => {
				const { ALL_SERVER_PERMISSIONS } = await import(
					"./lib/permissions-catalog.js"
				);
				return reply.send({ success: true, data: ALL_SERVER_PERMISSIONS });
			}
		);


		// Update status (authenticated; restart probe uses /health for liveness).
		app.get("/api/update/check", { schema: { summary: "Check for a panel update", tags: ["Updates"], response: { 200: { type: "object", required: ["currentVersion", "latestVersion", "updateAvailable", "isDocker"], properties: { currentVersion: { type: "string" }, latestVersion: { type: ["string", "null"] }, updateAvailable: { type: "boolean" }, isDocker: { type: "boolean" } } } } }, preHandler: [(app as any).authenticate], config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
			// Panel update state is admin-only information (admin.read tier).
			const perms: string[] = request.user?.permissions ?? [];
			if (!hasGrant(perms, "admin.read")) {
				return apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, "Admin read permission required");
			}
			const { getUpdateStatus, checkForUpdate } = await import("./services/auto-updater");
			const status = getUpdateStatus();
			// Refresh cache if stale (> 5 min) so the frontend gets real data
			const isStale =
				!status.lastCheckedAt ||
				Date.now() - new Date(status.lastCheckedAt).getTime() > 5 * 60 * 1000;
			if (isStale) {
				await checkForUpdate(logger);
			}
			const fresh = getUpdateStatus();
			return reply.send({
				currentVersion: fresh.currentVersion,
				latestVersion: fresh.latestVersion,
				updateAvailable: fresh.updateAvailable,
				isDocker: fresh.isDocker,
			});
		});

		// Public theme settings endpoint (unauthenticated, display fields only).
		// The computed public payload is cached (L1 process-local + L2 Redis);
		// the raw DB row is NOT cached because metadata holds OIDC secrets.
		app.get("/api/theme-settings/public", { schema: { summary: "Get public theme settings", tags: ["Theme"], response: { 200: { type: "object", required: ["success", "data"], properties: { success: { type: "boolean" }, data: { type: "object", additionalProperties: true } } } } }, config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (_request, reply) => {
			const data = await cachedConfig("theme_default", async () => {
				const settings = await prisma.themeSettings.findUnique({
					where: { id: "default" },
				});

				// Return only public fields
				const oidcMeta = (settings?.metadata as Record<string, any>) || {};
				const oidcDb =
					(oidcMeta.oidcProviders as Record<string, Record<string, string>>) ||
					{};
				const isProviderConfigured = (p: string) => {
					const db = oidcDb[p];
					return !!(
						(db?.clientId || process.env[`${p.toUpperCase()}_OIDC_CLIENT_ID`]) &&
						(db?.clientSecret ||
							process.env[`${p.toUpperCase()}_OIDC_CLIENT_SECRET`]) &&
						(db?.discoveryUrl ||
							process.env[`${p.toUpperCase()}_OIDC_DISCOVERY_URL`])
					);
				};
				const rawCss = typeof settings?.customCss === "string" ? settings.customCss : null;

				return {
					panelName: settings?.panelName ?? "Catalyst",
					logoUrl: settings?.logoUrl ?? null,
					faviconUrl: settings?.faviconUrl ?? null,
					defaultTheme: settings?.defaultTheme ?? "dark",
					enabledThemes: settings?.enabledThemes ?? null,
					primaryColor: settings?.primaryColor ?? null,
					secondaryColor: settings?.secondaryColor ?? null,
					accentColor: settings?.accentColor ?? null,
					// Expose which OAuth/SSO providers are configured so the frontend
					// can hide login buttons and profile linking UI when not set up.
					authProviders: {
						whmcs: isProviderConfigured("whmcs"),
						paymenter: isProviderConfigured("paymenter"),
					},
					// Extended theme customization stored in metadata
					themeColors: (settings?.metadata as any)?.themeColors || null,
					customCss: rawCss && rawCss.length > 20000 ? rawCss.slice(0, 20000) : rawCss,
				};
			});

			reply.header("Cache-Control", "no-store");
			reply.send({
				success: true,
				data,
			});
		});

		// Public OAuth/SSO provider list (unauthenticated). Plugins that declare
		// manifest.authProviders appear here while enabled, powering the
		// login-page "Continue with …" buttons. No plugin secrets involved —
		// just id/label/authorize URL.
		app.get(
			"/api/auth/oauth-providers",
			{ schema: { summary: "List configured OAuth providers", tags: ["Auth"], response: { 200: { type: "object", required: ["success", "providers"], properties: { success: { type: "boolean" }, providers: { type: "array", items: { type: "object", additionalProperties: true } } } } } }, config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
			async (_request, reply) => {
				const providers = collectAuthProviders(
					pluginLoader.getRegistry().getAll(),
				);
				reply.header("Cache-Control", "no-store");
				return reply.send({ success: true, providers });
			},
		);

		// Frontend error reporting endpoint (unauthenticated, rate-limited)
		app.post(
			"/api/system-errors/report",
			{
				schema: { summary: "Report a frontend system error", tags: ["Diagnostics"], body: { type: "object", required: ["component", "message"], properties: { level: { type: "string", enum: ["error", "warn", "critical"] }, component: { type: "string", minLength: 1, maxLength: 128 }, message: { type: "string", minLength: 1, maxLength: 2000 }, stack: { type: "string", maxLength: 10000 }, metadata: {} } }, response: { 200: { type: "object", properties: { success: { type: "boolean" } } }, 400: { type: "object", properties: { error: { type: "string" } } }, 500: { type: "object", properties: { error: { type: "string" } } } } },
				config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
			},
			async (request, reply) => {
				try {
					const body = request.body as {
						level?: "error" | "warn" | "critical";
						component: string;
						message: string;
						stack?: string;
						metadata?: any;
					};

					if (
						typeof body.component !== "string" ||
						body.component.trim().length === 0 ||
						typeof body.message !== "string" ||
						body.message.trim().length === 0
					) {
						return reply
							.status(400)
							.send({ error: "Invalid request" });
					}

					// SECURITY: this endpoint is unauthenticated. Cap every field
					// (mirroring /api/client-errors) so it cannot be used to flood
					// the SystemError table with multi-MB rows or amplify into the
					// admin WS feed.
					const safeComponent = body.component.trim().slice(0, 128);
					const safeStack =
						typeof body.stack === "string"
							? body.stack.slice(0, 10_000)
							: undefined;
					let safeMetadata: unknown = body.metadata;
					if (safeMetadata !== undefined && safeMetadata !== null) {
						try {
							const serialized = JSON.stringify(safeMetadata);
							if (serialized.length > 4096) {
								safeMetadata = {
									truncated: true,
									preview: serialized.slice(0, 2048),
								};
							}
						} catch {
							safeMetadata = { error: "unserializable metadata dropped" };
						}
					}

					await captureSystemError({
						level: body.level || "error",
						component: safeComponent,
						message: (body.message as string).slice(0, 2000),
						stack: safeStack,
						metadata: safeMetadata,
						...(request.user?.userId ? { userId: request.user.userId } : {}),
					});

					logger.info(
						{ component: safeComponent, level: body.level || "error" },
						"Frontend error reported",
					);

					return { success: true };
				} catch (err: any) {
					logger.error(err, "Failed to report frontend error");
					return reply.status(500).send({ error: "Failed to report error" });
				}
			},
		);

		// Client-side error ingest (unauthenticated, rate-limited). Accepts the
		// compact {message, stack, component, url, level} payload used by the SPA.
		app.post(
			"/api/client-errors",
			{
				schema: { summary: "Report a client-side error", tags: ["Diagnostics"], body: { type: "object", required: ["message"], properties: { message: { type: "string", minLength: 1, maxLength: 2000 }, stack: { type: "string", maxLength: 10000 }, component: { type: "string", maxLength: 128 }, url: { type: "string", maxLength: 2048 }, level: { type: "string", enum: ["error", "warn", "critical"] } } }, response: { 200: { type: "object", properties: { success: { type: "boolean" } } }, 400: { type: "object", properties: { error: { type: "string" } } } } },
				config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
			},
			async (request, reply) => {
				const body = (request.body ?? {}) as {
					message?: unknown;
					stack?: unknown;
					component?: unknown;
					url?: unknown;
					level?: unknown;
				};

				const message =
					typeof body.message === "string" ? body.message.trim() : "";
				if (!message) {
					return reply.status(400).send({ error: "Invalid request" });
				}

				const allowedLevels = new Set(["error", "warn", "critical"]);
				const requestedLevel =
					typeof body.level === "string" ? body.level : "error";
				const level = allowedLevels.has(requestedLevel)
					? (requestedLevel as "error" | "warn" | "critical")
					: "error";
				const component =
					typeof body.component === "string" && body.component.trim()
						? body.component.trim().slice(0, 128)
						: "frontend";
				const stack =
					typeof body.stack === "string"
						? body.stack.slice(0, 10_000)
						: undefined;
				const url =
					typeof body.url === "string" ? body.url.slice(0, 2048) : undefined;

				await captureSystemError({
					level: "error",
					component: "frontend",
					message: message.slice(0, 2000),
					stack,
					metadata: {
						sourceComponent: component,
						url,
						reportedLevel: level,
					},
					...(request.user?.userId ? { userId: request.user.userId } : {}),
				});

				return { success: true };
			},
		);

		// Initialize plugin system BEFORE starting server
		await pluginLoader.initialize();
		logger.info("Plugin system initialized");

		// Auto-enable plugins that were previously enabled. Plugins enabled
		// before the safety-disclaimer feature existed are grandfathered: a
		// backfill acceptance (no accepting user) is recorded once so they
		// keep starting, and the UI flags them for permission review.
		const enabledPlugins = await prisma.plugin.findMany({
			where: { enabled: true },
		});
		for (const plugin of enabledPlugins) {
			try {
				if (!plugin.safetyAcceptedAt && typeof plugin.version === "string") {
					const manifest = pluginLoader.getRegistry().get(plugin.name)?.manifest;
					await prisma.plugin.update({
						where: { name: plugin.name },
						data: {
							safetyAcceptedAt: new Date(),
							safetyAcceptedBy: null,
							safetyDisclaimerVersion: DISCLAIMER_VERSION,
							safetyAcceptedPluginVersion: plugin.version,
							safetyAcceptedPermissions:
								(manifest?.permissions as string[] | undefined) ?? [],
						},
					});
					logger.warn(
						{ plugin: plugin.name },
						"Grandfathered previously-enabled plugin without disclaimer acceptance — flagged for admin review",
					);
				}
				await pluginLoader.enablePlugin(plugin.name);
			} catch (error: any) {
				logger.error(
					{ plugin: plugin.name, error: error.message },
					"Failed to auto-enable plugin",
				);
				captureSystemError({
					level: 'error',
					component: 'PluginLoader',
					message: `Failed to auto-enable plugin ${plugin.name}: ${error.message}`,
					stack: error.stack,
					metadata: { pluginName: plugin.name },
				}).catch(() => {});
			}
		}

		// Bootstrap OIDC config from DB (falls back to env vars already set)
		try {
			const dbSettings = await prisma.themeSettings.findUnique({
				where: { id: "default" },
			});
			const meta = dbSettings?.metadata as Record<string, unknown> | null;
			if (meta?.oidcProviders && typeof meta.oidcProviders === "object") {
				const providers = meta.oidcProviders as Record<
					string,
					Record<string, string>
				>;
				for (const [key, cfg] of Object.entries(providers)) {
					const prefix = key.toUpperCase();
					if (cfg.clientId && !process.env[`${prefix}_OIDC_CLIENT_ID`])
						process.env[`${prefix}_OIDC_CLIENT_ID`] = cfg.clientId;
					if (cfg.clientSecret && !process.env[`${prefix}_OIDC_CLIENT_SECRET`])
						process.env[`${prefix}_OIDC_CLIENT_SECRET`] = cfg.clientSecret;
					if (cfg.discoveryUrl && !process.env[`${prefix}_OIDC_DISCOVERY_URL`])
						process.env[`${prefix}_OIDC_DISCOVERY_URL`] = cfg.discoveryUrl;
				}
				logger.info("OIDC config bootstrapped from database");
			}
		} catch (err: any) {
			logger.warn(
				{ error: err.message },
				"Failed to bootstrap OIDC config from DB, using env vars",
			);
		}

		// Initialize auth after OIDC env vars have been bootstrapped from DB
		const authModule = await import("./auth");
		authModule.initAuth();
		// Update app.auth reference now that initAuth() has reassigned the module-level auth
		(app as any).auth = authModule.auth;
		logger.info("Auth initialized");

		// Start server
		await app.listen({
			port: parseInt(process.env.PORT || "3000"),
			host: "0.0.0.0",
		});
		logger.info(
			`Catalyst Backend running on http://0.0.0.0:${process.env.PORT || 3000}`,
		);

		// SFTP server has been moved to the node agent.
		// The backend no longer runs its own SFTP server.
		// Token generation and validation remain in the backend;
		// the agent validates tokens via /api/agent/sftp/validate-token.

		// Background jobs must run on exactly one process. When WORKERS>0,
		// only worker id=1 owns schedulers/retention (see cluster.ts).
		// HTTP handling still runs on every worker.
		const runBackgroundJobs = shouldRunBackgroundJobs();
		if (runBackgroundJobs) {
			logger.info(
				{ owner: backgroundJobOwnerLabel() },
				"This process owns background jobs (scheduler/alerts/retention)",
			);

			// Start task scheduler
			await taskScheduler.start();
			logger.info(
				`Task scheduler started with ${taskScheduler.getScheduledTasksCount()} active tasks`,
			);

			// Recover servers whose clone/transfer was interrupted by a restart.
			try {
				const { reconcileStuckOperations } = await import("./lib/reconcile-operations");
				await reconcileStuckOperations(prisma, logger);
			} catch (error) {
				logger.warn({ error }, "Stuck-operation reconciliation failed");
			}

			// Start alert service
			await alertService.start();
			logger.info("Alert monitoring service started");

			// Reconcile release polling with the stored update settings. Saved
			// settings win; the AUTO_UPDATE_* env vars only seed the row on the
			// first read so upgraded installs keep their previous behaviour.
			// Skipped entirely in benchmark fair mode to eliminate external
			// GitHub polling that steals network/CPU from throughput tests.
			if (!fairMode) {
				const { applyAutoUpdateScheme } = await import("./services/auto-updater");
				await applyAutoUpdateScheme(logger);
			} else {
				logger.info("Benchmark fair mode: auto-update polling disabled");
			}

			const retentionJitter = () => Math.floor(Math.random() * 60_000);

			setTimeout(() => {
				auditRetentionInterval = startAuditRetention(prisma, logger);
				logger.info("Audit retention job scheduled");
			}, retentionJitter());

			setTimeout(() => {
				statRetentionInterval = startStatRetention(prisma, logger);
				logger.info("Stat retention job scheduled");
			}, retentionJitter());

			setTimeout(() => {
				backupRetentionInterval = startBackupRetention(prisma, logger, wsGateway);
				logger.info("Backup retention job scheduled");
			}, retentionJitter());

			setTimeout(() => {
				stuckBackupStateInterval = startStuckBackupStateWatchdog(prisma, logger, wsGateway);
				logger.info("Stuck backup state watchdog scheduled");
			}, retentionJitter());

			setTimeout(() => {
				logRetentionInterval = startLogRetention(prisma, logger);
				logger.info("Log retention job scheduled");
			}, retentionJitter());

			setTimeout(() => {
				metricsRetentionInterval = startMetricsRetention(prisma, logger);
				logger.info("Metrics retention job scheduled");
			}, retentionJitter());

			setTimeout(() => {
				authRetentionInterval = startAuthRetention(prisma, logger);
				logger.info("Auth retention job scheduled");
			}, retentionJitter());
		} else {
			logger.info(
				{ owner: backgroundJobOwnerLabel() },
				"Skipping background jobs on this worker (owned by worker id=1)",
			);
		}
	} catch (err) {
		logger.error(err, "Failed to start server");
		captureSystemError({
			level: 'critical',
			component: 'Bootstrap',
			message: describeError(err),
			stack: err instanceof Error ? err.stack : undefined,
		}).catch(() => {});
		process.exit(1);
	}
}

// ============================================================================
// DEPLOYMENT SCRIPT GENERATOR
// ============================================================================

function generateDeploymentScript(
	backendUrl: string,
	nodeId: string,
	hostName: string,
	apiKey: string,
	node: any,
): string {
	const shellEscape = (value: string) => `'${value.replace(/'/g, `'"'"'`)}'`;

	// Build env var exports for any custom agent paths the admin configured.
	// The deploy-agent.sh will pick these up and write them into config.toml.
	const pathEnvLines: string[] = [];
	if (node.serverDataDir) pathEnvLines.push(`export DATA_DIR=${shellEscape(node.serverDataDir)}`);
	if (node.consoleLogDir) pathEnvLines.push(`export CONSOLE_LOG_DIR=${shellEscape(node.consoleLogDir)}`);
	if (node.cniDir) pathEnvLines.push(`export CNI_DIR=${shellEscape(node.cniDir)}`);
	if (node.cniBinDir) pathEnvLines.push(`export CNI_BIN_DIR=${shellEscape(node.cniBinDir)}`);
	if (node.cniDataDir) pathEnvLines.push(`export CNI_DATA_DIR=${shellEscape(node.cniDataDir)}`);
	if (node.cniResultsDir) pathEnvLines.push(`export CNI_RESULTS_DIR=${shellEscape(node.cniResultsDir)}`);
	if (node.cniBridgeName) pathEnvLines.push(`export CNI_BRIDGE_NAME=${shellEscape(node.cniBridgeName)}`);
	if (node.cniBridgeSubnet) pathEnvLines.push(`export CNI_BRIDGE_SUBNET=${shellEscape(node.cniBridgeSubnet)}`);
	if (node.systemdOverrideDir) pathEnvLines.push(`export SYSTEMD_OVERRIDE_DIR=${shellEscape(node.systemdOverrideDir)}`);
	if (node.agentConfigPath) pathEnvLines.push(`export CATALYST_CONFIG_PATH=${shellEscape(node.agentConfigPath)}`);
	if (node.agentReleaseRepo) pathEnvLines.push(`export AGENT_RELEASE_REPO=${shellEscape(node.agentReleaseRepo)}`);
	const panelVersion = normalizePanelVersion(getCurrentVersion());
	if (panelVersion) pathEnvLines.push(`export AGENT_VERSION=${shellEscape(panelVersion)}`);
	if (node.sftpPort && node.sftpPort !== 2022) pathEnvLines.push(`export SFTP_PORT=${shellEscape(String(node.sftpPort))}`);
	const pathExports = pathEnvLines.length > 0
		? `\n# --- Custom agent paths (from node configuration) ---\n${pathEnvLines.join("\n")}\n`
		: "";

	return `#!/usr/bin/env bash
set -euo pipefail

# --- Auto-elevate to root if needed -----------------------------------------------
if [ "\$EUID" -ne 0 ]; then
    if command -v sudo >/dev/null 2>&1; then
        echo "Not running as root — re-executing with sudo ..."
        exec sudo -- "\$(command -v bash || command -v sh)" "\$0" "\$@"
    else
        echo "ERROR: This script must be run as root and sudo is not available." >&2
        exit 1
    fi
fi
# ---------------------------------------------------------------------------

BACKEND_HTTP_URL=${shellEscape(backendUrl)}
case "$BACKEND_HTTP_URL" in
  ws://*) BACKEND_HTTP_URL="http://\${BACKEND_HTTP_URL#ws://}" ;;
  wss://*) BACKEND_HTTP_URL="https://\${BACKEND_HTTP_URL#wss://}" ;;
esac
BACKEND_HTTP_URL="\${BACKEND_HTTP_URL%/}"
BACKEND_HTTP_URL="\${BACKEND_HTTP_URL%/ws}"
BACKEND_HTTP_URL="\${BACKEND_HTTP_URL%/}"

NODE_ID=${shellEscape(nodeId)}
NODE_HOSTNAME=${shellEscape(hostName)}
${pathExports}
DEPLOY_SCRIPT_URL="\${BACKEND_HTTP_URL}/api/agent/deploy-script"
TMP_SCRIPT="$(mktemp /tmp/catalyst-deploy-agent.XXXXXX.sh)"
# Agent API key: kept out of argv and URLs — the bootstrap writes it to a 0600
# file and the deploy script reads it from CATALYST_API_KEY_FILE.
KEY_FILE="$(mktemp /tmp/catalyst-agent-key.XXXXXX)"
chmod 600 "$KEY_FILE"
# shellEscape already returns a single-quoted word — do NOT wrap it in double
# quotes. Doing so makes the single quotes literal, so the key file would
# contain 'catalyst_...' and config.toml would end up with api_key = "'...'".
printf '%s' ${shellEscape(apiKey)} > "$KEY_FILE"

cleanup() {
  rm -f "$TMP_SCRIPT" "$KEY_FILE"
}
trap cleanup EXIT

echo "Fetching deploy script from \${DEPLOY_SCRIPT_URL}"
curl -fsSL "\${DEPLOY_SCRIPT_URL}" -o "$TMP_SCRIPT"
chmod +x "$TMP_SCRIPT"

echo "Running deploy script..."
CATALYST_API_KEY_FILE="$KEY_FILE" "$TMP_SCRIPT" "$BACKEND_HTTP_URL" "$NODE_ID" "$NODE_HOSTNAME"
`;
}

async function shutdown(signal: string) {
	if (shutdown.started) return;
	shutdown.started = true;
	logger.info(`Received ${signal}, shutting down gracefully...`);
	await app.close();
	taskScheduler?.stop();
	alertService?.stop();
	wsGateway?.destroy();
	pluginLoader?.shutdown().catch(() => {});
	fileTunnel?.destroy();
	await closeRedis().catch(() => {});
	if (auditRetentionInterval) clearInterval(auditRetentionInterval);
	if (statRetentionInterval) clearInterval(statRetentionInterval);
	if (backupRetentionInterval) clearInterval(backupRetentionInterval);
	if (stuckBackupStateInterval) clearInterval(stuckBackupStateInterval);
	if (logRetentionInterval) clearInterval(logRetentionInterval);
	if (metricsRetentionInterval) clearInterval(metricsRetentionInterval);
	if (authRetentionInterval) clearInterval(authRetentionInterval);
	await prisma.$disconnect();
	process.exit(0);
}

shutdown.started = false;

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

let capturingFatal = false;
function captureFatalProcessError(
	kind: "unhandledRejection" | "uncaughtException",
	reason: unknown,
) {
	if (capturingFatal) {
		logger.error({ kind, reason }, `Recursive ${kind} while capturing fatal error`);
		return;
	}
	capturingFatal = true;
	try {
		const err = reason instanceof Error ? reason : new Error(describeError(reason));
		logger.error({ err, kind }, kind);
		void captureSystemError({
			level: "critical",
			component: "Process",
			message: describeError(reason) || kind,
			stack: err.stack,
			metadata: { kind },
		})
			.catch((captureErr) => {
				logger.error({ err: captureErr, kind }, "Failed to persist fatal process error");
			})
			.finally(() => {
				capturingFatal = false;
			});
	} catch (handlerErr) {
		logger.error({ err: handlerErr, kind }, `Fatal ${kind} handler failed`);
		capturingFatal = false;
	}
}

process.on("unhandledRejection", (reason) => {
	captureFatalProcessError("unhandledRejection", reason);
});
process.on("uncaughtException", (error) => {
	captureFatalProcessError("uncaughtException", error);
});

const run = () => bootstrap().catch((err) => {
	logger.error(err, "Bootstrap error");
	captureSystemError({
		level: 'critical',
		component: 'Bootstrap',
		message: describeError(err),
		stack: err instanceof Error ? err.stack : undefined,
	}).catch(() => {});
	process.exit(1);
});

if (Number(process.env.WORKERS || 0) > 0) {
	bootstrapCluster(run);
} else {
	run();
}
