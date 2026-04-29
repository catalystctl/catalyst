import type { PluginRouteHandler } from './types';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

export interface RouteDefinition {
  method: HttpMethod;
  url: string;
  handler: PluginRouteHandler;
  schema?: any;
}

export class PluginRouteBuilder {
  private routes: RouteDefinition[] = [];

  get(url: string, handler: PluginRouteHandler): this {
    this.routes.push({ method: 'GET', url, handler });
    return this;
  }

  post(url: string, handler: PluginRouteHandler): this {
    this.routes.push({ method: 'POST', url, handler });
    return this;
  }

  put(url: string, handler: PluginRouteHandler): this {
    this.routes.push({ method: 'PUT', url, handler });
    return this;
  }

  del(url: string, handler: PluginRouteHandler): this {
    this.routes.push({ method: 'DELETE', url, handler });
    return this;
  }

  patch(url: string, handler: PluginRouteHandler): this {
    this.routes.push({ method: 'PATCH', url, handler });
    return this;
  }

  build(): RouteDefinition[] {
    return this.routes;
  }
}

export function defineRoutes(builder: (router: PluginRouteBuilder) => void): RouteDefinition[] {
  const router = new PluginRouteBuilder();
  builder(router);
  return router.build();
}
