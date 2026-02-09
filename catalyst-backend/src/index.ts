import "dotenv/config";
import Fastify from "fastify";
import fs from "fs";
import path from "path";
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
import { WebSocketGateway } from "./websocket/gateway";
import { authRoutes } from "./routes/auth";
import { nodeRoutes } from "./routes/nodes";
import { serverRoutes } from "./routes/servers";
import { templateRoutes } from "./routes/templates";
import { metricsRoutes } from "./routes/metrics";
import { backupRoutes } from "./routes/backups";
import { RbacMiddleware } from "./middleware/rbac";
import { startSFTPServer } from "./sftp-server";
import { adminRoutes } from "./routes/admin";
import { taskRoutes } from "./routes/tasks";
import { TaskScheduler } from "./services/task-scheduler";
import { alertRoutes } from "./routes/alerts";
import { apiKeyRoutes } from "./routes/api-keys";
import { AlertService } from "./services/alert-service";
import { getSecuritySettings } from "./services/mailer";
import { startAuditRetention } from "./services/audit-retention";
import { auth } from "./auth";
import { fromNodeHeaders } from "better-auth/node";
import { normalizeHostIp } from "./utils/ipam";
import { PluginLoader } from "./plugins/loader";
import { pluginRoutes } from "./routes/plugins";

const logger = pino(
  process.env.NODE_ENV === "production"
    ? { level: process.env.LOG_LEVEL || "info" }
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }
);

const app = Fastify({
  logger: true,
  bodyLimit: 104857600, // 100MB for file uploads
});

app.setErrorHandler((error, _request, reply) => {
  app.log.error(error);
  const status = (error as any).statusCode && (error as any).statusCode >= 400 ? (error as any).statusCode : 500;
  let message = "Internal Server Error";
  if (status !== 500) {
    const raw = (error as Error).message || "";
    // Only expose safe, short validation messages — never Prisma or internal details
    const isPrismaError = raw.includes("prisma") || raw.includes("Unique constraint") || raw.includes("Foreign key");
    message = raw.includes("\n") || raw.length > 200 || isPrismaError ? "Bad Request" : raw;
  }
  reply.status(status).send({ error: message });
});

const wsGateway = new WebSocketGateway(prisma, logger);
const rbac = new RbacMiddleware(prisma);
const taskScheduler = new TaskScheduler(prisma, logger);
const alertService = new AlertService(prisma, logger);
const pluginLoader = new PluginLoader(
  process.env.PLUGINS_DIR || path.join(process.cwd(), '..', 'catalyst-plugins'),
  prisma,
  logger,
  wsGateway,
  app,
  { hotReload: process.env.PLUGIN_HOT_RELOAD !== 'false' }
);
let auditRetentionInterval: ReturnType<typeof setInterval> | null = null;

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
      logger.warn({ taskId: task.id, serverId: server.id }, "Scheduled task blocked: server suspended");
      return;
    }
    const serverDir = process.env.SERVER_DATA_PATH || "/tmp/catalyst-servers";
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
          { nodeId: server.nodeId, hostIp: server.node.publicAddress, error: error.message },
          "Invalid host network IP"
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
        logger.warn({ taskId: task.id }, "Scheduled task command missing payload.command");
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
        // Use better-auth's built-in API key verification
        const verification = await auth.api.verifyApiKey({
          body: {
            key: token,
          },
        } as any);
        const verificationData = (verification as any)?.response ?? verification;

        if (!verificationData?.valid || !verificationData?.key || !verificationData?.user) {
          reply.status(401).send({ error: "Invalid API key" });
          return;
        }

        // Attach user info from verification
        request.user = {
          userId: verificationData.user.id,
          email: verificationData.user.email,
          username: verificationData.user.username,
          apiKeyId: verificationData.key.id,
        };
        return; // API key auth successful
      } catch (error: any) {
        logger.error(error, "API key authentication error");
        reply.status(401).send({ error: "Invalid or expired API key" });
        return;
      }
    }
  }

  // Fall back to session authentication
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(request.headers as Record<string, string | string[] | undefined>),
    });
    if (!session) {
      reply.status(401).send({ error: "Unauthorized" });
      return;
    }
    request.user = {
      userId: session.user.id,
      email: session.user.email,
      username: (session.user as any).username,
    };
  } catch {
    reply.status(401).send({ error: "Unauthorized" });
    return;
  }
};

(app as any).authenticate = authenticate;
(app as any).wsGateway = wsGateway;
(app as any).taskScheduler = taskScheduler;
(app as any).alertService = alertService;
(app as any).auth = auth;
(app as any).prisma = prisma;
(app as any).rbac = rbac;
(app as any).pluginLoader = pluginLoader;

// ============================================================================
// SETUP
// ============================================================================

async function bootstrap() {
  try {
    // Register security plugins
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
      hsts: process.env.NODE_ENV === "production"
        ? { maxAge: 31536000, includeSubDomains: true, preload: true }
        : false,
    });
    
    await app.register(fastifyRateLimit, {
      global: true,
      max: 200, // Per-IP limit: 200 requests
      timeWindow: '1 minute',
      errorResponseBuilder: () => ({
        error: 'Rate limit exceeded',
        message: 'Too many requests. Please try again later.',
      }),
      keyGenerator: (request) => {
        // Use user ID for authenticated requests, IP for unauthenticated
        return (request as any).user?.userId || request.ip;
      },
      allowList: async (request) => {
        const query = (request.query as { nodeId?: string; token?: string }) || {};
        const headerNodeId =
          typeof (request.headers["x-catalyst-node-id"] ?? request.headers["x-catalyst-nodeid"]) === "string"
            ? (request.headers["x-catalyst-node-id"] ?? request.headers["x-catalyst-nodeid"])
            : null;
        const headerToken =
          typeof request.headers["x-catalyst-node-token"] === "string"
            ? request.headers["x-catalyst-node-token"]
            : null;
        const nodeId = headerNodeId ?? (typeof query.nodeId === "string" ? query.nodeId : null);
        const token = headerToken ?? (typeof query.token === "string" ? query.token : null);
        if (!nodeId || !token) {
          return false;
        }
        const node = await prisma.node.findUnique({ where: { id: nodeId as string } });
        if (!node || token.length !== node.secret.length) return false;
        return crypto.timingSafeEqual(Buffer.from(node.secret), Buffer.from(token));
      },
      skipOnError: false,
    });

    await app.register(fastifyMultipart, {
      limits: {
        fileSize: 104857600,
      },
    });

    // Register plugins
    const allowedOrigins = [
      'http://localhost:3000',
      'http://localhost:5173', // Vite dev server
      'http://127.0.0.1:3000',
      'http://127.0.0.1:5173',
      ...(process.env.CORS_ORIGIN?.split(',').map(s => s.trim()) ?? []),
    ].filter(Boolean) as string[];
    const isAllowedOrigin = (origin?: string) =>
      Boolean(origin && allowedOrigins.includes(origin));

    await app.register(fastifyCors, {
      origin: (origin, callback) => {
        callback(null, isAllowedOrigin(origin));
      },
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "X-Client-Info"],
        credentials: true,
        maxAge: 86400,
      });

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
        logger.error(error, "WebSocket error handler");
      },
    });

    // Health check (exempt from rate limiting)
    app.get("/health", { 
      config: { rateLimit: { max: 1000000000, timeWindow: '1 minute' } }
    }, async (request, reply) => {
      return { status: "ok", timestamp: new Date().toISOString() };
    });

    // WebSocket gateway
    app.register(async (app) => {
      app.get("/ws", { websocket: true }, async (socket, request) => {
        await wsGateway.handleConnection(socket, request);
      });
    });

    // API Routes
    const authRateLimit = {
      config: {
        rateLimit: {
          max: async () => {
            const settings = await getSecuritySettings();
            return settings.authRateLimitMax;
          },
          timeWindow: '1 minute',
          allowList: (request) => request.url.startsWith("/api/auth/passkey/"),
        },
      },
    };
    await app.register(authRoutes, { prefix: "/api/auth", ...authRateLimit });
    app.route({
      method: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      url: "/api/auth/*",
      config: authRateLimit.config,
      handler: async (request, reply) => {
        if (request.method === "OPTIONS") {
          return reply.status(204).send();
        }
        if (
          request.url === "/api/auth/login" ||
          request.url === "/api/auth/register" ||
          request.url === "/api/auth/me"
        ) {
          return;
        }
        const url = new URL(request.url, `http://${request.headers.host ?? "localhost:3000"}`);
        const headers = new Headers();
        Object.entries(request.headers).forEach(([key, value]) => {
          if (typeof value === "string") {
            headers.append(key, value);
          } else if (Array.isArray(value)) {
            value.forEach((item) => headers.append(key, item));
          }
        });
        const body =
          request.method === "GET" || request.method === "HEAD" || request.body === null
            ? undefined
            : typeof request.body === "string"
              ? request.body
              : Buffer.isBuffer(request.body)
                ? request.body
                : JSON.stringify(request.body);
        const req = new Request(url.toString(), {
          method: request.method,
          headers,
          ...(body ? { body: Buffer.isBuffer(body) ? body.toString() : body } : {}),
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
                .filter(Boolean)
            );
          }
        }
        if (url.pathname === "/api/auth/sign-out") {
          setCookies.push("better-auth-passkey=; Max-Age=0; Path=/; SameSite=Lax; HttpOnly");
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
    await app.register(templateRoutes, { prefix: "/api/templates" });
    await app.register(metricsRoutes, { prefix: "/api" });
    await app.register(backupRoutes, { prefix: "/api/servers" });
    await app.register(adminRoutes, { prefix: "/api/admin" });
    await app.register(taskRoutes, { prefix: "/api/servers" });
    await app.register(alertRoutes, { prefix: "/api" });
    await app.register(apiKeyRoutes);
    await app.register((app) => pluginRoutes(app, pluginLoader));

    // Agent binary download endpoint (public)
    app.get("/api/agent/download", async (_request, reply) => {
      const agentPath = path.resolve(
        process.cwd(),
        "..",
        "catalyst-agent",
        "target",
        "release",
        "catalyst-agent"
      );

      if (!fs.existsSync(agentPath)) {
        // Attempt to build the agent automatically (only in development)
        if (process.env.NODE_ENV === "production") {
          return reply.status(404).send({ error: "Agent binary not found. Please build with 'cargo build --release' in catalyst-agent/" });
        }

        app.log.warn("Agent binary not found, attempting to build...");
        
        const agentDir = path.resolve(process.cwd(), "..", "catalyst-agent");
        if (!fs.existsSync(agentDir)) {
          return reply.status(404).send({ error: "Agent source code not found" });
        }

        try {
          const { execSync } = await import("child_process");
          app.log.info("Building agent with 'cargo build --release'...");
          
          execSync("cargo build --release", {
            cwd: agentDir,
            stdio: "inherit",
            timeout: 300000, // 5 minutes
          });

          app.log.info("Agent built successfully");

          if (!fs.existsSync(agentPath)) {
            return reply.status(500).send({ error: "Agent build completed but binary not found" });
          }
        } catch (err) {
          app.log.error({ err }, "Failed to build agent");
          return reply.status(500).send({ 
            error: "Failed to build agent binary",
            details: err instanceof Error ? err.message : String(err)
          });
        }
      }

      reply.header("Content-Type", "application/octet-stream");
      reply.header("Content-Disposition", "attachment; filename=catalyst-agent");
      return reply.send(fs.createReadStream(agentPath));
    });

    // Canonical node deployment script endpoint (public)
    app.get("/api/agent/deploy-script", async (_request, reply) => {
      const deployScriptPath = path.resolve(process.cwd(), "..", "scripts", "deploy-agent.sh");

      if (!fs.existsSync(deployScriptPath)) {
        return reply.status(404).send({ error: "Deploy script not found" });
      }

      reply.header("Content-Type", "text/x-shellscript");
      reply.header("Content-Disposition", "attachment; filename=deploy-agent.sh");
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

      const baseUrl =
        process.env.BACKEND_URL || `${request.protocol}://${request.headers.host}`;
      const script = generateDeploymentScript(
        baseUrl,
        deployToken.node.id,
        deployToken.node.secret,
        deployToken.node.hostname,
        typeof apiKey === "string" ? apiKey : null,
      );

      reply.type("text/plain").send(script);
    });

    // SFTP connection info endpoint (authenticated)
    app.get("/api/sftp/connection-info", { preHandler: [authenticate] }, async (request, reply) => {
      const enabled = process.env.SFTP_ENABLED !== 'false';
      const port = parseInt(process.env.SFTP_PORT || '2022');
      const host = process.env.BACKEND_URL
        ? new URL(process.env.BACKEND_URL).hostname
        : process.env.BACKEND_EXTERNAL_ADDRESS
          ? new URL(process.env.BACKEND_EXTERNAL_ADDRESS).hostname
          : request.hostname.split(':')[0];

      // Find a valid session token for this user to use as SFTP password
      const userId = (request as any).user?.userId;
      let sftpPassword: string | null = null;
      if (userId) {
        const activeSession = await prisma.session.findFirst({
          where: { userId, expiresAt: { gt: new Date() } },
          orderBy: { createdAt: 'desc' },
          select: { token: true },
        });
        sftpPassword = activeSession?.token ?? null;
      }

      reply.send({
        success: true,
        data: { enabled, host, port, sftpPassword },
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
        },
      });
    });

    // Initialize plugin system BEFORE starting server
    await pluginLoader.initialize();
    logger.info('Plugin system initialized');

    // Auto-enable plugins that were previously enabled
    const enabledPlugins = await prisma.plugin.findMany({ where: { enabled: true } });
    for (const plugin of enabledPlugins) {
      try {
        await pluginLoader.enablePlugin(plugin.name);
      } catch (error: any) {
        logger.error({ plugin: plugin.name, error: error.message }, 'Failed to auto-enable plugin');
      }
    }

    // Start server
    await app.listen({ port: parseInt(process.env.PORT || "3000"), host: "0.0.0.0" });
    logger.info(
      `Catalyst Backend running on http://0.0.0.0:${process.env.PORT || 3000}`
    );

    // Start SFTP server
    if (process.env.SFTP_ENABLED !== 'false') {
      startSFTPServer(logger);
    }

    // Start task scheduler
    await taskScheduler.start();
    logger.info(`Task scheduler started with ${taskScheduler.getScheduledTasksCount()} active tasks`);

    // Start alert service
    await alertService.start();
    logger.info('Alert monitoring service started');

    auditRetentionInterval = startAuditRetention(prisma, logger);
    logger.info('Audit retention job scheduled');
  } catch (err) {
    logger.error(err, "Failed to start server");
    process.exit(1);
  }
}

// ============================================================================
// DEPLOYMENT SCRIPT GENERATOR
// ============================================================================

function generateDeploymentScript(
  backendUrl: string,
  nodeId: string,
  secret: string,
  hostName: string,
  apiKey: string | null,
): string {
  const shellEscape = (value: string) => `'${value.replace(/'/g, `'"'"'`)}'`;
  const safeApiKey = apiKey ?? "";

  return `#!/usr/bin/env bash
set -euo pipefail

BACKEND_HTTP_URL="${backendUrl}"
case "$BACKEND_HTTP_URL" in
  ws://*) BACKEND_HTTP_URL="http://\${BACKEND_HTTP_URL#ws://}" ;;
  wss://*) BACKEND_HTTP_URL="https://\${BACKEND_HTTP_URL#wss://}" ;;
esac
BACKEND_HTTP_URL="\${BACKEND_HTTP_URL%/}"
BACKEND_HTTP_URL="\${BACKEND_HTTP_URL%/ws}"
BACKEND_HTTP_URL="\${BACKEND_HTTP_URL%/}"

NODE_ID=${shellEscape(nodeId)}
NODE_SECRET=${shellEscape(secret)}
NODE_API_KEY=${shellEscape(safeApiKey)}
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
"$TMP_SCRIPT" "$BACKEND_HTTP_URL" "$NODE_ID" "$NODE_SECRET" "$NODE_API_KEY" "$NODE_HOSTNAME"
`;
}

bootstrap().catch((err) => {
  logger.error(err, "Bootstrap error");
  process.exit(1);
});
