import { InferFieldsInputClient } from "../db/field.mjs";
import { StripEmptyObjects, UnionToIntersection } from "../types/helper.mjs";
import { InferRoutes } from "./path-to-object.mjs";
import { Session as Session$1, User as User$1 } from "../types/models.mjs";
import { Auth } from "../types/auth.mjs";
import { BetterAuthClientOptions as BetterAuthClientOptions$1, BetterAuthClientPlugin as BetterAuthClientPlugin$1, ClientAtomListener, ClientStore } from "@better-auth/core";
import { BetterAuthPluginDBSchema, InferDBFieldsOutput } from "@better-auth/core/db";
import { RawError } from "@better-auth/core/utils/error-codes";

//#region src/client/types.d.ts
type InferPluginEndpoints<Plugins> = Plugins extends Array<infer Pl> ? UnionToIntersection<Pl extends {
  $InferServerPlugin: infer Plug;
} ? Plug extends {
  endpoints: infer Endpoints;
} ? Endpoints : {} : {}> : {};
type InferClientAPI<O extends BetterAuthClientOptions$1> = InferRoutes<O["plugins"] extends Array<any> ? Omit<Auth["api"], keyof InferPluginEndpoints<O["plugins"]>> & InferPluginEndpoints<O["plugins"]> : Auth["api"], O>;
type InferActions<O extends BetterAuthClientOptions$1> = (O["plugins"] extends Array<infer Plugin> ? UnionToIntersection<Plugin extends BetterAuthClientPlugin$1 ? Plugin["getActions"] extends ((...args: any) => infer Actions) ? Actions : {} : {}> : {}) & InferRoutes<O["$InferAuth"] extends {
  plugins: infer Plugins;
} ? Plugins extends Array<infer Plugin> ? Plugin extends {
  endpoints: infer Endpoints;
} ? Endpoints : {} : {} : {}, O>;
type InferErrorCodes<O extends BetterAuthClientOptions$1> = O["plugins"] extends Array<infer Plugin> ? UnionToIntersection<Plugin extends BetterAuthClientPlugin$1 ? Plugin["$InferServerPlugin"] extends {
  $ERROR_CODES: infer E;
} ? { [K in keyof E & string]: E[K] extends RawError ? RawError<K> : never } : {} : {}> : {};
/**
 * signals are just used to recall a computed value.
 * as a convention they start with "$"
 */
type IsSignal<T> = T extends `$${infer _}` ? true : false;
type InferSessionFromClient<O extends BetterAuthClientOptions$1> = StripEmptyObjects<Session$1 & UnionToIntersection<InferAdditionalFromClient<O, "session", "output">>>;
type InferUserFromClient<O extends BetterAuthClientOptions$1> = StripEmptyObjects<User$1 & UnionToIntersection<InferAdditionalFromClient<O, "user", "output">>>;
type InferAdditionalFromClient<Options extends BetterAuthClientOptions$1, Key extends string, Format extends "input" | "output" = "output"> = Options["plugins"] extends Array<infer Plugin> ? Plugin extends BetterAuthClientPlugin$1 ? Plugin["$InferServerPlugin"] extends {
  schema: infer Schema;
} ? Schema extends BetterAuthPluginDBSchema ? Format extends "input" ? InferFieldsInputClient<Schema[Key]["fields"]> : InferDBFieldsOutput<Schema[Key]["fields"]> : {} : {} : {} : {};
type SessionQueryParams = {
  disableCookieCache?: boolean | undefined;
  disableRefresh?: boolean | undefined;
};
//#endregion
export { type BetterAuthClientOptions$1 as BetterAuthClientOptions, type BetterAuthClientPlugin$1 as BetterAuthClientPlugin, type ClientAtomListener, type ClientStore, InferActions, InferAdditionalFromClient, InferClientAPI, InferErrorCodes, InferSessionFromClient, InferUserFromClient, IsSignal, SessionQueryParams };