import { createAuthorizationURL } from "../oauth2/create-authorization-url.mjs";
import { refreshAccessToken } from "../oauth2/refresh-access-token.mjs";
import { validateAuthorizationCode } from "../oauth2/validate-authorization-code.mjs";
import { betterFetch } from "@better-fetch/fetch";
//#region src/social-providers/gitlab.ts
const cleanDoubleSlashes = (input = "") => {
	return input.split("://").map((str) => str.replace(/\/{2,}/g, "/")).join("://");
};
const issuerToEndpoints = (issuer) => {
	const baseUrl = issuer || "https://gitlab.com";
	return {
		authorizationEndpoint: cleanDoubleSlashes(`${baseUrl}/oauth/authorize`),
		tokenEndpoint: cleanDoubleSlashes(`${baseUrl}/oauth/token`),
		userinfoEndpoint: cleanDoubleSlashes(`${baseUrl}/api/v4/user`)
	};
};
const gitlab = (options) => {
	const { authorizationEndpoint, tokenEndpoint, userinfoEndpoint } = issuerToEndpoints(options.issuer);
	const issuerId = "gitlab";
	return {
		id: issuerId,
		name: "Gitlab",
		createAuthorizationURL: async ({ state, scopes, codeVerifier, loginHint, redirectURI }) => {
			const _scopes = options.disableDefaultScope ? [] : ["read_user"];
			if (options.scope) _scopes.push(...options.scope);
			if (scopes) _scopes.push(...scopes);
			return await createAuthorizationURL({
				id: issuerId,
				options,
				authorizationEndpoint,
				scopes: _scopes,
				state,
				redirectURI,
				codeVerifier,
				loginHint
			});
		},
		validateAuthorizationCode: async ({ code, redirectURI, codeVerifier }) => {
			return validateAuthorizationCode({
				code,
				redirectURI,
				options,
				codeVerifier,
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
			const { data: profile, error } = await betterFetch(userinfoEndpoint, { headers: { authorization: `Bearer ${token.accessToken}` } });
			if (error || profile.state !== "active" || profile.locked) return null;
			const userMap = await options.mapProfileToUser?.(profile);
			return {
				user: {
					id: profile.id,
					name: profile.name ?? profile.username ?? "",
					email: profile.email,
					image: profile.avatar_url,
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
export { gitlab };
