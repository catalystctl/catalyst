import { logger } from "../env/logger.mjs";
import { BetterAuthError } from "../error/index.mjs";
import { createAuthorizationURL } from "../oauth2/create-authorization-url.mjs";
import { refreshAccessToken } from "../oauth2/refresh-access-token.mjs";
import { validateAuthorizationCode } from "../oauth2/validate-authorization-code.mjs";
import { betterFetch } from "@better-fetch/fetch";
//#region src/social-providers/salesforce.ts
const salesforce = (options) => {
	const isSandbox = (options.environment ?? "production") === "sandbox";
	const authorizationEndpoint = options.loginUrl ? `https://${options.loginUrl}/services/oauth2/authorize` : isSandbox ? "https://test.salesforce.com/services/oauth2/authorize" : "https://login.salesforce.com/services/oauth2/authorize";
	const tokenEndpoint = options.loginUrl ? `https://${options.loginUrl}/services/oauth2/token` : isSandbox ? "https://test.salesforce.com/services/oauth2/token" : "https://login.salesforce.com/services/oauth2/token";
	const userInfoEndpoint = options.loginUrl ? `https://${options.loginUrl}/services/oauth2/userinfo` : isSandbox ? "https://test.salesforce.com/services/oauth2/userinfo" : "https://login.salesforce.com/services/oauth2/userinfo";
	return {
		id: "salesforce",
		name: "Salesforce",
		async createAuthorizationURL({ state, scopes, codeVerifier, redirectURI }) {
			if (!options.clientId || !options.clientSecret) {
				logger.error("Client Id and Client Secret are required for Salesforce. Make sure to provide them in the options.");
				throw new BetterAuthError("CLIENT_ID_AND_SECRET_REQUIRED");
			}
			if (!codeVerifier) throw new BetterAuthError("codeVerifier is required for Salesforce");
			const _scopes = options.disableDefaultScope ? [] : [
				"openid",
				"email",
				"profile"
			];
			if (options.scope) _scopes.push(...options.scope);
			if (scopes) _scopes.push(...scopes);
			return createAuthorizationURL({
				id: "salesforce",
				options,
				authorizationEndpoint,
				scopes: _scopes,
				state,
				codeVerifier,
				redirectURI: options.redirectURI || redirectURI
			});
		},
		validateAuthorizationCode: async ({ code, codeVerifier, redirectURI }) => {
			return validateAuthorizationCode({
				code,
				codeVerifier,
				redirectURI: options.redirectURI || redirectURI,
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
			try {
				const { data: user } = await betterFetch(userInfoEndpoint, { headers: { Authorization: `Bearer ${token.accessToken}` } });
				if (!user) {
					logger.error("Failed to fetch user info from Salesforce");
					return null;
				}
				const userMap = await options.mapProfileToUser?.(user);
				return {
					user: {
						id: user.user_id,
						name: user.name,
						email: user.email,
						image: user.photos?.picture || user.photos?.thumbnail,
						emailVerified: user.email_verified ?? false,
						...userMap
					},
					data: user
				};
			} catch (error) {
				logger.error("Failed to fetch user info from Salesforce:", error);
				return null;
			}
		},
		options
	};
};
//#endregion
export { salesforce };
