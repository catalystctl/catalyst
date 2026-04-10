//#region src/plugins/generic-oauth/providers/keycloak.ts
/**
* Keycloak OAuth provider helper
*
* @example
* ```ts
* import { genericOAuth, keycloak } from "better-auth/plugins/generic-oauth";
*
* export const auth = betterAuth({
*   plugins: [
*     genericOAuth({
*       config: [
*         keycloak({
*           clientId: process.env.KEYCLOAK_CLIENT_ID,
*           clientSecret: process.env.KEYCLOAK_CLIENT_SECRET,
*           issuer: process.env.KEYCLOAK_ISSUER,
*         }),
*       ],
*     }),
*   ],
* });
* ```
*/
function keycloak(options) {
	return {
		providerId: "keycloak",
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
export { keycloak };
