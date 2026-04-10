import { Awaitable, AwaitableFunction, LiteralString, LiteralUnion, Prettify, Primitive, UnionToIntersection } from "./helper.mjs";
import { BetterAuthPlugin, BetterAuthPluginErrorCodePart, HookEndpointContext } from "./plugin.mjs";
import { BaseURLConfig, BetterAuthAdvancedOptions, BetterAuthDBOptions, BetterAuthOptions, BetterAuthRateLimitOptions, BetterAuthRateLimitRule, BetterAuthRateLimitStorage, DynamicBaseURLConfig, GenerateIdFn, StoreIdentifierOption } from "./init-options.mjs";
import { BetterAuthCookie, BetterAuthCookies } from "./cookie.mjs";
import { SecretConfig } from "./secret.mjs";
import { AuthContext, BetterAuthPluginRegistry, BetterAuthPluginRegistryIdentifier, GenericEndpointContext, InfoContext, InternalAdapter, PluginContext } from "./context.mjs";
import { BetterAuthClientOptions, BetterAuthClientPlugin, ClientAtomListener, ClientFetchOption, ClientStore } from "./plugin-client.mjs";
import { StandardSchemaV1 as StandardSchemaV1$1 } from "@standard-schema/spec";
export { type StandardSchemaV1$1 as StandardSchemaV1 };