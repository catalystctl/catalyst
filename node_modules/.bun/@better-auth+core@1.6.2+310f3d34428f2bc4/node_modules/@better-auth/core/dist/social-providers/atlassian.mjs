import { logger } from "../env/logger.mjs";
import { BetterAuthError } from "../error/index.mjs";
import { createAuthorizationURL } from "../oauth2/create-authorization-url.mjs";
import { refreshAccessToken } from "../oauth2/refresh-access-token.mjs";
import { validateAuthorizationCode } from "../oauth2/validate-authorization-code.mjs";
import { betterFetch } from "@better-fetch/fetch";
//#region src/social-providers/atlassian.ts
const atlassian = (options) => {
	const tokenEndpoint = "https://auth.atlassian.com/oauth/token";
	return {
		id: "atlassian",
		name: "Atlassian",
		async createAuthorizationURL({ state, scopes, codeVerifier, redirectURI }) {
			if (!options.clientId || !options.clientSecret) {
				logger.error("Client Id and Secret are required for Atlassian");
				throw new BetterAuthError("CLIENT_ID_AND_SECRET_REQUIRED");
			}
			if (!codeVerifier) throw new BetterAuthError("codeVerifier is required for Atlassian");
			const _scopes = options.disableDefaultScope ? [] : ["read:jira-user", "offline_access"];
			if (options.scope) _scopes.push(...options.scope);
			if (scopes) _scopes.push(...scopes);
			return createAuthorizationURL({
				id: "atlassian",
				options,
				authorizationEndpoint: "https://auth.atlassian.com/authorize",
				scopes: _scopes,
				state,
				codeVerifier,
				redirectURI,
				additionalParams: { audience: "api.atlassian.com" },
				prompt: options.prompt
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
					clientSecret: options.clientSecret
				},
				tokenEndpoint
			});
		},
		async getUserInfo(token) {
			if (options.getUserInfo) return options.getUserInfo(token);
			if (!token.accessToken) return null;
			try {
				const { data: profile } = await betterFetch("https://api.atlassian.com/me", { headers: { Authorization: `Bearer ${token.accessToken}` } });
				if (!profile) return null;
				const userMap = await options.mapProfileToUser?.(profile);
				return {
					user: {
						id: profile.account_id,
						name: profile.name,
						email: profile.email,
						image: profile.picture,
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
export { atlassian };
