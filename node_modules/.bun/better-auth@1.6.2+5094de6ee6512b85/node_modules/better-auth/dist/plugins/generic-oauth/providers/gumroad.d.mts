import { GenericOAuthConfig } from "../types.mjs";
import { BaseOAuthProviderOptions } from "../index.mjs";

//#region src/plugins/generic-oauth/providers/gumroad.d.ts
interface GumroadOptions extends BaseOAuthProviderOptions {}
/**
 * Gumroad OAuth provider helper
 *
 * @example
 * ```ts
 * import { genericOAuth, gumroad } from "better-auth/plugins/generic-oauth";
 *
 * export const auth = betterAuth({
 *   plugins: [
 *     genericOAuth({
 *       config: [
 *         gumroad({
 *           clientId: process.env.GUMROAD_CLIENT_ID,
 *           clientSecret: process.env.GUMROAD_CLIENT_SECRET,
 *         }),
 *       ],
 *     }),
 *   ],
 * });
 * ```
 *
 * @see https://app.gumroad.com/oauth
 */
declare function gumroad(options: GumroadOptions): GenericOAuthConfig;
//#endregion
export { GumroadOptions, gumroad };