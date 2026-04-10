import { refreshAccessToken } from "../oauth2/refresh-access-token.mjs";
import { validateAuthorizationCode } from "../oauth2/validate-authorization-code.mjs";
import { betterFetch } from "@better-fetch/fetch";
//#region src/social-providers/tiktok.ts
const tiktok = (options) => {
	const tokenEndpoint = "https://open.tiktokapis.com/v2/oauth/token/";
	return {
		id: "tiktok",
		name: "TikTok",
		createAuthorizationURL({ state, scopes, redirectURI }) {
			const _scopes = options.disableDefaultScope ? [] : ["user.info.profile"];
			if (options.scope) _scopes.push(...options.scope);
			if (scopes) _scopes.push(...scopes);
			return new URL(`https://www.tiktok.com/v2/auth/authorize?scope=${_scopes.join(",")}&response_type=code&client_key=${options.clientKey}&redirect_uri=${encodeURIComponent(options.redirectURI || redirectURI)}&state=${state}`);
		},
		validateAuthorizationCode: async ({ code, redirectURI }) => {
			return validateAuthorizationCode({
				code,
				redirectURI: options.redirectURI || redirectURI,
				options: {
					clientKey: options.clientKey,
					clientSecret: options.clientSecret
				},
				tokenEndpoint
			});
		},
		refreshAccessToken: options.refreshAccessToken ? options.refreshAccessToken : async (refreshToken) => {
			return refreshAccessToken({
				refreshToken,
				options: { clientSecret: options.clientSecret },
				tokenEndpoint,
				authentication: "post",
				extraParams: { client_key: options.clientKey }
			});
		},
		async getUserInfo(token) {
			if (options.getUserInfo) return options.getUserInfo(token);
			const { data: profile, error } = await betterFetch(`https://open.tiktokapis.com/v2/user/info/?fields=${[
				"open_id",
				"avatar_large_url",
				"display_name",
				"username"
			].join(",")}`, { headers: { authorization: `Bearer ${token.accessToken}` } });
			if (error) return null;
			return {
				user: {
					email: profile.data.user.email || profile.data.user.username,
					id: profile.data.user.open_id,
					name: profile.data.user.display_name || profile.data.user.username || "",
					image: profile.data.user.avatar_large_url,
					emailVerified: false
				},
				data: profile
			};
		},
		options
	};
};
//#endregion
export { tiktok };
