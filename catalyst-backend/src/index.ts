import Fastify from "fastify";
import fastifyCompress from "@fastify/compress";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import fastifyWebsocket from "@fastify/websocket";
import fastifyCors from "@fastify/cors";
import fastifyRateLimit from "@fastify/rate-limit";
import fastifyHelmet from "@fastify/helmet";
import fastifyMultipart from "@fastify/multipart";
import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";
import pino from "pino";
import { prisma } from "./db";
import "./types"; // Load type augmentations
import { WebSocketGateway, setWsGateway } from "./websocket/gateway";
import { setErrorLoggerGateway, captureSystemError } from "./services/error-logger";
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
import { RbacMiddleware } from "./middleware/rbac";
import { startSFTPServer } from "./sftp-server";
import { adminRoutes } from "./routes/admin";
import { roleRoutes } from "./routes/roles";
import { taskRoutes } from "./routes/tasks";
import { bulkServerRoutes } from "./routes/bulk-servers";
import { consoleStreamRoutes } from "./routes/console-stream";
import { sseEventsRoutes } from "./routes/sse-events";
import { WebhookService } from "./services/webhook-service";
import { TaskScheduler } from "./services/task-scheduler";
import { alertRoutes } from "./routes/alerts";
import { dashboardRoutes } from "./routes/dashboard";
import { setupRoutes } from "./routes/setup";
import {
	verifyApiKey as verifyApiKeyService,
	createApiKey as createApiKeyService,
	deleteApiKey as deleteApiKeyService,
} from "./services/api-key-service";
import { apiKeyRoutes } from "./routes/api-keys";
import { AlertService } from "./services/alert-service";
import { getSecuritySettings } from "./services/mailer";
import {
	generateSftpToken,
	rotateSftpToken,
	getSftpTokenInfo,
	listSftpTokensForServer,
	revokeSftpToken,
	revokeAllSftpTokensForServer,
	SFTP_TTL_OPTIONS,
} from "./services/sftp-token-manager";
import { startAuditRetention } from "./services/audit-retention";
import { startStatRetention } from "./services/stat-retention";
import { startBackupRetention } from "./services/backup-retention";
import { startLogRetention } from "./services/log-retention";
import { startMetricsRetention } from "./services/metrics-retention";
import { startAuthRetention } from "./services/auth-retention";
import { auth } from "./auth";
import { fromNodeHeaders } from "better-auth/node";
import { normalizeHostIp } from "./utils/ipam";
import { PluginLoader } from "./plugins/loader";
import { pluginRoutes } from "./routes/plugins";
import { FileTunnelService } from "./services/file-tunnel";
import { fileTunnelRoutes } from "./routes/file-tunnel";
import { migrationRoutes } from "./routes/migration";
import { updateRoutes } from "./routes/update";
import { verifyAgentApiKey } from "./lib/agent-auth";

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

const app = Fastify({
	logger: true,
	bodyLimit: 1048576, // 1MB default limit (lowered from 100MB)
	trustProxy: true,
});

// Parse application/octet-stream as raw Buffer (used by file tunnel stream responses)
app.addContentTypeParser(
	"application/octet-stream",
	(_request, payload, done) => {
		const chunks: Buffer[] = [];
		payload.on("data", (chunk: Buffer) => chunks.push(chunk));
		payload.on("end", () => done(null, Buffer.concat(chunks)));
		payload.on("error", done);
	},
);

app.setErrorHandler((error, request, reply) => {
	app.log.error(error);
	captureSystemError({
		level: 'error',
		component: 'HTTP',
		message: (error as Error).message || 'Internal Server Error',
		stack: (error as Error).stack,
		metadata: { statusCode: (error as any).statusCode, url: request.url, method: request.method },
		userId: (request as any).user?.userId,
	}).catch(() => {});
	const status =
		(error as any).statusCode && (error as any).statusCode >= 400
			? (error as any).statusCode
			: 500;
	let message = "Internal Server Error";
	if (status !== 500) {
		const raw = (error as Error).message || "";
		// Only expose safe, short validation messages — never Prisma or internal details
		const isPrismaError =
			raw.includes("prisma") ||
			raw.includes("Unique constraint") ||
			raw.includes("Foreign key");
		message =
			raw.includes("\n") || raw.length > 200 || isPrismaError
				? "Bad Request"
				: raw;
	}
	reply.status(status).send({ error: message });
});

const wsGateway = new WebSocketGateway(prisma, logger);
setWsGateway(wsGateway);
setErrorLoggerGateway(wsGateway);
const rbac = new RbacMiddleware(prisma);
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
			await wsGateway.sendToAgent(server.nodeId, {
				type: "create_backup",
				serverId: server.id,
				serverUuid: server.uuid,
				environment,
				payload: task.payload ?? {},
			});
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

const authenticate = async (request: any, reply: any) => {
	const authHeader = request.headers.authorization;

	// Try API key authentication if header matches Bearer pattern
	if (authHeader?.startsWith("Bearer ")) {
		const token = authHeader.substring(7);

		// Check if it's an API key (starts with prefix)
		if (token.startsWith("catalyst")) {
			try {
				const verification = await verifyApiKeyService(token);

				if (!verification?.valid || !verification?.key || !verification?.user) {
					reply.status(401).send({ error: "Invalid API key" });
					return;
				}

				// Attach user info and resolved permissions from the API key
				let permissions: string[];
				if (verification.key.allPermissions) {
					const { resolveUserPermissions } = await import(
						"./lib/permissions-catalog"
					);
					permissions = await resolveUserPermissions(verification.key.userId);
				} else {
					permissions = verification.key.permissions;
				}

				request.user = {
					userId: verification.user.id,
					email: verification.user.email,
					username: verification.user.username,
					apiKeyId: verification.key.id,
					permissions,
				};
				return; // API key auth successful
			} catch (error: any) {
				captureSystemError({
					level: 'error',
					component: 'Index',
					message: error?.message || 'API key authentication error',
					stack: error?.stack,
					metadata: { context: 'api_key_auth' },
				}).catch(() => {});
				logger.error(error, "API key authentication error");
				reply.status(401).send({ error: "Invalid or expired API key" });
				return;
			}
		}
	}

	// Fall back to session authentication
	try {
		const session = await auth.api.getSession({
			headers: fromNodeHeaders(
				request.headers as Record<string, string | string[] | undefined>,
			),
		});
		if (!session) {
			reply.status(401).send({ error: "Unauthorized" });
			return;
		}
		// Resolve permissions from roles for session auth too
		const { resolveUserPermissions } = await import(
			"./lib/permissions-catalog"
		);
		const permissions = await resolveUserPermissions(session.user.id);
		request.user = {
			userId: session.user.id,
			email: session.user.email,
			username: (session.user as any).username,
			permissions,
		};
	} catch {
		reply.status(401).send({ error: "Unauthorized" });
		return;
	}
};

(app as any).authenticate = authenticate;
(app as any).wsGateway = wsGateway;
(app as any).fileTunnel = fileTunnel;
(app as any).taskScheduler = taskScheduler;
(app as any).webhookService = webhookService;
(app as any).alertService = alertService;
// (app as any).auth is set after initAuth() below
(app as any).prisma = prisma;
(app as any).rbac = rbac;
(app as any).pluginLoader = pluginLoader;

// ============================================================================
// SETUP
// ============================================================================

function getPanelVersion(): string {
	try {
		const __dirname = path.dirname(fileURLToPath(import.meta.url));
		const pkgPath = path.resolve(__dirname, "..", "..", "package.json");
		const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
		return pkg.version as string;
	} catch {
		return "unknown";
	}
}

async function bootstrap() {
	try {
		logger.info(`Catalyst Backend v${getPanelVersion()}`);
		// Register security plugins
		// Response compression — gzip/br/deflate for smaller payloads
		// Enabled by default; set ENABLE_COMPRESSION=false to disable.
		if (process.env.ENABLE_COMPRESSION !== "false") {
			await app.register(fastifyCompress, {
				global: true,
				encodings: ["gzip", "br", "deflate"],
				threshold: 1024, // Only compress responses > 1KB
			});
			app.addHook("onSend", async (_request, reply, _payload) => {
				if (reply.getHeader("content-type")?.toString().includes("text/event-stream")) {
					reply.header("content-encoding", undefined);
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

		await app.register(fastifyRateLimit, {
			global: true,
			max: 600, // Per-IP limit: 600 requests
			timeWindow: "1 minute",
			errorResponseBuilder: (_req, context) => {
				const err = new Error("Too many requests. Please try again later.");
				(err as any).statusCode = context.statusCode;
				return err;
			},
			keyGenerator: (request) => {
				// Use user ID for authenticated requests, IP for unauthenticated
				return request.user?.userId || request.ip;
			},
			allowList: async (request) => {
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
			skipOnError: false,
		});

		await app.register(fastifyMultipart, {
			limits: {
				fileSize: 104857600,
			},
			attachFieldsToBody: false,
		});

		// Register plugins
		const allowedOrigins = [
			...(process.env.CORS_ORIGIN?.split(",").map((s) => s.trim()) ?? []),
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

		await app.register(fastifyWebsocket, {
			options: { maxPayload: 64 * 1024 },
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

		// Health check (exempt from rate limiting)
		app.get(
			"/health",
			{
				config: { rateLimit: { max: 1000000000, timeWindow: "1 minute" } },
			},
			async (request, reply) => {
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
					request.log.error(
						{ err: dbError },
						"Health check: database unreachable",
					);
					return reply.status(503).send({
						status: "unhealthy",
						error: "database unreachable",
						details: dbError.message,
						timestamp: new Date().toISOString(),
					});
				}
				return { status: "ok", timestamp: new Date().toISOString() };
			},
		);

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
					timeWindow: "1 minute",
					allowList: (request) => request.url.startsWith("/api/auth/passkey/"),
				},
			},
		};
		await app.register(authRoutes, { prefix: "/api/auth", ...authRateLimit });
		await app.register(setupRoutes, { prefix: "/api/setup" });
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
				// NOTE: This list does NOT need to be exhaustive.  Missing a path here
				// won't cause a bug — Fastify will route to the correct handler anyway.
				const customAuthPaths = [
					"/api/auth/login",
					"/api/auth/register",
					"/api/auth/me",
					"/api/auth/profile",
					"/api/auth/forgot-password",
					"/api/auth/reset-password",
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
						"better-auth-passkey=; Max-Age=0; Path=/; SameSite=Strict; HttpOnly",
					);
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
		await app.register(updateRoutes, { prefix: "/api/admin/update" });
		await app.register((app) => adminEventsRoutes(app, wsGateway), {
			prefix: "/api/admin/events",
		});
		await app.register(roleRoutes, { prefix: "/api/roles" });
		await app.register(taskRoutes, { prefix: "/api/servers" });
		await app.register(bulkServerRoutes, { prefix: "/api/servers" });
		await app.register(alertRoutes, { prefix: "/api" });
		await app.register(dashboardRoutes, { prefix: "/api/dashboard" });
		await app.register(apiKeyRoutes);
		await app.register((app) => pluginRoutes(app, pluginLoader));
		// File tunnel routes need higher body limit for upload/stream endpoints.
		// Read the configured limit from security settings (admin-adjustable).
		const initialSecuritySettings = await getSecuritySettings();
		const fileTunnelBodyLimit = Math.max(
			5 * 1024 * 1024, // 5MB minimum
			Math.min(
				initialSecuritySettings.fileTunnelMaxUploadMb * 1024 * 1024,
				500 * 1024 * 1024,
			), // 500MB hard cap
		);
		await app.register(
			(app) => fileTunnelRoutes(app, prisma, logger, fileTunnel),
			{ bodyLimit: fileTunnelBodyLimit },
		);

		// Migration routes (Pterodactyl → Catalyst)
		await app.register((app) => migrationRoutes(app));

		// Agent binary download endpoint (public)
		app.get("/api/agent/download", async (request, reply) => {
			// Use musl static binary for portability across Linux distributions.
			// Supports both x86_64 and aarch64 architectures.
			const arch = (request.query as { arch?: string }).arch || "x86_64";
			const normalizedArch =
				arch === "aarch64" || arch === "arm64" ? "aarch64" : "x86_64";
			const target = `${normalizedArch}-unknown-linux-musl`;

			// Allow overriding the agent target directory via env var.
			// Falls back to the default location in catalyst-agent/target/.
			const agentTargetDir =
				process.env.AGENT_TARGET_DIR ||
				path.resolve(process.cwd(), "..", "catalyst-agent", "target");
			const agentPath = path.resolve(
				agentTargetDir,
				target,
				"release",
				"catalyst-agent",
			);

			if (!fs.existsSync(agentPath)) {
				// Attempt to build the agent automatically (only in development)
				if (process.env.NODE_ENV === "production") {
					return reply.status(404).send({
						error: `Agent binary not found for ${target}. Please build with 'cargo build --release --target ${target}' in catalyst-agent/`,
					});
				}

				app.log.warn(
					`Agent binary not found for ${target}, attempting to build...`,
				);

				const agentDir = path.resolve(process.cwd(), "..", "catalyst-agent");
				if (!fs.existsSync(agentDir)) {
					return reply
						.status(404)
						.send({ error: "Agent source code not found" });
				}

				try {
					const { execSync } = await import("child_process");
					app.log.info(
						`Building agent with 'cargo build --release --target ${target}'...`,
					);

					execSync(`cargo build --release --target ${target}`, {
						cwd: agentDir,
						stdio: "inherit",
						timeout: 300000, // 5 minutes
						env: {
							...process.env,
							CARGO_TARGET_DIR: path.resolve(agentDir, "target"),
						},
					});

					app.log.info("Agent built successfully");

					if (!fs.existsSync(agentPath)) {
						return reply
							.status(500)
							.send({ error: "Agent build completed but binary not found" });
					}
				} catch (err) {
					captureSystemError({
						level: 'error',
						component: 'Index',
						message: err instanceof Error ? err.message : 'Failed to build agent',
						stack: err instanceof Error ? err.stack : undefined,
						metadata: { context: 'agent_build' },
					}).catch(() => {});
					app.log.error({ err }, "Failed to build agent");
					return reply.status(500).send({
						error: "Failed to build agent binary",
						details: err instanceof Error ? err.message : String(err),
					});
				}
			}

			reply.header("Content-Type", "application/octet-stream");
			reply.header(
				"Content-Disposition",
				"attachment; filename=catalyst-agent",
			);
			return reply.send(fs.createReadStream(agentPath));
		});

		// Canonical node deployment script endpoint (public)
		app.get("/api/agent/deploy-script", async (_request, reply) => {
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
			return reply.send(fs.createReadStream(deployScriptPath));
		});

		// Node deployment script endpoint (public)
		app.get("/api/deploy/:token", async (request, reply) => {
			const { token } = request.params as { token: string };
			const { apiKey } = (request.query as { apiKey?: string }) || {};

			const deployToken = await prisma.deploymentToken.findUnique({
				where: { token },
				include: { node: true },
			});

			if (!deployToken || new Date() > deployToken.expiresAt) {
				return reply.status(401).send({ error: "Invalid or expired token" });
			}

			const apiKeyValue = typeof apiKey === "string" ? apiKey.trim() : "";
			if (!apiKeyValue) {
				return reply
					.status(400)
					.send({ error: "Missing apiKey query parameter" });
			}

			const apiKeyValid = await verifyAgentApiKey(
				prisma,
				deployToken.node.id,
				apiKeyValue,
			);
			if (!apiKeyValid) {
				return reply
					.status(401)
					.send({ error: "Invalid API key for this node" });
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
			);

			reply.type("text/plain").send(script);
		});

		// SFTP connection info endpoint (authenticated)
		// Uses a dedicated SFTP token manager with per-user configurable expiry.

		function getSftpHost(request: any): string {
			return process.env.BACKEND_URL
				? new URL(process.env.BACKEND_URL).hostname
				: process.env.BACKEND_EXTERNAL_ADDRESS
					? new URL(process.env.BACKEND_EXTERNAL_ADDRESS).hostname
					: request.hostname.split(":")[0];
		}

		app.get(
			"/api/sftp/connection-info",
			{ preHandler: [authenticate] },
			async (request, reply) => {
				const enabled = process.env.SFTP_ENABLED !== "false";
				const port = parseInt(process.env.SFTP_PORT || "2022");
				const host = getSftpHost(request);
				const userId = request.user?.userId;
				const serverId = (request.query as { serverId?: string }).serverId;

				if (!userId || !serverId) {
					return reply
						.status(400)
						.send({ error: "serverId query parameter is required" });
				}

				const ttlMs =
					Number((request.query as { ttl?: string }).ttl) || undefined;
				const result = generateSftpToken(userId, serverId, ttlMs);

				reply.send({
					success: true,
					data: {
						enabled,
						host,
						port,
						sftpPassword: result.token,
						expiresAt: result.expiresAt,
						ttlMs: result.ttlMs,
						ttlOptions: SFTP_TTL_OPTIONS.map((o) => ({
							label: o.label,
							value: o.value,
						})),
					},
				});
			},
		);

		// SFTP token rotation endpoint (authenticated)
		app.post(
			"/api/sftp/rotate-token",
			{ preHandler: [authenticate] },
			async (request, reply) => {
				const userId = request.user?.userId;
				const { serverId, ttlMs } = request.body as {
					serverId: string;
					ttlMs?: number;
				};

				if (!userId || !serverId) {
					return reply.status(400).send({ error: "serverId is required" });
				}

				const result = rotateSftpToken(userId, serverId, ttlMs);

				reply.send({
					success: true,
					data: {
						sftpPassword: result.token,
						expiresAt: result.expiresAt,
						ttlMs: result.ttlMs,
					},
				});
			},
		);

		// List all SFTP tokens for a server (owner-only, or self-view for non-owners)
		app.get(
			"/api/sftp/tokens",
			{ preHandler: [authenticate] },
			async (request, reply) => {
				const userId = request.user?.userId;
				const serverId = (request.query as { serverId?: string }).serverId;

				if (!userId || !serverId) {
					return reply
						.status(400)
						.send({ error: "serverId query parameter is required" });
				}

				const server = await prisma.server.findUnique({
					where: { id: serverId },
					select: { ownerId: true },
				});
				if (!server) {
					return reply.status(404).send({ error: "Server not found" });
				}

				const isOwner = server.ownerId === userId;
				const tokens = listSftpTokensForServer(serverId, userId, isOwner);

				// Enrich tokens with user info
				const enriched = await Promise.all(
					tokens.map(async (t) => {
						const user = await prisma.user.findUnique({
							where: { id: t.userId },
							select: { email: true, username: true },
						});
						return {
							userId: t.userId,
							email: user?.email ?? t.userId,
							username: user?.username ?? null,
							expiresAt: t.expiresAt,
							ttlMs: t.ttlMs,
							createdAt: t.createdAt,
							token: t.token,
							isSelf: t.isSelf,
						};
					}),
				);

				reply.send({ success: true, data: enriched });
			},
		);

		// Revoke a specific user's SFTP token for a server (owner or self)
		app.delete(
			"/api/sftp/tokens/:targetUserId",
			{ preHandler: [authenticate] },
			async (request, reply) => {
				const userId = request.user?.userId;
				const { targetUserId } = request.params as { targetUserId: string };
				const serverId = (request.query as { serverId?: string }).serverId;

				if (!userId || !serverId || !targetUserId) {
					return reply
						.status(400)
						.send({ error: "serverId and targetUserId are required" });
				}

				const server = await prisma.server.findUnique({
					where: { id: serverId },
					select: { ownerId: true },
				});
				if (!server) {
					return reply.status(404).send({ error: "Server not found" });
				}

				const isOwner = server.ownerId === userId;
				const revoked = revokeSftpToken(
					targetUserId,
					serverId,
					userId,
					isOwner,
				);

				if (!revoked) {
					return reply
						.status(404)
						.send({ error: "No active token found, or not authorized" });
				}

				reply.send({ success: true });
			},
		);

		// Revoke ALL SFTP tokens for a server (owner-only)
		app.delete(
			"/api/sftp/tokens",
			{ preHandler: [authenticate] },
			async (request, reply) => {
				const userId = request.user?.userId;
				const serverId = (request.query as { serverId?: string }).serverId;

				if (!userId || !serverId) {
					return reply
						.status(400)
						.send({ error: "serverId query parameter is required" });
				}

				const server = await prisma.server.findUnique({
					where: { id: serverId },
					select: { ownerId: true },
				});
				if (!server) {
					return reply.status(404).send({ error: "Server not found" });
				}

				if (server.ownerId !== userId) {
					return reply
						.status(403)
						.send({ error: "Only the server owner can revoke all tokens" });
				}

				const count = revokeAllSftpTokensForServer(serverId);
				reply.send({ success: true, data: { revoked: count } });
			},
		);

		// Public update check endpoint (unauthenticated)
		app.get("/api/update/check", async (_request, reply) => {
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
			});
		});

		// Public theme settings endpoint (unauthenticated)
		app.get("/api/theme-settings/public", async (_request, reply) => {
			let settings = await prisma.themeSettings.findUnique({
				where: { id: "default" },
			});

			if (!settings) {
				settings = await prisma.themeSettings.create({
					data: { id: "default" },
				});
			}

			// Return only public fields
			const oidcMeta = (settings.metadata as Record<string, any>) || {};
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

			reply.send({
				success: true,
				data: {
					panelName: settings.panelName,
					logoUrl: settings.logoUrl,
					faviconUrl: settings.faviconUrl,
					defaultTheme: settings.defaultTheme,
					enabledThemes: settings.enabledThemes,
					primaryColor: settings.primaryColor,
					secondaryColor: settings.secondaryColor,
					accentColor: settings.accentColor,
					// Expose which OAuth/SSO providers are configured so the frontend
					// can hide login buttons and profile linking UI when not set up.
					authProviders: {
						whmcs: isProviderConfigured("whmcs"),
						paymenter: isProviderConfigured("paymenter"),
					},
					// Extended theme customization stored in metadata
					themeColors: (settings.metadata as any)?.themeColors || null,
					customCss: settings.customCss || null,
				},
			});
		});

		// Frontend error reporting endpoint (unauthenticated, rate-limited)
		app.post(
			"/api/system-errors/report",
			{
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
							.send({ error: "component and message are required" });
					}

					await captureSystemError({
						level: body.level || "error",
						component: body.component,
						message: body.message,
						stack: body.stack,
						metadata: body.metadata,
						...(request.user?.userId ? { userId: request.user.userId } : {}),
					});

					logger.info(
						{ component: body.component, level: body.level || "error" },
						"Frontend error reported",
					);

					return { success: true };
				} catch (err: any) {
					logger.error(err, "Failed to report frontend error");
					return reply.status(500).send({ error: "Failed to report error" });
				}
			},
		);

		// Initialize plugin system BEFORE starting server
		await pluginLoader.initialize();
		logger.info("Plugin system initialized");

		// Auto-enable plugins that were previously enabled
		const enabledPlugins = await prisma.plugin.findMany({
			where: { enabled: true },
		});
		for (const plugin of enabledPlugins) {
			try {
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

		// Start SFTP server
		if (process.env.SFTP_ENABLED !== "false") {
			startSFTPServer(logger);
		}

		// Start task scheduler
		await taskScheduler.start();
		logger.info(
			`Task scheduler started with ${taskScheduler.getScheduledTasksCount()} active tasks`,
		);

		// Start alert service
		await alertService.start();
		logger.info("Alert monitoring service started");

		// Start auto-updater
		if (process.env.AUTO_UPDATE_ENABLED === "true") {
			const { scheduleUpdateCheck } = await import("./services/auto-updater");
			scheduleUpdateCheck(
				parseInt(process.env.AUTO_UPDATE_INTERVAL_MS || "3600000"),
				logger,
			);
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
			backupRetentionInterval = startBackupRetention(prisma, logger);
			logger.info("Backup retention job scheduled");
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
	} catch (err) {
		logger.error(err, "Failed to start server");
		captureSystemError({
			level: 'critical',
			component: 'Bootstrap',
			message: err instanceof Error ? err.message : String(err),
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
): string {
	const shellEscape = (value: string) => `'${value.replace(/'/g, `'"'"'`)}'`;

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
NODE_API_KEY=${shellEscape(apiKey)}
NODE_HOSTNAME=${shellEscape(hostName)}

DEPLOY_SCRIPT_URL="\${BACKEND_HTTP_URL}/api/agent/deploy-script"
TMP_SCRIPT="$(mktemp /tmp/catalyst-deploy-agent.XXXXXX.sh)"

cleanup() {
  rm -f "$TMP_SCRIPT"
}
trap cleanup EXIT

echo "Fetching deploy script from \${DEPLOY_SCRIPT_URL}"
curl -fsSL "\${DEPLOY_SCRIPT_URL}" -o "$TMP_SCRIPT"
chmod +x "$TMP_SCRIPT"

echo "Running deploy script..."
"$TMP_SCRIPT" "$BACKEND_HTTP_URL" "$NODE_ID" "$NODE_API_KEY" "$NODE_HOSTNAME"
`;
}

async function shutdown(signal: string) {
	logger.info(`Received ${signal}, shutting down gracefully...`);
	await app.close();
	taskScheduler?.stop();
	alertService?.stop();
	wsGateway?.destroy();
	pluginLoader?.shutdown().catch(() => {});
	fileTunnel?.destroy();
	if (auditRetentionInterval) clearInterval(auditRetentionInterval);
	if (statRetentionInterval) clearInterval(statRetentionInterval);
	if (backupRetentionInterval) clearInterval(backupRetentionInterval);
	if (logRetentionInterval) clearInterval(logRetentionInterval);
	if (metricsRetentionInterval) clearInterval(metricsRetentionInterval);
	if (authRetentionInterval) clearInterval(authRetentionInterval);
	await prisma.$disconnect();
	process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

import { bootstrapCluster } from './cluster';

const run = () => bootstrap().catch((err) => {
	logger.error(err, "Bootstrap error");
	captureSystemError({
		level: 'critical',
		component: 'Bootstrap',
		message: err instanceof Error ? err.message : String(err),
		stack: err instanceof Error ? err.stack : undefined,
	}).catch(() => {});
	process.exit(1);
});

if (Number(process.env.WORKERS || 0) > 0) {
	bootstrapCluster(run);
} else {
	run();
}
