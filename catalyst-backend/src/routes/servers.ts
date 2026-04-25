import type { FastifyInstance } from "fastify";
import { serverCoreRoutes } from "./servers/core.js";
import { serverFilesRoutes } from "./servers/files.js";
import { serverModpluginsRoutes } from "./servers/mod-plugins.js";
import { serverPowerRoutes } from "./servers/power.js";
import { serverNetworkRoutes } from "./servers/network.js";
import { serverDatabasesRoutes } from "./servers/databases.js";
import { serverInvitesRoutes } from "./servers/invites.js";
import { serverAdminopsRoutes } from "./servers/admin-ops.js";
import { serverVariablesRoutes } from "./servers/variables.js";
import { serverStatsRoutes } from "./servers/stats.js";

export async function serverRoutes(app: FastifyInstance) {
  await app.register(serverCoreRoutes);
  await app.register(serverStatsRoutes);
  await app.register(serverFilesRoutes);
  await app.register(serverModpluginsRoutes);
  await app.register(serverPowerRoutes);
  await app.register(serverNetworkRoutes);
  await app.register(serverDatabasesRoutes);
  await app.register(serverInvitesRoutes);
  await app.register(serverAdminopsRoutes);
  await app.register(serverVariablesRoutes);
}
