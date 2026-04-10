import { ExtractPluginField, InferPluginFieldFromTuple, UnionToIntersection } from "./helper.mjs";
import { BetterAuthOptions } from "@better-auth/core";
import { Account, InferDBFieldsFromOptionsInput, InferDBFieldsFromPluginsInput, RateLimit, Session as Session$1, User as User$1, Verification } from "@better-auth/core/db";

//#region src/types/models.d.ts
type AdditionalUserFieldsInput<Options extends BetterAuthOptions> = InferDBFieldsFromPluginsInput<"user", Options["plugins"]> & InferDBFieldsFromOptionsInput<Options["user"]>;
type AdditionalSessionFieldsInput<Options extends BetterAuthOptions> = InferDBFieldsFromPluginsInput<"session", Options["plugins"]> & InferDBFieldsFromOptionsInput<Options["session"]>;
type InferPluginTypes<O extends BetterAuthOptions> = O["plugins"] extends readonly [unknown, ...unknown[]] ? InferPluginFieldFromTuple<O["plugins"], "$Infer"> : O["plugins"] extends Array<infer P> ? UnionToIntersection<ExtractPluginField<P, "$Infer">> : {};
//#endregion
export { type Account, AdditionalSessionFieldsInput, AdditionalUserFieldsInput, InferPluginTypes, type RateLimit, type Session$1 as Session, type User$1 as User, type Verification };