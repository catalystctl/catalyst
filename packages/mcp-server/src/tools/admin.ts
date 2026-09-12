import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { CatalystClient } from "../client.js";
import { toJsonText } from "../client.js";

function text(value: unknown) {
  return { content: [{ type: "text" as const, text: toJsonText(value) }] };
}

export function registerUserTools(server: McpServer, client: CatalystClient): void {
  server.registerTool(
    "list_users",
    {
      description: "List panel users with search and pagination (GET /api/admin/users).",
      inputSchema: z.object({
        search: z.string().optional(),
        page: z.number().int().min(1).optional(),
        limit: z.number().int().min(1).max(100).optional(),
      }),
    },
    async (args) => text(await client.get("/admin/users", args)),
  );

  server.registerTool(
    "get_user",
    {
      description: "One user with roles, sessions, and login metadata (GET /api/admin/users/:id).",
      inputSchema: z.object({ userId: z.string() }),
    },
    async (args) => text(await client.get(`/admin/users/${args.userId}`)),
  );

  server.registerTool(
    "create_user",
    {
      description: "Create a user with email, username, and password (POST /api/admin/users).",
      inputSchema: z.object({
        email: z.string().email(),
        username: z.string().min(2).max(32),
        password: z.string().min(8).describe("Minimum 8 characters"),
        roleIds: z.array(z.string()).optional(),
      }),
    },
    async (args) => text(await client.post("/admin/users", args)),
  );

  server.registerTool(
    "update_user",
    {
      description: "Update email, username, or role assignments (PUT /api/admin/users/:id).",
      inputSchema: z.object({
        userId: z.string(),
        email: z.string().email().optional(),
        username: z.string().min(2).max(32).optional(),
        roleIds: z.array(z.string()).optional(),
      }),
    },
    async (args) => {
      const { userId, ...body } = args;
      return text(await client.put(`/admin/users/${userId}`, body));
    },
  );

  server.registerTool(
    "delete_user",
    {
      description: "Delete a user and revoke their access (DELETE /api/admin/users/:id/delete).",
      inputSchema: z.object({ userId: z.string() }),
    },
    async (args) => text(await client.post(`/admin/users/${args.userId}/delete`, {})),
  );

  server.registerTool(
    "ban_user",
    {
      description: "Ban a user with an optional reason and expiry (POST /api/admin/users/:id/ban).",
      inputSchema: z.object({
        userId: z.string(),
        reason: z.string().optional(),
        expiresAt: z.string().optional().describe("ISO timestamp when the ban expires"),
      }),
    },
    async (args) => {
      const { userId, ...body } = args;
      return text(await client.post(`/admin/users/${userId}/ban`, body));
    },
  );

  server.registerTool(
    "unban_user",
    {
      description: "Lift a user ban (POST /api/admin/users/:id/unban).",
      inputSchema: z.object({ userId: z.string() }),
    },
    async (args) => text(await client.post(`/admin/users/${args.userId}/unban`, {})),
  );

  server.registerTool(
    "list_user_servers",
    {
      description: "Servers a user owns or can access (GET /api/admin/users/:id/servers).",
      inputSchema: z.object({ userId: z.string() }),
    },
    async (args) => text(await client.get(`/admin/users/${args.userId}/servers`)),
  );
}

export function registerRoleTools(server: McpServer, client: CatalystClient): void {
  server.registerTool(
    "list_roles",
    {
      description: "List roles with permissions (GET /api/roles).",
      inputSchema: z.object({}),
    },
    async () => text(await client.get("/roles")),
  );

  server.registerTool(
    "get_role",
    {
      description: "One role with members and grants (GET /api/roles/:id).",
      inputSchema: z.object({ roleId: z.string() }),
    },
    async (args) => text(await client.get(`/roles/${args.roleId}`)),
  );

  server.registerTool(
    "create_role",
    {
      description: "Create a role with a permission set (POST /api/roles).",
      inputSchema: z.object({
        name: z.string(),
        description: z.string().optional(),
        permissions: z.array(z.string()).min(1).describe("e.g. [server.read, server.start] or [*]"),
        scope: z
          .object({
            mode: z.enum(["none", "servers", "nodes"]),
            serverIds: z.array(z.string()).optional(),
            nodeIds: z.array(z.string()).optional(),
            permissions: z.array(z.string()).optional(),
          })
          .optional()
          .describe("Scoped server/node grants (replace-all). See set_role_scope to change later."),
      }),
    },
    async (args) => text(await client.post("/roles", args)),
  );

  server.registerTool(
    "update_role",
    {
      description: "Rename a role or replace its permissions (PUT /api/roles/:id).",
      inputSchema: z.object({
        roleId: z.string(),
        name: z.string().optional(),
        description: z.string().optional(),
        permissions: z.array(z.string()).optional(),
        scope: z
          .object({
            mode: z.enum(["none", "servers", "nodes"]),
            serverIds: z.array(z.string()).optional(),
            nodeIds: z.array(z.string()).optional(),
            permissions: z.array(z.string()).optional(),
          })
          .optional()
          .describe("Replacement scoped grants; mode none clears them."),
      }),
    },
    async (args) => {
      const { roleId, ...body } = args;
      return text(await client.put(`/roles/${roleId}`, body));
    },
  );

  server.registerTool(
    "delete_role",
    {
      description: "Delete a role (DELETE /api/roles/:id). Members lose its permissions.",
      inputSchema: z.object({ roleId: z.string() }),
    },
    async (args) => text(await client.delete(`/roles/${args.roleId}`)),
  );

  server.registerTool(
    "assign_role_to_user",
    {
      description: "Add a user to a role (POST /api/roles/:roleId/users/:userId).",
      inputSchema: z.object({ roleId: z.string(), userId: z.string() }),
    },
    async (args) => text(await client.post(`/roles/${args.roleId}/users/${args.userId}`, {})),
  );

  server.registerTool(
    "remove_role_from_user",
    {
      description: "Remove a user from a role (DELETE /api/roles/:roleId/users/:userId).",
      inputSchema: z.object({ roleId: z.string(), userId: z.string() }),
    },
    async (args) => text(await client.delete(`/roles/${args.roleId}/users/${args.userId}`)),
  );
}

export function registerApiKeyTools(server: McpServer, client: CatalystClient): void {
  server.registerTool(
    "list_api_keys",
    {
      description: "List API keys (admin sees all; others see their own) (GET /api/admin/api-keys).",
      inputSchema: z.object({
        page: z.number().int().min(1).optional(),
        limit: z.number().int().min(1).max(100).optional(),
      }),
    },
    async (args) => text(await client.get("/admin/api-keys", args)),
  );

  server.registerTool(
    "create_api_key",
    {
      description: "Create an API key. The secret is returned once (POST /api/admin/api-keys).",
      inputSchema: z.object({
        name: z.string().min(1).max(100),
        allPermissions: z.boolean().optional().describe("Inherit the creator's full permission set"),
        permissions: z.array(z.string()).optional().describe("Scoped permissions when allPermissions is false"),
        expiresIn: z.number().int().min(3600).max(31536000).optional().describe("Lifetime in seconds"),
      }),
    },
    async (args) => text(await client.post("/admin/api-keys", args)),
  );

  server.registerTool(
    "get_api_key",
    {
      description: "One API key's metadata (never the secret) (GET /api/admin/api-keys/:id).",
      inputSchema: z.object({ keyId: z.string() }),
    },
    async (args) => text(await client.get(`/admin/api-keys/${args.keyId}`)),
  );

  server.registerTool(
    "update_api_key",
    {
      description: "Rename, enable/disable, or adjust rate limits (PATCH /api/admin/api-keys/:id).",
      inputSchema: z.object({
        keyId: z.string(),
        name: z.string().optional(),
        enabled: z.boolean().optional(),
        rateLimitMax: z.number().int().min(1).max(10000).optional(),
      }),
    },
    async (args) => {
      const { keyId, ...body } = args;
      return text(await client.patch(`/admin/api-keys/${keyId}`, body));
    },
  );

  server.registerTool(
    "delete_api_key",
    {
      description: "Revoke an API key immediately (DELETE /api/admin/api-keys/:id).",
      inputSchema: z.object({ keyId: z.string() }),
    },
    async (args) => text(await client.delete(`/admin/api-keys/${args.keyId}`)),
  );

  server.registerTool(
    "get_api_key_usage",
    {
      description: "Request counts and last-use timestamp for a key (GET /api/admin/api-keys/:id/usage).",
      inputSchema: z.object({ keyId: z.string() }),
    },
    async (args) => text(await client.get(`/admin/api-keys/${args.keyId}/usage`)),
  );
}

export function registerAlertTools(server: McpServer, client: CatalystClient): void {
  server.registerTool(
    "list_alert_rules",
    {
      description: "Alert rules for thresholds, offline nodes, and crashes (GET /api/alert-rules).",
      inputSchema: z.object({}),
    },
    async () => text(await client.get("/alert-rules")),
  );

  server.registerTool(
    "create_alert_rule",
    {
      description: "Create an alert rule (POST /api/alert-rules).",
      inputSchema: z.object({
        name: z.string(),
        type: z.enum(["resource_threshold", "node_offline", "server_crashed"]),
        target: z.enum(["server", "node", "global"]),
        targetId: z.string().optional(),
        conditions: z.record(z.string(), z.unknown()).describe("Thresholds, e.g. {cpuPercent: 90}"),
        actions: z.record(z.string(), z.unknown()).describe("Webhooks/notifications, e.g. {webhooks: [...]}"),
        description: z.string().optional(),
        enabled: z.boolean().optional(),
      }),
    },
    async (args) => text(await client.post("/alert-rules", args)),
  );

  server.registerTool(
    "list_alerts",
    {
      description: "Fired alerts, newest first (GET /api/alerts).",
      inputSchema: z.object({
        resolved: z.boolean().optional().describe("Filter by resolved state"),
        limit: z.number().int().min(1).max(100).optional(),
      }),
    },
    async (args) => text(await client.get("/alerts", args)),
  );

  server.registerTool(
    "resolve_alert",
    {
      description: "Mark an alert resolved (POST /api/alerts/:id/resolve).",
      inputSchema: z.object({ alertId: z.string() }),
    },
    async (args) => text(await client.post(`/alerts/${args.alertId}/resolve`, {})),
  );
}
