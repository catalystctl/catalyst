import { createAuthorizationURL } from "../oauth2/create-authorization-url.mjs";
import { refreshAccessToken } from "../oauth2/refresh-access-token.mjs";
import { validateAuthorizationCode } from "../oauth2/validate-authorization-code.mjs";
import { betterFetch } from "@better-fetch/fetch";
//#region src/social-providers/linkedin.ts
const linkedin = (options) => {
	const authorizationEndpoint = "https://www.linkedin.com/oauth/v2/authorization";
	const tokenEndpoint = "https://www.linkedin.com/oauth/v2/accessToken";
	return {
		id: "linkedin",
		name: "Linkedin",
		createAuthorizationURL: async ({ state, scopes, redirectURI, loginHint }) => {
			const _scopes = options.disableDefaultScope ? [] : [
				"profile",
				"email",
				"openid"
			];
			if (options.scope) _scopes.push(...options.scope);
			if (scopes) _scopes.push(...scopes);
			return await createAuthorizationURL({
				id: "linkedin",
				options,
				authorizationEndpoint,
				scopes: _scopes,
				state,
				loginHint,
				redirectURI
			});
		},
		validateAuthorizationCode: async ({ code, redirectURI }) => {
			return await validateAuthorizationCode({
				code,
				redirectURI,
				options,
				tokenEndpoint
			});
		},
		refreshAccessToken: options.refreshAccessToken ? options.refreshAccessToken : async (refreshToken) => {
			return refreshAccessToken({
				refreshToken,
				options: {
					clientId: options.clientId,
					clientKey: options.clientKey,
					clientSecret: options.clientSecret
				},
				tokenEndpoint
			});
		},
		async getUserInfo(token) {
			if (options.getUserInfo) return options.getUserInfo(token);
			const { data: profile, error } = await betterFetch("https://api.linkedin.com/v2/userinfo", {
				method: "GET",
				headers: { Authorization: `Bearer ${token.accessToken}` }
			});
			if (error) return null;
			const userMap = await options.mapProfileToUser?.(profile);
			return {
				user: {
					id: profile.sub,
					name: profile.name,
					email: profile.email,
					emailVerified: profile.email_verified || false,
					image: profile.picture,
					...userMap
				},
				data: profile
			};
		},
		options
	};
};
//#endregion
export { linkedin };
