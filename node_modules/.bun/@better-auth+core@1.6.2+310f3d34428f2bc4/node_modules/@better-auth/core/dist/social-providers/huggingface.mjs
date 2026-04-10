import { createAuthorizationURL } from "../oauth2/create-authorization-url.mjs";
import { refreshAccessToken } from "../oauth2/refresh-access-token.mjs";
import { validateAuthorizationCode } from "../oauth2/validate-authorization-code.mjs";
import { betterFetch } from "@better-fetch/fetch";
//#region src/social-providers/huggingface.ts
const huggingface = (options) => {
	const tokenEndpoint = "https://huggingface.co/oauth/token";
	return {
		id: "huggingface",
		name: "Hugging Face",
		createAuthorizationURL({ state, scopes, codeVerifier, redirectURI }) {
			const _scopes = options.disableDefaultScope ? [] : [
				"openid",
				"profile",
				"email"
			];
			if (options.scope) _scopes.push(...options.scope);
			if (scopes) _scopes.push(...scopes);
			return createAuthorizationURL({
				id: "huggingface",
				options,
				authorizationEndpoint: "https://huggingface.co/oauth/authorize",
				scopes: _scopes,
				state,
				codeVerifier,
				redirectURI
			});
		},
		validateAuthorizationCode: async ({ code, codeVerifier, redirectURI }) => {
			return validateAuthorizationCode({
				code,
				codeVerifier,
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
			const { data: profile, error } = await betterFetch("https://huggingface.co/oauth/userinfo", {
				method: "GET",
				headers: { Authorization: `Bearer ${token.accessToken}` }
			});
			if (error) return null;
			const userMap = await options.mapProfileToUser?.(profile);
			return {
				user: {
					id: profile.sub,
					name: profile.name || profile.preferred_username || "",
					email: profile.email,
					image: profile.picture,
					emailVerified: profile.email_verified ?? false,
					...userMap
				},
				data: profile
			};
		},
		options
	};
};
//#endregion
export { huggingface };
