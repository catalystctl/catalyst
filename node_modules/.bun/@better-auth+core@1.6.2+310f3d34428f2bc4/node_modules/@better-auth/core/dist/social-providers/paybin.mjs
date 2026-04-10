import { logger } from "../env/logger.mjs";
import { BetterAuthError } from "../error/index.mjs";
import { createAuthorizationURL } from "../oauth2/create-authorization-url.mjs";
import { refreshAccessToken } from "../oauth2/refresh-access-token.mjs";
import { validateAuthorizationCode } from "../oauth2/validate-authorization-code.mjs";
import { decodeJwt } from "jose";
//#region src/social-providers/paybin.ts
const paybin = (options) => {
	const issuer = options.issuer || "https://idp.paybin.io";
	const authorizationEndpoint = `${issuer}/oauth2/authorize`;
	const tokenEndpoint = `${issuer}/oauth2/token`;
	return {
		id: "paybin",
		name: "Paybin",
		async createAuthorizationURL({ state, scopes, codeVerifier, redirectURI, loginHint }) {
			if (!options.clientId || !options.clientSecret) {
				logger.error("Client Id and Client Secret is required for Paybin. Make sure to provide them in the options.");
				throw new BetterAuthError("CLIENT_ID_AND_SECRET_REQUIRED");
			}
			if (!codeVerifier) throw new BetterAuthError("codeVerifier is required for Paybin");
			const _scopes = options.disableDefaultScope ? [] : [
				"openid",
				"email",
				"profile"
			];
			if (options.scope) _scopes.push(...options.scope);
			if (scopes) _scopes.push(...scopes);
			return await createAuthorizationURL({
				id: "paybin",
				options,
				authorizationEndpoint,
				scopes: _scopes,
				state,
				codeVerifier,
				redirectURI,
				prompt: options.prompt,
				loginHint
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
			if (!token.idToken) return null;
			const user = decodeJwt(token.idToken);
			const userMap = await options.mapProfileToUser?.(user);
			return {
				user: {
					id: user.sub,
					name: user.name || user.preferred_username || "",
					email: user.email,
					image: user.picture,
					emailVerified: user.email_verified || false,
					...userMap
				},
				data: user
			};
		},
		options
	};
};
//#endregion
export { paybin };
