import { betterFetch } from "@better-fetch/fetch";
//#region src/plugins/generic-oauth/providers/gumroad.ts
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
function gumroad(options) {
	const getUserInfo = async (tokens) => {
		const { data: profile, error } = await betterFetch("https://api.gumroad.com/v2/user", {
			method: "GET",
			headers: { Authorization: `Bearer ${tokens.accessToken}` }
		});
		if (error || !profile?.success || !profile.user) return null;
		return {
			id: profile.user.user_id,
			name: profile.user.name,
			email: profile.user.email,
			image: profile.user.profile_url,
			emailVerified: false
		};
	};
	return {
		providerId: "gumroad",
		authorizationUrl: "https://gumroad.com/oauth/authorize",
		tokenUrl: "https://api.gumroad.com/oauth/token",
		clientId: options.clientId,
		clientSecret: options.clientSecret,
		scopes: options.scopes ?? ["view_profile"],
		redirectURI: options.redirectURI,
		pkce: options.pkce,
		disableImplicitSignUp: options.disableImplicitSignUp,
		disableSignUp: options.disableSignUp,
		overrideUserInfo: options.overrideUserInfo,
		getUserInfo
	};
}
//#endregion
export { gumroad };
