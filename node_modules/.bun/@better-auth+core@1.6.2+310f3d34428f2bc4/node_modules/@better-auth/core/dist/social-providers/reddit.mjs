import { getOAuth2Tokens } from "../oauth2/utils.mjs";
import { createAuthorizationURL } from "../oauth2/create-authorization-url.mjs";
import { refreshAccessToken } from "../oauth2/refresh-access-token.mjs";
import { base64 } from "@better-auth/utils/base64";
import { betterFetch } from "@better-fetch/fetch";
//#region src/social-providers/reddit.ts
const reddit = (options) => {
	return {
		id: "reddit",
		name: "Reddit",
		createAuthorizationURL({ state, scopes, redirectURI }) {
			const _scopes = options.disableDefaultScope ? [] : ["identity"];
			if (options.scope) _scopes.push(...options.scope);
			if (scopes) _scopes.push(...scopes);
			return createAuthorizationURL({
				id: "reddit",
				options,
				authorizationEndpoint: "https://www.reddit.com/api/v1/authorize",
				scopes: _scopes,
				state,
				redirectURI,
				duration: options.duration
			});
		},
		validateAuthorizationCode: async ({ code, redirectURI }) => {
			const body = new URLSearchParams({
				grant_type: "authorization_code",
				code,
				redirect_uri: options.redirectURI || redirectURI
			});
			const { data, error } = await betterFetch("https://www.reddit.com/api/v1/access_token", {
				method: "POST",
				headers: {
					"content-type": "application/x-www-form-urlencoded",
					accept: "text/plain",
					"user-agent": "better-auth",
					Authorization: `Basic ${base64.encode(`${options.clientId}:${options.clientSecret}`)}`
				},
				body: body.toString()
			});
			if (error) throw error;
			return getOAuth2Tokens(data);
		},
		refreshAccessToken: options.refreshAccessToken ? options.refreshAccessToken : async (refreshToken) => {
			return refreshAccessToken({
				refreshToken,
				options: {
					clientId: options.clientId,
					clientKey: options.clientKey,
					clientSecret: options.clientSecret
				},
				authentication: "basic",
				tokenEndpoint: "https://www.reddit.com/api/v1/access_token"
			});
		},
		async getUserInfo(token) {
			if (options.getUserInfo) return options.getUserInfo(token);
			const { data: profile, error } = await betterFetch("https://oauth.reddit.com/api/v1/me", { headers: {
				Authorization: `Bearer ${token.accessToken}`,
				"User-Agent": "better-auth"
			} });
			if (error) return null;
			const userMap = await options.mapProfileToUser?.(profile);
			return {
				user: {
					id: profile.id,
					name: profile.name,
					email: profile.oauth_client_id,
					emailVerified: profile.has_verified_email,
					image: profile.icon_img?.split("?")[0],
					...userMap
				},
				data: profile
			};
		},
		options
	};
};
//#endregion
export { reddit };
