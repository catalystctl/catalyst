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
      description: "List servers visible to the API key (GET /api/servers). Supports offset pagination and live metrics.",
      inputSchema: z.object({
        offset: z.number().int().min(0).optional().describe("Servers to skip, for pagination"),
        limit: z.number().int().min(1).max(500).optional().describe("Page size, 1-500 (default 50)"),
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
      description:
        "Create a game server (POST /api/servers). Needs templateId, nodeId, locationId, primaryPort, and all three resource allocations. Get locationId from list_locations, nodeId from list_nodes, templateId from list_templates.",
      inputSchema: z.object({
        name: z.string().min(1).max(100),
        templateId: z.string(),
        nodeId: z.string(),
        locationId: z.string().describe("Location ID from list_locations (required)"),
        primaryPort: z
          .number()
          .int()
          .min(1)
          .max(65535)
          .describe("Primary port players connect on, e.g. 25565"),
        allocatedMemoryMb: z
          .number()
          .int()
          .min(512)
          .max(131072)
          .describe("Memory allocation in MB (512-131072)"),
        allocatedCpuCores: z
          .number()
          .int()
          .min(1)
          .max(128)
          .describe("CPU allocation in whole cores (1-128)"),
        allocatedDiskMb: z
          .number()
          .int()
          .min(1024)
          .max(1048576)
          .describe("Disk allocation in MB (1024-1048576)"),
        description: z.string().max(500).optional(),
        ownerId: z.string().optional().describe("Owner user ID (admin only)"),
        environment: z.record(z.string(), z.string()).optional().describe("Template variable overrides"),
        portBindings: z
          .record(z.string(), z.number().int().min(1).max(65535))
          .optional()
          .describe("Container port → host port map"),
        primaryIp: z.string().optional().describe("Static IP (macvlan mode only)"),
        allocationId: z.string().optional().describe("Node allocation to claim (host mode)"),
        backupAllocationMb: z.number().int().min(0).max(1048576).optional(),
        databaseAllocation: z.number().int().min(0).max(1048576).optional(),
        networkMode: z
          .enum(["bridge", "macvlan", "host", "mc-lan-static", "mc-lan-dynamic"])
          .optional()
          .describe("Defaults to mc-lan-static"),
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
        description: z.string().max(500).optional(),
        allocatedMemoryMb: z
          .number()
          .int()
          .min(512)
          .max(131072)
          .optional()
          .describe("Memory allocation in MB (512-131072)"),
        allocatedCpuCores: z
          .number()
          .int()
          .min(1)
          .max(128)
          .optional()
          .describe("CPU allocation in whole cores (1-128)"),
        allocatedDiskMb: z
          .number()
          .int()
          .min(1024)
          .max(1048576)
          .optional()
          .describe("Disk allocation in MB (1024-1048576)"),
        environment: z.record(z.string(), z.string()).optional(),
        startupCommand: z.string().max(4096).nullable().optional(),
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
    "clone_server_preflight",
    {
      description:
        "Resolve a server clone and return the node-specific change set, blockers and warnings WITHOUT creating anything (POST /api/servers/:id/clone/preflight). Cross-node clones must run this first and pass the returned preflightId to clone_server.",
      inputSchema: z.object({
        serverId,
        mode: z.enum(["full", "configuration"]).describe("full (config + files, source must be stopped) or configuration (config only + fresh install)"),
        targetNodeId: z.string().describe("Node the clone will be created on"),
        networkMode: z.enum(["bridge", "macvlan", "host", "mc-lan-static", "mc-lan-dynamic"]).optional().describe("Network mode override"),
        allocationId: z.string().optional().describe("Node allocation to claim (host/bridge)"),
        ownerId: z.string().optional().describe("Owner for the clone"),
        allocatedMemoryMb: z.number().int().min(512).max(131072).optional().describe("Memory override (MB)"),
        allocatedCpuCores: z.number().int().min(1).max(128).optional().describe("CPU override (cores)"),
        allocatedDiskMb: z.number().int().min(1024).max(1048576).optional().describe("Disk override (MB)"),
      }),
    },
    async (args) => {
      const { serverId: id, ...body } = args;
      return text(await client.post(`/servers/${id}/clone/preflight`, body));
    },
  );

  server.registerTool(
    "clone_server",
    {
      description:
        "Clone a server (POST /api/servers/:id/clone). mode=full copies configuration and files (source must be stopped); mode=configuration copies configuration only and runs a fresh install. Cloning to a different node requires preflightId from clone_server_preflight and acknowledgedWarnings for any warnings it returned.",
      inputSchema: z.object({
        serverId,
        name: z.string().min(1).max(100).describe("Name for the cloned server"),
        nodeId: z.string().optional().describe("Target node (defaults to source node)"),
        mode: z.enum(["full", "configuration"]).optional().describe("full or configuration"),
        copyFiles: z.boolean().optional().describe("Deprecated alias: true → mode=full, false → mode=configuration"),
        preflightId: z.string().optional().describe("preflightId returned by clone_server_preflight (required cross-node)"),
        fingerprint: z.string().optional().describe("Fingerprint returned by clone_server_preflight"),
        acknowledgedWarnings: z.array(z.string()).optional().describe("Warning codes to acknowledge"),
        allocationId: z.string().optional().describe("Node allocation to claim"),
        networkMode: z.enum(["bridge", "macvlan", "host", "mc-lan-static", "mc-lan-dynamic"]).optional().describe("Network mode override"),
        allocatedMemoryMb: z.number().int().min(512).max(131072).optional().describe("Memory override (MB)"),
        allocatedCpuCores: z.number().int().min(1).max(128).optional().describe("CPU override (cores)"),
        allocatedDiskMb: z.number().int().min(1024).max(1048576).optional().describe("Disk override (MB)"),
      }),
    },
    async (args) => {
      const { serverId: id, ...body } = args;
      return text(await client.post(`/servers/${id}/clone`, body));
    },
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
  power("reinstall_server", "reinstall", "Delete all server files and reinstall from scratch. Irreversible (POST /api/servers/:id/reinstall).");
  power("cancel_install", "cancel-install", "Cancel a stuck installer and reset to stopped (POST /api/servers/:id/cancel-install).");
  power("rebuild_server", "rebuild", "Re-run the template install command while preserving server files (POST /api/servers/:id/rebuild).");
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
        lines: z.number().int().min(1).optional().describe("Number of lines, default 100"),
      }),
    },
    async (args) => text(await client.get(`/servers/${args.serverId}/logs`, { lines: args.lines })),
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
      description: "Update startup/environment variables for a server (PATCH /api/servers/:id/variables). The body is a flat variable-name → value map.",
      inputSchema: z.object({
        serverId,
        variables: z.record(z.string(), z.string()).describe("Flat map of variable name → new value"),
      }),
    },
    // The route reads the body as a flat Record<string, string>; wrapping the
    // map in { variables: ... } makes every update a silent no-op.
    async (args) => text(await client.patch(`/servers/${args.serverId}/variables`, args.variables)),
  );
}
