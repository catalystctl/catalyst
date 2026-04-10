import { BetterAuthPluginDBSchema } from "../db/plugin.mjs";
import { Awaitable, LiteralString } from "./helper.mjs";
import { RawError } from "../utils/error-codes.mjs";
import { BetterAuthOptions } from "./init-options.mjs";
import { AuthContext } from "./context.mjs";
import { AuthMiddleware } from "../api/index.mjs";
import { Endpoint, EndpointContext, InputContext, Middleware } from "better-call";
import { Migration } from "kysely";

//#region src/types/plugin.d.ts
type DeepPartial<T> = T extends Function ? T : T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;
type HookEndpointContext = Partial<EndpointContext<string, any> & Omit<InputContext<string, any>, "method">> & {
  path?: string;
  context: AuthContext & {
    returned?: unknown | undefined;
    responseHeaders?: Headers | undefined;
  };
  headers?: Headers | undefined;
};
type BetterAuthPluginErrorCodePart = {
  /**
   * The error codes returned by the plugin
   */
  $ERROR_CODES?: Record<string, RawError>;
};
type BetterAuthPlugin = BetterAuthPluginErrorCodePart & {
  id: LiteralString;
  version?: string | undefined;
  /**
   * The init function is called when the plugin is initialized.
   * You can return a new context or modify the existing context.
   */
  init?: ((ctx: AuthContext) => Awaitable<{
    context?: DeepPartial<Omit<AuthContext, "options">> & Record<string, unknown>;
    options?: Partial<BetterAuthOptions>;
  }> | void | Promise<void>) | undefined;
  endpoints?: {
    [key: string]: Endpoint;
  } | undefined;
  middlewares?: {
    path: string;
    middleware: Middleware;
  }[] | undefined;
  onRequest?: ((request: Request, ctx: AuthContext) => Promise<{
    response: Response;
  } | {
    request: Request;
  } | void>) | undefined;
  onResponse?: ((response: Response, ctx: AuthContext) => Promise<{
    response: Response;
  } | void>) | undefined;
  hooks?: {
    before?: {
      matcher: (context: HookEndpointContext) => boolean;
      handler: AuthMiddleware;
    }[];
    after?: {
      matcher: (context: HookEndpointContext) => boolean;
      handler: AuthMiddleware;
    }[];
  } | undefined;
  /**
   * Schema the plugin needs
   *
   * This will also be used to migrate the database. If the fields are dynamic from the plugins
   * configuration each time the configuration is changed a new migration will be created.
   *
   * NOTE: If you want to create migrations manually using
   * migrations option or any other way you
   * can disable migration per table basis.
   *
   * @example
   * ```ts
   * schema: {
   * 	user: {
   * 		fields: {
   * 			email: {
   * 				 type: "string",
   * 			},
   * 			emailVerified: {
   * 				type: "boolean",
   * 				defaultValue: false,
   * 			},
   * 		},
   * 	}
   * } as AuthPluginSchema
   * ```
   */
  schema?: BetterAuthPluginDBSchema | undefined;
  /**
   * The migrations of the plugin. If you define schema that will automatically create
   * migrations for you.
   *
   * ⚠️ Only uses this if you dont't want to use the schema option and you disabled migrations for
   * the tables.
   */
  migrations?: Record<string, Migration> | undefined;
  /**
   * The options of the plugin
   */
  options?: Record<string, any> | undefined;
  /**
   * types to be inferred
   */
  $Infer?: Record<string, any> | undefined;
  /**
   * The rate limit rules to apply to specific paths.
   */
  rateLimit?: {
    window: number;
    max: number;
    pathMatcher: (path: string) => boolean;
  }[] | undefined;
  /**
   * All database operations that are performed by the plugin
   *
   * This will override the default database operations
   */
  adapter?: {
    [key: string]: (...args: any[]) => Awaitable<any>;
  };
};
//#endregion
export { BetterAuthPlugin, BetterAuthPluginErrorCodePart, HookEndpointContext };