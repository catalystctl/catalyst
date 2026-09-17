/**
 * Panel-hosted MCP tool registry (Streamable HTTP at /api/mcp).
 *
 * Mirrors the local `packages/mcp-server` catalog 1:1 (same REST method +
 * path for every tool) so assistants get identical coverage whether they run
 * the local stdio server or talk to the panel directly. Execution goes back
 * through this Fastify instance (`app.inject`) with the caller's own API key,
 * so every existing permission check, scoped grant, and audit log applies
 * unchanged — the MCP layer adds no new authorization paths.
 *
 * Destructive tools require an explicit `confirm: true` argument. The flag is
 * stripped before forwarding so strict REST schemas never see it; without it
 * the call fails with a self-describing error telling the model to retry.
 */

export type McpHttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type JsonSchema = Record<string, unknown>;

export interface McpToolDef {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  method: McpHttpMethod;
  /** Full path incl. /api prefix (or /health). Args fill :params. */
  path: (args: Record<string, any>) => string;
  /** Arg keys forwarded as URL query params. */
  queryKeys?: string[];
  /**
   * Body builder. "rest" forwards every arg except path/query/confirm keys;
   * an array picks listed keys; a function builds it explicitly.
   */
  body?: "rest" | string[] | ((args: Record<string, any>) => unknown);
  /** Arg keys consumed by path() — excluded from a "rest" body. */
  pathKeys?: string[];
  /** Requires confirm:true. Stripped before forwarding. */
  destructive?: boolean;
}

// ── JSON Schema helpers ─────────────────────────────────────────────────────

const str = (description?: string): JsonSchema => ({
  type: "string",
  ...(description ? { description } : {}),
});
const num = (description?: string): JsonSchema => ({
  type: "number",
  ...(description ? { description } : {}),
});
const int = (description?: string): JsonSchema => ({
  type: "integer",
  ...(description ? { description } : {}),
});
const bool = (description?: string): JsonSchema => ({
  type: "boolean",
  ...(description ? { description } : {}),
});
const arr = (items: JsonSchema, description?: string): JsonSchema => ({
  type: "array",
  items,
  ...(description ? { description } : {}),
});
const obj = (description?: string): JsonSchema => ({
  type: "object",
  ...(description ? { description } : {}),
});
const enumOf = (values: string[], description?: string): JsonSchema => ({
  type: "string",
  enum: values,
  ...(description ? { description } : {}),
});

const serverId = (): JsonSchema => str("Server ID (cuid)");
const pageLimitSearch = (): Record<string, JsonSchema> => ({
  page: int("Page number, starting at 1"),
  limit: int("Items per page (max 100)"),
  search: str("Free-text search filter"),
});

function schema(
  properties: Record<string, JsonSchema>,
  required: string[] = [],
): JsonSchema {
  return {
    type: "object",
    properties,
    ...(required.length > 0 ? { required } : {}),
    additionalProperties: false,
  };
}

const CONFIRM_SUFFIX =
  ' Destructive: pass {"confirm": true} alongside the other arguments to execute.';

function def(t: McpToolDef): McpToolDef {
  if (t.destructive) {
    return { ...t, description: `${t.description}${CONFIRM_SUFFIX}` };
  }
  return t;
}

// ── Meta ────────────────────────────────────────────────────────────────────

const metaTools: McpToolDef[] = [
  def({
    name: "panel_health",
    description: "Check whether the Catalyst panel is reachable (unauthenticated /health probe).",
    inputSchema: schema({}),
    method: "GET",
    path: () => "/health",
  }),
  def({
    name: "whoami",
    description: "Show the identity and effective permissions of the calling API key (GET /api/auth/me).",
    inputSchema: schema({}),
    method: "GET",
    path: () => "/api/auth/me",
  }),
  def({
    name: "get_dashboard_stats",
    description: "Panel-wide counts for servers, nodes, and alerts (GET /api/dashboard/stats).",
    inputSchema: schema({}),
    method: "GET",
    path: () => "/api/dashboard/stats",
  }),
  def({
    name: "get_recent_activity",
    description: "Recent audit-log activity for the dashboard (GET /api/dashboard/activity).",
    inputSchema: schema({ limit: int("Number of events (max 20)") }),
    method: "GET",
    path: () => "/api/dashboard/activity",
    queryKeys: ["limit"],
  }),
  def({
    name: "list_permissions_catalog",
    description: "Full permission catalog used by API keys and roles (GET /api/admin/api-keys/permissions-catalog).",
    inputSchema: schema({}),
    method: "GET",
    path: () => "/api/admin/api-keys/permissions-catalog",
  }),
  def({
    name: "get_my_permissions",
    description: "Effective permissions of the calling API key owner (GET /api/admin/api-keys/my-permissions).",
    inputSchema: schema({}),
    method: "GET",
    path: () => "/api/admin/api-keys/my-permissions",
  }),
];

// ── Servers ─────────────────────────────────────────────────────────────────

function powerTool(
  name: string,
  action: string,
  description: string,
  extraProps: Record<string, JsonSchema> = {},
  destructive = false,
): McpToolDef {
  return def({
    name,
    description,
    inputSchema: schema({ serverId: serverId(), ...extraProps }, ["serverId"]),
    method: "POST",
    path: (a) => `/api/servers/${a.serverId}/${action}`,
    pathKeys: ["serverId"],
    body: "rest",
    destructive,
  });
}

const serverTools: McpToolDef[] = [
  def({
    name: "list_servers",
    description: "List servers visible to the API key (GET /api/servers). Supports search and pagination.",
    inputSchema: schema({
      ...pageLimitSearch(),
      withMetrics: bool("Include live resource metrics"),
    }),
    method: "GET",
    path: () => "/api/servers",
    queryKeys: ["page", "limit", "search", "withMetrics"],
  }),
  def({
    name: "get_server",
    description: "Full details for one server (GET /api/servers/:id).",
    inputSchema: schema({ serverId: serverId() }, ["serverId"]),
    method: "GET",
    path: (a) => `/api/servers/${a.serverId}`,
    pathKeys: ["serverId"],
  }),
  def({
    name: "create_server",
    description: "Create a game server (POST /api/servers). Needs templateId, nodeId, and resource allocations.",
    inputSchema: schema(
      {
        name: str("Server name (1-100 chars)"),
        templateId: str(),
        nodeId: str(),
        locationId: str(),
        description: str(),
        allocatedMemoryMb: int(),
        allocatedCpuCores: num(),
        allocatedDiskMb: int(),
        environment: obj("Template variable overrides"),
        startupCommand: str(),
      },
      ["name", "templateId", "nodeId"],
    ),
    method: "POST",
    path: () => "/api/servers",
    body: "rest",
  }),
  def({
    name: "update_server",
    description: "Update server name, resources, environment, or startup command (PUT /api/servers/:id).",
    inputSchema: schema({
      serverId: serverId(),
      name: str(),
      description: str(),
      allocatedMemoryMb: int(),
      allocatedCpuCores: num(),
      allocatedDiskMb: int(),
      environment: obj(),
      startupCommand: str(),
    }),
    method: "PUT",
    path: (a) => `/api/servers/${a.serverId}`,
    pathKeys: ["serverId"],
    body: "rest",
  }),
  def({
    name: "delete_server",
    description: "Delete a stopped server (DELETE /api/servers/:id).",
    inputSchema: schema({ serverId: serverId() }, ["serverId"]),
    method: "DELETE",
    path: (a) => `/api/servers/${a.serverId}`,
    pathKeys: ["serverId"],
    destructive: true,
  }),
  def({
    name: "clone_server",
    description: "Clone a server onto the same or another node (POST /api/servers/:id/clone).",
    inputSchema: schema(
      {
        serverId: serverId(),
        name: str("Name for the cloned server"),
        nodeId: str("Target node (defaults to source node)"),
      },
      ["serverId", "name"],
    ),
    method: "POST",
    path: (a) => `/api/servers/${a.serverId}/clone`,
    pathKeys: ["serverId"],
    body: ["name", "nodeId"],
  }),
  def({
    name: "resize_server_disk",
    description: "Resize server disk. Growing works online; shrinking needs the server stopped (POST /api/servers/:id/storage/resize).",
    inputSchema: schema(
      { serverId: serverId(), allocatedDiskMb: int("New disk size in MB") },
      ["serverId", "allocatedDiskMb"],
    ),
    method: "POST",
    path: (a) => `/api/servers/${a.serverId}/storage/resize`,
    pathKeys: ["serverId"],
    body: ["allocatedDiskMb"],
  }),
  powerTool("start_server", "start", "Start a server (POST /api/servers/:id/start)."),
  powerTool("stop_server", "stop", "Stop a server gracefully (POST /api/servers/:id/stop)."),
  powerTool("restart_server", "restart", "Restart a server (POST /api/servers/:id/restart)."),
  powerTool("kill_server", "kill", "Force-kill a server process (POST /api/servers/:id/kill)."),
  powerTool("install_server", "install", "Run the first-time installer (POST /api/servers/:id/install)."),
  powerTool(
    "reinstall_server",
    "reinstall",
    "Wipe disk and reinstall from scratch. Irreversible (POST /api/servers/:id/reinstall).",
    {},
    true,
  ),
  powerTool("cancel_install", "cancel-install", "Cancel a stuck installer and reset to stopped (POST /api/servers/:id/cancel-install)."),
  powerTool("rebuild_server", "rebuild", "Rebuild the container while preserving data (POST /api/servers/:id/rebuild)."),
  powerTool(
    "suspend_server",
    "suspend",
    "Suspend a server with an optional reason (POST /api/servers/:id/suspend).",
    { reason: str(), stopServer: bool() },
  ),
  powerTool("unsuspend_server", "unsuspend", "Lift a suspension (POST /api/servers/:id/unsuspend)."),
  def({
    name: "respond_to_eula",
    description: "Accept or decline a Minecraft-style EULA prompt (POST /api/servers/eula).",
    inputSchema: schema(
      {
        serverId: str("Server waiting on the EULA prompt"),
        accepted: bool("True to accept, false to decline"),
      },
      ["serverId", "accepted"],
    ),
    method: "POST",
    path: () => "/api/servers/eula",
    body: "rest",
  }),
  def({
    name: "send_console_command",
    description: "Send a console command to a running server (POST /api/servers/:id/console/command).",
    inputSchema: schema(
      { serverId: serverId(), command: str("Command to execute, without leading slash") },
      ["serverId", "command"],
    ),
    method: "POST",
    path: (a) => `/api/servers/${a.serverId}/console/command`,
    pathKeys: ["serverId"],
    body: ["command"],
  }),
  def({
    name: "get_server_logs",
    description: "Recent stored console output for a server (GET /api/servers/:id/logs).",
    inputSchema: schema({ serverId: serverId(), limit: int() }),
    method: "GET",
    path: (a) => `/api/servers/${a.serverId}/logs`,
    pathKeys: ["serverId"],
    queryKeys: ["limit"],
  }),
  def({
    name: "get_server_variables",
    description: "Template variables and current values for a server (GET /api/servers/:id/variables).",
    inputSchema: schema({ serverId: serverId() }, ["serverId"]),
    method: "GET",
    path: (a) => `/api/servers/${a.serverId}/variables`,
    pathKeys: ["serverId"],
  }),
  def({
    name: "update_server_variables",
    description: "Update startup/environment variables for a server (PATCH /api/servers/:id/variables).",
    inputSchema: schema(
      { serverId: serverId(), variables: obj("Variable key/value pairs") },
      ["serverId", "variables"],
    ),
    method: "PATCH",
    path: (a) => `/api/servers/${a.serverId}/variables`,
    pathKeys: ["serverId"],
    body: ["variables"],
  }),
];

// ── Files / network / databases / backups / tasks ───────────────────────────

const fileTools: McpToolDef[] = [
  def({
    name: "list_files",
    description: "List files in a server directory (GET /api/servers/:id/files?path=...).",
    inputSchema: schema({ serverId: serverId(), path: str("Directory path, defaults to /") }, ["serverId"]),
    method: "GET",
    path: (a) => `/api/servers/${a.serverId}/files`,
    pathKeys: ["serverId"],
    queryKeys: ["path"],
  }),
  def({
    name: "download_file",
    description: "Download a text file's contents (GET /api/servers/:id/files/download). Binary files are truncated.",
    inputSchema: schema(
      { serverId: serverId(), path: str("File path, e.g. /server.properties") },
      ["serverId", "path"],
    ),
    method: "GET",
    path: (a) => `/api/servers/${a.serverId}/files/download`,
    pathKeys: ["serverId"],
    queryKeys: ["path"],
  }),
  def({
    name: "write_file",
    description: "Create or overwrite a text file with full content (POST /api/servers/:id/files/write).",
    inputSchema: schema(
      { serverId: serverId(), path: str("Destination file path"), content: str("Full file content") },
      ["serverId", "path", "content"],
    ),
    method: "POST",
    path: (a) => `/api/servers/${a.serverId}/files/write`,
    pathKeys: ["serverId"],
    body: ["path", "content"],
  }),
  def({
    name: "create_file_or_directory",
    description: "Create an empty file or directory (POST /api/servers/:id/files/create).",
    inputSchema: schema(
      {
        serverId: serverId(),
        name: str("File or directory name/path"),
        type: enumOf(["file", "directory"], "What to create"),
        content: str("Initial content for files"),
      },
      ["serverId", "name", "type"],
    ),
    method: "POST",
    path: (a) => `/api/servers/${a.serverId}/files/create`,
    pathKeys: ["serverId"],
    body: "rest",
  }),
  def({
    name: "rename_file",
    description: "Rename or move a file or directory (POST /api/servers/:id/files/rename).",
    inputSchema: schema({ serverId: serverId(), from: str(), to: str() }, ["serverId", "from", "to"]),
    method: "POST",
    path: (a) => `/api/servers/${a.serverId}/files/rename`,
    pathKeys: ["serverId"],
    body: ["from", "to"],
  }),
  def({
    name: "delete_file",
    description: "Delete a file or directory (DELETE /api/servers/:id/files/delete).",
    inputSchema: schema({ serverId: serverId(), path: str("Path to delete") }, ["serverId", "path"]),
    method: "DELETE",
    path: (a) => `/api/servers/${a.serverId}/files/delete`,
    pathKeys: ["serverId"],
    queryKeys: ["path"],
    destructive: true,
  }),
  def({
    name: "set_file_permissions",
    description: "chmod a file using octal notation like 644 (POST /api/servers/:id/files/permissions).",
    inputSchema: schema(
      { serverId: serverId(), path: str(), mode: str("Octal mode, e.g. 644") },
      ["serverId", "path", "mode"],
    ),
    method: "POST",
    path: (a) => `/api/servers/${a.serverId}/files/permissions`,
    pathKeys: ["serverId"],
    body: ["path", "mode"],
  }),
  def({
    name: "compress_files",
    description: "Compress files into a zip/tar.gz archive (POST /api/servers/:id/files/compress).",
    inputSchema: schema(
      {
        serverId: serverId(),
        paths: arr(str(), "Source paths to include"),
        destination: str("Archive path, e.g. /backup.zip"),
      },
      ["serverId", "paths", "destination"],
    ),
    method: "POST",
    path: (a) => `/api/servers/${a.serverId}/files/compress`,
    pathKeys: ["serverId"],
    body: "rest",
  }),
  def({
    name: "decompress_archive",
    description: "Extract a zip/tar.gz archive (POST /api/servers/:id/files/decompress).",
    inputSchema: schema({
      serverId: serverId(),
      path: str("Archive path"),
      destination: str("Target directory (defaults to archive directory)"),
    }),
    method: "POST",
    path: (a) => `/api/servers/${a.serverId}/files/decompress`,
    pathKeys: ["serverId"],
    body: "rest",
  }),
  def({
    name: "list_archive_contents",
    description: "Peek inside an archive without extracting it (POST /api/servers/:id/files/archive-contents).",
    inputSchema: schema({ serverId: serverId(), path: str("Archive path") }, ["serverId", "path"]),
    method: "POST",
    path: (a) => `/api/servers/${a.serverId}/files/archive-contents`,
    pathKeys: ["serverId"],
    body: ["path"],
  }),
  def({
    name: "list_server_allocations",
    description: "Network allocations bound to a server (GET /api/servers/:id/allocations).",
    inputSchema: schema({ serverId: serverId() }, ["serverId"]),
    method: "GET",
    path: (a) => `/api/servers/${a.serverId}/allocations`,
    pathKeys: ["serverId"],
  }),
  def({
    name: "add_server_allocation",
    description: "Bind a free node allocation or a host/container port pair to a server (POST /api/servers/:id/allocations).",
    inputSchema: schema({
      serverId: serverId(),
      allocationId: str(),
      containerPort: int(),
      hostPort: int(),
    }),
    method: "POST",
    path: (a) => `/api/servers/${a.serverId}/allocations`,
    pathKeys: ["serverId"],
    body: "rest",
  }),
  def({
    name: "remove_server_allocation",
    description: "Unbind a network allocation from a server (DELETE /api/servers/:id/allocations/:allocationId).",
    inputSchema: schema({ serverId: serverId(), allocationId: str() }, ["serverId", "allocationId"]),
    method: "DELETE",
    path: (a) => `/api/servers/${a.serverId}/allocations/${a.allocationId}`,
    pathKeys: ["serverId", "allocationId"],
    destructive: true,
  }),
  def({
    name: "list_database_hosts",
    description: "Database hosts available for provisioning (GET /api/servers/database-hosts).",
    inputSchema: schema({}),
    method: "GET",
    path: () => "/api/servers/database-hosts",
  }),
  def({
    name: "list_server_databases",
    description: "Databases owned by a server (GET /api/servers/:id/databases).",
    inputSchema: schema({ serverId: serverId() }, ["serverId"]),
    method: "GET",
    path: (a) => `/api/servers/${a.serverId}/databases`,
    pathKeys: ["serverId"],
  }),
  def({
    name: "create_server_database",
    description: "Provision a database for a server (POST /api/servers/:id/databases).",
    inputSchema: schema({
      serverId: serverId(),
      hostId: str("Database host ID from list_database_hosts"),
      database: str("Database name (generated when omitted)"),
    }),
    method: "POST",
    path: (a) => `/api/servers/${a.serverId}/databases`,
    pathKeys: ["serverId"],
    body: "rest",
  }),
  def({
    name: "delete_server_database",
    description: "Delete a server database (DELETE /api/servers/:id/databases/:databaseId).",
    inputSchema: schema({ serverId: serverId(), databaseId: str() }, ["serverId", "databaseId"]),
    method: "DELETE",
    path: (a) => `/api/servers/${a.serverId}/databases/${a.databaseId}`,
    pathKeys: ["serverId", "databaseId"],
    destructive: true,
  }),
  def({
    name: "list_backups",
    description: "Backups for a server, newest first (GET /api/servers/:id/backups).",
    inputSchema: schema({ serverId: serverId() }, ["serverId"]),
    method: "GET",
    path: (a) => `/api/servers/${a.serverId}/backups`,
    pathKeys: ["serverId"],
  }),
  def({
    name: "create_backup",
    description: "Start a backup of a server (POST /api/servers/:id/backups).",
    inputSchema: schema({ serverId: serverId(), name: str("Friendly backup name") }, ["serverId"]),
    method: "POST",
    path: (a) => `/api/servers/${a.serverId}/backups`,
    pathKeys: ["serverId"],
    body: ["name"],
  }),
  def({
    name: "restore_backup",
    description: "Restore a backup over the server's current files (POST /api/servers/:id/backups/:backupId/restore).",
    inputSchema: schema({ serverId: serverId(), backupId: str() }, ["serverId", "backupId"]),
    method: "POST",
    path: (a) => `/api/servers/${a.serverId}/backups/${a.backupId}/restore`,
    pathKeys: ["serverId", "backupId"],
    body: [],
    destructive: true,
  }),
  def({
    name: "delete_backup",
    description: "Delete a backup (DELETE /api/servers/:id/backups/:backupId).",
    inputSchema: schema({ serverId: serverId(), backupId: str() }, ["serverId", "backupId"]),
    method: "DELETE",
    path: (a) => `/api/servers/${a.serverId}/backups/${a.backupId}`,
    pathKeys: ["serverId", "backupId"],
    destructive: true,
  }),
  def({
    name: "list_scheduled_tasks",
    description: "Cron tasks for a server (GET /api/servers/:id/tasks).",
    inputSchema: schema({ serverId: serverId() }, ["serverId"]),
    method: "GET",
    path: (a) => `/api/servers/${a.serverId}/tasks`,
    pathKeys: ["serverId"],
  }),
  def({
    name: "create_scheduled_task",
    description: "Create a cron task: restart/stop/start/backup/command (POST /api/servers/:id/tasks).",
    inputSchema: schema(
      {
        serverId: serverId(),
        name: str(),
        action: enumOf(["restart", "stop", "start", "backup", "command"]),
        schedule: str("Cron expression, e.g. 0 3 * * *"),
        payload: obj("Extra data, e.g. {command: 'say hi'}"),
        enabled: bool(),
      },
      ["serverId", "name", "action", "schedule"],
    ),
    method: "POST",
    path: (a) => `/api/servers/${a.serverId}/tasks`,
    pathKeys: ["serverId"],
    body: "rest",
  }),
  def({
    name: "update_scheduled_task",
    description: "Update a scheduled task (PUT /api/servers/:id/tasks/:taskId).",
    inputSchema: schema({
      serverId: serverId(),
      taskId: str(),
      name: str(),
      schedule: str(),
      enabled: bool(),
      payload: obj(),
    }),
    method: "PUT",
    path: (a) => `/api/servers/${a.serverId}/tasks/${a.taskId}`,
    pathKeys: ["serverId", "taskId"],
    body: "rest",
  }),
  def({
    name: "delete_scheduled_task",
    description: "Delete a scheduled task (DELETE /api/servers/:id/tasks/:taskId).",
    inputSchema: schema({ serverId: serverId(), taskId: str() }, ["serverId", "taskId"]),
    method: "DELETE",
    path: (a) => `/api/servers/${a.serverId}/tasks/${a.taskId}`,
    pathKeys: ["serverId", "taskId"],
    destructive: true,
  }),
  def({
    name: "get_scheduled_task",
    description: "One scheduled task with its run state (GET /api/servers/:id/tasks/:taskId).",
    inputSchema: schema({ serverId: serverId(), taskId: str() }, ["serverId", "taskId"]),
    method: "GET",
    path: (a) => `/api/servers/${a.serverId}/tasks/${a.taskId}`,
    pathKeys: ["serverId", "taskId"],
  }),
  def({
    name: "execute_scheduled_task",
    description: "Run a scheduled task immediately (POST /api/servers/:id/tasks/:taskId/execute).",
    inputSchema: schema({ serverId: serverId(), taskId: str() }, ["serverId", "taskId"]),
    method: "POST",
    path: (a) => `/api/servers/${a.serverId}/tasks/${a.taskId}/execute`,
    pathKeys: ["serverId", "taskId"],
    body: [],
  }),
];

// ── Nodes / locations / templates / nests ───────────────────────────────────

const infraTools: McpToolDef[] = [
  def({
    name: "list_nodes",
    description: "List compute nodes with online status (GET /api/nodes).",
    inputSchema: schema({ ...pageLimitSearch() }),
    method: "GET",
    path: () => "/api/nodes",
    queryKeys: ["search", "page", "limit"],
  }),
  def({
    name: "get_node",
    description: "Full details for one node (GET /api/nodes/:id).",
    inputSchema: schema({ nodeId: str() }, ["nodeId"]),
    method: "GET",
    path: (a) => `/api/nodes/${a.nodeId}`,
    pathKeys: ["nodeId"],
  }),
  def({
    name: "create_node",
    description: "Register a new compute node (POST /api/nodes). The response includes the agent secret.",
    inputSchema: schema(
      {
        name: str(),
        hostname: str("Agent-visible hostname or IP"),
        publicAddress: str("Public address players connect to"),
        locationId: str(),
        maxMemoryMb: int(),
        maxCpuCores: num(),
        description: str(),
        sftpPort: int(),
      },
      ["name", "hostname", "publicAddress", "locationId", "maxMemoryMb", "maxCpuCores"],
    ),
    method: "POST",
    path: () => "/api/nodes",
    body: "rest",
  }),
  def({
    name: "update_node",
    description: "Update node capacity, addresses, or metadata (PUT /api/nodes/:id).",
    inputSchema: schema({
      nodeId: str(),
      name: str(),
      hostname: str(),
      publicAddress: str(),
      maxMemoryMb: int(),
      maxCpuCores: num(),
      description: str(),
    }),
    method: "PUT",
    path: (a) => `/api/nodes/${a.nodeId}`,
    pathKeys: ["nodeId"],
    body: "rest",
  }),
  def({
    name: "delete_node",
    description: "Delete an empty node (DELETE /api/nodes/:id). Move or delete its servers first.",
    inputSchema: schema({ nodeId: str() }, ["nodeId"]),
    method: "DELETE",
    path: (a) => `/api/nodes/${a.nodeId}`,
    pathKeys: ["nodeId"],
    destructive: true,
  }),
  def({
    name: "list_node_allocations",
    description: "IP/port allocations on a node (GET /api/nodes/:id/allocations).",
    inputSchema: schema({ nodeId: str() }, ["nodeId"]),
    method: "GET",
    path: (a) => `/api/nodes/${a.nodeId}/allocations`,
    pathKeys: ["nodeId"],
  }),
  def({
    name: "create_node_allocation",
    description: "Add an IP/port allocation pool entry to a node (POST /api/nodes/:id/allocations).",
    inputSchema: schema(
      {
        nodeId: str(),
        ip: str("Bind IP, e.g. 0.0.0.0"),
        ports: str("Ports or ranges, e.g. 25565-25570, 19132"),
        alias: str(),
      },
      ["nodeId", "ip", "ports"],
    ),
    method: "POST",
    path: (a) => `/api/nodes/${a.nodeId}/allocations`,
    pathKeys: ["nodeId"],
    body: "rest",
  }),
  def({
    name: "delete_node_allocation",
    description: "Delete a free node allocation (DELETE /api/nodes/:id/allocations/:allocationId).",
    inputSchema: schema({ nodeId: str(), allocationId: str() }, ["nodeId", "allocationId"]),
    method: "DELETE",
    path: (a) => `/api/nodes/${a.nodeId}/allocations/${a.allocationId}`,
    pathKeys: ["nodeId", "allocationId"],
    destructive: true,
  }),
  def({
    name: "get_node_stats",
    description: "Resource usage and capacity for a node (GET /api/nodes/:id/stats).",
    inputSchema: schema({ nodeId: str() }, ["nodeId"]),
    method: "GET",
    path: (a) => `/api/nodes/${a.nodeId}/stats`,
    pathKeys: ["nodeId"],
  }),
  def({
    name: "get_node_metrics_history",
    description: "Time-series CPU/memory/disk history for a node (GET /api/nodes/:id/metrics).",
    inputSchema: schema({ nodeId: str(), hours: int("Lookback window (max 168)"), limit: int() }, ["nodeId"]),
    method: "GET",
    path: (a) => `/api/nodes/${a.nodeId}/metrics`,
    pathKeys: ["nodeId"],
    queryKeys: ["hours", "limit"],
  }),
  def({
    name: "list_node_assignments",
    description: "User/role assignments on a node (GET /api/nodes/:id/assignments).",
    inputSchema: schema({ nodeId: str() }, ["nodeId"]),
    method: "GET",
    path: (a) => `/api/nodes/${a.nodeId}/assignments`,
    pathKeys: ["nodeId"],
  }),
  def({
    name: "assign_node",
    description: "Assign a node to a user or role, optionally expiring (POST /api/nodes/:id/assign).",
    inputSchema: schema({
      nodeId: str(),
      userId: str("User to assign (one of userId or roleId)"),
      roleId: str("Role to assign (one of userId or roleId)"),
      expiresAt: str("ISO timestamp for temporary access"),
    }),
    method: "POST",
    path: (a) => `/api/nodes/${a.nodeId}/assign`,
    pathKeys: ["nodeId"],
    body: "rest",
  }),
  def({
    name: "remove_node_assignment",
    description: "Remove a node assignment (DELETE /api/nodes/:id/assignments/:assignmentId).",
    inputSchema: schema({ nodeId: str(), assignmentId: str() }, ["nodeId", "assignmentId"]),
    method: "DELETE",
    path: (a) => `/api/nodes/${a.nodeId}/assignments/${a.assignmentId}`,
    pathKeys: ["nodeId", "assignmentId"],
    destructive: true,
  }),
  def({
    name: "list_locations",
    description: "List datacenter locations with node counts (GET /api/locations).",
    inputSchema: schema({}),
    method: "GET",
    path: () => "/api/locations",
  }),
  def({
    name: "get_location",
    description: "One location with its nodes (GET /api/locations/:id).",
    inputSchema: schema({ locationId: str() }, ["locationId"]),
    method: "GET",
    path: (a) => `/api/locations/${a.locationId}`,
    pathKeys: ["locationId"],
  }),
  def({
    name: "create_location",
    description: "Create a location (POST /api/locations).",
    inputSchema: schema({ name: str(), description: str() }, ["name"]),
    method: "POST",
    path: () => "/api/locations",
    body: "rest",
  }),
  def({
    name: "update_location",
    description: "Update a location (PUT /api/locations/:id).",
    inputSchema: schema({ locationId: str(), name: str(), description: str() }),
    method: "PUT",
    path: (a) => `/api/locations/${a.locationId}`,
    pathKeys: ["locationId"],
    body: "rest",
  }),
  def({
    name: "delete_location",
    description: "Delete an empty location (DELETE /api/locations/:id).",
    inputSchema: schema({ locationId: str() }, ["locationId"]),
    method: "DELETE",
    path: (a) => `/api/locations/${a.locationId}`,
    pathKeys: ["locationId"],
    destructive: true,
  }),
  def({
    name: "list_templates",
    description: "List server templates/eggs (GET /api/templates).",
    inputSchema: schema({ search: str(), nestId: str(), page: int(), limit: int() }),
    method: "GET",
    path: () => "/api/templates",
    queryKeys: ["search", "nestId", "page", "limit"],
  }),
  def({
    name: "get_template",
    description: "Full template including variables and install script (GET /api/templates/:id).",
    inputSchema: schema({ templateId: str() }, ["templateId"]),
    method: "GET",
    path: (a) => `/api/templates/${a.templateId}`,
    pathKeys: ["templateId"],
  }),
  def({
    name: "create_template",
    description: "Create a server template/egg (POST /api/templates). Needs author, image, startup, and variables.",
    inputSchema: schema(
      {
        name: str(),
        author: str(),
        version: str(),
        description: str(),
        image: str("Default container image, e.g. ghcr.io/pterodactyl/yolks:java_21"),
        startup: str("Startup command, e.g. java -jar server.jar"),
        stopCommand: str(),
        variables: arr(obj(), "Environment variable definitions"),
        installScript: str(),
        supportedPorts: arr(int()),
        allocatedMemoryMb: int(),
        allocatedCpuCores: num(),
        nestId: str(),
      },
      ["name", "author", "image", "startup"],
    ),
    method: "POST",
    path: () => "/api/templates",
    body: "rest",
  }),
  def({
    name: "update_template",
    description: "Update a template (PUT /api/templates/:id). Only the given fields change.",
    inputSchema: schema({
      templateId: str(),
      name: str(),
      description: str(),
      author: str(),
      version: str(),
      image: str(),
      startup: str(),
      stopCommand: str(),
      variables: arr(obj()),
      installScript: str(),
      nestId: str(),
    }),
    method: "PUT",
    path: (a) => `/api/templates/${a.templateId}`,
    pathKeys: ["templateId"],
    body: "rest",
  }),
  def({
    name: "delete_template",
    description: "Delete a template that no server uses (DELETE /api/templates/:id).",
    inputSchema: schema({ templateId: str() }, ["templateId"]),
    method: "DELETE",
    path: (a) => `/api/templates/${a.templateId}`,
    pathKeys: ["templateId"],
    destructive: true,
  }),
  def({
    name: "import_pterodactyl_egg",
    description: "Convert a Pterodactyl egg JSON into a Catalyst template (POST /api/templates/import-pterodactyl).",
    inputSchema: schema(
      { egg: obj("Full Pterodactyl egg JSON object"), nestId: str() },
      ["egg"],
    ),
    method: "POST",
    path: () => "/api/templates/import-pterodactyl",
    body: (a) => ({ ...(typeof a.egg === "object" && a.egg !== null ? a.egg : {}), nestId: a.nestId }),
  }),
  def({
    name: "list_nests",
    description: "Template categories/nests (GET /api/nests).",
    inputSchema: schema({}),
    method: "GET",
    path: () => "/api/nests",
  }),
  def({
    name: "get_nest",
    description: "One template nest with its templates (GET /api/nests/:id).",
    inputSchema: schema({ nestId: str() }, ["nestId"]),
    method: "GET",
    path: (a) => `/api/nests/${a.nestId}`,
    pathKeys: ["nestId"],
  }),
  def({
    name: "create_nest",
    description: "Create a template category/nest (POST /api/nests).",
    inputSchema: schema({ name: str(), description: str(), icon: str(), author: str() }, ["name"]),
    method: "POST",
    path: () => "/api/nests",
    body: "rest",
  }),
  def({
    name: "update_nest",
    description: "Rename or re-describe a nest (PUT /api/nests/:id).",
    inputSchema: schema({ nestId: str(), name: str(), description: str(), icon: str(), author: str() }),
    method: "PUT",
    path: (a) => `/api/nests/${a.nestId}`,
    pathKeys: ["nestId"],
    body: "rest",
  }),
  def({
    name: "delete_nest",
    description: "Delete a nest; its templates become uncategorized (DELETE /api/nests/:id).",
    inputSchema: schema({ nestId: str() }, ["nestId"]),
    method: "DELETE",
    path: (a) => `/api/nests/${a.nestId}`,
    pathKeys: ["nestId"],
    destructive: true,
  }),
];

// ── Users / roles / API keys / alerts ───────────────────────────────────────

const roleScopeSchema: JsonSchema = {
  type: "object",
  description: "Role wizard scoped access (replace-all semantics)",
  properties: {
    mode: enumOf(["none", "servers", "nodes"], "none clears all scoped grants"),
    serverIds: arr(str(), "Required when mode is servers"),
    nodeIds: arr(str(), "Required when mode is nodes; use * for all nodes"),
    permissions: arr(str(), "Scoped permissions, e.g. [file.read, console.read]"),
  },
  additionalProperties: false,
};

const adminTools: McpToolDef[] = [
  def({
    name: "list_users",
    description: "List panel users with search and pagination (GET /api/admin/users).",
    inputSchema: schema({ ...pageLimitSearch() }),
    method: "GET",
    path: () => "/api/admin/users",
    queryKeys: ["search", "page", "limit"],
  }),
  def({
    name: "get_user",
    description: "One user with roles, sessions, and login metadata (GET /api/admin/users/:id).",
    inputSchema: schema({ userId: str() }, ["userId"]),
    method: "GET",
    path: (a) => `/api/admin/users/${a.userId}`,
    pathKeys: ["userId"],
  }),
  def({
    name: "create_user",
    description: "Create a user with email, username, and password (POST /api/admin/users).",
    inputSchema: schema(
      {
        email: str(),
        username: str("2-32 characters"),
        password: str("Minimum 8 characters"),
        roleIds: arr(str()),
      },
      ["email", "username", "password"],
    ),
    method: "POST",
    path: () => "/api/admin/users",
    body: "rest",
  }),
  def({
    name: "update_user",
    description: "Update email, username, or role assignments (PUT /api/admin/users/:id).",
    inputSchema: schema({ userId: str(), email: str(), username: str(), roleIds: arr(str()) }),
    method: "PUT",
    path: (a) => `/api/admin/users/${a.userId}`,
    pathKeys: ["userId"],
    body: "rest",
  }),
  def({
    name: "delete_user",
    description: "Delete a user and revoke their access (DELETE /api/admin/users/:id/delete).",
    inputSchema: schema({ userId: str() }, ["userId"]),
    method: "POST",
    path: (a) => `/api/admin/users/${a.userId}/delete`,
    pathKeys: ["userId"],
    body: [],
    destructive: true,
  }),
  def({
    name: "ban_user",
    description: "Ban a user with an optional reason and expiry (POST /api/admin/users/:id/ban).",
    inputSchema: schema({ userId: str(), reason: str(), expiresAt: str("ISO timestamp when the ban expires") }),
    method: "POST",
    path: (a) => `/api/admin/users/${a.userId}/ban`,
    pathKeys: ["userId"],
    body: "rest",
    destructive: true,
  }),
  def({
    name: "unban_user",
    description: "Lift a user ban (POST /api/admin/users/:id/unban).",
    inputSchema: schema({ userId: str() }, ["userId"]),
    method: "POST",
    path: (a) => `/api/admin/users/${a.userId}/unban`,
    pathKeys: ["userId"],
    body: [],
  }),
  def({
    name: "list_user_servers",
    description: "Servers a user owns or can access (GET /api/admin/users/:id/servers).",
    inputSchema: schema({ userId: str() }, ["userId"]),
    method: "GET",
    path: (a) => `/api/admin/users/${a.userId}/servers`,
    pathKeys: ["userId"],
  }),
  def({
    name: "list_roles",
    description: "List roles with permissions (GET /api/roles).",
    inputSchema: schema({}),
    method: "GET",
    path: () => "/api/roles",
  }),
  def({
    name: "get_role",
    description: "One role with members and grants (GET /api/roles/:id).",
    inputSchema: schema({ roleId: str() }, ["roleId"]),
    method: "GET",
    path: (a) => `/api/roles/${a.roleId}`,
    pathKeys: ["roleId"],
  }),
  def({
    name: "create_role",
    description: "Create a role with a permission set (POST /api/roles).",
    inputSchema: schema(
      {
        name: str(),
        description: str(),
        permissions: arr(str(), "e.g. [server.read, server.start] or [*]"),
        scope: roleScopeSchema,
      },
      ["name", "permissions"],
    ),
    method: "POST",
    path: () => "/api/roles",
    body: "rest",
  }),
  def({
    name: "update_role",
    description: "Rename a role or replace its permissions (PUT /api/roles/:id).",
    inputSchema: schema({ roleId: str(), name: str(), description: str(), permissions: arr(str()), scope: roleScopeSchema }),
    method: "PUT",
    path: (a) => `/api/roles/${a.roleId}`,
    pathKeys: ["roleId"],
    body: "rest",
  }),
  def({
    name: "delete_role",
    description: "Delete a role (DELETE /api/roles/:id). Members lose its permissions.",
    inputSchema: schema({ roleId: str() }, ["roleId"]),
    method: "DELETE",
    path: (a) => `/api/roles/${a.roleId}`,
    pathKeys: ["roleId"],
    destructive: true,
  }),
  def({
    name: "assign_role_to_user",
    description: "Add a user to a role (POST /api/roles/:roleId/users/:userId).",
    inputSchema: schema({ roleId: str(), userId: str() }, ["roleId", "userId"]),
    method: "POST",
    path: (a) => `/api/roles/${a.roleId}/users/${a.userId}`,
    pathKeys: ["roleId", "userId"],
    body: [],
  }),
  def({
    name: "remove_role_from_user",
    description: "Remove a user from a role (DELETE /api/roles/:roleId/users/:userId).",
    inputSchema: schema({ roleId: str(), userId: str() }, ["roleId", "userId"]),
    method: "DELETE",
    path: (a) => `/api/roles/${a.roleId}/users/${a.userId}`,
    pathKeys: ["roleId", "userId"],
    destructive: true,
  }),
  def({
    name: "list_role_presets",
    description: "Ready-made permission bundles for creating roles (GET /api/roles/presets).",
    inputSchema: schema({}),
    method: "GET",
    path: () => "/api/roles/presets",
  }),
  def({
    name: "get_user_roles",
    description: "Roles and aggregated permissions for one user (GET /api/roles/users/:userId/roles).",
    inputSchema: schema({ userId: str() }, ["userId"]),
    method: "GET",
    path: (a) => `/api/roles/users/${a.userId}/roles`,
    pathKeys: ["userId"],
  }),
  def({
    name: "add_role_permission",
    description: "Add a single permission to a role (POST /api/roles/:id/permissions). You cannot touch roles you belong to.",
    inputSchema: schema({ roleId: str(), permission: str() }, ["roleId", "permission"]),
    method: "POST",
    path: (a) => `/api/roles/${a.roleId}/permissions`,
    pathKeys: ["roleId"],
    body: ["permission"],
  }),
  def({
    name: "remove_role_permission",
    description: "Remove a single permission from a role (DELETE /api/roles/:id/permissions/:permission).",
    inputSchema: schema({ roleId: str(), permission: str() }, ["roleId", "permission"]),
    method: "DELETE",
    path: (a) => `/api/roles/${a.roleId}/permissions/${encodeURIComponent(a.permission)}`,
    pathKeys: ["roleId", "permission"],
    destructive: true,
  }),
  def({
    name: "set_role_scope",
    description: "Replace a role's server/node scoped grants (PUT /api/roles/:id with scope). Mode none clears grants.",
    inputSchema: schema({ roleId: str(), scope: roleScopeSchema }, ["roleId", "scope"]),
    method: "PUT",
    path: (a) => `/api/roles/${a.roleId}`,
    pathKeys: ["roleId"],
    body: ["scope"],
  }),
  def({
    name: "list_role_nodes",
    description: "Nodes assigned to a role, including wildcard coverage (GET /api/roles/:id/nodes).",
    inputSchema: schema({ roleId: str() }, ["roleId"]),
    method: "GET",
    path: (a) => `/api/roles/${a.roleId}/nodes`,
    pathKeys: ["roleId"],
  }),
  def({
    name: "get_user_nodes",
    description: "Nodes a user can reach via assignments and roles (GET /api/roles/users/:userId/nodes).",
    inputSchema: schema({ userId: str() }, ["userId"]),
    method: "GET",
    path: (a) => `/api/roles/users/${a.userId}/nodes`,
    pathKeys: ["userId"],
  }),
  def({
    name: "list_api_keys",
    description: "List API keys (admin sees all; others see their own) (GET /api/admin/api-keys).",
    inputSchema: schema({ page: int(), limit: int() }),
    method: "GET",
    path: () => "/api/admin/api-keys",
    queryKeys: ["page", "limit"],
  }),
  def({
    name: "create_api_key",
    description: "Create an API key. The secret is returned once (POST /api/admin/api-keys).",
    inputSchema: schema({
      name: str(),
      allPermissions: bool("Inherit the creator's full permission set"),
      permissions: arr(str(), "Scoped permissions when allPermissions is false"),
      expiresIn: int("Lifetime in seconds"),
    }),
    method: "POST",
    path: () => "/api/admin/api-keys",
    body: "rest",
  }),
  def({
    name: "get_api_key",
    description: "One API key's metadata (never the secret) (GET /api/admin/api-keys/:id).",
    inputSchema: schema({ keyId: str() }, ["keyId"]),
    method: "GET",
    path: (a) => `/api/admin/api-keys/${a.keyId}`,
    pathKeys: ["keyId"],
  }),
  def({
    name: "update_api_key",
    description: "Rename, enable/disable, or adjust rate limits (PATCH /api/admin/api-keys/:id).",
    inputSchema: schema({ keyId: str(), name: str(), enabled: bool(), rateLimitMax: int() }),
    method: "PATCH",
    path: (a) => `/api/admin/api-keys/${a.keyId}`,
    pathKeys: ["keyId"],
    body: "rest",
  }),
  def({
    name: "delete_api_key",
    description: "Revoke an API key immediately (DELETE /api/admin/api-keys/:id).",
    inputSchema: schema({ keyId: str() }, ["keyId"]),
    method: "DELETE",
    path: (a) => `/api/admin/api-keys/${a.keyId}`,
    pathKeys: ["keyId"],
    destructive: true,
  }),
  def({
    name: "get_api_key_usage",
    description: "Request counts and last-use timestamp for a key (GET /api/admin/api-keys/:id/usage).",
    inputSchema: schema({ keyId: str() }, ["keyId"]),
    method: "GET",
    path: (a) => `/api/admin/api-keys/${a.keyId}/usage`,
    pathKeys: ["keyId"],
  }),
  def({
    name: "list_alert_rules",
    description: "Alert rules for thresholds, offline nodes, and crashes (GET /api/alert-rules).",
    inputSchema: schema({}),
    method: "GET",
    path: () => "/api/alert-rules",
  }),
  def({
    name: "create_alert_rule",
    description: "Create an alert rule (POST /api/alert-rules).",
    inputSchema: schema(
      {
        name: str(),
        type: enumOf(["resource_threshold", "node_offline", "server_crashed"]),
        target: enumOf(["server", "node", "global"]),
        targetId: str(),
        conditions: obj("Thresholds, e.g. {cpuPercent: 90}"),
        actions: obj("Webhooks/notifications, e.g. {webhooks: [...]}"),
        description: str(),
        enabled: bool(),
      },
      ["name", "type", "target", "conditions", "actions"],
    ),
    method: "POST",
    path: () => "/api/alert-rules",
    body: "rest",
  }),
  def({
    name: "get_alert_rule",
    description: "One alert rule with conditions and actions (GET /api/alert-rules/:id).",
    inputSchema: schema({ ruleId: str() }, ["ruleId"]),
    method: "GET",
    path: (a) => `/api/alert-rules/${a.ruleId}`,
    pathKeys: ["ruleId"],
  }),
  def({
    name: "update_alert_rule",
    description: "Update an alert rule's name, conditions, actions, or enabled flag (PUT /api/alert-rules/:id).",
    inputSchema: schema({
      ruleId: str(),
      name: str(),
      description: str(),
      conditions: obj(),
      actions: obj(),
      enabled: bool(),
    }),
    method: "PUT",
    path: (a) => `/api/alert-rules/${a.ruleId}`,
    pathKeys: ["ruleId"],
    body: "rest",
  }),
  def({
    name: "delete_alert_rule",
    description: "Delete an alert rule (DELETE /api/alert-rules/:id).",
    inputSchema: schema({ ruleId: str() }, ["ruleId"]),
    method: "DELETE",
    path: (a) => `/api/alert-rules/${a.ruleId}`,
    pathKeys: ["ruleId"],
    destructive: true,
  }),
  def({
    name: "list_alerts",
    description: "Fired alerts, newest first (GET /api/alerts).",
    inputSchema: schema({ resolved: bool("Filter by resolved state"), limit: int() }),
    method: "GET",
    path: () => "/api/alerts",
    queryKeys: ["resolved", "limit"],
  }),
  def({
    name: "resolve_alert",
    description: "Mark an alert resolved (POST /api/alerts/:id/resolve).",
    inputSchema: schema({ alertId: str() }, ["alertId"]),
    method: "POST",
    path: (a) => `/api/alerts/${a.alertId}/resolve`,
    pathKeys: ["alertId"],
    body: [],
  }),
  def({
    name: "list_alert_deliveries",
    description: "Email/webhook delivery attempts for one alert (GET /api/alerts/:id/deliveries).",
    inputSchema: schema({ alertId: str() }, ["alertId"]),
    method: "GET",
    path: (a) => `/api/alerts/${a.alertId}/deliveries`,
    pathKeys: ["alertId"],
  }),
  def({
    name: "bulk_resolve_alerts",
    description: "Resolve many alerts at once (POST /api/alerts/bulk-resolve).",
    inputSchema: schema({ alertIds: arr(str()) }, ["alertIds"]),
    method: "POST",
    path: () => "/api/alerts/bulk-resolve",
    body: ["alertIds"],
  }),
  def({
    name: "get_alert_stats",
    description: "Alert totals by severity and type (GET /api/alerts/stats).",
    inputSchema: schema({ scope: enumOf(["mine", "all"]) }),
    method: "GET",
    path: () => "/api/alerts/stats",
    queryKeys: ["scope"],
  }),
];

// ── Sharing / ops / mods / audit / hosts / plugins / migration / system ────

const extendedTools: McpToolDef[] = [
  def({
    name: "list_server_invites",
    description: "Pending access invites for a server (GET /api/servers/:id/invites).",
    inputSchema: schema({ serverId: serverId() }, ["serverId"]),
    method: "GET",
    path: (a) => `/api/servers/${a.serverId}/invites`,
    pathKeys: ["serverId"],
  }),
  def({
    name: "create_server_invite",
    description: "Invite someone by email with a permission set (POST /api/servers/:id/invites). Returns the invite link.",
    inputSchema: schema(
      {
        serverId: serverId(),
        email: str(),
        permissions: arr(str(), "e.g. [console.read, console.write, file.read]"),
      },
      ["serverId", "email", "permissions"],
    ),
    method: "POST",
    path: (a) => `/api/servers/${a.serverId}/invites`,
    pathKeys: ["serverId"],
    body: "rest",
  }),
  def({
    name: "delete_server_invite",
    description: "Cancel a pending invite (DELETE /api/servers/:id/invites/:inviteId).",
    inputSchema: schema({ serverId: serverId(), inviteId: str() }, ["serverId", "inviteId"]),
    method: "DELETE",
    path: (a) => `/api/servers/${a.serverId}/invites/${a.inviteId}`,
    pathKeys: ["serverId", "inviteId"],
    destructive: true,
  }),
  def({
    name: "regenerate_server_invite",
    description: "Issue a fresh token for a pending invite (POST /api/servers/:id/invites/:inviteId/regenerate).",
    inputSchema: schema({ serverId: serverId(), inviteId: str() }, ["serverId", "inviteId"]),
    method: "POST",
    path: (a) => `/api/servers/${a.serverId}/invites/${a.inviteId}/regenerate`,
    pathKeys: ["serverId", "inviteId"],
    body: [],
  }),
  def({
    name: "preview_invite",
    description: "Show what an invite token grants without accepting it (GET /api/servers/invites/:token).",
    inputSchema: schema({ token: str("Invite token from the invite link") }, ["token"]),
    method: "GET",
    path: (a) => `/api/servers/invites/${a.token}`,
    pathKeys: ["token"],
  }),
  def({
    name: "list_server_access",
    description: "Users with direct access to a server and their permissions (GET /api/servers/:id/access).",
    inputSchema: schema({ serverId: serverId() }, ["serverId"]),
    method: "GET",
    path: (a) => `/api/servers/${a.serverId}/access`,
    pathKeys: ["serverId"],
  }),
  def({
    name: "grant_server_access",
    description: "Give a user permissions on a server, or update their set (POST /api/servers/:id/access).",
    inputSchema: schema(
      { serverId: serverId(), targetUserId: str(), permissions: arr(str()) },
      ["serverId", "targetUserId", "permissions"],
    ),
    method: "POST",
    path: (a) => `/api/servers/${a.serverId}/access`,
    pathKeys: ["serverId"],
    body: "rest",
  }),
  def({
    name: "remove_server_access",
    description: "Revoke a user's direct access to a server (DELETE /api/servers/:id/access/:userId).",
    inputSchema: schema({ serverId: serverId(), targetUserId: str() }, ["serverId", "targetUserId"]),
    method: "DELETE",
    path: (a) => `/api/servers/${a.serverId}/access/${a.targetUserId}`,
    pathKeys: ["serverId", "targetUserId"],
    destructive: true,
  }),
  def({
    name: "get_my_server_permissions",
    description: "Effective permissions the API key holder has on one server (GET /api/servers/:id/permissions).",
    inputSchema: schema({ serverId: serverId() }, ["serverId"]),
    method: "GET",
    path: (a) => `/api/servers/${a.serverId}/permissions`,
    pathKeys: ["serverId"],
  }),
  def({
    name: "list_transfer_candidates",
    description: "Users eligible to receive server ownership (GET /api/servers/:id/transfer-candidates).",
    inputSchema: schema({ serverId: serverId() }, ["serverId"]),
    method: "GET",
    path: (a) => `/api/servers/${a.serverId}/transfer-candidates`,
    pathKeys: ["serverId"],
  }),
  def({
    name: "transfer_server_ownership",
    description: "Transfer server ownership to another user (POST /api/servers/:id/transfer-ownership).",
    inputSchema: schema({ serverId: serverId(), newOwnerId: str() }, ["serverId", "newOwnerId"]),
    method: "POST",
    path: (a) => `/api/servers/${a.serverId}/transfer-ownership`,
    pathKeys: ["serverId"],
    body: ["newOwnerId"],
    destructive: true,
  }),
  def({
    name: "get_server_stats",
    description: "Latest resource snapshot for a server (GET /api/servers/:id/stats).",
    inputSchema: schema({ serverId: serverId() }, ["serverId"]),
    method: "GET",
    path: (a) => `/api/servers/${a.serverId}/stats`,
    pathKeys: ["serverId"],
  }),
  def({
    name: "get_server_metrics_history",
    description: "Time-series CPU/memory/disk/network history (GET /api/servers/:id/metrics).",
    inputSchema: schema({ serverId: serverId(), hours: int("Lookback window (max 168)"), limit: int() }, ["serverId"]),
    method: "GET",
    path: (a) => `/api/servers/${a.serverId}/metrics`,
    pathKeys: ["serverId"],
    queryKeys: ["hours", "limit"],
  }),
  def({
    name: "bulk_suspend_servers",
    description: "Suspend up to 100 servers at once (POST /api/servers/bulk/suspend).",
    inputSchema: schema(
      {
        serverIds: arr(str()),
        reason: str("Recorded reason"),
        stopServer: bool("Stop running servers first"),
      },
      ["serverIds"],
    ),
    method: "POST",
    path: () => "/api/servers/bulk/suspend",
    body: ["serverIds", "reason", "stopServer"],
  }),
  def({
    name: "bulk_unsuspend_servers",
    description: "Unsuspend up to 100 servers at once (POST /api/servers/bulk/unsuspend).",
    inputSchema: schema({ serverIds: arr(str()) }, ["serverIds"]),
    method: "POST",
    path: () => "/api/servers/bulk/unsuspend",
    body: ["serverIds"],
  }),
  def({
    name: "bulk_delete_servers",
    description: "Delete up to 100 stopped servers at once (DELETE /api/servers/bulk).",
    inputSchema: schema({ serverIds: arr(str()) }, ["serverIds"]),
    method: "DELETE",
    path: () => "/api/servers/bulk",
    body: ["serverIds"],
    destructive: true,
  }),
  def({
    name: "get_backup_download",
    description: "Download URL or stream info for a backup file (GET /api/servers/:id/backups/:backupId/download).",
    inputSchema: schema({ serverId: serverId(), backupId: str() }, ["serverId", "backupId"]),
    method: "GET",
    path: (a) => `/api/servers/${a.serverId}/backups/${a.backupId}/download`,
    pathKeys: ["serverId", "backupId"],
  }),
  def({
    name: "list_sftp_tokens",
    description: "Active SFTP tokens for file access to a server (GET /api/sftp/tokens?serverId=...).",
    inputSchema: schema({ serverId: serverId() }, ["serverId"]),
    method: "GET",
    path: () => "/api/sftp/tokens",
    queryKeys: ["serverId"],
  }),
  def({
    name: "search_mods",
    description: "Search Modrinth/CurseForge for mods compatible with a server (GET /api/servers/:id/mod-manager/search).",
    inputSchema: schema({
      serverId: serverId(),
      provider: str("modrinth or curseforge"),
      query: str("Empty query returns trending"),
      game: str(),
      gameVersion: str(),
      loader: str("e.g. fabric, forge, paper"),
    }),
    method: "GET",
    path: (a) => `/api/servers/${a.serverId}/mod-manager/search`,
    pathKeys: ["serverId"],
    queryKeys: ["provider", "query", "game", "gameVersion", "loader"],
  }),
  def({
    name: "install_mod",
    description: "Install a mod version onto a server (POST /api/servers/:id/mod-manager/install).",
    inputSchema: schema({
      serverId: serverId(),
      provider: str(),
      projectId: str(),
      versionId: str(),
      game: str(),
      projectName: str(),
      target: str("Mods target, e.g. mods, datapacks, modpack (defaults per template)"),
    }),
    method: "POST",
    path: (a) => `/api/servers/${a.serverId}/mod-manager/install`,
    pathKeys: ["serverId"],
    body: "rest",
  }),
  def({
    name: "list_installed_mods",
    description: "Mods already installed on a server (GET /api/servers/:id/mod-manager/installed).",
    inputSchema: schema({ serverId: serverId() }, ["serverId"]),
    method: "GET",
    path: (a) => `/api/servers/${a.serverId}/mod-manager/installed`,
    pathKeys: ["serverId"],
  }),
  def({
    name: "uninstall_mod",
    description: "Remove an installed mod file (POST /api/servers/:id/mod-manager/uninstall).",
    inputSchema: schema({ serverId: serverId(), filename: str(), target: str() }),
    method: "POST",
    path: (a) => `/api/servers/${a.serverId}/mod-manager/uninstall`,
    pathKeys: ["serverId"],
    body: "rest",
  }),
  def({
    name: "check_mod_updates",
    description: "Check installed mods for newer versions (POST /api/servers/:id/mod-manager/check-updates).",
    inputSchema: schema({ serverId: serverId(), filenames: arr(str()) }, ["serverId", "filenames"]),
    method: "POST",
    path: (a) => `/api/servers/${a.serverId}/mod-manager/check-updates`,
    pathKeys: ["serverId"],
    body: "rest",
  }),
  def({
    name: "search_plugins",
    description: "Search providers for server plugins (GET /api/servers/:id/plugin-manager/search).",
    inputSchema: schema({
      serverId: serverId(),
      provider: str(),
      query: str(),
      game: str(),
      gameVersion: str(),
      loader: str(),
    }),
    method: "GET",
    path: (a) => `/api/servers/${a.serverId}/plugin-manager/search`,
    pathKeys: ["serverId"],
    queryKeys: ["provider", "query", "game", "gameVersion", "loader"],
  }),
  def({
    name: "install_plugin",
    description: "Install a plugin version onto a server (POST /api/servers/:id/plugin-manager/install).",
    inputSchema: schema({
      serverId: serverId(),
      provider: str(),
      projectId: str(),
      versionId: str(),
      game: str(),
      projectName: str(),
      target: str(),
    }),
    method: "POST",
    path: (a) => `/api/servers/${a.serverId}/plugin-manager/install`,
    pathKeys: ["serverId"],
    body: "rest",
  }),
  def({
    name: "list_installed_plugins",
    description: "Plugins already installed on a server (GET /api/servers/:id/plugin-manager/installed).",
    inputSchema: schema({ serverId: serverId() }, ["serverId"]),
    method: "GET",
    path: (a) => `/api/servers/${a.serverId}/plugin-manager/installed`,
    pathKeys: ["serverId"],
  }),
  def({
    name: "uninstall_plugin",
    description: "Remove an installed plugin file (POST /api/servers/:id/plugin-manager/uninstall).",
    inputSchema: schema({ serverId: serverId(), filename: str() }, ["serverId", "filename"]),
    method: "POST",
    path: (a) => `/api/servers/${a.serverId}/plugin-manager/uninstall`,
    pathKeys: ["serverId"],
    body: "rest",
  }),
  def({
    name: "list_audit_logs",
    description: "Panel audit log with user/action/resource filters (GET /api/admin/audit-logs).",
    inputSchema: schema({
      page: int(),
      limit: int(),
      userId: str(),
      action: str("Substring match, e.g. server.start"),
      resource: str(),
      from: str("ISO start timestamp"),
      to: str("ISO end timestamp"),
    }),
    method: "GET",
    path: () => "/api/admin/audit-logs",
    queryKeys: ["page", "limit", "userId", "action", "resource", "from", "to"],
  }),
  def({
    name: "list_system_errors",
    description: "Captured panel/agent errors with level and resolution filters (GET /api/admin/system-errors).",
    inputSchema: schema({
      page: int(),
      limit: int(),
      level: str("error, warn, or critical"),
      component: str("Substring match, e.g. WebSocketGateway"),
      nodeId: str(),
      resolved: bool(),
      from: str(),
      to: str(),
    }),
    method: "GET",
    path: () => "/api/admin/system-errors",
    queryKeys: ["page", "limit", "level", "component", "nodeId", "resolved", "from", "to"],
  }),
  def({
    name: "resolve_system_error",
    description: "Mark one system error resolved (POST /api/admin/system-errors/:id/resolve).",
    inputSchema: schema({ errorId: str() }, ["errorId"]),
    method: "POST",
    path: (a) => `/api/admin/system-errors/${a.errorId}/resolve`,
    pathKeys: ["errorId"],
    body: [],
  }),
  def({
    name: "resolve_all_system_errors",
    description: "Mark all currently unresolved system errors resolved (POST /api/admin/system-errors/resolve-all).",
    inputSchema: schema({}),
    method: "POST",
    path: () => "/api/admin/system-errors/resolve-all",
    body: [],
  }),
  def({
    name: "list_db_hosts",
    description: "MySQL/Postgres hosts the panel can provision from (GET /api/admin/database-hosts).",
    inputSchema: schema({}),
    method: "GET",
    path: () => "/api/admin/database-hosts",
  }),
  def({
    name: "create_db_host",
    description: "Register a database host (POST /api/admin/database-hosts).",
    inputSchema: schema(
      {
        name: str(),
        host: str(),
        username: str(),
        password: str(),
        port: int(),
        engine: enumOf(["mysql", "postgresql", "postgres"]),
        database: str(),
      },
      ["name", "host", "username", "password"],
    ),
    method: "POST",
    path: () => "/api/admin/database-hosts",
    body: "rest",
  }),
  def({
    name: "update_db_host",
    description: "Update a database host (PUT /api/admin/database-hosts/:id).",
    inputSchema: schema({
      hostId: str(),
      name: str(),
      host: str(),
      port: int(),
      username: str(),
      password: str(),
    }),
    method: "PUT",
    path: (a) => `/api/admin/database-hosts/${a.hostId}`,
    pathKeys: ["hostId"],
    body: "rest",
  }),
  def({
    name: "delete_db_host",
    description: "Delete a database host with no live databases (DELETE /api/admin/database-hosts/:id).",
    inputSchema: schema({ hostId: str() }, ["hostId"]),
    method: "DELETE",
    path: (a) => `/api/admin/database-hosts/${a.hostId}`,
    pathKeys: ["hostId"],
    destructive: true,
  }),
  def({
    name: "ping_db_host",
    description: "Test connectivity to a database host (POST /api/admin/database-hosts/:id/ping).",
    inputSchema: schema({ hostId: str() }, ["hostId"]),
    method: "POST",
    path: (a) => `/api/admin/database-hosts/${a.hostId}/ping`,
    pathKeys: ["hostId"],
    body: [],
  }),
  def({
    name: "list_panel_plugins",
    description: "Installed panel plugins with status and consent state (GET /api/plugins).",
    inputSchema: schema({}),
    method: "GET",
    path: () => "/api/plugins",
  }),
  def({
    name: "get_panel_plugin",
    description: "One plugin's capabilities, config, and permission state (GET /api/plugins/:name).",
    inputSchema: schema({ name: str() }, ["name"]),
    method: "GET",
    path: (a) => `/api/plugins/${a.name}`,
    pathKeys: ["name"],
  }),
  def({
    name: "set_panel_plugin_enabled",
    description: "Enable or disable a plugin. Enabling may require safety disclaimer acceptance (POST /api/plugins/:name/enable).",
    inputSchema: schema({
      name: str(),
      enabled: bool(),
      disclaimerVersion: str("Safety disclaimer version being accepted, when prompted"),
    }),
    method: "POST",
    path: (a) => `/api/plugins/${a.name}/enable`,
    pathKeys: ["name"],
    body: (a) => ({
      enabled: a.enabled,
      safety: a.disclaimerVersion ? { disclaimerVersion: a.disclaimerVersion } : undefined,
    }),
  }),
  def({
    name: "reload_panel_plugin",
    description: "Hot-reload a plugin without restarting the panel (POST /api/plugins/:name/reload).",
    inputSchema: schema({ name: str() }, ["name"]),
    method: "POST",
    path: (a) => `/api/plugins/${a.name}/reload`,
    pathKeys: ["name"],
    body: [],
  }),
  def({
    name: "install_panel_plugin",
    description: "Download and stage a plugin package; it stays inert until enabled (POST /api/plugins/install).",
    inputSchema: schema({ url: str(), sha256: str("64-char hex digest") }, ["url"]),
    method: "POST",
    path: () => "/api/plugins/install",
    body: "rest",
  }),
  def({
    name: "browse_plugin_marketplace",
    description: "Browse configured plugin marketplace indexes (GET /api/plugins/marketplace).",
    inputSchema: schema({ forceRefresh: bool() }),
    method: "GET",
    path: () => "/api/plugins/marketplace",
    queryKeys: ["forceRefresh"],
  }),
  def({
    name: "list_migration_jobs",
    description: "Pterodactyl migration jobs (GET /api/admin/migration).",
    inputSchema: schema({}),
    method: "GET",
    path: () => "/api/admin/migration",
  }),
  def({
    name: "get_migration_job",
    description: "One migration job with status (GET /api/admin/migration/:jobId).",
    inputSchema: schema({ jobId: str() }, ["jobId"]),
    method: "GET",
    path: (a) => `/api/admin/migration/${a.jobId}`,
    pathKeys: ["jobId"],
  }),
  def({
    name: "get_migration_steps",
    description: "Step-level progress of a migration job (GET /api/admin/migration/:jobId/steps).",
    inputSchema: schema({ jobId: str() }, ["jobId"]),
    method: "GET",
    path: (a) => `/api/admin/migration/${a.jobId}/steps`,
    pathKeys: ["jobId"],
  }),
  def({
    name: "pause_migration_job",
    description: "Pause a running migration job (POST /api/admin/migration/:jobId/pause).",
    inputSchema: schema({ jobId: str() }, ["jobId"]),
    method: "POST",
    path: (a) => `/api/admin/migration/${a.jobId}/pause`,
    pathKeys: ["jobId"],
    body: [],
  }),
  def({
    name: "resume_migration_job",
    description: "Resume a paused migration job (POST /api/admin/migration/:jobId/resume).",
    inputSchema: schema({ jobId: str() }, ["jobId"]),
    method: "POST",
    path: (a) => `/api/admin/migration/${a.jobId}/resume`,
    pathKeys: ["jobId"],
    body: [],
  }),
  def({
    name: "cancel_migration_job",
    description: "Cancel a migration job (POST /api/admin/migration/:jobId/cancel).",
    inputSchema: schema({ jobId: str() }, ["jobId"]),
    method: "POST",
    path: (a) => `/api/admin/migration/${a.jobId}/cancel`,
    pathKeys: ["jobId"],
    body: [],
    destructive: true,
  }),
  def({
    name: "retry_migration_step",
    description: "Retry one failed migration step (POST /api/admin/migration/:jobId/retry/:stepId).",
    inputSchema: schema({ jobId: str(), stepId: str() }, ["jobId", "stepId"]),
    method: "POST",
    path: (a) => `/api/admin/migration/${a.jobId}/retry/${a.stepId}`,
    pathKeys: ["jobId", "stepId"],
    body: [],
  }),
  def({
    name: "get_update_status",
    description: "Panel version, latest release, and update availability (GET /api/admin/update/status).",
    inputSchema: schema({}),
    method: "GET",
    path: () => "/api/admin/update/status",
  }),
  def({
    name: "trigger_panel_update",
    description: "Start a panel update. Disruptive: run only with approval (POST /api/admin/update/trigger).",
    inputSchema: schema({}),
    method: "POST",
    path: () => "/api/admin/update/trigger",
    body: [],
    destructive: true,
  }),
  def({
    name: "get_provider_key_status",
    description: "Which mod-provider API keys are configured, booleans only (GET /api/providers/status).",
    inputSchema: schema({}),
    method: "GET",
    path: () => "/api/providers/status",
  }),
];

export const MCP_TOOLS: McpToolDef[] = [
  ...metaTools,
  ...serverTools,
  ...fileTools,
  ...infraTools,
  ...adminTools,
  ...extendedTools,
];

const toolsByName = new Map<string, McpToolDef>(MCP_TOOLS.map((t) => [t.name, t]));

export function getMcpTool(name: string): McpToolDef | undefined {
  return toolsByName.get(name);
}

/** Request plan resolved from tool arguments. */
export interface McpUpstreamRequest {
  method: McpHttpMethod;
  path: string;
  query: Record<string, string>;
  body: unknown;
}

function toQueryValue(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

/**
 * Resolve a tool call into an upstream REST request. The `confirm` flag is
 * consumed here and never forwarded.
 */
export function planUpstreamRequest(
  tool: McpToolDef,
  args: Record<string, any>,
): McpUpstreamRequest {
  const query: Record<string, string> = {};
  for (const key of tool.queryKeys ?? []) {
    const value = toQueryValue(args[key]);
    if (value !== null) query[key] = value;
  }
  let body: unknown;
  if (tool.body === undefined) {
    body = undefined;
  } else if (typeof tool.body === "function") {
    body = tool.body(args);
  } else if (tool.body === "rest") {
    const skip = new Set([...(tool.pathKeys ?? []), ...(tool.queryKeys ?? []), "confirm"]);
    const rest: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(args)) {
      if (!skip.has(key) && value !== undefined) rest[key] = value;
    }
    body = rest;
  } else {
    const picked: Record<string, unknown> = {};
    for (const key of tool.body) {
      if (args[key] !== undefined) picked[key] = args[key];
    }
    body = picked;
  }
  return { method: tool.method, path: tool.path(args), query, body };
}
