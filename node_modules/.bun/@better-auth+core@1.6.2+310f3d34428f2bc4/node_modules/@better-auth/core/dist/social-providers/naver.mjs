import { createAuthorizationURL } from "../oauth2/create-authorization-url.mjs";
import { refreshAccessToken } from "../oauth2/refresh-access-token.mjs";
import { validateAuthorizationCode } from "../oauth2/validate-authorization-code.mjs";
import { betterFetch } from "@better-fetch/fetch";
//#region src/social-providers/naver.ts
const naver = (options) => {
	const tokenEndpoint = "https://nid.naver.com/oauth2.0/token";
	return {
		id: "naver",
		name: "Naver",
		createAuthorizationURL({ state, scopes, redirectURI }) {
			const _scopes = options.disableDefaultScope ? [] : ["profile", "email"];
			if (options.scope) _scopes.push(...options.scope);
			if (scopes) _scopes.push(...scopes);
			return createAuthorizationURL({
				id: "naver",
				options,
				authorizationEndpoint: "https://nid.naver.com/oauth2.0/authorize",
				scopes: _scopes,
				state,
				redirectURI
			});
		},
		validateAuthorizationCode: async ({ code, redirectURI }) => {
			return validateAuthorizationCode({
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
			const { data: profile, error } = await betterFetch("https://openapi.naver.com/v1/nid/me", { headers: { Authorization: `Bearer ${token.accessToken}` } });
			if (error || !profile || profile.resultcode !== "00") return null;
			const userMap = await options.mapProfileToUser?.(profile);
			const res = profile.response || {};
			return {
				user: {
					id: res.id,
					name: res.name || res.nickname || "",
					email: res.email,
					image: res.profile_image,
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
export { naver };
