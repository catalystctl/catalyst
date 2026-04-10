import { createAuthorizationURL } from "../oauth2/create-authorization-url.mjs";
import { refreshAccessToken } from "../oauth2/refresh-access-token.mjs";
import { validateAuthorizationCode } from "../oauth2/validate-authorization-code.mjs";
import { betterFetch } from "@better-fetch/fetch";
import { createRemoteJWKSet, decodeJwt, jwtVerify } from "jose";
//#region src/social-providers/facebook.ts
const facebook = (options) => {
	return {
		id: "facebook",
		name: "Facebook",
		async createAuthorizationURL({ state, scopes, redirectURI, loginHint }) {
			const _scopes = options.disableDefaultScope ? [] : ["email", "public_profile"];
			if (options.scope) _scopes.push(...options.scope);
			if (scopes) _scopes.push(...scopes);
			return await createAuthorizationURL({
				id: "facebook",
				options,
				authorizationEndpoint: "https://www.facebook.com/v24.0/dialog/oauth",
				scopes: _scopes,
				state,
				redirectURI,
				loginHint,
				additionalParams: options.configId ? { config_id: options.configId } : {}
			});
		},
		validateAuthorizationCode: async ({ code, redirectURI }) => {
			return validateAuthorizationCode({
				code,
				redirectURI,
				options,
				tokenEndpoint: "https://graph.facebook.com/v24.0/oauth/access_token"
			});
		},
		async verifyIdToken(token, nonce) {
			if (options.disableIdTokenSignIn) return false;
			if (options.verifyIdToken) return options.verifyIdToken(token, nonce);
			if (token.split(".").length === 3) try {
				const { payload: jwtClaims } = await jwtVerify(token, createRemoteJWKSet(new URL("https://limited.facebook.com/.well-known/oauth/openid/jwks/")), {
					algorithms: ["RS256"],
					audience: options.clientId,
					issuer: "https://www.facebook.com"
				});
				if (nonce && jwtClaims.nonce !== nonce) return false;
				return !!jwtClaims;
			} catch {
				return false;
			}
			return true;
		},
		refreshAccessToken: options.refreshAccessToken ? options.refreshAccessToken : async (refreshToken) => {
			return refreshAccessToken({
				refreshToken,
				options: {
					clientId: options.clientId,
					clientKey: options.clientKey,
					clientSecret: options.clientSecret
				},
				tokenEndpoint: "https://graph.facebook.com/v24.0/oauth/access_token"
			});
		},
		async getUserInfo(token) {
			if (options.getUserInfo) return options.getUserInfo(token);
			if (token.idToken && token.idToken.split(".").length === 3) {
				const profile = decodeJwt(token.idToken);
				const user = {
					id: profile.sub,
					name: profile.name,
					email: profile.email,
					picture: { data: {
						url: profile.picture,
						height: 100,
						width: 100,
						is_silhouette: false
					} }
				};
				const userMap = await options.mapProfileToUser?.({
					...user,
					email_verified: false
				});
				return {
					user: {
						...user,
						emailVerified: false,
						...userMap
					},
					data: profile
				};
			}
			const { data: profile, error } = await betterFetch("https://graph.facebook.com/me?fields=" + [
				"id",
				"name",
				"email",
				"picture",
				...options?.fields || []
			].join(","), { auth: {
				type: "Bearer",
				token: token.accessToken
			} });
			if (error) return null;
			const userMap = await options.mapProfileToUser?.(profile);
			return {
				user: {
					id: profile.id,
					name: profile.name,
					email: profile.email,
					image: profile.picture.data.url,
					emailVerified: profile.email_verified,
					...userMap
				},
				data: profile
			};
		},
		options
	};
};
//#endregion
export { facebook };
