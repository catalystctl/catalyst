import { logger } from "../env/logger.mjs";
import { APIError } from "better-call";
import { betterFetch } from "@better-fetch/fetch";
import { UnsecuredJWT, createLocalJWKSet, decodeProtectedHeader, jwtVerify } from "jose";
//#region src/oauth2/verify.ts
/** Last fetched jwks used locally in getJwks @internal */
let jwks;
/**
* Performs local verification of an access token for your APIs.
*
* Can also be configured for remote verification.
*/
async function verifyJwsAccessToken(token, opts) {
	try {
		const jwt = await jwtVerify(token, createLocalJWKSet(await getJwks(token, opts)), opts.verifyOptions);
		if (jwt.payload.azp) jwt.payload.client_id = jwt.payload.azp;
		return jwt.payload;
	} catch (error) {
		if (error instanceof Error) throw error;
		throw new Error(error);
	}
}
async function getJwks(token, opts) {
	let jwtHeaders;
	try {
		jwtHeaders = decodeProtectedHeader(token);
	} catch (error) {
		if (error instanceof Error) throw error;
		throw new Error(error);
	}
	if (!jwtHeaders.kid) throw new Error("Missing jwt kid");
	if (!jwks || !jwks.keys.find((jwk) => jwk.kid === jwtHeaders.kid)) {
		jwks = typeof opts.jwksFetch === "string" ? await betterFetch(opts.jwksFetch, { headers: { Accept: "application/json" } }).then(async (res) => {
			if (res.error) throw new Error(`Jwks failed: ${res.error.message ?? res.error.statusText}`);
			return res.data;
		}) : await opts.jwksFetch();
		if (!jwks) throw new Error("No jwks found");
	}
	return jwks;
}
/**
* Performs local verification of an access token for your API.
*
* Can also be configured for remote verification.
*/
async function verifyAccessToken(token, opts) {
	let payload;
	if (opts.jwksUrl && !opts?.remoteVerify?.force) try {
		payload = await verifyJwsAccessToken(token, {
			jwksFetch: opts.jwksUrl,
			verifyOptions: opts.verifyOptions
		});
	} catch (error) {
		if (error instanceof Error) if (error.name === "TypeError" || error.name === "JWSInvalid") {} else if (error.name === "JWTExpired") throw new APIError("UNAUTHORIZED", { message: "token expired" });
		else if (error.name === "JWTInvalid") throw new APIError("UNAUTHORIZED", { message: "token invalid" });
		else throw error;
		else throw new Error(error);
	}
	if (opts?.remoteVerify) {
		const { data: introspect, error: introspectError } = await betterFetch(opts.remoteVerify.introspectUrl, {
			method: "POST",
			headers: {
				Accept: "application/json",
				"Content-Type": "application/x-www-form-urlencoded"
			},
			body: new URLSearchParams({
				client_id: opts.remoteVerify.clientId,
				client_secret: opts.remoteVerify.clientSecret,
				token,
				token_type_hint: "access_token"
			}).toString()
		});
		if (introspectError) logger.error(`Introspection failed: ${introspectError.message ?? introspectError.statusText}`);
		if (!introspect) throw new APIError("INTERNAL_SERVER_ERROR", { message: "introspection failed" });
		if (!introspect.active) throw new APIError("UNAUTHORIZED", { message: "token inactive" });
		try {
			const unsecuredJwt = new UnsecuredJWT(introspect).encode();
			const { audience: _audience, ...verifyOptions } = opts.verifyOptions;
			payload = (introspect.aud ? UnsecuredJWT.decode(unsecuredJwt, opts.verifyOptions) : UnsecuredJWT.decode(unsecuredJwt, verifyOptions)).payload;
		} catch (error) {
			throw new Error(error);
		}
	}
	if (!payload) throw new APIError("UNAUTHORIZED", { message: `no token payload` });
	if (opts.scopes) {
		const validScopes = new Set(payload.scope?.split(" "));
		for (const sc of opts.scopes) if (!validScopes.has(sc)) throw new APIError("FORBIDDEN", { message: `invalid scope ${sc}` });
	}
	return payload;
}
//#endregion
export { getJwks, verifyAccessToken, verifyJwsAccessToken };
