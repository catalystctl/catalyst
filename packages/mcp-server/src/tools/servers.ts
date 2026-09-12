import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { CatalystClient } from "../client.js";
import { toJsonText } from "../client.js";

function text(value: unknown) {
  return { content: [{ type: "text" as const, text: toJsonText(value) }] };
}

const serverId = z.string().describe("Server ID (cuid)");

export function registerServerTools(server: McpServer, client: CatalystClient): void {
  server.registerTool(
    "list_servers",
    {
      description: "List servers visible to the API key (GET /api/servers). Supports search and pagination.",
      inputSchema: z.object({
        page: z.number().int().min(1).optional(),
        limit: z.number().int().min(1).max(100).optional(),
        search: z.string().optional(),
        withMetrics: z.boolean().optional().describe("Include live resource metrics"),
      }),
    },
    async (args) => text(await client.get("/servers", args)),
  );

  server.registerTool(
    "get_server",
    {
      description: "Full details for one server (GET /api/servers/:id).",
      inputSchema: z.object({ serverId }),
    },
    async (args) => text(await client.get(`/servers/${args.serverId}`)),
  );

  server.registerTool(
    "create_server",
    {
      description: "Create a game server (POST /api/servers). Needs templateId, nodeId, and resource allocations.",
      inputSchema: z.object({
        name: z.string().min(1).max(100),
        templateId: z.string(),
        nodeId: z.string(),
        locationId: z.string().optional(),
        description: z.string().optional(),
        allocatedMemoryMb: z.number().int().min(128).optional(),
        allocatedCpuCores: z.number().optional(),
        allocatedDiskMb: z.number().int().min(1024).optional(),
        environment: z.record(z.string(), z.string()).optional().describe("Template variable overrides"),
        startupCommand: z.string().optional(),
      }),
    },
    async (args) => text(await client.post("/servers", args)),
  );

  server.registerTool(
    "update_server",
    {
      description: "Update server name, resources, environment, or startup command (PUT /api/servers/:id).",
      inputSchema: z.object({
        serverId,
        name: z.string().min(1).max(100).optional(),
        description: z.string().optional(),
        allocatedMemoryMb: z.number().int().min(128).optional(),
        allocatedCpuCores: z.number().optional(),
        allocatedDiskMb: z.number().int().min(1024).optional(),
        environment: z.record(z.string(), z.string()).optional(),
        startupCommand: z.string().optional(),
      }),
    },
    async (args) => {
      const { serverId: id, ...body } = args;
      return text(await client.put(`/servers/${id}`, body));
    },
  );

  server.registerTool(
    "delete_server",
    {
      description: "Delete a stopped server (DELETE /api/servers/:id).",
      inputSchema: z.object({ serverId }),
    },
    async (args) => text(await client.delete(`/servers/${args.serverId}`)),
  );

  server.registerTool(
    "clone_server",
    {
      description: "Clone a server onto the same or another node (POST /api/servers/:id/clone).",
      inputSchema: z.object({
        serverId,
        name: z.string().min(1).max(100).describe("Name for the cloned server"),
        nodeId: z.string().optional().describe("Target node (defaults to source node)"),
      }),
    },
    async (args) => text(await client.post(`/servers/${args.serverId}/clone`, { name: args.name, nodeId: args.nodeId })),
  );

  server.registerTool(
    "resize_server_disk",
    {
      description: "Resize server disk. Growing works online; shrinking needs the server stopped (POST /api/servers/:id/storage/resize).",
      inputSchema: z.object({
        serverId,
        allocatedDiskMb: z.number().int().min(1024).describe("New disk size in MB"),
      }),
    },
    async (args) => text(await client.post(`/servers/${args.serverId}/storage/resize`, { allocatedDiskMb: args.allocatedDiskMb })),
  );

  const power = (name: string, action: string, description: string, extra?: z.ZodRawShape) =>
    server.registerTool(
      name,
      {
        description,
        inputSchema: z.object({ serverId, ...(extra ?? {}) }),
      },
      async (args: { serverId: string } & Record<string, unknown>) => {
        const { serverId: id, ...body } = args;
        return text(await client.post(`/servers/${id}/${action}`, body));
      },
    );

  power("start_server", "start", "Start a server (POST /api/servers/:id/start).");
  power("stop_server", "stop", "Stop a server gracefully (POST /api/servers/:id/stop).");
  power("restart_server", "restart", "Restart a server (POST /api/servers/:id/restart).");
  power("kill_server", "kill", "Force-kill a server process (POST /api/servers/:id/kill).");
  power("install_server", "install", "Run the first-time installer (POST /api/servers/:id/install).");
  power("reinstall_server", "reinstall", "Wipe disk and reinstall from scratch. Irreversible (POST /api/servers/:id/reinstall).");
  power("cancel_install", "cancel-install", "Cancel a stuck installer and reset to stopped (POST /api/servers/:id/cancel-install).");
  power("rebuild_server", "rebuild", "Rebuild the container while preserving data (POST /api/servers/:id/rebuild).");
  power(
    "suspend_server",
    "suspend",
    "Suspend a server with an optional reason (POST /api/servers/:id/suspend).",
    { reason: z.string().optional(), stopServer: z.boolean().optional() },
  );
  power("unsuspend_server", "unsuspend", "Lift a suspension (POST /api/servers/:id/unsuspend).");

  server.registerTool(
    "respond_to_eula",
    {
      description: "Accept or decline a Minecraft-style EULA prompt (POST /api/servers/eula).",
      inputSchema: z.object({
        serverId: z.string().describe("Server waiting on the EULA prompt"),
        accepted: z.boolean().describe("True to accept, false to decline"),
      }),
    },
    async (args) => text(await client.post("/servers/eula", args)),
  );

  server.registerTool(
    "send_console_command",
    {
      description: "Send a console command to a running server (POST /api/servers/:id/console/command).",
      inputSchema: z.object({
        serverId,
        command: z.string().min(1).describe("Command to execute, without leading slash"),
      }),
    },
    async (args) => text(await client.post(`/servers/${args.serverId}/console/command`, { command: args.command })),
  );

  server.registerTool(
    "get_server_logs",
    {
      description: "Recent stored console output for a server (GET /api/servers/:id/logs).",
      inputSchema: z.object({
        serverId,
        limit: z.number().int().min(1).max(1000).optional(),
      }),
    },
    async (args) => text(await client.get(`/servers/${args.serverId}/logs`, { limit: args.limit })),
  );

  server.registerTool(
    "get_server_variables",
    {
      description: "Template variables and current values for a server (GET /api/servers/:id/variables).",
      inputSchema: z.object({ serverId }),
    },
    async (args) => text(await client.get(`/servers/${args.serverId}/variables`)),
  );

  server.registerTool(
    "update_server_variables",
    {
      description: "Update startup/environment variables for a server (PATCH /api/servers/:id/variables).",
      inputSchema: z.object({
        serverId,
        variables: z.record(z.string(), z.string()).describe("Variable key/value pairs"),
      }),
    },
    async (args) => text(await client.patch(`/servers/${args.serverId}/variables`, { variables: args.variables })),
  );
}
