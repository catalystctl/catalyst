//#region src/plugins/generic-oauth/providers/okta.ts
/**
* Okta OAuth provider helper
*
* @example
* ```ts
* import { genericOAuth, okta } from "better-auth/plugins/generic-oauth";
*
* export const auth = betterAuth({
*   plugins: [
*     genericOAuth({
*       config: [
*         okta({
*           clientId: process.env.OKTA_CLIENT_ID,
*           clientSecret: process.env.OKTA_CLIENT_SECRET,
*           issuer: process.env.OKTA_ISSUER,
*         }),
*       ],
*     }),
*   ],
* });
* ```
*/
function okta(options) {
	return {
		providerId: "okta",
		discoveryUrl: `${options.issuer.replace(/\/$/, "")}/.well-known/openid-configuration`,
		clientId: options.clientId,
		clientSecret: options.clientSecret,
		scopes: options.scopes ?? [
			"openid",
			"profile",
			"email"
		],
		redirectURI: options.redirectURI,
		pkce: options.pkce,
		disableImplicitSignUp: options.disableImplicitSignUp,
		disableSignUp: options.disableSignUp,
		overrideUserInfo: options.overrideUserInfo
	};
}
//#endregion
export { okta };
