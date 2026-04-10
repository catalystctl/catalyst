import { makeSignature } from "../../crypto/index.mjs";
//#region src/plugins/test-utils/cookie-builder.ts
/**
* Signs a cookie value using HMAC-SHA256
*/
async function signCookieValue(value, secret) {
	return `${value}.${await makeSignature(value, secret)}`;
}
/**
* Creates a test cookie with proper signing and attributes
*/
async function createTestCookie(ctx, sessionToken, domain) {
	const secret = ctx.secret;
	const signedToken = await signCookieValue(sessionToken, secret);
	const cookieName = ctx.authCookies.sessionToken.name;
	const cookieAttrs = ctx.authCookies.sessionToken.attributes;
	return [{
		name: cookieName,
		value: signedToken,
		domain: domain || getDomainFromBaseURL(ctx.baseURL),
		path: cookieAttrs.path || "/",
		httpOnly: cookieAttrs.httpOnly ?? true,
		secure: cookieAttrs.secure ?? false,
		sameSite: normalizeSameSite(cookieAttrs.sameSite),
		expires: cookieAttrs.maxAge ? Math.floor(Date.now() / 1e3) + cookieAttrs.maxAge : void 0
	}];
}
/**
* Creates a Headers object with the cookie header set
*/
async function createCookieHeaders(ctx, sessionToken) {
	const secret = ctx.secret;
	const signedToken = await signCookieValue(sessionToken, secret);
	const cookieName = ctx.authCookies.sessionToken.name;
	const headers = new Headers();
	headers.set("cookie", `${cookieName}=${signedToken}`);
	return headers;
}
function getDomainFromBaseURL(baseURL) {
	try {
		return new URL(baseURL).hostname;
	} catch {
		return "localhost";
	}
}
function normalizeSameSite(sameSite) {
	if (typeof sameSite === "string") {
		const lower = sameSite.toLowerCase();
		if (lower === "strict") return "Strict";
		if (lower === "none") return "None";
	}
	return "Lax";
}
//#endregion
export { createCookieHeaders, createTestCookie };
