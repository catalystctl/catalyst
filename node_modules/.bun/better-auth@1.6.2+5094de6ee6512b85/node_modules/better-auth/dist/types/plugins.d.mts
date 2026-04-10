import { ExtractPluginField, InferPluginFieldFromTuple, UnionToIntersection } from "./helper.mjs";
import { AuthContext, BetterAuthOptions, BetterAuthPlugin } from "@better-auth/core";
import { BetterAuthPluginDBSchema } from "@better-auth/core/db";

//#region src/types/plugins.d.ts
type InferOptionSchema<S extends BetterAuthPluginDBSchema> = S extends Record<string, {
  fields: infer Fields;
}> ? { [K in keyof S]?: {
  modelName?: string | undefined;
  fields?: { [P in keyof Fields]?: string } | undefined;
} } : never;
type InferPluginErrorCodes<O extends BetterAuthOptions> = O["plugins"] extends readonly [unknown, ...unknown[]] ? InferPluginFieldFromTuple<O["plugins"], "$ERROR_CODES"> : O["plugins"] extends Array<infer P> ? UnionToIntersection<ExtractPluginField<P, "$ERROR_CODES">> : {};
type InferPluginIDs<O extends BetterAuthOptions> = O["plugins"] extends Array<infer P> ? UnionToIntersection<P extends BetterAuthPlugin ? P["id"] : never> : never;
type ExtractInitContext<P extends BetterAuthPlugin> = P["init"] extends ((...args: any[]) => infer R) ? Awaited<R> extends {
  context?: infer C;
} ? C extends Record<string, any> ? Omit<C, keyof AuthContext> : {} : {} : {};
type InferPluginContext<O extends BetterAuthOptions> = O["plugins"] extends Array<infer P> ? UnionToIntersection<P extends BetterAuthPlugin ? ExtractInitContext<P> : {}> : {};
//#endregion
export { InferOptionSchema, InferPluginContext, InferPluginErrorCodes, InferPluginIDs };