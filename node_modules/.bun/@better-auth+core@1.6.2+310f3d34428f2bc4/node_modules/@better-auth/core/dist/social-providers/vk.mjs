import { createAuthorizationURL } from "../oauth2/create-authorization-url.mjs";
import { refreshAccessToken } from "../oauth2/refresh-access-token.mjs";
import { validateAuthorizationCode } from "../oauth2/validate-authorization-code.mjs";
import { betterFetch } from "@better-fetch/fetch";
//#region src/social-providers/vk.ts
const vk = (options) => {
	const tokenEndpoint = "https://id.vk.com/oauth2/auth";
	return {
		id: "vk",
		name: "VK",
		async createAuthorizationURL({ state, scopes, codeVerifier, redirectURI }) {
			const _scopes = options.disableDefaultScope ? [] : ["email", "phone"];
			if (options.scope) _scopes.push(...options.scope);
			if (scopes) _scopes.push(...scopes);
			return createAuthorizationURL({
				id: "vk",
				options,
				authorizationEndpoint: "https://id.vk.com/authorize",
				scopes: _scopes,
				state,
				redirectURI,
				codeVerifier
			});
		},
		validateAuthorizationCode: async ({ code, codeVerifier, redirectURI, deviceId }) => {
			return validateAuthorizationCode({
				code,
				codeVerifier,
				redirectURI: options.redirectURI || redirectURI,
				options,
				deviceId,
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
		async getUserInfo(data) {
			if (options.getUserInfo) return options.getUserInfo(data);
			if (!data.accessToken) return null;
			const formBody = new URLSearchParams({
				access_token: data.accessToken,
				client_id: options.clientId
			}).toString();
			const { data: profile, error } = await betterFetch("https://id.vk.com/oauth2/user_info", {
				method: "POST",
				headers: { "Content-Type": "application/x-www-form-urlencoded" },
				body: formBody
			});
			if (error) return null;
			const userMap = await options.mapProfileToUser?.(profile);
			if (!profile.user.email && !userMap?.email) return null;
			return {
				user: {
					id: profile.user.user_id,
					first_name: profile.user.first_name,
					last_name: profile.user.last_name,
					email: profile.user.email,
					image: profile.user.avatar,
					emailVerified: false,
					birthday: profile.user.birthday,
					sex: profile.user.sex,
					name: `${profile.user.first_name} ${profile.user.last_name}`,
					...userMap
				},
				data: profile
			};
		},
		options
	};
};
//#endregion
export { vk };
