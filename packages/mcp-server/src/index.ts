#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CatalystClient } from "./client.js";
import { resolveConfig, configSummary } from "./config.js";
import { registerMetaTools } from "./tools/meta.js";
import { registerServerTools } from "./tools/servers.js";
import {
  registerBackupTools,
  registerDatabaseTools,
  registerFileTools,
  registerNetworkTools,
  registerTaskTools,
} from "./tools/server-subresources.js";
import { registerLocationTools, registerNodeTools, registerTemplateTools } from "./tools/infra.js";
import {
  registerAlertTools,
  registerApiKeyTools,
  registerRoleTools,
  registerUserTools,
} from "./tools/admin.js";
import {
  registerModTools,
  registerServerOpsTools,
  registerSharingTools,
  registerTemplateManagementTools,
} from "./tools/extended-servers.js";
import {
  registerAlertExtraTools,
  registerAuditTools,
  registerDatabaseHostTools,
  registerMigrationTools,
  registerNodeExtraTools,
  registerPluginTools,
  registerRoleExtraTools,
  registerSystemTools,
} from "./tools/extended-admin.js";

async function main(): Promise<void> {
  const config = resolveConfig();
  const client = new CatalystClient(config);
  const server = new McpServer({
    name: "catalyst",
    version: "0.1.0",
  });

  registerMetaTools(server, client);
  registerServerTools(server, client);
  registerFileTools(server, client);
  registerNetworkTools(server, client);
  registerDatabaseTools(server, client);
  registerBackupTools(server, client);
  registerTaskTools(server, client);
  registerNodeTools(server, client);
  registerLocationTools(server, client);
  registerTemplateTools(server, client);
  registerUserTools(server, client);
  registerRoleTools(server, client);
  registerRoleExtraTools(server, client);
  registerApiKeyTools(server, client);
  registerAlertTools(server, client);
  registerAlertExtraTools(server, client);
  registerTemplateManagementTools(server, client);
  registerSharingTools(server, client);
  registerServerOpsTools(server, client);
  registerModTools(server, client);
  registerNodeExtraTools(server, client);
  registerAuditTools(server, client);
  registerDatabaseHostTools(server, client);
  registerPluginTools(server, client);
  registerMigrationTools(server, client);
  registerSystemTools(server, client);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[catalyst-mcp] connected (${configSummary(config)})`);
}

main().catch((error) => {
  console.error(`[catalyst-mcp] failed to start: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
