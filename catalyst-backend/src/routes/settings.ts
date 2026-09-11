import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getLocalizationSettings } from '../services/localization.js';

/**
 * Instance settings the panel reads before anyone is signed in.
 *
 * The login, registration and setup screens have to render in the language the
 * admin chose, and they cannot call the admin API, so this stays unauthenticated
 * and exposes display-only fields.
 */
export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/locale',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      reply.send({ success: true, data: await getLocalizationSettings() });
    },
  );
}
