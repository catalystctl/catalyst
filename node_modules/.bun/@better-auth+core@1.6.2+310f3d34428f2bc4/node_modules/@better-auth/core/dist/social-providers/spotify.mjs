import { createAuthorizationURL } from "../oauth2/create-authorization-url.mjs";
import { refreshAccessToken } from "../oauth2/refresh-access-token.mjs";
import { validateAuthorizationCode } from "../oauth2/validate-authorization-code.mjs";
import { betterFetch } from "@better-fetch/fetch";
//#region src/social-providers/spotify.ts
const spotify = (options) => {
	const tokenEndpoint = "https://accounts.spotify.com/api/token";
	return {
		id: "spotify",
		name: "Spotify",
		createAuthorizationURL({ state, scopes, codeVerifier, redirectURI }) {
			const _scopes = options.disableDefaultScope ? [] : ["user-read-email"];
			if (options.scope) _scopes.push(...options.scope);
			if (scopes) _scopes.push(...scopes);
			return createAuthorizationURL({
				id: "spotify",
				options,
				authorizationEndpoint: "https://accounts.spotify.com/authorize",
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
			const { data: profile, error } = await betterFetch("https://api.spotify.com/v1/me", {
				method: "GET",
				headers: { Authorization: `Bearer ${token.accessToken}` }
			});
			if (error) return null;
			const userMap = await options.mapProfileToUser?.(profile);
			return {
				user: {
					id: profile.id,
					name: profile.display_name,
					email: profile.email,
					image: profile.images[0]?.url,
					emailVerified: false,
					...userMap
				},
				data: profile
			};
		},
		options
	};
};
//#endregion
export { spotify };
