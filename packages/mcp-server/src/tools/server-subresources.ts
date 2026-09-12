import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { CatalystClient } from "../client.js";
import { toJsonText } from "../client.js";

function text(value: unknown) {
  return { content: [{ type: "text" as const, text: toJsonText(value) }] };
}

const serverId = z.string().describe("Server ID (cuid)");

export function registerFileTools(server: McpServer, client: CatalystClient): void {
  server.registerTool(
    "list_files",
    {
      description: "List files in a server directory (GET /api/servers/:id/files?path=...).",
      inputSchema: z.object({ serverId, path: z.string().optional().describe("Directory path, defaults to /") }),
    },
    async (args) => text(await client.get(`/servers/${args.serverId}/files`, { path: args.path ?? "/" })),
  );

  server.registerTool(
    "download_file",
    {
      description: "Download a text file's contents (GET /api/servers/:id/files/download). Binary files are truncated.",
      inputSchema: z.object({ serverId, path: z.string().describe("File path, e.g. /server.properties") }),
    },
    async (args) => text(await client.get(`/servers/${args.serverId}/files/download`, { path: args.path })),
  );

  server.registerTool(
    "write_file",
    {
      description: "Create or overwrite a text file with full content (POST /api/servers/:id/files/write).",
      inputSchema: z.object({
        serverId,
        path: z.string().describe("Destination file path"),
        content: z.string().describe("Full file content"),
      }),
    },
    async (args) => text(await client.post(`/servers/${args.serverId}/files/write`, { path: args.path, content: args.content })),
  );

  server.registerTool(
    "create_file_or_directory",
    {
      description: "Create an empty file or directory (POST /api/servers/:id/files/create).",
      inputSchema: z.object({
        serverId,
        name: z.string().describe("File or directory name/path"),
        type: z.enum(["file", "directory"]).describe("What to create"),
        content: z.string().optional().describe("Initial content for files"),
      }),
    },
    async (args) => text(await client.post(`/servers/${args.serverId}/files/create`, args)),
  );

  server.registerTool(
    "rename_file",
    {
      description: "Rename or move a file or directory (POST /api/servers/:id/files/rename).",
      inputSchema: z.object({ serverId, from: z.string(), to: z.string() }),
    },
    async (args) => text(await client.post(`/servers/${args.serverId}/files/rename`, { from: args.from, to: args.to })),
  );

  server.registerTool(
    "delete_file",
    {
      description: "Delete a file or directory (DELETE /api/servers/:id/files/delete).",
      inputSchema: z.object({ serverId, path: z.string().describe("Path to delete") }),
    },
    async (args) => text(await client.request({ method: "DELETE", path: `/servers/${args.serverId}/files/delete`, query: { path: args.path } })),
  );

  server.registerTool(
    "set_file_permissions",
    {
      description: "chmod a file using octal notation like 644 (POST /api/servers/:id/files/permissions).",
      inputSchema: z.object({ serverId, path: z.string(), mode: z.string().describe("Octal mode, e.g. 644") }),
    },
    async (args) => text(await client.post(`/servers/${args.serverId}/files/permissions`, { path: args.path, mode: args.mode })),
  );

  server.registerTool(
    "compress_files",
    {
      description: "Compress files into a zip/tar.gz archive (POST /api/servers/:id/files/compress).",
      inputSchema: z.object({
        serverId,
        paths: z.array(z.string()).min(1).describe("Source paths to include"),
        destination: z.string().describe("Archive path, e.g. /backup.zip"),
      }),
    },
    async (args) => text(await client.post(`/servers/${args.serverId}/files/compress`, args)),
  );

  server.registerTool(
    "decompress_archive",
    {
      description: "Extract a zip/tar.gz archive (POST /api/servers/:id/files/decompress).",
      inputSchema: z.object({
        serverId,
        path: z.string().describe("Archive path"),
        destination: z.string().optional().describe("Target directory (defaults to archive directory)"),
      }),
    },
    async (args) => text(await client.post(`/servers/${args.serverId}/files/decompress`, args)),
  );

  server.registerTool(
    "list_archive_contents",
    {
      description: "Peek inside an archive without extracting it (POST /api/servers/:id/files/archive-contents).",
      inputSchema: z.object({ serverId, path: z.string().describe("Archive path") }),
    },
    async (args) => text(await client.post(`/servers/${args.serverId}/files/archive-contents`, { path: args.path })),
  );
}

export function registerNetworkTools(server: McpServer, client: CatalystClient): void {
  server.registerTool(
    "list_server_allocations",
    {
      description: "Network allocations bound to a server (GET /api/servers/:id/allocations).",
      inputSchema: z.object({ serverId }),
    },
    async (args) => text(await client.get(`/servers/${args.serverId}/allocations`)),
  );

  server.registerTool(
    "add_server_allocation",
    {
      description: "Bind a free node allocation or a host/container port pair to a server (POST /api/servers/:id/allocations).",
      inputSchema: z.object({
        serverId,
        allocationId: z.string().optional(),
        containerPort: z.number().int().min(1).max(65535).optional(),
        hostPort: z.number().int().min(1).max(65535).optional(),
      }),
    },
    async (args) => {
      const { serverId: id, ...body } = args;
      return text(await client.post(`/servers/${id}/allocations`, body));
    },
  );

  server.registerTool(
    "remove_server_allocation",
    {
      description: "Unbind a network allocation from a server (DELETE /api/servers/:id/allocations/:allocationId).",
      inputSchema: z.object({ serverId, allocationId: z.string() }),
    },
    async (args) => text(await client.delete(`/servers/${args.serverId}/allocations/${args.allocationId}`)),
  );
}

export function registerDatabaseTools(server: McpServer, client: CatalystClient): void {
  server.registerTool(
    "list_database_hosts",
    {
      description: "Database hosts available for provisioning (GET /api/servers/database-hosts).",
      inputSchema: z.object({}),
    },
    async () => text(await client.get("/servers/database-hosts")),
  );

  server.registerTool(
    "list_server_databases",
    {
      description: "Databases owned by a server (GET /api/servers/:id/databases).",
      inputSchema: z.object({ serverId }),
    },
    async (args) => text(await client.get(`/servers/${args.serverId}/databases`)),
  );

  server.registerTool(
    "create_server_database",
    {
      description: "Provision a database for a server (POST /api/servers/:id/databases).",
      inputSchema: z.object({
        serverId,
        hostId: z.string().describe("Database host ID from list_database_hosts"),
        database: z.string().optional().describe("Database name (generated when omitted)"),
      }),
    },
    async (args) => {
      const { serverId: id, ...body } = args;
      return text(await client.post(`/servers/${id}/databases`, body));
    },
  );

  server.registerTool(
    "delete_server_database",
    {
      description: "Delete a server database (DELETE /api/servers/:id/databases/:databaseId).",
      inputSchema: z.object({ serverId, databaseId: z.string() }),
    },
    async (args) => text(await client.delete(`/servers/${args.serverId}/databases/${args.databaseId}`)),
  );
}

export function registerBackupTools(server: McpServer, client: CatalystClient): void {
  server.registerTool(
    "list_backups",
    {
      description: "Backups for a server, newest first (GET /api/servers/:id/backups).",
      inputSchema: z.object({ serverId }),
    },
    async (args) => text(await client.get(`/servers/${args.serverId}/backups`)),
  );

  server.registerTool(
    "create_backup",
    {
      description: "Start a backup of a server (POST /api/servers/:id/backups).",
      inputSchema: z.object({
        serverId,
        name: z.string().optional().describe("Friendly backup name"),
      }),
    },
    async (args) => text(await client.post(`/servers/${args.serverId}/backups`, { name: args.name })),
  );

  server.registerTool(
    "restore_backup",
    {
      description: "Restore a backup over the server's current files (POST /api/servers/:id/backups/:backupId/restore).",
      inputSchema: z.object({ serverId, backupId: z.string() }),
    },
    async (args) => text(await client.post(`/servers/${args.serverId}/backups/${args.backupId}/restore`, {})),
  );

  server.registerTool(
    "delete_backup",
    {
      description: "Delete a backup (DELETE /api/servers/:id/backups/:backupId).",
      inputSchema: z.object({ serverId, backupId: z.string() }),
    },
    async (args) => text(await client.delete(`/servers/${args.serverId}/backups/${args.backupId}`)),
  );
}

export function registerTaskTools(server: McpServer, client: CatalystClient): void {
  server.registerTool(
    "list_scheduled_tasks",
    {
      description: "Cron tasks for a server (GET /api/servers/:id/tasks).",
      inputSchema: z.object({ serverId }),
    },
    async (args) => text(await client.get(`/servers/${args.serverId}/tasks`)),
  );

  server.registerTool(
    "create_scheduled_task",
    {
      description: "Create a cron task: restart/stop/start/backup/command (POST /api/servers/:id/tasks).",
      inputSchema: z.object({
        serverId,
        name: z.string(),
        action: z.enum(["restart", "stop", "start", "backup", "command"]),
        schedule: z.string().describe("Cron expression, e.g. 0 3 * * *"),
        payload: z.record(z.string(), z.unknown()).optional().describe("Extra data, e.g. {command: 'say hi'}"),
        enabled: z.boolean().optional(),
      }),
    },
    async (args) => {
      const { serverId: id, ...body } = args;
      return text(await client.post(`/servers/${id}/tasks`, body));
    },
  );

  server.registerTool(
    "update_scheduled_task",
    {
      description: "Update a scheduled task (PUT /api/servers/:id/tasks/:taskId).",
      inputSchema: z.object({
        serverId,
        taskId: z.string(),
        name: z.string().optional(),
        schedule: z.string().optional(),
        enabled: z.boolean().optional(),
        payload: z.record(z.string(), z.unknown()).optional(),
      }),
    },
    async (args) => {
      const { serverId: id, taskId, ...body } = args;
      return text(await client.put(`/servers/${id}/tasks/${taskId}`, body));
    },
  );

  server.registerTool(
    "delete_scheduled_task",
    {
      description: "Delete a scheduled task (DELETE /api/servers/:id/tasks/:taskId).",
      inputSchema: z.object({ serverId, taskId: z.string() }),
    },
    async (args) => text(await client.delete(`/servers/${args.serverId}/tasks/${args.taskId}`)),
  );
}
