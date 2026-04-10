import { logger } from "../env/logger.mjs";
import { APIError } from "../error/index.mjs";
import { createAuthorizationURL } from "../oauth2/create-authorization-url.mjs";
import { refreshAccessToken } from "../oauth2/refresh-access-token.mjs";
import { validateAuthorizationCode } from "../oauth2/validate-authorization-code.mjs";
import { base64 } from "@better-auth/utils/base64";
import { betterFetch } from "@better-fetch/fetch";
import { decodeJwt, decodeProtectedHeader, importJWK, jwtVerify } from "jose";
//#region src/social-providers/microsoft-entra-id.ts
const microsoft = (options) => {
	const tenant = options.tenantId || "common";
	const authority = options.authority || "https://login.microsoftonline.com";
	const authorizationEndpoint = `${authority}/${tenant}/oauth2/v2.0/authorize`;
	const tokenEndpoint = `${authority}/${tenant}/oauth2/v2.0/token`;
	return {
		id: "microsoft",
		name: "Microsoft EntraID",
		createAuthorizationURL(data) {
			const scopes = options.disableDefaultScope ? [] : [
				"openid",
				"profile",
				"email",
				"User.Read",
				"offline_access"
			];
			if (options.scope) scopes.push(...options.scope);
			if (data.scopes) scopes.push(...data.scopes);
			return createAuthorizationURL({
				id: "microsoft",
				options,
				authorizationEndpoint,
				state: data.state,
				codeVerifier: data.codeVerifier,
				scopes,
				redirectURI: data.redirectURI,
				prompt: options.prompt,
				loginHint: data.loginHint
			});
		},
		validateAuthorizationCode({ code, codeVerifier, redirectURI }) {
			return validateAuthorizationCode({
				code,
				codeVerifier,
				redirectURI,
				options,
				tokenEndpoint
			});
		},
		async verifyIdToken(token, nonce) {
			if (options.disableIdTokenSignIn) return false;
			if (options.verifyIdToken) return options.verifyIdToken(token, nonce);
			try {
				const { kid, alg: jwtAlg } = decodeProtectedHeader(token);
				if (!kid || !jwtAlg) return false;
				const publicKey = await getMicrosoftPublicKey(kid, tenant, authority);
				const verifyOptions = {
					algorithms: [jwtAlg],
					audience: options.clientId,
					maxTokenAge: "1h"
				};
				/**
				* Issuer varies per user's tenant for multi-tenant endpoints, so only validate for specific tenants.
				* @see https://learn.microsoft.com/en-us/entra/identity-platform/v2-protocols#endpoints
				*/
				if (tenant !== "common" && tenant !== "organizations" && tenant !== "consumers") verifyOptions.issuer = `${authority}/${tenant}/v2.0`;
				const { payload: jwtClaims } = await jwtVerify(token, publicKey, verifyOptions);
				if (nonce && jwtClaims.nonce !== nonce) return false;
				return true;
			} catch (error) {
				logger.error("Failed to verify ID token:", error);
				return false;
			}
		},
		async getUserInfo(token) {
			if (options.getUserInfo) return options.getUserInfo(token);
			if (!token.idToken) return null;
			const user = decodeJwt(token.idToken);
			const profilePhotoSize = options.profilePhotoSize || 48;
			await betterFetch(`https://graph.microsoft.com/v1.0/me/photos/${profilePhotoSize}x${profilePhotoSize}/$value`, {
				headers: { Authorization: `Bearer ${token.accessToken}` },
				async onResponse(context) {
					if (options.disableProfilePhoto || !context.response.ok) return;
					try {
						const pictureBuffer = await context.response.clone().arrayBuffer();
						user.picture = `data:image/jpeg;base64, ${base64.encode(pictureBuffer)}`;
					} catch (e) {
						logger.error(e && typeof e === "object" && "name" in e ? e.name : "", e);
					}
				}
			});
			const userMap = await options.mapProfileToUser?.(user);
			const emailVerified = user.email_verified !== void 0 ? user.email_verified : user.email && (user.verified_primary_email?.includes(user.email) || user.verified_secondary_email?.includes(user.email)) ? true : false;
			return {
				user: {
					id: user.sub,
					name: user.name,
					email: user.email,
					image: user.picture,
					emailVerified,
					...userMap
				},
				data: user
			};
		},
		refreshAccessToken: options.refreshAccessToken ? options.refreshAccessToken : async (refreshToken) => {
			const scopes = options.disableDefaultScope ? [] : [
				"openid",
				"profile",
				"email",
				"User.Read",
				"offline_access"
			];
			if (options.scope) scopes.push(...options.scope);
			return refreshAccessToken({
				refreshToken,
				options: {
					clientId: options.clientId,
					clientSecret: options.clientSecret
				},
				extraParams: { scope: scopes.join(" ") },
				tokenEndpoint
			});
		},
		options
	};
};
const getMicrosoftPublicKey = async (kid, tenant, authority) => {
	const { data } = await betterFetch(`${authority}/${tenant}/discovery/v2.0/keys`);
	if (!data?.keys) throw new APIError("BAD_REQUEST", { message: "Keys not found" });
	const jwk = data.keys.find((key) => key.kid === kid);
	if (!jwk) throw new Error(`JWK with kid ${kid} not found`);
	return await importJWK(jwk, jwk.alg);
};
//#endregion
export { getMicrosoftPublicKey, microsoft };
