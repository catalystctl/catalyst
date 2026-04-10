import { logger } from "../env/logger.mjs";
import { BetterAuthError } from "../error/index.mjs";
import { createAuthorizationURL } from "../oauth2/create-authorization-url.mjs";
import { refreshAccessToken } from "../oauth2/refresh-access-token.mjs";
import { validateAuthorizationCode } from "../oauth2/validate-authorization-code.mjs";
import { betterFetch } from "@better-fetch/fetch";
//#region src/social-providers/figma.ts
const figma = (options) => {
	const tokenEndpoint = "https://api.figma.com/v1/oauth/token";
	return {
		id: "figma",
		name: "Figma",
		async createAuthorizationURL({ state, scopes, codeVerifier, redirectURI }) {
			if (!options.clientId || !options.clientSecret) {
				logger.error("Client Id and Client Secret are required for Figma. Make sure to provide them in the options.");
				throw new BetterAuthError("CLIENT_ID_AND_SECRET_REQUIRED");
			}
			if (!codeVerifier) throw new BetterAuthError("codeVerifier is required for Figma");
			const _scopes = options.disableDefaultScope ? [] : ["current_user:read"];
			if (options.scope) _scopes.push(...options.scope);
			if (scopes) _scopes.push(...scopes);
			return await createAuthorizationURL({
				id: "figma",
				options,
				authorizationEndpoint: "https://www.figma.com/oauth",
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
				tokenEndpoint,
				authentication: "basic"
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
				tokenEndpoint,
				authentication: "basic"
			});
		},
		async getUserInfo(token) {
			if (options.getUserInfo) return options.getUserInfo(token);
			try {
				const { data: profile } = await betterFetch("https://api.figma.com/v1/me", { headers: { Authorization: `Bearer ${token.accessToken}` } });
				if (!profile) {
					logger.error("Failed to fetch user from Figma");
					return null;
				}
				const userMap = await options.mapProfileToUser?.(profile);
				return {
					user: {
						id: profile.id,
						name: profile.handle,
						email: profile.email,
						image: profile.img_url,
						emailVerified: false,
						...userMap
					},
					data: profile
				};
			} catch (error) {
				logger.error("Failed to fetch user info from Figma:", error);
				return null;
			}
		},
		options
	};
};
//#endregion
export { figma };
