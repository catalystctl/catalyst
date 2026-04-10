import { createAuthorizationURL } from "../oauth2/create-authorization-url.mjs";
import { refreshAccessToken } from "../oauth2/refresh-access-token.mjs";
import { validateAuthorizationCode } from "../oauth2/validate-authorization-code.mjs";
import { betterFetch } from "@better-fetch/fetch";
//#region src/social-providers/kakao.ts
const kakao = (options) => {
	const tokenEndpoint = "https://kauth.kakao.com/oauth/token";
	return {
		id: "kakao",
		name: "Kakao",
		createAuthorizationURL({ state, scopes, redirectURI }) {
			const _scopes = options.disableDefaultScope ? [] : [
				"account_email",
				"profile_image",
				"profile_nickname"
			];
			if (options.scope) _scopes.push(...options.scope);
			if (scopes) _scopes.push(...scopes);
			return createAuthorizationURL({
				id: "kakao",
				options,
				authorizationEndpoint: "https://kauth.kakao.com/oauth/authorize",
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
			const { data: profile, error } = await betterFetch("https://kapi.kakao.com/v2/user/me", { headers: { Authorization: `Bearer ${token.accessToken}` } });
			if (error || !profile) return null;
			const userMap = await options.mapProfileToUser?.(profile);
			const account = profile.kakao_account || {};
			const kakaoProfile = account.profile || {};
			return {
				user: {
					id: String(profile.id),
					name: kakaoProfile.nickname || account.name || "",
					email: account.email,
					image: kakaoProfile.profile_image_url || kakaoProfile.thumbnail_image_url,
					emailVerified: !!account.is_email_valid && !!account.is_email_verified,
					...userMap
				},
				data: profile
			};
		},
		options
	};
};
//#endregion
export { kakao };
