import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  HTTPMethods,
  RouteOptions,
} from 'fastify';

/**
 * Runtime plugin HTTP routes. Fastify cannot `route()` after listen(), so
 * marketplace installs / reloads register here and a catch-all dispatcher
 * (mounted once at startup) forwards to the matching handler.
 */

export function matchRoutePath(
  pattern: string,
  pathname: string,
): Record<string, string> | null {
  const patternParts = pattern.split('/').filter(Boolean);
  const pathParts = pathname.split('/').filter(Boolean);
  if (patternParts.length !== pathParts.length) return null;

  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i++) {
    const part = patternParts[i];
    if (part.startsWith(':') && part.length > 1) {
      params[part.slice(1)] = decodeURIComponent(pathParts[i]);
      continue;
    }
    if (part !== pathParts[i]) return null;
  }
  return params;
}

function methodsOf(route: RouteOptions): string[] {
  const raw = route.method;
  const list = Array.isArray(raw) ? raw : [raw];
  return list.map((m) => String(m).toUpperCase());
}

function hookList(value: unknown): Array<(request: FastifyRequest, reply: FastifyReply) => unknown> {
  if (!value) return [];
  return (Array.isArray(value) ? value : [value]).filter(
    (h): h is (request: FastifyRequest, reply: FastifyReply) => unknown => typeof h === 'function',
  );
}

export class PluginRouteTable {
  private routes = new Map<string, RouteOptions[]>();

  register(pluginName: string, route: RouteOptions): void {
    const list = this.routes.get(pluginName) ?? [];
    list.push(route);
    this.routes.set(pluginName, list);
  }

  removePlugin(pluginName: string): void {
    this.routes.delete(pluginName);
  }

  match(
    pluginName: string,
    method: string,
    pathname: string,
  ): { route: RouteOptions; params: Record<string, string> } | null {
    const list = this.routes.get(pluginName);
    if (!list) return null;
    const methodUpper = method.toUpperCase();
    for (const route of list) {
      if (!methodsOf(route).includes(methodUpper)) continue;
      const params = matchRoutePath(route.url, pathname);
      if (params) return { route, params };
    }
    return null;
  }
}

async function runHooks(
  hooks: Array<(request: FastifyRequest, reply: FastifyReply) => unknown>,
  skip: Function | undefined,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<boolean> {
  for (const hook of hooks) {
    if (skip && hook === skip) continue;
    await hook(request, reply);
    if (reply.sent) return false;
  }
  return true;
}

/**
 * Mount a single catch-all under /api/plugins/:pluginName/*. Must run before
 * listen(). Host routes like /api/plugins/:name/enable stay more specific.
 */
export function registerPluginRouteDispatcher(
  fastify: FastifyInstance,
  table: PluginRouteTable,
): void {
  const authenticate = (fastify as FastifyInstance & { authenticate?: Function }).authenticate;
  const methods: HTTPMethods[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

  fastify.route({
    method: methods,
    url: '/api/plugins/:pluginName/*',
    ...(authenticate ? { onRequest: [authenticate as any] } : {}),
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const pluginName = String((request.params as { pluginName?: string }).pluginName ?? '');
      const splat = String((request.params as { '*': string })['*'] ?? '').replace(/^\/+/, '');
      const pathname = `/api/plugins/${pluginName}/${splat}`;
      const matched = table.match(pluginName, request.method, pathname);
      if (!matched) {
        return reply.status(404).send({ success: false, error: 'Plugin route not found' });
      }

      Object.assign(request.params as object, matched.params);

      const okOnRequest = await runHooks(
        hookList((matched.route as RouteOptions).onRequest),
        authenticate,
        request,
        reply,
      );
      if (!okOnRequest) return;

      const okPre = await runHooks(
        hookList((matched.route as RouteOptions).preHandler),
        authenticate,
        request,
        reply,
      );
      if (!okPre) return;

      return (matched.route.handler as Function)(request, reply);
    },
  });
}
