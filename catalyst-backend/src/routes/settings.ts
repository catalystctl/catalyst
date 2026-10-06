import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getLocalizationSettings } from '../services/localization.js';
import { onCacheInvalidate } from '../lib/cache-bus.js';

/**
 * Instance settings the panel reads before anyone is signed in.
 *
 * The login, registration and setup screens have to render in the language the
 * admin chose, and they cannot call the admin API, so this stays unauthenticated
 * and exposes display-only fields.
 *
 * The payload changes only when an admin updates localization settings, which
 * already broadcasts on the 'config' cache-bus channel (see
 * services/localization.ts). The serialized body is therefore built once and
 * served as a ready string — the unauthenticated boot path pays no JSON
 * serialization, no DB read and no Redis round trip after the first fill.
 */
let localeBody: string | null = null;

async function buildLocaleBody(): Promise<string> {
  const settings = await getLocalizationSettings();
  return JSON.stringify({ success: true, data: settings });
}

onCacheInvalidate('config', () => {
  localeBody = null;
});

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/locale',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      let body = localeBody;
      if (body === null) {
        body = await buildLocaleBody();
        localeBody = body;
      }
      reply.header('content-type', 'application/json; charset=utf-8');
      return reply.send(body);
    },
  );
}
