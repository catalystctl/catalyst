import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { CatalystClient } from "../client.js";
import { toJsonText } from "../client.js";

function text(value: unknown) {
  return { content: [{ type: "text" as const, text: toJsonText(value) }] };
}

const pagination = {
  page: z.number().int().min(1).optional().describe("Page number, starting at 1"),
  limit: z.number().int().min(1).max(100).optional().describe("Items per page (max 100)"),
  search: z.string().optional().describe("Free-text search filter"),
};

export function registerMetaTools(server: McpServer, client: CatalystClient): void {
  server.registerTool(
    "panel_health",
    {
      description: "Check whether the Catalyst panel is reachable (unauthenticated /health probe).",
      inputSchema: z.object({}),
    },
    async () => text(await client.health()),
  );

  server.registerTool(
    "whoami",
    {
      description: "Show the identity and effective permissions of the configured API key (GET /api/auth/me).",
      inputSchema: z.object({}),
    },
    async () => text(await client.get("/auth/me")),
  );

  server.registerTool(
    "get_dashboard_stats",
    {
      description: "Panel-wide counts for servers, nodes, and alerts (GET /api/dashboard/stats).",
      inputSchema: z.object({}),
    },
    async () => text(await client.get("/dashboard/stats")),
  );

  server.registerTool(
    "get_recent_activity",
    {
      description: "Recent audit-log activity for the dashboard (GET /api/dashboard/activity).",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(20).optional().describe("Number of events (max 20)"),
      }),
    },
    async (args) => text(await client.get("/dashboard/activity", { limit: args.limit ?? 5 })),
  );

  server.registerTool(
    "list_permissions_catalog",
    {
      description: "Full permission catalog used by API keys and roles (GET /api/admin/api-keys/permissions-catalog).",
      inputSchema: z.object({}),
    },
    async () => text(await client.get("/admin/api-keys/permissions-catalog")),
  );

  server.registerTool(
    "get_my_permissions",
    {
      description: "Effective permissions of the configured API key owner (GET /api/admin/api-keys/my-permissions).",
      inputSchema: z.object({}),
    },
    async () => text(await client.get("/admin/api-keys/my-permissions")),
  );
}

export { pagination };
