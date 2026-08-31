import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { getModManagerSettings } from "../services/mailer";
import { serialize } from "../utils/serialize";

/**
 * Reports which provider API keys are configured — booleans only, never key values.
 *
 * The plugin/mod-manager tabs use this to hide providers whose required key is
 * missing (Modrinth, CurseForge); selecting those would only produce 409
 * "API key not configured" errors. Every authenticated user can read this:
 * subusers with server access see the same tabs and must not need admin.read.
 */
export async function providerKeyRoutes(app: FastifyInstance) {
  app.get(
    "/status",
    { onRequest: [app.authenticate] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const settings = await getModManagerSettings();
      reply.send(
        serialize({
          success: true,
          data: {
            modrinth: Boolean(settings.modrinthApiKey),
            curseforge: Boolean(settings.curseforgeApiKey),
          },
        }),
      );
    }
  );
}
