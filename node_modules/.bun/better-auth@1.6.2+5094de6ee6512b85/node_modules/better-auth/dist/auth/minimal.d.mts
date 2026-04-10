import { Auth } from "../types/auth.mjs";
import { BetterAuthOptions } from "@better-auth/core";

//#region src/auth/minimal.d.ts
/**
 * Better Auth initializer for minimal mode (without Kysely)
 */
declare const betterAuth: <Options extends BetterAuthOptions>(options: Options & {}) => Auth<Options>;
//#endregion
export { type BetterAuthOptions, betterAuth };