import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { CatalystClient } from "../client.js";
import { toJsonText } from "../client.js";

function text(value: unknown) {
  return { content: [{ type: "text" as const, text: toJsonText(value) }] };
}

const roleScope = z
  .object({
    mode: z.enum(["none", "servers", "nodes"]).describe("none clears all scoped grants"),
    serverIds: z.array(z.string()).optional().describe("Required when mode is servers"),
    nodeIds: z.array(z.string()).optional().describe("Required when mode is nodes; use * for all nodes"),
    permissions: z.array(z.string()).optional().describe("Scoped permissions, e.g. [file.read, console.read]"),
  })
  .describe("Role wizard scoped access (replace-all semantics)");

export function registerRoleExtraTools(server: McpServer, client: CatalystClient): void {
  server.registerTool(
    "list_role_presets",
    {
      description: "Ready-made permission bundles for creating roles (GET /api/roles/presets).",
      inputSchema: z.object({}),
    },
    async () => text(await client.get("/roles/presets")),
  );

  server.registerTool(
    "get_user_roles",
    {
      description: "Roles and aggregated permissions for one user (GET /api/roles/users/:userId/roles).",
      inputSchema: z.object({ userId: z.string() }),
    },
    async (args) => text(await client.get(`/roles/users/${args.userId}/roles`)),
  );

  server.registerTool(
    "add_role_permission",
    {
      description: "Add a single permission to a role (POST /api/roles/:id/permissions). You cannot touch roles you belong to.",
      inputSchema: z.object({ roleId: z.string(), permission: z.string() }),
    },
    async (args) => text(await client.post(`/roles/${args.roleId}/permissions`, { permission: args.permission })),
  );

  server.registerTool(
    "remove_role_permission",
    {
      description: "Remove a single permission from a role (DELETE /api/roles/:id/permissions/:permission).",
      inputSchema: z.object({ roleId: z.string(), permission: z.string() }),
    },
    async (args) => text(await client.delete(`/roles/${args.roleId}/permissions/${encodeURIComponent(args.permission)}`)),
  );

  server.registerTool(
    "set_role_scope",
    {
      description: "Replace a role's server/node scoped grants (PUT /api/roles/:id with scope). Mode none clears grants.",
      inputSchema: z.object({ roleId: z.string(), scope: roleScope }),
    },
    async (args) => text(await client.put(`/roles/${args.roleId}`, { scope: args.scope })),
  );

  server.registerTool(
    "list_role_nodes",
    {
      description: "Nodes assigned to a role, including wildcard coverage (GET /api/roles/:id/nodes).",
      inputSchema: z.object({ roleId: z.string() }),
    },
    async (args) => text(await client.get(`/roles/${args.roleId}/nodes`)),
  );

  server.registerTool(
    "get_user_nodes",
    {
      description: "Nodes a user can reach via assignments and roles (GET /api/roles/users/:userId/nodes).",
      inputSchema: z.object({ userId: z.string() }),
    },
    async (args) => text(await client.get(`/roles/users/${args.userId}/nodes`)),
  );
}

export function registerNodeExtraTools(server: McpServer, client: CatalystClient): void {
  server.registerTool(
    "get_node_metrics_history",
    {
      description: "Time-series CPU/memory/disk history for a node (GET /api/nodes/:id/metrics).",
      inputSchema: z.object({
        nodeId: z.string(),
        hours: z.number().int().min(1).max(168).optional(),
        limit: z.number().int().min(1).max(1000).optional(),
      }),
    },
    async (args) => text(await client.get(`/nodes/${args.nodeId}/metrics`, { hours: args.hours, limit: args.limit })),
  );

  server.registerTool(
    "list_node_assignments",
    {
      description: "User/role assignments on a node (GET /api/nodes/:id/assignments).",
      inputSchema: z.object({ nodeId: z.string() }),
    },
    async (args) => text(await client.get(`/nodes/${args.nodeId}/assignments`)),
  );

  server.registerTool(
    "assign_node",
    {
      description: "Assign a node to a user or role, optionally expiring (POST /api/nodes/:id/assign).",
      inputSchema: z.object({
        nodeId: z.string(),
        userId: z.string().optional().describe("User to assign (one of userId or roleId)"),
        roleId: z.string().optional().describe("Role to assign (one of userId or roleId)"),
        expiresAt: z.string().optional().describe("ISO timestamp for temporary access"),
      }),
    },
    async (args) => {
      const { nodeId, ...body } = args;
      return text(await client.post(`/nodes/${nodeId}/assign`, body));
    },
  );

  server.registerTool(
    "remove_node_assignment",
    {
      description: "Remove a node assignment (DELETE /api/nodes/:id/assignments/:assignmentId).",
      inputSchema: z.object({ nodeId: z.string(), assignmentId: z.string() }),
    },
    async (args) => text(await client.delete(`/nodes/${args.nodeId}/assignments/${args.assignmentId}`)),
  );
}

export function registerAuditTools(server: McpServer, client: CatalystClient): void {
  server.registerTool(
    "list_audit_logs",
    {
      description: "Panel audit log with user/action/resource filters (GET /api/admin/audit-logs).",
      inputSchema: z.object({
        page: z.number().int().min(1).optional(),
        limit: z.number().int().min(1).max(100).optional(),
        userId: z.string().optional(),
        action: z.string().optional().describe("Substring match, e.g. server.start"),
        resource: z.string().optional(),
        from: z.string().optional().describe("ISO start timestamp"),
        to: z.string().optional().describe("ISO end timestamp"),
      }),
    },
    async (args) => text(await client.get("/admin/audit-logs", args)),
  );

  server.registerTool(
    "list_system_errors",
    {
      description: "Captured panel/agent errors with level and resolution filters (GET /api/admin/system-errors).",
      inputSchema: z.object({
        page: z.number().int().min(1).optional(),
        limit: z.number().int().min(1).max(100).optional(),
        level: z.string().optional().describe("error, warn, or critical"),
        component: z.string().optional().describe("Substring match, e.g. WebSocketGateway"),
        nodeId: z.string().optional(),
        resolved: z.boolean().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
      }),
    },
    async (args) => text(await client.get("/admin/system-errors", args)),
  );

  server.registerTool(
    "resolve_system_error",
    {
      description: "Mark one system error resolved (POST /api/admin/system-errors/:id/resolve).",
      inputSchema: z.object({ errorId: z.string() }),
    },
    async (args) => text(await client.post(`/admin/system-errors/${args.errorId}/resolve`, {})),
  );

  server.registerTool(
    "resolve_all_system_errors",
    {
      description: "Mark all currently unresolved system errors resolved (POST /api/admin/system-errors/resolve-all).",
      inputSchema: z.object({}),
    },
    async () => text(await client.post("/admin/system-errors/resolve-all", {})),
  );
}

export function registerDatabaseHostTools(server: McpServer, client: CatalystClient): void {
  server.registerTool(
    "list_db_hosts",
    {
      description: "MySQL/Postgres hosts the panel can provision from (GET /api/admin/database-hosts).",
      inputSchema: z.object({}),
    },
    async () => text(await client.get("/admin/database-hosts")),
  );

  server.registerTool(
    "create_db_host",
    {
      description: "Register a database host (POST /api/admin/database-hosts).",
      inputSchema: z.object({
        name: z.string().min(3),
        host: z.string(),
        username: z.string(),
        password: z.string(),
        port: z.number().int().min(1).max(65535).optional(),
        engine: z.enum(["mysql", "postgresql", "postgres"]).optional(),
        database: z.string().optional(),
      }),
    },
    async (args) => text(await client.post("/admin/database-hosts", args)),
  );

  server.registerTool(
    "update_db_host",
    {
      description: "Update a database host (PUT /api/admin/database-hosts/:id).",
      inputSchema: z.object({
        hostId: z.string(),
        name: z.string().optional(),
        host: z.string().optional(),
        port: z.number().int().min(1).max(65535).optional(),
        username: z.string().optional(),
        password: z.string().optional(),
      }),
    },
    async (args) => {
      const { hostId, ...body } = args;
      return text(await client.put(`/admin/database-hosts/${hostId}`, body));
    },
  );

  server.registerTool(
    "delete_db_host",
    {
      description: "Delete a database host with no live databases (DELETE /api/admin/database-hosts/:id).",
      inputSchema: z.object({ hostId: z.string() }),
    },
    async (args) => text(await client.delete(`/admin/database-hosts/${args.hostId}`)),
  );

  server.registerTool(
    "ping_db_host",
    {
      description: "Test connectivity to a database host (POST /api/admin/database-hosts/:id/ping).",
      inputSchema: z.object({ hostId: z.string() }),
    },
    async (args) => text(await client.post(`/admin/database-hosts/${args.hostId}/ping`, {})),
  );
}

export function registerAlertExtraTools(server: McpServer, client: CatalystClient): void {
  server.registerTool(
    "get_alert_rule",
    {
      description: "One alert rule with conditions and actions (GET /api/alert-rules/:id).",
      inputSchema: z.object({ ruleId: z.string() }),
    },
    async (args) => text(await client.get(`/alert-rules/${args.ruleId}`)),
  );

  server.registerTool(
    "update_alert_rule",
    {
      description: "Update an alert rule's name, conditions, actions, or enabled flag (PUT /api/alert-rules/:id).",
      inputSchema: z.object({
        ruleId: z.string(),
        name: z.string().optional(),
        description: z.string().optional(),
        conditions: z.record(z.string(), z.unknown()).optional(),
        actions: z.record(z.string(), z.unknown()).optional(),
        enabled: z.boolean().optional(),
      }),
    },
    async (args) => {
      const { ruleId, ...body } = args;
      return text(await client.put(`/alert-rules/${ruleId}`, body));
    },
  );

  server.registerTool(
    "delete_alert_rule",
    {
      description: "Delete an alert rule (DELETE /api/alert-rules/:id).",
      inputSchema: z.object({ ruleId: z.string() }),
    },
    async (args) => text(await client.delete(`/alert-rules/${args.ruleId}`)),
  );

  server.registerTool(
    "list_alert_deliveries",
    {
      description: "Email/webhook delivery attempts for one alert (GET /api/alerts/:id/deliveries).",
      inputSchema: z.object({ alertId: z.string() }),
    },
    async (args) => text(await client.get(`/alerts/${args.alertId}/deliveries`)),
  );

  server.registerTool(
    "bulk_resolve_alerts",
    {
      description: "Resolve many alerts at once (POST /api/alerts/bulk-resolve).",
      inputSchema: z.object({ alertIds: z.array(z.string()).min(1) }),
    },
    async (args) => text(await client.post("/alerts/bulk-resolve", { alertIds: args.alertIds })),
  );

  server.registerTool(
    "get_alert_stats",
    {
      description: "Alert totals by severity and type (GET /api/alerts/stats).",
      inputSchema: z.object({ scope: z.enum(["mine", "all"]).optional() }),
    },
    async (args) => text(await client.get("/alerts/stats", args)),
  );
}

export function registerPluginTools(server: McpServer, client: CatalystClient): void {
  server.registerTool(
    "list_panel_plugins",
    {
      description: "Installed panel plugins with status and consent state (GET /api/plugins).",
      inputSchema: z.object({}),
    },
    async () => text(await client.get("/plugins")),
  );

  server.registerTool(
    "get_panel_plugin",
    {
      description: "One plugin's capabilities, config, and permission state (GET /api/plugins/:name).",
      inputSchema: z.object({ name: z.string() }),
    },
    async (args) => text(await client.get(`/plugins/${args.name}`)),
  );

  server.registerTool(
    "set_panel_plugin_enabled",
    {
      description: "Enable or disable a plugin. Enabling may require safety disclaimer acceptance (POST /api/plugins/:name/enable).",
      inputSchema: z.object({
        name: z.string(),
        enabled: z.boolean(),
        disclaimerVersion: z.string().optional().describe("Safety disclaimer version being accepted, when prompted"),
      }),
    },
    async (args) =>
      text(
        await client.post(`/plugins/${args.name}/enable`, {
          enabled: args.enabled,
          safety: args.disclaimerVersion ? { disclaimerVersion: args.disclaimerVersion } : undefined,
        }),
      ),
  );

  server.registerTool(
    "reload_panel_plugin",
    {
      description: "Hot-reload a plugin without restarting the panel (POST /api/plugins/:name/reload).",
      inputSchema: z.object({ name: z.string() }),
    },
    async (args) => text(await client.post(`/plugins/${args.name}/reload`, {})),
  );

  server.registerTool(
    "install_panel_plugin",
    {
      description: "Download and stage a plugin package; it stays inert until enabled (POST /api/plugins/install).",
      inputSchema: z.object({
        url: z.string().url(),
        sha256: z.string().regex(/^[0-9a-fA-F]{64}$/).optional(),
      }),
    },
    async (args) => text(await client.post("/plugins/install", args)),
  );

  server.registerTool(
    "browse_plugin_marketplace",
    {
      description: "Browse configured plugin marketplace indexes (GET /api/plugins/marketplace).",
      inputSchema: z.object({ forceRefresh: z.boolean().optional() }),
    },
    async (args) => text(await client.get("/plugins/marketplace", { forceRefresh: args.forceRefresh })),
  );
}

export function registerMigrationTools(server: McpServer, client: CatalystClient): void {
  server.registerTool(
    "list_migration_jobs",
    {
      description: "Pterodactyl migration jobs (GET /api/admin/migration).",
      inputSchema: z.object({}),
    },
    async () => text(await client.get("/admin/migration")),
  );

  server.registerTool(
    "get_migration_job",
    {
      description: "One migration job with status (GET /api/admin/migration/:jobId).",
      inputSchema: z.object({ jobId: z.string() }),
    },
    async (args) => text(await client.get(`/admin/migration/${args.jobId}`)),
  );

  server.registerTool(
    "get_migration_steps",
    {
      description: "Step-level progress of a migration job (GET /api/admin/migration/:jobId/steps).",
      inputSchema: z.object({ jobId: z.string() }),
    },
    async (args) => text(await client.get(`/admin/migration/${args.jobId}/steps`)),
  );

  const jobAction = (name: string, action: string, description: string) =>
    server.registerTool(
      name,
      {
        description,
        inputSchema: z.object({ jobId: z.string() }),
      },
      async (args) => text(await client.post(`/admin/migration/${args.jobId}/${action}`, {})),
    );

  jobAction("pause_migration_job", "pause", "Pause a running migration job (POST /api/admin/migration/:jobId/pause).");
  jobAction("resume_migration_job", "resume", "Resume a paused migration job (POST /api/admin/migration/:jobId/resume).");
  jobAction("cancel_migration_job", "cancel", "Cancel a migration job (POST /api/admin/migration/:jobId/cancel).");

  server.registerTool(
    "retry_migration_step",
    {
      description: "Retry one failed migration step (POST /api/admin/migration/:jobId/retry/:stepId).",
      inputSchema: z.object({ jobId: z.string(), stepId: z.string() }),
    },
    async (args) => text(await client.post(`/admin/migration/${args.jobId}/retry/${args.stepId}`, {})),
  );
}

export function registerSystemTools(server: McpServer, client: CatalystClient): void {
  server.registerTool(
    "get_update_status",
    {
      description: "Panel version, latest release, and update availability (GET /api/admin/update/status).",
      inputSchema: z.object({}),
    },
    async () => text(await client.get("/admin/update/status")),
  );

  server.registerTool(
    "trigger_panel_update",
    {
      description: "Start a panel update. Disruptive: run only with approval (POST /api/admin/update/trigger).",
      inputSchema: z.object({}),
    },
    async () => text(await client.post("/admin/update/trigger", {})),
  );

  server.registerTool(
    "get_provider_key_status",
    {
      description: "Which mod-provider API keys are configured, booleans only (GET /api/providers/status).",
      inputSchema: z.object({}),
    },
    async () => text(await client.get("/providers/status")),
  );
}
