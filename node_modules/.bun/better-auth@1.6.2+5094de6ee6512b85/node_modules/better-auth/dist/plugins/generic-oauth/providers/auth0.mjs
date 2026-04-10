//#region src/plugins/generic-oauth/providers/auth0.ts
/**
* Auth0 OAuth provider helper
*
* @example
* ```ts
* import { genericOAuth, auth0 } from "better-auth/plugins/generic-oauth";
*
* export const auth = betterAuth({
*   plugins: [
*     genericOAuth({
*       config: [
*         auth0({
*           clientId: process.env.AUTH0_CLIENT_ID,
*           clientSecret: process.env.AUTH0_CLIENT_SECRET,
*           domain: process.env.AUTH0_DOMAIN,
*         }),
*       ],
*     }),
*   ],
* });
* ```
*/
function auth0(options) {
	return {
		providerId: "auth0",
		discoveryUrl: `https://${options.domain.replace(/^https?:\/\//, "")}/.well-known/openid-configuration`,
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
export { auth0 };
