import { BetterAuthDBSchema, ModelNames, SecondaryStorage } from "../db/type.mjs";
import { DBAdapter } from "../db/adapter/index.mjs";
import { createLogger } from "../env/logger.mjs";
import { AuthContext } from "../types/context.mjs";
import { OAuthProvider } from "../oauth2/oauth-provider.mjs";
import * as better_call0 from "better-call";
import { EndpointContext, EndpointOptions, StrictEndpoint } from "better-call";
import * as _better_auth_core0 from "@better-auth/core";

//#region src/api/index.d.ts
declare const optionsMiddleware: <InputCtx extends better_call0.MiddlewareInputContext<better_call0.MiddlewareOptions>>(inputContext: InputCtx) => Promise<AuthContext>;
declare const createAuthMiddleware: {
  <Options extends better_call0.MiddlewareOptions, R>(options: Options, handler: (ctx: better_call0.MiddlewareContext<Options, {
    returned?: unknown | undefined;
    responseHeaders?: Headers | undefined;
  } & _better_auth_core0.PluginContext<_better_auth_core0.BetterAuthOptions> & _better_auth_core0.InfoContext & {
    options: _better_auth_core0.BetterAuthOptions;
    trustedOrigins: string[];
    trustedProviders: string[];
    isTrustedOrigin: (url: string, settings?: {
      allowRelativePaths: boolean;
    }) => boolean;
    oauthConfig: {
      skipStateCookieCheck?: boolean | undefined;
      storeStateStrategy: "database" | "cookie";
    };
    newSession: {
      session: {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        userId: string;
        expiresAt: Date;
        token: string;
        ipAddress?: string | null | undefined;
        userAgent?: string | null | undefined;
      } & Record<string, any>;
      user: {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        email: string;
        emailVerified: boolean;
        name: string;
        image?: string | null | undefined;
      } & Record<string, any>;
    } | null;
    session: {
      session: {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        userId: string;
        expiresAt: Date;
        token: string;
        ipAddress?: string | null | undefined;
        userAgent?: string | null | undefined;
      } & Record<string, any>;
      user: {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        email: string;
        emailVerified: boolean;
        name: string;
        image?: string | null | undefined;
      } & Record<string, any>;
    } | null;
    setNewSession: (session: {
      session: {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        userId: string;
        expiresAt: Date;
        token: string;
        ipAddress?: string | null | undefined;
        userAgent?: string | null | undefined;
      } & Record<string, any>;
      user: {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        email: string;
        emailVerified: boolean;
        name: string;
        image?: string | null | undefined;
      } & Record<string, any>;
    } | null) => void;
    socialProviders: OAuthProvider[];
    authCookies: _better_auth_core0.BetterAuthCookies;
    logger: ReturnType<typeof createLogger>;
    rateLimit: {
      enabled: boolean;
      window: number;
      max: number;
      storage: "memory" | "database" | "secondary-storage";
    } & Omit<_better_auth_core0.BetterAuthRateLimitOptions, "enabled" | "window" | "max" | "storage">;
    adapter: DBAdapter<_better_auth_core0.BetterAuthOptions>;
    internalAdapter: _better_auth_core0.InternalAdapter<_better_auth_core0.BetterAuthOptions>;
    createAuthCookie: (cookieName: string, overrideAttributes?: Partial<better_call0.CookieOptions> | undefined) => _better_auth_core0.BetterAuthCookie;
    secret: string;
    secretConfig: string | _better_auth_core0.SecretConfig;
    sessionConfig: {
      updateAge: number;
      expiresIn: number;
      freshAge: number;
      cookieRefreshCache: false | {
        enabled: true;
        updateAge: number;
      };
    };
    generateId: (options: {
      model: ModelNames;
      size?: number | undefined;
    }) => string | false;
    secondaryStorage: SecondaryStorage | undefined;
    password: {
      hash: (password: string) => Promise<string>;
      verify: (data: {
        password: string;
        hash: string;
      }) => Promise<boolean>;
      config: {
        minPasswordLength: number;
        maxPasswordLength: number;
      };
      checkPassword: (userId: string, ctx: _better_auth_core0.GenericEndpointContext<_better_auth_core0.BetterAuthOptions>) => Promise<boolean>;
    };
    tables: BetterAuthDBSchema;
    runMigrations: () => Promise<void>;
    publishTelemetry: (event: {
      type: string;
      anonymousId?: string | undefined;
      payload: Record<string, any>;
    }) => Promise<void>;
    skipOriginCheck: boolean | string[];
    skipCSRFCheck: boolean;
    runInBackground: (promise: Promise<unknown>) => void;
    runInBackgroundOrAwait: (promise: Promise<unknown> | void) => _better_auth_core0.Awaitable<unknown>;
  }>) => Promise<R>): (inputContext: better_call0.MiddlewareInputContext<Options>) => Promise<R>;
  <Options extends better_call0.MiddlewareOptions, R_1>(handler: (ctx: better_call0.MiddlewareContext<Options, {
    returned?: unknown | undefined;
    responseHeaders?: Headers | undefined;
  } & _better_auth_core0.PluginContext<_better_auth_core0.BetterAuthOptions> & _better_auth_core0.InfoContext & {
    options: _better_auth_core0.BetterAuthOptions;
    trustedOrigins: string[];
    trustedProviders: string[];
    isTrustedOrigin: (url: string, settings?: {
      allowRelativePaths: boolean;
    }) => boolean;
    oauthConfig: {
      skipStateCookieCheck?: boolean | undefined;
      storeStateStrategy: "database" | "cookie";
    };
    newSession: {
      session: {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        userId: string;
        expiresAt: Date;
        token: string;
        ipAddress?: string | null | undefined;
        userAgent?: string | null | undefined;
      } & Record<string, any>;
      user: {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        email: string;
        emailVerified: boolean;
        name: string;
        image?: string | null | undefined;
      } & Record<string, any>;
    } | null;
    session: {
      session: {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        userId: string;
        expiresAt: Date;
        token: string;
        ipAddress?: string | null | undefined;
        userAgent?: string | null | undefined;
      } & Record<string, any>;
      user: {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        email: string;
        emailVerified: boolean;
        name: string;
        image?: string | null | undefined;
      } & Record<string, any>;
    } | null;
    setNewSession: (session: {
      session: {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        userId: string;
        expiresAt: Date;
        token: string;
        ipAddress?: string | null | undefined;
        userAgent?: string | null | undefined;
      } & Record<string, any>;
      user: {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        email: string;
        emailVerified: boolean;
        name: string;
        image?: string | null | undefined;
      } & Record<string, any>;
    } | null) => void;
    socialProviders: OAuthProvider[];
    authCookies: _better_auth_core0.BetterAuthCookies;
    logger: ReturnType<typeof createLogger>;
    rateLimit: {
      enabled: boolean;
      window: number;
      max: number;
      storage: "memory" | "database" | "secondary-storage";
    } & Omit<_better_auth_core0.BetterAuthRateLimitOptions, "enabled" | "window" | "max" | "storage">;
    adapter: DBAdapter<_better_auth_core0.BetterAuthOptions>;
    internalAdapter: _better_auth_core0.InternalAdapter<_better_auth_core0.BetterAuthOptions>;
    createAuthCookie: (cookieName: string, overrideAttributes?: Partial<better_call0.CookieOptions> | undefined) => _better_auth_core0.BetterAuthCookie;
    secret: string;
    secretConfig: string | _better_auth_core0.SecretConfig;
    sessionConfig: {
      updateAge: number;
      expiresIn: number;
      freshAge: number;
      cookieRefreshCache: false | {
        enabled: true;
        updateAge: number;
      };
    };
    generateId: (options: {
      model: ModelNames;
      size?: number | undefined;
    }) => string | false;
    secondaryStorage: SecondaryStorage | undefined;
    password: {
      hash: (password: string) => Promise<string>;
      verify: (data: {
        password: string;
        hash: string;
      }) => Promise<boolean>;
      config: {
        minPasswordLength: number;
        maxPasswordLength: number;
      };
      checkPassword: (userId: string, ctx: _better_auth_core0.GenericEndpointContext<_better_auth_core0.BetterAuthOptions>) => Promise<boolean>;
    };
    tables: BetterAuthDBSchema;
    runMigrations: () => Promise<void>;
    publishTelemetry: (event: {
      type: string;
      anonymousId?: string | undefined;
      payload: Record<string, any>;
    }) => Promise<void>;
    skipOriginCheck: boolean | string[];
    skipCSRFCheck: boolean;
    runInBackground: (promise: Promise<unknown>) => void;
    runInBackgroundOrAwait: (promise: Promise<unknown> | void) => _better_auth_core0.Awaitable<unknown>;
  }>) => Promise<R_1>): (inputContext: better_call0.MiddlewareInputContext<Options>) => Promise<R_1>;
};
type EndpointHandler<Path extends string, Options extends EndpointOptions, R> = (context: EndpointContext<Path, Options, AuthContext>) => Promise<R>;
declare function createAuthEndpoint<Path extends string, Options extends EndpointOptions, R>(path: Path, options: Options, handler: EndpointHandler<Path, Options, R>): StrictEndpoint<Path, Options, R>;
declare function createAuthEndpoint<Path extends string, Options extends EndpointOptions, R>(options: Options, handler: EndpointHandler<Path, Options, R>): StrictEndpoint<Path, Options, R>;
type AuthEndpoint<Path extends string, Opts extends EndpointOptions, R> = ReturnType<typeof createAuthEndpoint<Path, Opts, R>>;
type AuthMiddleware = ReturnType<typeof createAuthMiddleware>;
//#endregion
export { AuthEndpoint, AuthMiddleware, createAuthEndpoint, createAuthMiddleware, optionsMiddleware };