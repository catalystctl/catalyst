import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { CatalystClient } from "../client.js";
import { toJsonText } from "../client.js";

function text(value: unknown) {
  return { content: [{ type: "text" as const, text: toJsonText(value) }] };
}

const serverId = z.string().describe("Server ID (cuid)");

export function registerTemplateManagementTools(server: McpServer, client: CatalystClient): void {
  server.registerTool(
    "create_template",
    {
      description: "Create a server template/egg (POST /api/templates). Needs author, image, startup, and variables.",
      inputSchema: z.object({
        name: z.string(),
        author: z.string(),
        version: z.string().optional(),
        description: z.string().optional(),
        image: z.string().describe("Default container image, e.g. ghcr.io/pterodactyl/yolks:java_21"),
        startup: z.string().describe("Startup command, e.g. java -jar server.jar"),
        stopCommand: z.string().optional(),
        variables: z.array(z.record(z.string(), z.unknown())).optional().describe("Environment variable definitions"),
        installScript: z.string().optional(),
        supportedPorts: z.array(z.number().int()).optional(),
        allocatedMemoryMb: z.number().int().optional(),
        allocatedCpuCores: z.number().optional(),
        nestId: z.string().optional(),
      }),
    },
    async (args) => text(await client.post("/templates", args)),
  );

  server.registerTool(
    "update_template",
    {
      description: "Update a template (PUT /api/templates/:id). Only the given fields change.",
      inputSchema: z.object({
        templateId: z.string(),
        name: z.string().optional(),
        description: z.string().optional(),
        author: z.string().optional(),
        version: z.string().optional(),
        image: z.string().optional(),
        startup: z.string().optional(),
        stopCommand: z.string().optional(),
        variables: z.array(z.record(z.string(), z.unknown())).optional(),
        installScript: z.string().optional(),
        nestId: z.string().nullable().optional(),
      }),
    },
    async (args) => {
      const { templateId, ...body } = args;
      return text(await client.put(`/templates/${templateId}`, body));
    },
  );

  server.registerTool(
    "delete_template",
    {
      description: "Delete a template that no server uses (DELETE /api/templates/:id).",
      inputSchema: z.object({ templateId: z.string() }),
    },
    async (args) => text(await client.delete(`/templates/${args.templateId}`)),
  );

  server.registerTool(
    "import_pterodactyl_egg",
    {
      description: "Convert a Pterodactyl egg JSON into a Catalyst template (POST /api/templates/import-pterodactyl).",
      inputSchema: z.object({
        egg: z.record(z.string(), z.unknown()).describe("Full Pterodactyl egg JSON object"),
        nestId: z.string().optional(),
      }),
    },
    async (args) => text(await client.post("/templates/import-pterodactyl", { ...args.egg, nestId: args.nestId })),
  );

  server.registerTool(
    "get_nest",
    {
      description: "One template nest with its templates (GET /api/nests/:id).",
      inputSchema: z.object({ nestId: z.string() }),
    },
    async (args) => text(await client.get(`/nests/${args.nestId}`)),
  );

  server.registerTool(
    "create_nest",
    {
      description: "Create a template category/nest (POST /api/nests).",
      inputSchema: z.object({
        name: z.string(),
        description: z.string().optional(),
        icon: z.string().optional(),
        author: z.string().optional(),
      }),
    },
    async (args) => text(await client.post("/nests", args)),
  );

  server.registerTool(
    "update_nest",
    {
      description: "Rename or re-describe a nest (PUT /api/nests/:id).",
      inputSchema: z.object({
        nestId: z.string(),
        name: z.string().optional(),
        description: z.string().optional(),
        icon: z.string().optional(),
        author: z.string().optional(),
      }),
    },
    async (args) => {
      const { nestId, ...body } = args;
      return text(await client.put(`/nests/${nestId}`, body));
    },
  );

  server.registerTool(
    "delete_nest",
    {
      description: "Delete a nest; its templates become uncategorized (DELETE /api/nests/:id).",
      inputSchema: z.object({ nestId: z.string() }),
    },
    async (args) => text(await client.delete(`/nests/${args.nestId}`)),
  );
}

export function registerSharingTools(server: McpServer, client: CatalystClient): void {
  server.registerTool(
    "list_server_invites",
    {
      description: "Pending access invites for a server (GET /api/servers/:id/invites).",
      inputSchema: z.object({ serverId }),
    },
    async (args) => text(await client.get(`/servers/${args.serverId}/invites`)),
  );

  server.registerTool(
    "create_server_invite",
    {
      description: "Invite someone by email with a permission set (POST /api/servers/:id/invites). Returns the invite link.",
      inputSchema: z.object({
        serverId,
        email: z.string().email(),
        permissions: z.array(z.string()).min(1).describe("e.g. [console.read, console.write, file.read]"),
      }),
    },
    async (args) => {
      const { serverId: id, ...body } = args;
      return text(await client.post(`/servers/${id}/invites`, body));
    },
  );

  server.registerTool(
    "delete_server_invite",
    {
      description: "Cancel a pending invite (DELETE /api/servers/:id/invites/:inviteId).",
      inputSchema: z.object({ serverId, inviteId: z.string() }),
    },
    async (args) => text(await client.delete(`/servers/${args.serverId}/invites/${args.inviteId}`)),
  );

  server.registerTool(
    "regenerate_server_invite",
    {
      description: "Issue a fresh token for a pending invite (POST /api/servers/:id/invites/:inviteId/regenerate).",
      inputSchema: z.object({ serverId, inviteId: z.string() }),
    },
    async (args) => text(await client.post(`/servers/${args.serverId}/invites/${args.inviteId}/regenerate`, {})),
  );

  server.registerTool(
    "preview_invite",
    {
      description: "Show what an invite token grants without accepting it (GET /api/servers/invites/:token).",
      inputSchema: z.object({ token: z.string().describe("Invite token from the invite link") }),
    },
    async (args) => text(await client.get(`/servers/invites/${args.token}`)),
  );

  server.registerTool(
    "list_server_access",
    {
      description: "Users with direct access to a server and their permissions (GET /api/servers/:id/access).",
      inputSchema: z.object({ serverId }),
    },
    async (args) => text(await client.get(`/servers/${args.serverId}/access`)),
  );

  server.registerTool(
    "grant_server_access",
    {
      description: "Give a user permissions on a server, or update their set (POST /api/servers/:id/access).",
      inputSchema: z.object({
        serverId,
        targetUserId: z.string(),
        permissions: z.array(z.string()).min(1),
      }),
    },
    async (args) => {
      const { serverId: id, ...body } = args;
      return text(await client.post(`/servers/${id}/access`, body));
    },
  );

  server.registerTool(
    "remove_server_access",
    {
      description: "Revoke a user's direct access to a server (DELETE /api/servers/:id/access/:userId).",
      inputSchema: z.object({ serverId, targetUserId: z.string() }),
    },
    async (args) => text(await client.delete(`/servers/${args.serverId}/access/${args.targetUserId}`)),
  );

  server.registerTool(
    "get_my_server_permissions",
    {
      description: "Effective permissions the API key holder has on one server (GET /api/servers/:id/permissions).",
      inputSchema: z.object({ serverId }),
    },
    async (args) => text(await client.get(`/servers/${args.serverId}/permissions`)),
  );

  server.registerTool(
    "list_transfer_candidates",
    {
      description: "Users eligible to receive server ownership (GET /api/servers/:id/transfer-candidates).",
      inputSchema: z.object({ serverId }),
    },
    async (args) => text(await client.get(`/servers/${args.serverId}/transfer-candidates`)),
  );

  server.registerTool(
    "transfer_server_ownership",
    {
      description: "Transfer server ownership to another user (POST /api/servers/:id/transfer-ownership).",
      inputSchema: z.object({ serverId, newOwnerId: z.string() }),
    },
    async (args) => text(await client.post(`/servers/${args.serverId}/transfer-ownership`, { newOwnerId: args.newOwnerId })),
  );
}

export function registerServerOpsTools(server: McpServer, client: CatalystClient): void {
  server.registerTool(
    "get_server_stats",
    {
      description: "Latest resource snapshot for a server (GET /api/servers/:id/stats).",
      inputSchema: z.object({ serverId }),
    },
    async (args) => text(await client.get(`/servers/${args.serverId}/stats`)),
  );

  server.registerTool(
    "get_server_metrics_history",
    {
      description: "Time-series CPU/memory/disk/network history (GET /api/servers/:id/metrics).",
      inputSchema: z.object({
        serverId,
        hours: z.number().int().min(1).max(168).optional().describe("Lookback window (max 168)"),
        limit: z.number().int().min(1).max(1000).optional(),
      }),
    },
    async (args) => text(await client.get(`/servers/${args.serverId}/metrics`, { hours: args.hours, limit: args.limit })),
  );

  server.registerTool(
    "get_scheduled_task",
    {
      description: "One scheduled task with its run state (GET /api/servers/:id/tasks/:taskId).",
      inputSchema: z.object({ serverId, taskId: z.string() }),
    },
    async (args) => text(await client.get(`/servers/${args.serverId}/tasks/${args.taskId}`)),
  );

  server.registerTool(
    "execute_scheduled_task",
    {
      description: "Run a scheduled task immediately (POST /api/servers/:id/tasks/:taskId/execute).",
      inputSchema: z.object({ serverId, taskId: z.string() }),
    },
    async (args) => text(await client.post(`/servers/${args.serverId}/tasks/${args.taskId}/execute`, {})),
  );

  const bulk = (name: string, action: string, description: string, method: "POST" | "DELETE") =>
    server.registerTool(
      name,
      {
        description,
        inputSchema: z.object({
          serverIds: z.array(z.string()).min(1).max(100),
          reason: z.string().optional().describe("Recorded reason (suspend only)"),
          stopServer: z.boolean().optional().describe("Stop running servers first (suspend only)"),
        }),
      },
      async (args) =>
        text(
          await client.request({
            method,
            path: `/servers/bulk${action}`,
            body: { serverIds: args.serverIds, reason: args.reason, stopServer: args.stopServer },
          }),
        ),
    );

  bulk("bulk_suspend_servers", "/suspend", "Suspend up to 100 servers at once (POST /api/servers/bulk/suspend).", "POST");
  bulk("bulk_unsuspend_servers", "/unsuspend", "Unsuspend up to 100 servers at once (POST /api/servers/bulk/unsuspend).", "POST");
  bulk("bulk_delete_servers", "", "Delete up to 100 stopped servers at once (DELETE /api/servers/bulk).", "DELETE");

  server.registerTool(
    "get_backup_download",
    {
      description: "Download URL or stream info for a backup file (GET /api/servers/:id/backups/:backupId/download).",
      inputSchema: z.object({ serverId, backupId: z.string() }),
    },
    async (args) => text(await client.get(`/servers/${args.serverId}/backups/${args.backupId}/download`)),
  );

  server.registerTool(
    "list_sftp_tokens",
    {
      description: "Active SFTP tokens for file access to a server (GET /api/sftp/tokens?serverId=...).",
      inputSchema: z.object({ serverId }),
    },
    async (args) => text(await client.get("/sftp/tokens", { serverId: args.serverId })),
  );
}

const modTarget = z.string().optional().describe("Mods target, e.g. mods, datapacks, modpack (defaults per template)");

export function registerModTools(server: McpServer, client: CatalystClient): void {
  server.registerTool(
    "search_mods",
    {
      description: "Search Modrinth/CurseForge for mods compatible with a server (GET /api/servers/:id/mod-manager/search).",
      inputSchema: z.object({
        serverId,
        provider: z.string().describe("modrinth or curseforge"),
        query: z.string().optional().describe("Empty query returns trending"),
        game: z.string().optional(),
        gameVersion: z.string().optional(),
        loader: z.string().optional().describe("e.g. fabric, forge, paper"),
      }),
    },
    async (args) => {
      const { serverId: id, ...query } = args;
      return text(await client.get(`/servers/${id}/mod-manager/search`, query));
    },
  );

  server.registerTool(
    "install_mod",
    {
      description: "Install a mod version onto a server (POST /api/servers/:id/mod-manager/install).",
      inputSchema: z.object({
        serverId,
        provider: z.string(),
        projectId: z.string(),
        versionId: z.string(),
        game: z.string().optional(),
        projectName: z.string().optional(),
        target: modTarget,
      }),
    },
    async (args) => {
      const { serverId: id, ...body } = args;
      return text(await client.post(`/servers/${id}/mod-manager/install`, body));
    },
  );

  server.registerTool(
    "list_installed_mods",
    {
      description: "Mods already installed on a server (GET /api/servers/:id/mod-manager/installed).",
      inputSchema: z.object({ serverId }),
    },
    async (args) => text(await client.get(`/servers/${args.serverId}/mod-manager/installed`)),
  );

  server.registerTool(
    "uninstall_mod",
    {
      description: "Remove an installed mod file (POST /api/servers/:id/mod-manager/uninstall).",
      inputSchema: z.object({ serverId, filename: z.string(), target: modTarget }),
    },
    async (args) => {
      const { serverId: id, ...body } = args;
      return text(await client.post(`/servers/${id}/mod-manager/uninstall`, body));
    },
  );

  server.registerTool(
    "check_mod_updates",
    {
      description: "Check installed mods for newer versions (POST /api/servers/:id/mod-manager/check-updates).",
      inputSchema: z.object({ serverId, filenames: z.array(z.string()).min(1) }),
    },
    async (args) => {
      const { serverId: id, ...body } = args;
      return text(await client.post(`/servers/${id}/mod-manager/check-updates`, body));
    },
  );

  server.registerTool(
    "search_plugins",
    {
      description: "Search providers for server plugins (GET /api/servers/:id/plugin-manager/search).",
      inputSchema: z.object({
        serverId,
        provider: z.string(),
        query: z.string().optional(),
        game: z.string().optional(),
        gameVersion: z.string().optional(),
        loader: z.string().optional(),
      }),
    },
    async (args) => {
      const { serverId: id, ...query } = args;
      return text(await client.get(`/servers/${id}/plugin-manager/search`, query));
    },
  );

  server.registerTool(
    "install_plugin",
    {
      description: "Install a plugin version onto a server (POST /api/servers/:id/plugin-manager/install).",
      inputSchema: z.object({
        serverId,
        provider: z.string(),
        projectId: z.string(),
        versionId: z.string(),
        game: z.string().optional(),
        projectName: z.string().optional(),
        target: modTarget,
      }),
    },
    async (args) => {
      const { serverId: id, ...body } = args;
      return text(await client.post(`/servers/${id}/plugin-manager/install`, body));
    },
  );

  server.registerTool(
    "list_installed_plugins",
    {
      description: "Plugins already installed on a server (GET /api/servers/:id/plugin-manager/installed).",
      inputSchema: z.object({ serverId }),
    },
    async (args) => text(await client.get(`/servers/${args.serverId}/plugin-manager/installed`)),
  );

  server.registerTool(
    "uninstall_plugin",
    {
      description: "Remove an installed plugin file (POST /api/servers/:id/plugin-manager/uninstall).",
      inputSchema: z.object({ serverId, filename: z.string() }),
    },
    async (args) => {
      const { serverId: id, ...body } = args;
      return text(await client.post(`/servers/${id}/plugin-manager/uninstall`, body));
    },
  );
}
