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

/** Route auth mode a plugin may request via `config.auth` on registerRoute. */
export type PluginRouteAuthMode = 'required' | 'optional' | 'public';

// Route-level auth mode for plugin routes (see PluginRouteAuthMode). Declared
// by plugins in registerRoute({ config: { auth: 'public' } }) and consumed by
// the dispatcher below.
declare module 'fastify' {
  interface FastifyContextConfig {
    auth?: PluginRouteAuthMode | string;
  }
}

export function routeAuthMode(route: RouteOptions): PluginRouteAuthMode {
  const mode = (route.config as { auth?: unknown } | undefined)?.auth;
  return mode === 'public' || mode === 'optional' ? mode : 'required';
}

export interface PluginRouteDispatcherOptions {
  /** Host auth hook; 401s unauthenticated callers. */
  authenticate?: Function;
  /**
   * Non-replying session resolution for `config.auth: 'optional'` routes —
   * attaches request.user when a valid session exists, stays anonymous
   * otherwise.
   */
  resolveUser?: (request: FastifyRequest) => Promise<{
    userId: string;
    email: string;
    username: string;
    permissions: string[];
  } | null>;
  /** Live effective grants for a plugin; `routes.public` unlocks non-required auth modes. */
  permissionsProvider?: (pluginName: string) => string[];
}

/**
 * Mount a single catch-all under /api/plugins/:pluginName/*. Must run before
 * listen(). Host routes like /api/plugins/:name/enable stay more specific.
 *
 * Auth: every route is host-authenticated unless the plugin registered it
 * with `config.auth` 'public'/'optional' AND holds the `routes.public` grant
 * (checked live per request, so revoking the grant immediately re-secures
 * the routes).
 */
export function registerPluginRouteDispatcher(
  fastify: FastifyInstance,
  table: PluginRouteTable,
  options: PluginRouteDispatcherOptions = {},
): void {
  const authenticate = options.authenticate ?? (fastify as FastifyInstance & { authenticate?: Function }).authenticate;
  const resolveUser = options.resolveUser;
  const permissionsProvider = options.permissionsProvider;
  const methods: HTTPMethods[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

  fastify.route({
    method: methods,
    url: '/api/plugins/:pluginName/*',
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const pluginName = String((request.params as { pluginName?: string }).pluginName ?? '');
      const splat = String((request.params as { '*': string })['*'] ?? '').replace(/^\/+/, '');
      const pathname = `/api/plugins/${pluginName}/${splat}`;
      const matched = table.match(pluginName, request.method, pathname);

      // Auth runs after matching so a plugin's public routes can skip it.
      // Unmatched requests keep the legacy behaviour of 401 before 404.
      const grants = permissionsProvider?.(pluginName);
      const authMode =
        matched && routeAuthMode(matched.route) !== 'required' && grants &&
        (grants.includes('routes.public') || grants.includes('*'))
          ? routeAuthMode(matched.route)
          : 'required';

      if (!matched) {
        if (authenticate) {
          await authenticate(request, reply);
          if (reply.sent) return;
        }
        return reply.status(404).send({ success: false, error: 'Plugin route not found' });
      }

      if (authMode === 'required') {
        if (authenticate) {
          await authenticate(request, reply);
          if (reply.sent) return;
        }
      } else if (authMode === 'optional' && resolveUser) {
        const user = await resolveUser(request);
        if (user) {
          (request as any).user = user;
        }
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
